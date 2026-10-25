#!/usr/bin/env python3
"""ConfigSync: run the Home Assistant config mirror on a schedule.

Keeps a clone of the private config-history repo in /data/repo and runs its
own bin/ha-sync.sh in local mode against the read-only HA config mount. All
filtering, redaction and secret scanning lives in that private repo; this
file only schedules, authenticates and reports.

Python standard library only.
"""
from __future__ import annotations

import json
import logging
import os
import re
import select
import shlex
import shutil
import signal
import subprocess
import sys
import textwrap
import threading
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

log = logging.getLogger("configsync")

DEFAULT_API = "http://supervisor/core/api"
SENSOR = "sensor.configsync_last_run"
SYNC_TIMEOUT = 15 * 60
REPOST_EVERY = 10 * 60
GIT_TIMEOUT = 5 * 60

KEY_ERROR = "deploy key is not a valid private key"
REQUIRED_OPTIONS = ("repository", "deploy_key", "git_author_email")
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
ERROR_CAP = 500

_PEM = re.compile(r"-----BEGIN ([A-Z0-9 ]+)-----(.*?)-----END \1-----", re.DOTALL)
_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def repair_key(text: str) -> str:
    """Rebuild a private key whose line breaks were lost or mangled.

    The HA options UI shows `password` fields as single-line inputs, so a
    pasted OpenSSH key can arrive with its newlines turned into spaces."""
    match = _PEM.search(text.replace("\r\n", "\n"))
    if not match:
        raise ValueError(KEY_ERROR)
    label = match.group(1)
    body = re.sub(r"\s+", "", match.group(2))
    if not body:
        raise ValueError(KEY_ERROR)
    lines = "\n".join(textwrap.wrap(body, 70))
    return f"-----BEGIN {label}-----\n{lines}\n-----END {label}-----\n"


def validate_key(path: Path) -> str:
    """Return the key's SHA256 fingerprint, or raise ValueError(KEY_ERROR).

    `-P ""` makes a passphrase-protected key fail at once instead of
    prompting. ssh-keygen's own output is never passed on: it can quote the
    file it was given."""
    try:
        public = subprocess.run(
            ["ssh-keygen", "-y", "-P", "", "-f", str(path)],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=5, check=True,
        ).stdout
        listing = subprocess.run(
            ["ssh-keygen", "-l", "-f", "-"],
            input=public, capture_output=True, text=True, timeout=5, check=True,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        raise ValueError(KEY_ERROR) from None
    fingerprint = next((part for part in listing.split() if part.startswith("SHA256:")), "")
    if not fingerprint:
        raise ValueError(KEY_ERROR)
    return fingerprint


def missing_options(opts: dict) -> list[str]:
    """Names of required options that are empty or absent, in a fixed order."""
    return [name for name in REQUIRED_OPTIONS if not str(opts.get(name) or "").strip()]


def next_run(now: datetime, frequency: str, hhmm: str, weekday: str) -> datetime:
    """The first scheduled slot strictly after `now` (timezone-aware)."""
    hour, minute = (int(part) for part in hhmm.split(":"))
    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    if frequency == "weekly":
        target = WEEKDAYS.index(weekday)
        candidate += timedelta(days=(target - candidate.weekday()) % 7)
    return candidate


def is_sync_command(line: str) -> bool:
    """True for a stdin line asking for a sync now: `sync`, `"sync"`, ..."""
    return line.strip().strip("\"'").strip().lower() == "sync"


def failure_summary(lines: list[str]) -> str:
    """Short error text for the sensor: from the last ERROR: line to the end,
    or else the last five lines. ANSI colour codes removed, capped."""
    clean = [_ANSI.sub("", line).rstrip("\n") for line in lines]
    starts = [i for i, line in enumerate(clean) if "ERROR:" in line]
    picked = clean[starts[-1]:] if starts else clean[-5:]
    return "\n".join(picked).strip()[:ERROR_CAP]


# --- one sync ---------------------------------------------------------------

@dataclass
class Paths:
    data: Path = Path("/data")
    ha_config: Path = Path("/homeassistant")
    known_hosts: Path = Path("/etc/configsync/known_hosts")
    key_dir: Path = Path("/tmp")


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def load_status(paths: Paths) -> dict:
    try:
        return json.loads((paths.data / "status.json").read_text())
    except (OSError, ValueError):
        return {}


def save_status(paths: Paths, status: dict) -> None:
    target = paths.data / "status.json"
    tmp = target.with_suffix(".tmp")
    tmp.write_text(json.dumps(status, indent=2) + "\n")
    os.replace(tmp, target)


class SyncError(Exception):
    """A run failed; the message is safe to show in Home Assistant."""


def _git(args: list[str], env: dict, cwd: Path | None = None) -> str:
    try:
        return subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True,
                              text=True, timeout=GIT_TIMEOUT, check=True).stdout.strip()
    except subprocess.CalledProcessError as exc:
        detail = failure_summary(((exc.stdout or "") + (exc.stderr or "")).splitlines())
        raise SyncError(detail or f"git {args[0]} failed") from None
    except subprocess.TimeoutExpired:
        raise SyncError(f"git {args[0]} timed out") from None


def _write_key(opts: dict, paths: Paths) -> Path:
    key = repair_key(opts["deploy_key"])
    paths.key_dir.mkdir(parents=True, exist_ok=True)
    path = paths.key_dir / "deploy_key"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(key)
    os.chmod(path, 0o600)
    log.info("Deploy key %s", validate_key(path))
    return path


def _prepare_clone(opts: dict, repo: Path, env: dict) -> None:
    url, branch = opts["repository"], opts.get("branch") or "main"
    if not (repo / ".git").is_dir():
        if repo.exists():
            shutil.rmtree(repo)
        log.info("Cloning %s (%s)", url, branch)
        _git(["clone", "--quiet", "--branch", branch, url, str(repo)], env)
    else:
        _git(["remote", "set-url", "origin", url], env, repo)
        _git(["fetch", "--quiet", "origin", branch], env, repo)
        # -f: a run that died after pulling leaves config/ and storage/ dirty;
        # that must never block the next run.
        _git(["checkout", "--quiet", "-f", "-B", branch, f"origin/{branch}"], env, repo)
        _git(["reset", "--quiet", "--hard", f"origin/{branch}"], env, repo)
        _git(["clean", "-qfdx"], env, repo)
    _git(["config", "user.name", opts.get("git_author_name") or "ConfigSync"], env, repo)
    _git(["config", "user.email", opts["git_author_email"]], env, repo)
    _git(["config", "core.hooksPath", ".githooks"], env, repo)


def _run_script(repo: Path, env: dict, timeout: int) -> None:
    lines: list[str] = []
    proc = subprocess.Popen([str(repo / "bin" / "ha-sync.sh")], cwd=repo, env=env,
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, start_new_session=True)

    def pump():
        for line in proc.stdout:
            lines.append(line)
            log.info("  %s", line.rstrip("\n"))

    reader = threading.Thread(target=pump, daemon=True)
    reader.start()
    try:
        code = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
        reader.join(5)
        minutes = max(1, round(timeout / 60))
        raise SyncError(f"ha-sync.sh timed out after {minutes} minute{'s' if minutes != 1 else ''}") from None
    reader.join(5)
    if code != 0:
        raise SyncError(failure_summary(lines) or f"ha-sync.sh exited with {code}")


def run_sync(opts: dict, paths: Paths, timeout: int = SYNC_TIMEOUT) -> dict:
    """One full sync. Never raises; returns the status to report."""
    started = now_iso()
    previous = load_status(paths)

    def result(state: str, commit: str = "", files: int = 0, error: str = "") -> dict:
        return {"state": state, "last_run": started,
                "last_success": started if state == "ok" else previous.get("last_success", ""),
                "commit": commit, "files_changed": files, "error": error}

    missing = missing_options(opts)
    if missing:
        names = ", ".join(missing)
        error = (f"option {names} is not set" if len(missing) == 1
                 else f"options {names} are not set")
        log.error(error)
        return result("failed", error=error)

    try:
        key = _write_key(opts, paths)
        env = dict(os.environ)
        env["GIT_TERMINAL_PROMPT"] = "0"
        env["GIT_SSH_COMMAND"] = (
            f"ssh -i {shlex.quote(str(key))} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
            f" -o UserKnownHostsFile={shlex.quote(str(paths.known_hosts))} -o BatchMode=yes")
        repo = paths.data / "repo"
        _prepare_clone(opts, repo, env)
        before = _git(["rev-parse", "HEAD"], env, repo)
        log.info("Running ha-sync.sh against %s", paths.ha_config)
        # Without git's push advice, a rejected push ends in the "! [rejected]"
        # and "error: failed to push" lines rather than five "hint:" lines.
        script_env = {**env, "HA_LOCAL_CONFIG": str(paths.ha_config), "GIT_CONFIG_COUNT": "1",
                      "GIT_CONFIG_KEY_0": "advice.pushUpdateRejected", "GIT_CONFIG_VALUE_0": "false"}
        _run_script(repo, script_env, timeout)
        after = _git(["rev-parse", "HEAD"], env, repo)
    except (ValueError, SyncError) as exc:
        log.error("Sync failed: %s", exc)
        return result("failed", error=str(exc)[:ERROR_CAP])
    except Exception as exc:  # keep the scheduler alive whatever happens
        log.exception("Sync crashed")
        return result("failed", error=f"unexpected error: {type(exc).__name__}"[:ERROR_CAP])

    if after == before:
        log.info("Sync ok, no changes")
        return result("ok")
    files = len(_git(["diff", "--name-only", before, after], env, repo).splitlines())
    log.info("Sync ok, committed %s (%d files)", after[:7], files)
    return result("ok", commit=after[:7], files=files)


# --- Home Assistant ---------------------------------------------------------

class HA:
    """Posts the sensor and notifications through the Supervisor's Core API
    proxy. Failures are logged, never raised: reporting must not break a sync."""

    def __init__(self, api: str, token: str | None):
        self.api = api.rstrip("/")
        self.token = token
        self._warned = False

    def _post(self, path: str, body: dict) -> None:
        if not self.token:
            if not self._warned:
                log.warning("HA API not available (no SUPERVISOR_TOKEN); not reporting")
                self._warned = True
            return
        request = urllib.request.Request(
            self.api + path, data=json.dumps(body).encode(), method="POST",
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        try:
            urllib.request.urlopen(request, timeout=10).close()
        except Exception as exc:
            log.warning("HA API %s failed: %s", path, exc)

    def post_status(self, status: dict) -> None:
        attributes = {"friendly_name": "ConfigSync last run", "icon": "mdi:source-branch-sync"}
        for key in ("last_run", "last_success", "commit", "files_changed", "error", "next_run"):
            attributes[key] = status.get(key, "")
        self._post(f"/states/{SENSOR}", {"state": status.get("state", "never"),
                                         "attributes": attributes})

    def notify(self, service: str, message: str) -> None:
        self._post(f"/services/notify/{service}", {"title": "ConfigSync failed", "message": message})


# --- scheduling -------------------------------------------------------------

def run_and_report(opts: dict, paths: Paths, ha: HA, upcoming, status: dict) -> dict:
    """Run one sync and report it. Never raises: an exception here would stop
    the app and leave the sensor showing the previous result indefinitely."""
    ha.post_status({**status, "state": "running"})
    try:
        new = run_sync(opts, paths)
        new["next_run"] = upcoming().isoformat(timespec="seconds")
        save_status(paths, new)
    except Exception as exc:
        log.exception("Reporting the sync failed")
        new = {**status, "state": "failed", "last_run": now_iso(),
               "error": f"internal error: {type(exc).__name__}: {exc}"[:ERROR_CAP]}
        try:
            new["next_run"] = upcoming().isoformat(timespec="seconds")
        except Exception:
            pass
    ha.post_status(new)
    if new["state"] == "failed" and opts.get("notify_service"):
        ha.notify(opts["notify_service"], new.get("error", ""))
    return new


def wait_for_trigger(deadline: float, stream) -> str:
    """Wait until `deadline` (epoch seconds) or a `sync` line on `stream`.

    Returns "schedule" or "stdin". Reads the raw fd so that several lines
    arriving at once are all seen. After EOF (stdin closed) it just sleeps,
    so a closed stdin never turns into a busy loop."""
    fd = None
    if stream is not None:
        try:
            fd = stream.fileno()
        except (OSError, ValueError):
            fd = None
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            return "schedule"
        if fd is None:
            time.sleep(remaining)
            continue
        ready, _, _ = select.select([fd], [], [], remaining)
        if not ready:
            continue
        chunk = os.read(fd, 4096)
        if not chunk:
            fd = None
            continue
        lines = chunk.decode(errors="replace").splitlines()
        if any(is_sync_command(line) for line in lines):
            log.info("Sync requested via stdin")
            return "stdin"
        log.info("Ignoring stdin input (send 'sync' to run now)")


def main() -> None:
    logging.basicConfig(level=logging.INFO, stream=sys.stdout,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
    paths = Paths()
    opts = json.loads((paths.data / "options.json").read_text())
    ha = HA(os.environ.get("CONFIGSYNC_HA_API", DEFAULT_API), os.environ.get("SUPERVISOR_TOKEN"))

    def upcoming() -> datetime:
        return next_run(datetime.now().astimezone(), opts.get("frequency", "daily"),
                        opts.get("time", "03:40"), opts.get("weekday", "sun"))

    status = load_status(paths) or {"state": "never"}
    target = upcoming()
    status["next_run"] = target.isoformat(timespec="seconds")
    ha.post_status(status)

    def do_run() -> dict:
        return run_and_report(opts, paths, ha, upcoming, status)

    if opts.get("run_on_start", True):
        status = do_run()
    log.info("Next scheduled sync %s", upcoming().isoformat(timespec="seconds"))
    while True:
        target = upcoming()
        while True:
            chunk_end = min(target.timestamp(), time.time() + REPOST_EVERY)
            trigger = wait_for_trigger(chunk_end, sys.stdin)
            if trigger == "stdin" or time.time() >= target.timestamp():
                status = do_run()
                log.info("Next scheduled sync %s", upcoming().isoformat(timespec="seconds"))
                break
            ha.post_status(status)


if __name__ == "__main__":
    main()

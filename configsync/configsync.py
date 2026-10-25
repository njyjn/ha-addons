#!/usr/bin/env python3
"""ConfigSync: run the Home Assistant config mirror on a schedule.

Keeps a clone of the private config-history repo in /data/repo and runs its
own bin/ha-sync.sh in local mode against the read-only HA config mount. All
filtering, redaction and secret scanning lives in that private repo; this
file only schedules, authenticates and reports.

Python standard library only.
"""
from __future__ import annotations

import re
import subprocess
import textwrap
from datetime import datetime, timedelta
from pathlib import Path

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

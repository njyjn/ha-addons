"""Tests for a full ConfigSync run, HA reporting and the trigger wait.

The run tests use a real local copy of the private config repo (see
helpers.SYNC_REPO), a bare repo standing in for GitHub, and a throwaway key.
"""
import os
import sys
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import configsync  # noqa: E402
from helpers import (GITHUB_KNOWN_HOSTS, SYNC_REPO, StubHA, build_ha_tree, git,  # noqa: E402
                     make_key, make_remote, push_change, sync_repo_available)


@unittest.skipUnless(sync_repo_available(),
                     "needs CONFIGSYNC_SYNC_REPO: a checkout of the private config repo with local mode")
class RunSyncTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.remote, self.branch = make_remote(self.tmp)
        self.ha = build_ha_tree(self.tmp / "ha")
        known_hosts = self.tmp / "known_hosts"
        known_hosts.write_text(GITHUB_KNOWN_HOSTS)
        self.key_text = make_key(self.tmp).read_text()
        self.opts = {
            "repository": f"file://{self.remote}",
            "branch": self.branch,
            "deploy_key": self.key_text,
            "git_author_name": "ConfigSync",
            "git_author_email": "cs@example.invalid",
        }
        self.paths = configsync.Paths(data=self.tmp / "data", ha_config=self.ha,
                                      known_hosts=known_hosts, key_dir=self.tmp / "keys")
        self.paths.data.mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def remote_head(self) -> str:
        return git("--git-dir", str(self.remote), "rev-parse", self.branch)

    def test_first_run_commits(self):
        s = configsync.run_sync(self.opts, self.paths)
        self.assertEqual(s["state"], "ok", s["error"])
        self.assertGreaterEqual(len(s["commit"]), 7)
        self.assertGreater(s["files_changed"], 0)
        self.assertTrue(self.remote_head().startswith(s["commit"]))
        self.assertEqual(s["last_success"], s["last_run"])

    def test_second_run_no_change(self):
        configsync.run_sync(self.opts, self.paths)
        s = configsync.run_sync(self.opts, self.paths)
        self.assertEqual(s["state"], "ok", s["error"])
        self.assertEqual(s["commit"], "")
        self.assertEqual(s["files_changed"], 0)

    def test_hooks_path_set(self):
        configsync.run_sync(self.opts, self.paths)
        self.assertEqual(git("config", "core.hooksPath", cwd=self.paths.data / "repo"), ".githooks")

    def test_missing_option(self):
        self.opts["repository"] = ""
        s = configsync.run_sync(self.opts, self.paths)
        self.assertEqual((s["state"], s["error"]), ("failed", "option repository is not set"))

    def test_bad_key(self):
        self.opts["deploy_key"] = "nope"
        s = configsync.run_sync(self.opts, self.paths)
        self.assertEqual((s["state"], s["error"]), ("failed", "deploy key is not a valid private key"))

    def test_key_file_private(self):
        configsync.run_sync(self.opts, self.paths)
        key = self.paths.key_dir / "deploy_key"
        self.assertEqual(key.stat().st_mode & 0o777, 0o600)

    def test_push_rejected_then_recovers(self):
        hook = self.remote / "hooks" / "pre-receive"
        hook.write_text("#!/bin/sh\nexit 1\n")
        hook.chmod(0o755)
        s = configsync.run_sync(self.opts, self.paths)
        self.assertEqual(s["state"], "failed")
        self.assertIn("pre-receive hook declined", s["error"])
        self.assertEqual(s["commit"], "")
        hook.unlink()
        s = configsync.run_sync(self.opts, self.paths)
        self.assertEqual(s["state"], "ok", s["error"])
        self.assertTrue(self.remote_head().startswith(s["commit"]))

    def test_last_success_carried_on_failure(self):
        ok = configsync.run_sync(self.opts, self.paths)
        configsync.save_status(self.paths, ok)
        self.opts["deploy_key"] = "nope"
        failed = configsync.run_sync(self.opts, self.paths)
        self.assertEqual(failed["last_success"], ok["last_success"])

    def test_timeout(self):
        push_change(self.remote, self.branch, self.tmp, "bin/ha-sync.sh", "#!/bin/sh\nsleep 30\n", 0o755)
        start = time.monotonic()
        s = configsync.run_sync(self.opts, self.paths, timeout=2)
        self.assertLess(time.monotonic() - start, 20)
        self.assertEqual(s["state"], "failed")
        self.assertTrue(s["error"].startswith("ha-sync.sh timed out after"), s["error"])

    def test_failed_run_does_not_block_next(self):
        """A run that dies after pulling leaves config/ and storage/ dirty; when
        origin then moves on those files, the next run must still succeed."""
        self.assertEqual(configsync.run_sync(self.opts, self.paths)["state"], "ok")
        allowlist = "bin/allowlist-config.txt"
        original = (SYNC_REPO / allowlist).read_text()
        push_change(self.remote, self.branch, self.tmp, allowlist, original + "secrets.yaml\n")
        failed = configsync.run_sync(self.opts, self.paths)
        self.assertEqual(failed["state"], "failed")
        self.assertIn("denied", failed["error"])
        push_change(self.remote, self.branch, self.tmp, allowlist, original)
        push_change(self.remote, self.branch, self.tmp, "storage/core.area_registry.json",
                    '{"changed": "by another machine"}\n')
        s = configsync.run_sync(self.opts, self.paths)
        self.assertEqual(s["state"], "ok", s["error"])

    def test_non_fast_forward_error_is_readable(self):
        """Another machine pushes while this run is in progress: the error
        names the rejection, not just git's advice lines."""
        competitor = self.tmp / "competitor"
        hook = ("#!/usr/bin/env bash\n"
                "env -u GIT_INDEX_FILE -u GIT_DIR -u GIT_WORK_TREE -u GIT_PREFIX \\\n"
                f"  git -C {competitor} push -q origin HEAD:{self.branch} || true\n"
                "exit 0\n")
        push_change(self.remote, self.branch, self.tmp, ".githooks/pre-commit", hook, 0o755)
        git("clone", "--quiet", "--branch", self.branch, f"file://{self.remote}", str(competitor))
        (competitor / "elsewhere.txt").write_text("pushed by another machine\n")
        git("add", "elsewhere.txt", cwd=competitor)
        git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "core.hooksPath=/dev/null",
            "commit", "--quiet", "-m", "test: competing commit", cwd=competitor)
        s = configsync.run_sync(self.opts, self.paths)
        self.assertEqual(s["state"], "failed")
        self.assertIn("rejected", s["error"])
        self.assertNotIn("hint:", s["error"])

    def test_no_key_in_output(self):
        body_line = self.key_text.splitlines()[1]
        with self.assertLogs("configsync", level="DEBUG") as logs:
            configsync.run_sync(self.opts, self.paths)
        self.assertTrue(any("SHA256:" in line for line in logs.output))
        for line in logs.output:
            self.assertNotIn(body_line, line)


class HATests(unittest.TestCase):
    STATUS = {"state": "ok", "last_run": "2026-10-25T03:40:00+08:00",
              "last_success": "2026-10-25T03:40:00+08:00", "commit": "abc1234",
              "files_changed": 3, "error": "", "next_run": "2026-10-26T03:40:00+08:00"}

    def test_ha_down(self):
        with self.assertLogs("configsync", level="WARNING"):
            self.assertIsNone(configsync.HA("http://127.0.0.1:9", "t").post_status(self.STATUS))

    def test_no_token_skips(self):
        stub = StubHA()
        try:
            ha = configsync.HA(stub.url, None)
            ha.post_status(self.STATUS)
            ha.notify("x", "m")
            self.assertEqual(stub.requests, [])
        finally:
            stub.close()

    def test_ha_posts(self):
        stub = StubHA()
        try:
            ha = configsync.HA(stub.url, "t")
            ha.post_status(self.STATUS)
            ha.notify("x", "m")
        finally:
            stub.close()
        state, note = stub.requests
        self.assertEqual(state["path"], "/states/sensor.configsync_last_run")
        self.assertEqual(state["auth"], "Bearer t")
        self.assertEqual(state["body"]["state"], "ok")
        attrs = state["body"]["attributes"]
        self.assertEqual(attrs["friendly_name"], "ConfigSync last run")
        for key in ("last_run", "last_success", "commit", "files_changed", "error", "next_run"):
            self.assertEqual(attrs[key], self.STATUS[key])
        self.assertEqual(note["path"], "/services/notify/x")
        self.assertEqual(note["body"], {"title": "ConfigSync failed", "message": "m"})


class RunAndReportTests(unittest.TestCase):
    def test_survives_unexpected_error(self):
        """If saving status blows up (e.g. /data full), the loop must not die:
        the run is reported as failed and the function returns."""
        with tempfile.TemporaryDirectory() as tmp:
            not_a_dir = Path(tmp) / "data"
            not_a_dir.write_text("a file where /data should be")
            paths = configsync.Paths(data=not_a_dir, ha_config=Path(tmp), key_dir=Path(tmp) / "k")
            stub = StubHA()
            try:
                ha = configsync.HA(stub.url, "t")
                opts = {"repository": "file:///nope", "deploy_key": "x",
                        "git_author_email": "a@b.c", "notify_service": "n"}
                with self.assertLogs("configsync", level="ERROR"):
                    status = configsync.run_and_report(
                        opts, paths, ha, lambda: datetime(2026, 10, 26, 3, 40, tzinfo=timezone.utc),
                        {"state": "never"})
            finally:
                stub.close()
        self.assertEqual(status["state"], "failed")
        posted = [r["body"]["state"] for r in stub.requests if r["path"].startswith("/states/")]
        self.assertEqual(posted[0], "running")
        self.assertEqual(posted[-1], "failed")
        self.assertTrue(any(r["path"] == "/services/notify/n" for r in stub.requests))


class WaitForTriggerTests(unittest.TestCase):
    def test_wait_stdin(self):
        r, w = os.pipe()
        with os.fdopen(r) as stream, os.fdopen(w, "w") as writer:
            writer.write("sync\n")
            writer.flush()
            start = time.monotonic()
            self.assertEqual(configsync.wait_for_trigger(time.time() + 5, stream), "stdin")
            self.assertLess(time.monotonic() - start, 1)

    def test_other_input_ignored(self):
        r, w = os.pipe()
        with os.fdopen(r) as stream, os.fdopen(w, "w") as writer:
            writer.write("hello\n")
            writer.flush()
            self.assertEqual(configsync.wait_for_trigger(time.time() + 0.5, stream), "schedule")

    def test_wait_eof_no_spin(self):
        r, w = os.pipe()
        os.close(w)
        with os.fdopen(r) as stream:
            cpu = time.process_time()
            self.assertEqual(configsync.wait_for_trigger(time.time() + 1, stream), "schedule")
            self.assertLess(time.process_time() - cpu, 0.2)

    def test_no_stream(self):
        self.assertEqual(configsync.wait_for_trigger(time.time() + 0.2, None), "schedule")


if __name__ == "__main__":
    unittest.main()

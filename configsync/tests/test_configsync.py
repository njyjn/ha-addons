"""Unit tests for the ConfigSync runner's pure helpers.

Run from configsync/:  python3 -m unittest discover -s tests -v
"""
import sys
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import configsync  # noqa: E402
from helpers import make_key  # noqa: E402

TZ = timezone(timedelta(hours=8))
KEY_ERROR = "deploy key is not a valid private key"


class RepairKeyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.original = make_key(Path(cls.tmp.name)).read_text()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_flattened_key_rebuilt(self):
        flattened = " ".join(self.original.split("\n")).strip()
        self.assertNotIn("\n", flattened)
        self.assertEqual(configsync.repair_key(flattened), self.original)

    def test_intact_key_unchanged(self):
        self.assertEqual(configsync.repair_key(self.original), self.original)

    def test_crlf_key(self):
        self.assertEqual(configsync.repair_key(self.original.replace("\n", "\r\n")), self.original)

    def test_garbage_rejected(self):
        with self.assertRaises(ValueError) as ctx:
            configsync.repair_key("hello")
        self.assertEqual(str(ctx.exception), KEY_ERROR)


class ValidateKeyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_valid_key_fingerprint(self):
        self.assertTrue(configsync.validate_key(make_key(self.dir)).startswith("SHA256:"))

    def test_passphrase_key_rejected_fast(self):
        key = make_key(self.dir, passphrase="pw-for-test")
        start = time.monotonic()
        with self.assertRaises(ValueError):
            configsync.validate_key(key)
        self.assertLess(time.monotonic() - start, 5)

    def test_error_has_no_key_material(self):
        bad = self.dir / "bad"
        bad.write_text("-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAnotakey\n-----END OPENSSH PRIVATE KEY-----\n")
        with self.assertRaises(ValueError) as ctx:
            configsync.validate_key(bad)
        self.assertEqual(str(ctx.exception), KEY_ERROR)


class MissingOptionsTests(unittest.TestCase):
    def test_missing(self):
        opts = {"repository": "", "deploy_key": "k", "git_author_email": ""}
        self.assertEqual(configsync.missing_options(opts), ["repository", "git_author_email"])

    def test_absent_key_counts_as_missing(self):
        self.assertEqual(configsync.missing_options({"deploy_key": "k", "git_author_email": "a@b.c"}),
                         ["repository"])


class NextRunTests(unittest.TestCase):
    def test_daily_later_today(self):
        now = datetime(2026, 10, 25, 1, 0, tzinfo=TZ)
        self.assertEqual(configsync.next_run(now, "daily", "03:40", "sun"),
                         datetime(2026, 10, 25, 3, 40, tzinfo=TZ))

    def test_daily_passed(self):
        now = datetime(2026, 10, 25, 3, 40, tzinfo=TZ)
        self.assertEqual(configsync.next_run(now, "daily", "03:40", "sun"),
                         datetime(2026, 10, 26, 3, 40, tzinfo=TZ))

    def test_weekly_wraps(self):
        now = datetime(2026, 10, 25, 4, 0, tzinfo=TZ)  # a Sunday
        self.assertEqual(configsync.next_run(now, "weekly", "03:40", "sun"),
                         datetime(2026, 11, 1, 3, 40, tzinfo=TZ))

    def test_weekly_later_this_week(self):
        now = datetime(2026, 10, 25, 4, 0, tzinfo=TZ)
        self.assertEqual(configsync.next_run(now, "weekly", "03:40", "wed"),
                         datetime(2026, 10, 28, 3, 40, tzinfo=TZ))

    def test_weekly_later_today(self):
        now = datetime(2026, 10, 25, 1, 0, tzinfo=TZ)
        self.assertEqual(configsync.next_run(now, "weekly", "03:40", "sun"),
                         datetime(2026, 10, 25, 3, 40, tzinfo=TZ))


class SyncCommandTests(unittest.TestCase):
    def test_sync_variants(self):
        for line in ["sync", "sync\n", '"sync"', " SYNC "]:
            self.assertTrue(configsync.is_sync_command(line), line)
        for line in ["", "syncx", "{}"]:
            self.assertFalse(configsync.is_sync_command(line), line)


class FailureSummaryTests(unittest.TestCase):
    def test_error_line_kept(self):
        lines = ["==> x", "\x1b[1;31mERROR:\x1b[0m gitleaks found a secret", "  Inspect with: ..."]
        self.assertEqual(configsync.failure_summary(lines),
                         "ERROR: gitleaks found a secret\n  Inspect with: ...")

    def test_last_error_wins(self):
        lines = ["ERROR: first", "ok", "ERROR: second"]
        self.assertEqual(configsync.failure_summary(lines), "ERROR: second")

    def test_no_error_last_five(self):
        lines = [f"line {i}" for i in range(8)]
        self.assertEqual(configsync.failure_summary(lines), "\n".join(lines[-5:]))

    def test_capped(self):
        self.assertEqual(len(configsync.failure_summary(["x" * 2000])), 500)


if __name__ == "__main__":
    unittest.main()

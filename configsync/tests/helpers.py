"""Shared fixtures for the ConfigSync tests."""
import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

GITHUB_KNOWN_HOSTS = (
    "github.com ssh-ed25519 "
    "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n"
)

# The private config repo holds bin/ha-sync.sh and the allowlists. It cannot
# be vendored into this public repo, so the sync tests need a checkout of it.
SYNC_REPO = Path(os.environ.get("CONFIGSYNC_SYNC_REPO", "/home/user/homeassistant-config"))


def sync_repo_available() -> bool:
    script = SYNC_REPO / "bin" / "ha-sync.sh"
    return script.is_file() and "HA_LOCAL_CONFIG" in script.read_text()


def make_key(directory: Path, passphrase: str = "") -> Path:
    path = directory / "id_ed25519"
    subprocess.run(
        ["ssh-keygen", "-q", "-t", "ed25519", "-N", passphrase, "-C", "", "-f", str(path)],
        check=True,
    )
    return path


def build_ha_tree(root: Path) -> Path:
    """A minimal Home Assistant config folder the allowlists will match."""
    (root / ".storage").mkdir(parents=True)
    (root / "configuration.yaml").write_text("homeassistant:\n  name: Test\n")
    (root / "secrets.yaml").write_text("test_password: hunter2hunter2\n")
    (root / ".storage" / "core.area_registry").write_text(
        '{"version":1,"data":{"areas":[{"id":"kitchen","name":"Kitchen"}]}}')
    return root


def git(*args, cwd=None) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout.strip()


def make_remote(tmp: Path) -> tuple[Path, str]:
    """A bare repo seeded from the private checkout, standing in for GitHub.
    Returns (path, branch)."""
    branch = git("rev-parse", "--abbrev-ref", "HEAD", cwd=SYNC_REPO)
    remote = tmp / "remote.git"
    git("clone", "--quiet", "--bare", "--no-local", "--branch", branch,
        f"file://{SYNC_REPO}", str(remote))
    return remote, branch


def push_change(remote: Path, branch: str, tmp: Path, path: str, content: str, mode: int = 0o644):
    """Commit one file change to the remote from a scratch clone."""
    work = tmp / "scratch"
    if work.exists():
        git("fetch", "--quiet", "origin", branch, cwd=work)
        git("reset", "--quiet", "--hard", f"origin/{branch}", cwd=work)
    else:
        git("clone", "--quiet", "--branch", branch, f"file://{remote}", str(work))
    target = work / path
    target.write_text(content)
    target.chmod(mode)
    git("add", path, cwd=work)
    git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "core.hooksPath=/dev/null",
        "commit", "--quiet", "-m", f"test: change {path}", cwd=work)
    git("push", "--quiet", "origin", f"HEAD:{branch}", cwd=work)


class StubHA:
    """Records POSTs to a fake Home Assistant API."""

    def __init__(self):
        self.requests = []
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length) or b"{}")
                stub.requests.append({"path": self.path, "auth": self.headers.get("Authorization"),
                                      "body": body})
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b"{}")

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()

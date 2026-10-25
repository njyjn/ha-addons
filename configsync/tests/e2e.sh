#!/usr/bin/env bash
#
# End-to-end run of the ConfigSync image.
#
# Stands in for everything outside the container: a bare repo for GitHub
# (file:// URL, so no network or real deploy key), a sample HA config folder,
# and a stub HTTP server for the HA API. Checks one successful sync, then a
# forced failure that must report `failed` and send a notification.
#
# Needs: docker (with arm64 emulation on non-arm64 hosts), python3, git,
# ssh-keygen, and a checkout of the private config repo:
#   CONFIGSYNC_SYNC_REPO=/path/to/homeassistant-config IMAGE=configsync:test tests/e2e.sh

set -euo pipefail

SRC="${CONFIGSYNC_SYNC_REPO:-/home/user/homeassistant-config}"
IMAGE="${IMAGE:-configsync:test}"
WAIT="${WAIT:-600}"
NAME="configsync-e2e-$$"

T="$(mktemp -d)"
STUB_PID=""
cleanup() {
  exec 3>&- 2>/dev/null || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null || true
  rm -rf "$T"
}
trap cleanup EXIT

pass() { printf 'PASS %s\n' "$1"; }
fail() {
  printf 'FAIL %s\n' "$1" >&2
  echo "--- container log (tail) ---" >&2; tail -30 "$T/container.log" >&2 || true
  echo "--- HA API requests ---" >&2; cat "$T/requests.log" >&2 || true
  exit 1
}

[ -x "$SRC/bin/ha-sync.sh" ] || { echo "no private repo at $SRC (set CONFIGSYNC_SYNC_REPO)" >&2; exit 2; }

# --- stand-in for GitHub ----------------------------------------------------
BRANCH="$(git -C "$SRC" rev-parse --abbrev-ref HEAD)"
git clone -q --bare --no-local --branch "$BRANCH" "file://$SRC" "$T/remote.git"
START_HEAD="$(git --git-dir "$T/remote.git" rev-parse "$BRANCH")"

# --- sample HA config -------------------------------------------------------
mkdir -p "$T/ha/.storage"
printf 'homeassistant:\n  name: Test\n' > "$T/ha/configuration.yaml"
printf 'test_password: hunter2hunter2\n' > "$T/ha/secrets.yaml"
printf '{"version":1,"data":{"areas":[{"id":"kitchen","name":"Kitchen"}]}}' \
  > "$T/ha/.storage/core.area_registry"

# --- options ----------------------------------------------------------------
ssh-keygen -q -t ed25519 -N "" -C "" -f "$T/key"
mkdir -p "$T/data"
python3 - "$T" "$BRANCH" <<'PY'
import json, sys
t, branch = sys.argv[1], sys.argv[2]
opts = {
    "repository": "file:///remote/remote.git", "branch": branch,
    "deploy_key": open(f"{t}/key").read(), "frequency": "daily", "time": "03:40",
    "weekday": "sun", "run_on_start": True, "git_author_name": "ConfigSync",
    "git_author_email": "cs@example.invalid", "notify_service": "test",
}
json.dump(opts, open(f"{t}/data/options.json", "w"))
PY

# --- stub HA API ------------------------------------------------------------
cat > "$T/stub.py" <<'PY'
import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
log, port_file = sys.argv[1], sys.argv[2]
class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        with open(log, "a") as f:
            f.write(json.dumps({"path": self.path, "auth": self.headers.get("Authorization"),
                                "body": json.loads(body or b"{}")}) + "\n")
        self.send_response(200); self.end_headers(); self.wfile.write(b"{}")
    def log_message(self, *a): pass
s = ThreadingHTTPServer(("127.0.0.1", 0), H)
open(port_file, "w").write(str(s.server_address[1]))
s.serve_forever()
PY
touch "$T/requests.log"
python3 "$T/stub.py" "$T/requests.log" "$T/port" & STUB_PID=$!
for _ in $(seq 50); do [ -s "$T/port" ] && break; sleep 0.1; done
PORT="$(cat "$T/port")"

# --- run the container, stdin fed from a FIFO ------------------------------
mkfifo "$T/stdin.fifo"
docker run -i --rm --name "$NAME" --platform linux/arm64 --network host \
  -v "$T/remote.git:/remote/remote.git" \
  -v "$T/ha:/homeassistant:ro" \
  -v "$T/data:/data" \
  -e SUPERVISOR_TOKEN=t -e CONFIGSYNC_HA_API="http://127.0.0.1:$PORT" -e TZ=Asia/Singapore \
  "$IMAGE" < "$T/stdin.fifo" > "$T/container.log" 2>&1 &
exec 3> "$T/stdin.fifo"

# wait_for <python expression over r (one request)> <label>
wait_for() {
  local expr="$1" label="$2" deadline=$((SECONDS + WAIT))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if python3 - "$T/requests.log" "$expr" <<'PY'
import json, sys
reqs = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
sys.exit(0 if any(eval(sys.argv[2], {}, {"r": r}) for r in reqs) else 1)
PY
    then return 0; fi
    sleep 2
  done
  fail "$label"
}
SENSOR='r["path"] == "/states/sensor.configsync_last_run"'

# --- 1. first run succeeds and pushes --------------------------------------
wait_for "$SENSOR and r[\"body\"][\"state\"] == \"ok\"" e2e_ok
[ "$(git --git-dir "$T/remote.git" rev-parse "$BRANCH")" != "$START_HEAD" ] || fail e2e_ok
python3 - "$T/requests.log" <<'PY' || fail e2e_ok
import json, sys
ok = [json.loads(l) for l in open(sys.argv[1]) if '"ok"' in l][-1]
assert ok["auth"] == "Bearer t"
assert len(ok["body"]["attributes"]["commit"]) == 7
PY
pass e2e_ok

# --- 2. forced failure: a denylisted file allowlisted ----------------------
git clone -q --branch "$BRANCH" "file://$T/remote.git" "$T/work"
echo "secrets.yaml" >> "$T/work/bin/allowlist-config.txt"
git -C "$T/work" -c user.name=t -c user.email=t@example.invalid -c core.hooksPath=/dev/null \
  commit -qam "test: allowlist a denied file"
git -C "$T/work" push -q origin "HEAD:$BRANCH"
echo sync >&3
wait_for "$SENSOR and r[\"body\"][\"state\"] == \"failed\" and \"denied\" in r[\"body\"][\"attributes\"][\"error\"]" e2e_failed
wait_for 'r["path"] == "/services/notify/test" and r["body"]["title"] == "ConfigSync failed"' e2e_failed_notifies
pass e2e_failed_notifies

# --- 3. the key never reaches the log --------------------------------------
KEY_LINE="$(sed -n 2p "$T/key")"
! grep -qF "$KEY_LINE" "$T/container.log" || fail e2e_key_not_logged
grep -q "Deploy key SHA256:" "$T/container.log" || fail e2e_key_not_logged
pass e2e_key_not_logged

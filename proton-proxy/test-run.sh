#!/usr/bin/env bash
# Local check for run.sh: builds the image and runs it with a stand-in for
# Gluetun's entrypoint, so we can see which settings Gluetun would get.
# Not shipped (excluded by .dockerignore). Run: bash proton-proxy/test-run.sh
set -uo pipefail
cd "$(dirname "$0")"
IMG=proton-proxy-test
[ "${SKIP_BUILD:-0}" = 1 ] || docker build -q -t "$IMG" . >/dev/null || { echo "FAIL: build"; exit 1; }
TMP=$(mktemp -d)
fail=0

run() { # $1 = options.json content; prints combined output, returns exit code
  printf '%s' "$1" > "$TMP/options.json"
  docker run --rm -v "$TMP/options.json:/data/options.json:ro" -e GLUETUN_ENTRYPOINT=/usr/bin/env "$IMG" 2>&1
}

# 1. No key: clear message, non-zero exit, Gluetun (here: env) never started.
out=$(run '{"wireguard_private_key":"","wireguard_address":"","server_countries":"Singapore","server_cities":"","free_only":false}'); code=$?
if [ $code -ne 0 ] && grep -q "Set wireguard_private_key" <<<"$out" && ! grep -q "VPN_SERVICE_PROVIDER=" <<<"$out"; then echo "PASS: missing key"; else echo "FAIL: missing key (exit $code)"; echo "$out"; fail=1; fi

# 2. Key with base64 characters: passed through unchanged; all settings mapped.
KEY='abc+/def='
out=$(run "{\"wireguard_private_key\":\"$KEY\",\"wireguard_address\":\"\",\"server_countries\":\"Singapore\",\"server_cities\":\"\",\"free_only\":false}")
env_part=$(grep -E '^[A-Z_]+=' <<<"$out")
for want in "WIREGUARD_PRIVATE_KEY=$KEY" VPN_SERVICE_PROVIDER=protonvpn VPN_TYPE=wireguard SERVER_COUNTRIES=Singapore HTTPPROXY=on HTTPPROXY_LISTENING_ADDRESS=:8888 SHADOWSOCKS=off FREE_ONLY=off; do
  grep -qxF "$want" <<<"$env_part" || { echo "FAIL: missing $want"; fail=1; }
done
grep -q '^WIREGUARD_ADDRESSES=.' <<<"$env_part" && { echo "FAIL: WIREGUARD_ADDRESSES should be empty (Gluetun's Proton default)"; fail=1; }
grep -q '^SERVER_CITIES=.' <<<"$env_part" && { echo "FAIL: SERVER_CITIES should be empty"; fail=1; }
# run.sh's own log lines (everything except the env dump) must not show the key
grep -vE '^[A-Z_]+=' <<<"$out" | grep -qF "$KEY" && { echo "FAIL: key printed in log"; fail=1; }
[ $fail -eq 0 ] && echo "PASS: settings mapped, key not logged"

# 3. Optional settings: city, address, free servers only.
out=$(run "{\"wireguard_private_key\":\"$KEY\",\"wireguard_address\":\"10.2.0.2/32\",\"server_countries\":\"Japan\",\"server_cities\":\"Tokyo\",\"free_only\":true}")
for want in WIREGUARD_ADDRESSES=10.2.0.2/32 SERVER_COUNTRIES=Japan SERVER_CITIES=Tokyo FREE_ONLY=on; do
  grep -qxF "$want" <<<"$out" || { echo "FAIL: missing $want"; fail=1; }
done
grep -qF "(Japan, Tokyo, free servers only)" <<<"$out" || { echo "FAIL: startup message"; fail=1; }
[ $fail -eq 0 ] && echo "PASS: optional settings"

rm -rf "$TMP"
exit $fail

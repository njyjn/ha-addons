#!/usr/bin/env bash
# Turns the app's settings (/data/options.json) into Gluetun's environment
# variables, then starts Gluetun. Never prints the private key.
set -euo pipefail

OPTIONS=/data/options.json
opt() { jq -r --arg k "$1" '.[$k] // empty' "$OPTIONS"; }

key="$(opt wireguard_private_key)"
if [ -z "$key" ]; then
  echo "[proton-proxy] Set wireguard_private_key (the PrivateKey line from a Proton WireGuard config) in the app's Configuration, then start the app again." >&2
  exit 1
fi

export VPN_SERVICE_PROVIDER=protonvpn
export VPN_TYPE=wireguard
export WIREGUARD_PRIVATE_KEY="$key"
address="$(opt wireguard_address)"
[ -n "$address" ] && export WIREGUARD_ADDRESSES="$address"

export SERVER_COUNTRIES="$(opt server_countries)"
cities="$(opt server_cities)"
[ -n "$cities" ] && export SERVER_CITIES="$cities"
free_note=""
if [ "$(opt free_only)" = "true" ]; then export FREE_ONLY=on; free_note=", free servers only"; else export FREE_ONLY=off; fi

# Only an HTTP proxy, for other apps on Home Assistant's internal network.
export HTTPPROXY=on
export HTTPPROXY_LISTENING_ADDRESS=":8888"
export SHADOWSOCKS=off

echo "[proton-proxy] Connecting to Proton VPN (${SERVER_COUNTRIES:-any country}${cities:+, $cities}${free_note}); HTTP proxy on port 8888."
exec "${GLUETUN_ENTRYPOINT:-/gluetun-entrypoint}"

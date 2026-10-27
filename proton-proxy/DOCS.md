# Proton Proxy

Runs a Proton VPN (WireGuard) connection and offers it as an **HTTP proxy
to other apps** on this Home Assistant, e.g. HypeBot's `proxy_url`. Only
apps that are pointed at the proxy use the VPN; the rest of your home
network is unaffected.

It wraps the official [Gluetun](https://github.com/qdm12/gluetun) image
(pinned version). If the VPN tunnel drops, Gluetun's firewall blocks the
proxy rather than letting traffic out over your home connection.

## Setup

1. Sign in at <https://account.protonvpn.com> → **Downloads** →
   **WireGuard configuration**. Pick a platform (any), a name, and a server
   (Singapore, or a free-plan country), then **Create**.
2. From the config shown, copy the value after `PrivateKey = `. Paste it
   into **wireguard_private_key** here. It's a secret: don't share it.
3. Start the app and open **Log**. When it's connected you'll see
   `Public IP address is …` with the country. That's the IP Apple will see.
4. On the app's **Info** page, note the **Hostname** (e.g.
   `abcd1234-proton-proxy`). In HypeBot set
   `proxy_url: http://<hostname>:8888` and restart HypeBot once.

## Options

| Option | Default | Notes |
|---|---|---|
| `wireguard_private_key` | | Required. From a Proton WireGuard config. |
| `wireguard_address` | (Proton default `10.2.0.2/32`) | Only if your config's `Address` differs. |
| `server_countries` | `Singapore` | Comma-separated, e.g. `Singapore,Japan`. |
| `server_cities` | | Optional, e.g. `Singapore`. |
| `free_only` | `false` | Turn on for Proton's free plan (free servers only; the free plan doesn't include every country). |

## Notes

- Turn on **Watchdog** on the app's Info page, so Home Assistant restarts
  it if Gluetun stops (e.g. a Proton outage at startup).
- Any app on this Home Assistant can use the proxy; it has no password.
  That's fine for apps you installed yourself, but don't install apps you
  don't trust alongside it.
- The proxy listens on port 8888 inside Home Assistant only. No port is
  opened on your home network.
- The app needs network-admin permission and the VPN device. Every VPN app
  does, which lowers its security rating in Home Assistant.
- Upgrading Gluetun: bump `GLUETUN_VERSION` in the Dockerfile and the app
  version.

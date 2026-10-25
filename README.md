# Home Assistant Add-ons

Personal Home Assistant add-ons repository.

## Installation

1. Go to Home Assistant Settings → Add-ons, Backups & Automations → Add-on Store
2. Click the menu (⋮) in the top-right
3. Select "Repositories"
4. Add this URL: `https://github.com/njyjn/ha-addons`
5. Click "Create"

The add-ons will now appear in your Add-on Store under "Justin's Home Assistant Add-ons".

## Available Add-ons

### InventoryBot

Barcode scanner-based inventory management system with real-time quantity tracking and transaction history.

- **Repository**: [njyjn/inventorybot](https://github.com/njyjn/inventorybot)
- **Image**: `ghcr.io/njyjn/inventorybot`
- **Supported Architectures**: aarch64, amd64, armv7

For full documentation, see the [InventoryBot README](https://github.com/njyjn/inventorybot/blob/main/README.md).

### BabyBot

Baby care tracking and management system.

- **Repository**: [njyjn/babybot](https://github.com/njyjn/babybot)
- **Image**: `ghcr.io/njyjn/babybot`
- **Supported Architectures**: aarch64

For full documentation, see the [BabyBot README](https://github.com/njyjn/babybot/blob/main/README.md).

### FlightBot

ADS-B receiver (readsb + tar1090) for an RTL-SDR stick such as the RadarBox FlightStick.

- **Repository**: [njyjn/flightbot](https://github.com/njyjn/flightbot)
- **Image**: `ghcr.io/njyjn/flightbot`
- **Supported Architectures**: aarch64

For full documentation, see the [FlightBot README](https://github.com/njyjn/flightbot/blob/main/README.md).

### ChoreBot

Household chore tracker: the helper ticks chores off on the guardhouse tablet, and Home Assistant gets a sensor plus a daily alert for anything overdue.

- **Repository**: [njyjn/chorebot](https://github.com/njyjn/chorebot)
- **Image**: `ghcr.io/njyjn/chorebot`
- **Supported Architectures**: aarch64

For full documentation, see the [ChoreBot README](https://github.com/njyjn/chorebot/blob/main/README.md).

### HypeBot

Stock alerts for hard-to-find products: checks Apple Store Singapore pickup availability for the models you pick and alerts via Slack, Telegram or a Home Assistant notify service, with a sensor per model.

- **Repository**: [njyjn/hypebot](https://github.com/njyjn/hypebot)
- **Image**: `ghcr.io/njyjn/hypebot`
- **Supported Architectures**: aarch64

For full documentation, see the [HypeBot README](https://github.com/njyjn/hypebot/blob/main/README.md).

### ConfigSync

Mirrors the Home Assistant config into a private Git repository on a daily or weekly schedule, using that repository's own allowlists, redaction and secret scanning, and reports to `sensor.configsync_last_run`. Unlike the add-ons above it lives in this repository and is built on the Pi; there is no prebuilt image.

- **Source**: [`configsync/`](configsync/)
- **Supported Architectures**: aarch64

For full documentation, see the [ConfigSync docs](configsync/DOCS.md).

## Updates

Add-ons are automatically updated when new versions are pushed to GitHub Container Registry. Simply restart the add-on in Home Assistant to pull the latest image.

ConfigSync is the exception: it builds on the Pi, and Home Assistant offers an update when the `version` in `configsync/config.yaml` is bumped.

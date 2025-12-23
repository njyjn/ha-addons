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

## Updates

Add-ons are automatically updated when new versions are pushed to GitHub Container Registry. Simply restart the add-on in Home Assistant to pull the latest image.

# Homebridge Levoit Air Purifier EU

[![npm](https://img.shields.io/npm/v/homebridge-levoit-air-purifier-eu.svg)](https://www.npmjs.com/package/homebridge-levoit-air-purifier-eu)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

A Homebridge plugin to control Levoit Air Purifiers via the VeSync platform with **EU endpoint support**.

> **Note:** This is a fork of [homebridge-levoit-air-purifier](https://github.com/RaresAil/homebridge-levoit-air-purifier) by RaresAil with improvements for the current VeSync auth flow and EU support.

## Supported Devices

| Model | Tested | Speed Levels |
|-------|--------|--------------|
| Core 600S | ✅ (Original) | Sleep, 1-4 |
| Core 400S Pro | ✅ (Original) | Sleep, 1-4 |
| Core 400S | ✅ (Original) | Sleep, 1-4 |
| Core 300S / 300S Pro | ✅ | Sleep, 1-3 |
| Core 200S | ✅ (Original) | Sleep, 1-3 |
| Vital 100S / 200S | ✅ (Original) | Sleep, 1-3 |

**Note:** Devices below 200 (e.g. 131S) are not supported as they require API v1.

## Features

- ✅ Air quality display (PM2.5 as separate sensor)
- ✅ Filter life level & filter change indicator
- ✅ Child lock
- ✅ Modes: Auto, Manual, Sleep
- ✅ Speed control
- ✅ EU & US endpoint support
- ✅ Token persistence (session is saved)

### Experimental Features

- **DeviceDisplay**: Display control as light in HomeKit
- **Humidifiers**: Support for Levoit humidifiers (Dual 200S)

## Installation

### Via Homebridge UI (Recommended)

Search for **"levoit air purifier eu"** in the Homebridge Plugin search.

### Via npm

```bash
npm install -g homebridge-levoit-air-purifier-eu
```

### On the Official Homebridge Image (Raspberry Pi)

Open the **Terminal** in the Homebridge UI and run:

```bash
npm --prefix /var/lib/homebridge install --save homebridge-levoit-air-purifier-eu
```

Then **restart Homebridge**.

### Install from GitHub (Development)

```bash
npm --prefix /var/lib/homebridge install --save git+https://github.com/Karrypto/homebridge-levoit-air-purifier.git#master
```

## Configuration

### Via Homebridge UI

1. Go to **Plugins** → **Levoit Air Purifier EU** → **Settings**
2. Enter your VeSync credentials
3. Select your **Country Code** (e.g. `DE` for Germany, `US` for USA)
4. Save and restart Homebridge

### Manual Configuration (config.json)

```json
{
  "platforms": [
    {
      "platform": "LevoitAirPurifiers",
      "name": "Levoit Air Purifiers",
      "email": "your@email.com",
      "password": "your-password",
      "countryCode": "DE"
    }
  ]
}
```

### Optional Settings

```json
{
  "platform": "LevoitAirPurifiers",
  "name": "Levoit Air Purifiers",
  "email": "your@email.com",
  "password": "your-password",
  "countryCode": "DE",
  "enableDebugMode": false,
  "experimentalFeatures": ["DeviceDisplay", "Humidifiers"]
}
```

## Country Codes

| Country | Code | Endpoint |
|---------|------|----------|
| 🇩🇪 Germany | `DE` | EU |
| 🇦🇹 Austria | `AT` | EU |
| 🇨🇭 Switzerland | `CH` | EU |
| 🇬🇧 United Kingdom | `GB` | EU |
| 🇫🇷 France | `FR` | EU |
| 🇳🇱 Netherlands | `NL` | EU |
| 🇺🇸 USA | `US` | US |
| 🇨🇦 Canada | `CA` | US |
| 🇦🇺 Australia | `AU` | US |

EU accounts are automatically routed via `smartapi.vesync.eu`.

## HomeKit Control

### Speed (Rotation Speed)

**Core 200S / 300S / 300S Pro:**

| HomeKit | Mode |
|---------|------|
| 0% | Off |
| 25% | Sleep Mode |
| 50% | Level 1 |
| 75% | Level 2 |
| 100% | Level 3 |

**Core 400S / 400S Pro / 600S:**

| HomeKit | Mode |
|---------|------|
| 0% | Off |
| 20% | Sleep Mode |
| 40% | Level 1 |
| 60% | Level 2 |
| 80% | Level 3 |
| 100% | Level 4 |

### Target State

| HomeKit | Levoit Mode |
|---------|-------------|
| Auto | Automatic mode |
| Manual | Manual mode |

## Troubleshooting

### "Login failed: Invalid email or password"
- Verify your VeSync credentials in the VeSync app

### "Cross-region error"
- Select the correct **Country Code** for your region

### Device not appearing in HomeKit
- Enable **Debug Mode** in plugin settings
- Check if the device is online in the VeSync app

### Token Persistence
The plugin saves your VeSync session. After a restart you'll see:
```
Reusing persisted VeSync session
```

## Uninstall

```bash
npm --prefix /var/lib/homebridge uninstall homebridge-levoit-air-purifier-eu
```

## Changes from Original

This fork includes the following improvements:

- **New 2-step auth flow** (compatible with current VeSync accounts)
- **EU endpoint support** (automatic based on country code)
- **Token persistence** (session saved between restarts)
- **Improved error handling**

## Credits & License

**Original Plugin:** [homebridge-levoit-air-purifier](https://github.com/RaresAil/homebridge-levoit-air-purifier) by [RaresAil](https://github.com/RaresAil)

**Auth flow inspired by:** [homebridge-tsvesync](https://github.com/mickgiles/homebridge-tsvesync)

**License:** [Apache-2.0](LICENSE)

This project is a fork and is released under the same license as the original.

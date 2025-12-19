# Homebridge Levoit Air Purifier (Fork)

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

Ein Homebridge-Plugin zur Steuerung von Levoit-Luftreinigern über die VeSync-Plattform.

> **Hinweis:** Dies ist ein Fork von [homebridge-levoit-air-purifier](https://github.com/RaresAil/homebridge-levoit-air-purifier) von RaresAil mit Verbesserungen für den aktuellen VeSync-Auth-Flow und EU-Unterstützung.

## Unterstützte Geräte

| Modell | Getestet | Geschwindigkeitsstufen |
|--------|----------|------------------------|
| Core 600S | ✅ (Original) | Sleep, 1-4 |
| Core 400S Pro | ✅ (Original) | Sleep, 1-4 |
| Core 400S | ✅ (Original) | Sleep, 1-4 |
| Core 300S / 300S Pro | ✅ | Sleep, 1-3 |
| Core 200S | ✅ (Original) | Sleep, 1-3 |
| Vital 100S / 200S | ✅ (Original) | Sleep, 1-3 |

**Hinweis:** Geräte unter 200 (z.B. 131S) werden nicht unterstützt, da diese API v1 benötigen.

## Features

- ✅ Luftqualitätsanzeige (PM2.5 als separater Sensor)
- ✅ Filterlebensdauer & Filterwechsel-Indikator
- ✅ Kindersicherung (Child Lock)
- ✅ Modi: Auto, Manuell, Nachtmodus
- ✅ Geschwindigkeitssteuerung
- ✅ EU & US Endpoint-Unterstützung
- ✅ Token Persistence (Session wird gespeichert)

### Experimentelle Features

- **DeviceDisplay**: Display-Steuerung als Lampe in HomeKit
- **Humidifiers**: Unterstützung für Levoit-Luftbefeuchter (Dual 200S)

## Installation

### Auf dem offiziellen Homebridge Image (Raspberry Pi)

Öffne das **Terminal** in der Homebridge UI und führe folgenden Befehl aus:

```bash
npm --prefix /var/lib/homebridge install --save git+https://github.com/Karrypto/homebridge-levoit-air-purifier.git#master
```

Danach **Homebridge neu starten**.

### Andere Installationen

```bash
npm install -g git+https://github.com/Karrypto/homebridge-levoit-air-purifier.git
```

## Konfiguration

### Über die Homebridge UI

1. Gehe zu **Plugins** → **Levoit Air Purifiers** → **Settings**
2. Gib deine VeSync-Zugangsdaten ein
3. Wähle deinen **Country Code** (z.B. `DE` für Deutschland)
4. Speichern und Homebridge neu starten

### Manuelle Konfiguration (config.json)

```json
{
  "platforms": [
    {
      "platform": "LevoitAirPurifiers",
      "name": "Levoit Air Purifiers",
      "email": "deine@email.de",
      "password": "dein-passwort",
      "countryCode": "DE"
    }
  ]
}
```

### Optionale Einstellungen

```json
{
  "platform": "LevoitAirPurifiers",
  "name": "Levoit Air Purifiers",
  "email": "deine@email.de",
  "password": "dein-passwort",
  "countryCode": "DE",
  "enableDebugMode": false,
  "experimentalFeatures": ["DeviceDisplay", "Humidifiers"]
}
```

## Country Codes

| Land | Code | Endpoint |
|------|------|----------|
| 🇩🇪 Deutschland | `DE` | EU |
| 🇦🇹 Österreich | `AT` | EU |
| 🇨🇭 Schweiz | `CH` | EU |
| 🇬🇧 Großbritannien | `GB` | EU |
| 🇫🇷 Frankreich | `FR` | EU |
| 🇳🇱 Niederlande | `NL` | EU |
| 🇺🇸 USA | `US` | US |
| 🇨🇦 Kanada | `CA` | US |
| 🇦🇺 Australien | `AU` | US |

EU-Accounts werden automatisch über `smartapi.vesync.eu` geroutet.

## Steuerung in HomeKit

### Geschwindigkeit (Rotation Speed)

**Core 200S / 300S / 300S Pro:**

| HomeKit | Modus |
|---------|-------|
| 0% | Aus |
| 25% | Nachtmodus (Sleep) |
| 50% | Stufe 1 |
| 75% | Stufe 2 |
| 100% | Stufe 3 |

**Core 400S / 400S Pro / 600S:**

| HomeKit | Modus |
|---------|-------|
| 0% | Aus |
| 20% | Nachtmodus (Sleep) |
| 40% | Stufe 1 |
| 60% | Stufe 2 |
| 80% | Stufe 3 |
| 100% | Stufe 4 |

### Zielzustand (Target State)

| HomeKit | Levoit Modus |
|---------|--------------|
| Auto | Automatik-Modus |
| Manual | Manueller Modus |

## Troubleshooting

### "Login failed: Invalid email or password"
- Prüfe deine VeSync-Zugangsdaten in der VeSync-App

### "Cross-region error"
- Wähle den korrekten **Country Code** für dein Land

### Gerät erscheint nicht in HomeKit
- Aktiviere **Debug Mode** in den Plugin-Einstellungen
- Prüfe ob das Gerät in der VeSync-App online ist

### Token Persistence
Das Plugin speichert die VeSync-Session. Nach einem Neustart siehst du:
```
Reusing persisted VeSync session
```

## Deinstallation

```bash
npm --prefix /var/lib/homebridge uninstall homebridge-levoit-air-purifier
```

## Änderungen gegenüber dem Original

Dieser Fork enthält folgende Verbesserungen:

- **Neuer 2-Schritt-Auth-Flow** (kompatibel mit aktuellen VeSync-Accounts)
- **EU-Endpoint-Unterstützung** (automatisch basierend auf Country Code)
- **Token Persistence** (Session wird zwischen Neustarts gespeichert)
- **Verbesserte Fehlerbehandlung**

## Credits & Lizenz

**Original-Plugin:** [homebridge-levoit-air-purifier](https://github.com/RaresAil/homebridge-levoit-air-purifier) von [RaresAil](https://github.com/RaresAil)

**Auth-Flow inspiriert von:** [homebridge-tsvesync](https://github.com/mickgiles/homebridge-tsvesync)

**Lizenz:** [Apache-2.0](LICENSE)

Dieses Projekt ist ein Fork und steht unter der gleichen Lizenz wie das Original.

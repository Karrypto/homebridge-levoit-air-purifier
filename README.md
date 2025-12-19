# Homebridge Levoit Air Purifier (Karrypto Fork)

Ein schlankes Homebridge-Plugin zur Steuerung von Levoit-Luftreinigern über die VeSync-API.

## Features

- ✅ **Unterstützung für Levoit Core 200S/300S/400S/600S**
- ✅ **Neuer 2-Schritt-Auth-Flow** (kompatibel mit aktuellen VeSync-Accounts)
- ✅ **EU & US Endpoint-Unterstützung** (automatisch basierend auf Country Code)
- ✅ **Token Persistence** (Session wird gespeichert, schnellerer Start)
- ✅ **Luftqualitätsanzeige** (PM2.5 Sensor als separates Accessory)
- ✅ **Filterlebensdauer-Anzeige**
- ✅ **Kindersicherung** (Child Lock)
- ✅ **Modi**: Auto, Manuell (Stufe 1-3), Nachtmodus

## Installation

### Via GitHub URL (empfohlen für diesen Fork)

```bash
npm install -g git+https://github.com/Karrypto/homebridge-levoit-air-purifier.git
```

Oder über die Homebridge UI:
1. **Plugins** → **⋮** → **Install Plugin**
2. Eintragen: `git+https://github.com/Karrypto/homebridge-levoit-air-purifier.git`

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

## Country Codes

| Land | Code | Endpoint |
|------|------|----------|
| 🇩🇪 Deutschland | `DE` | EU |
| 🇦🇹 Österreich | `AT` | EU |
| 🇨🇭 Schweiz | `CH` | EU |
| 🇬🇧 Großbritannien | `GB` | EU |
| 🇫🇷 Frankreich | `FR` | EU |
| 🇺🇸 USA | `US` | US |
| 🇨🇦 Kanada | `CA` | US |
| 🇦🇺 Australien | `AU` | US |

## Steuerung in HomeKit

### Geschwindigkeit (Rotation Speed)

| HomeKit | Levoit Modus |
|---------|--------------|
| 0% | Aus |
| 25% | Nachtmodus (Sleep) |
| 50% | Manuell Stufe 1 |
| 75% | Manuell Stufe 2 |
| 100% | Manuell Stufe 3 |

### Zielzustand (Target State)

| HomeKit | Levoit Modus |
|---------|--------------|
| Auto | Automatik-Modus |
| Manual | Manueller Modus |

## Unterstützte Geräte

- Core 200S
- Core 300S / 300S Pro
- Core 400S / 400S Pro
- Core 600S
- Vital 100S / 200S

### Experimentelle Features

In den Plugin-Einstellungen können optional aktiviert werden:
- **DeviceDisplay**: Display-Steuerung als Lampe in HomeKit
- **Humidifiers**: Unterstützung für Levoit-Luftbefeuchter

## Token Persistence

Das Plugin speichert die VeSync-Session zwischen Neustarts. Dadurch:
- Schnellerer Start (kein neuer Login nötig)
- Weniger API-Aufrufe
- Stabilere Verbindung

Die Session wird automatisch erneuert, bevor sie abläuft.

## Troubleshooting

### "Login failed: Invalid email or password"
- Prüfe deine VeSync-Zugangsdaten
- Stelle sicher, dass du dich in der VeSync-App einloggen kannst

### "Cross-region error"
- Wähle den korrekten **Country Code** für dein Land
- EU-Accounts benötigen EU-Country-Codes (DE, GB, FR, etc.)

### Gerät erscheint nicht in HomeKit
- Aktiviere **Debug Mode** in den Plugin-Einstellungen
- Prüfe die Homebridge-Logs auf Fehlermeldungen
- Stelle sicher, dass das Gerät in der VeSync-App online ist

## Credits

Basierend auf [homebridge-levoit-air-purifier](https://github.com/RaresAil/homebridge-levoit-air-purifier) von RaresAil.

Auth-Flow inspiriert von [homebridge-tsvesync](https://github.com/mickgiles/homebridge-tsvesync).

## Lizenz

Apache-2.0

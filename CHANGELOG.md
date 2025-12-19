# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2024-12-19

### Added
- Child Bridge recommendation in README

### Changed
- Simplified supported devices table in README

## [1.0.1] - 2024-12-19

### Changed
- Updated README with clearer documentation

## [1.0.0] - 2024-12-19

### Added
- Initial release as `homebridge-levoit-air-purifier-eu`
- New 2-step authentication flow (compatible with current VeSync accounts)
- EU endpoint support (automatic based on country code)
- Token persistence (session saved between restarts)
- Country code selection in plugin configuration

### Supported Devices
- Core 600S
- Core 400S / 400S Pro
- Core 300S / 300S Pro
- Core 200S
- Vital 100S / 200S

### Credits
- Forked from [homebridge-levoit-air-purifier](https://github.com/RaresAil/homebridge-levoit-air-purifier) by RaresAil
- Auth flow inspired by [homebridge-tsvesync](https://github.com/mickgiles/homebridge-tsvesync)


# Audi Connect for Gladys Assistant

External integration for [Gladys Assistant](https://gladysassistant.com) that brings your
**Audi connect / myAudi** cars into Gladys: battery and charging, fuel, range, mileage, locks,
doors and windows, climate and parking position — with commands, scene triggers, scene actions
and a dashboard widget.

Built from the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
with the [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

- **Type**: `device`, cloud only (`"transports": ["cloud"]`)
- **Gladys**: 5.3.0 or later
- **Markets**: Europe and Canada (myAudi accounts from the US and China are not supported)
- **Languages**: English, French, German, Spanish

User documentation: [English](docs/en.md) · [Français](docs/fr.md) · [Deutsch](docs/de.md) ·
[Español](docs/es.md)

## Features

| Surface          | What                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Devices          | one per car: mileage, battery, ranges, fuel, charging, climate, locks, openings, service, position |
| Commands         | charging start/stop, target charge level, climate start/stop + temperature, lock/unlock (S-PIN)    |
| Scene triggers   | `charging_state_changed`, `lock_state_changed`, `command_failed`                                   |
| Scene actions    | `start_climatisation`, `stop_climatisation`, `refresh_vehicle`                                     |
| Dashboard widget | `car_status`: battery/fuel gauge, range, mileage, status, buttons, map link                        |
| Configuration    | `test_connection`, `refresh_now` (with optional wake-up), `identify` (flash lights)                |

## How it signs in

Audi no longer accepts the password sign-in of third-party apps in Europe and Canada (the token
exchange requires an Android Play Integrity attestation). The integration uses the standard
OAuth **device authorization grant** instead, rendered by Gladys as an `account_link` field:
the user clicks **Connect**, approves a code on the Audi page, and the integration polls for the
approval. The resulting refresh token rotates and is stored by the integration in the Gladys
configuration (outside the config schema, never shown).

The Audi cloud protocol was ported from the Home Assistant integration
[audiconnect/audi_connect_ha](https://github.com/audiconnect/audi_connect_ha) (MIT).

## Development

```bash
npm install
npm test               # node --test
npm run lint           # ESLint
npm run format:check   # Prettier
```

Tests never touch the network: `test/helpers/fakeAudi.js` fakes the Audi cloud and the SDK's
`createFakeGladys()` fakes Gladys. See [`CLAUDE.md`](CLAUDE.md) for the architecture and the
invariants.

Run it against a local Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="audi-connect" \
LOG_LEVEL=debug \
npm start
```

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major` (the first release:
   `major`, from 0.0.0 to 1.0.0).
3. The workflow bumps `package.json` and the manifest, rolls the changelog, tags `vX.Y.Z`,
   builds the `linux/amd64` + `linux/arm64` image to `ghcr.io/prohand/gladys-audiconnect`, and
   publishes the GitHub Release.

The repository needs the GitHub topic `gladys-assistant-integration` to be indexed by the store,
and **Private vulnerability reporting** turned on (see [`SECURITY.md`](SECURITY.md)).

## License

Apache-2.0

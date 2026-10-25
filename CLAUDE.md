# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors working in
this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **Audi connect / myAudi** cars. It started
from the official JavaScript template (GladysAssistant/integration-template-js) and follows the
conventions of prohand/gladys-devmel (workflows, four languages).

Cloud only (`"transports": ["cloud"]`): every value comes from the Audi / VW Group cloud, nothing
talks to the car on the LAN. One Gladys device per car (VIN). Gladys 5.1+ adds scene triggers
(charging state changed, lock state changed, command failed), scene actions (start/stop
climate, read a car) and the "Audi car" widget. The manifest requires Gladys 5.3.0 (catalog
`keywords`); shelves `vehicles`, `energy`, `security`; no `countries` (Europe and Canada are
more than the field holds).

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/api.test.js                # one file
node --test --test-name-pattern "S-PIN"     # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks (needs Node 24)
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node 22 and 24, and on
pull requests the store checks and a Docker build. Run the three commands before pushing.

## Architecture

```
index.js                     creates the SDK client, connects (no logic)
src/integration.js           all the SDK wiring, testable with the fake Gladys
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/account.js               "Connect" (account_link): waits for the approval on the Audi page
src/fleet.js                 cars: reads, publication, triggers, per-car command queue
src/devices/car.js           the car device: features (keys are forever), states
src/devices/index.js         onPoll dispatcher (config interval over Gladys' 1-minute poll)
src/audi/http.js             fetch wrapper: app headers, timeout, rate-limit header, errors
src/audi/auth.js             device-code sign-in, IDK / AZS / MBB tokens, rotating refresh
src/audi/api.js              every Audi call (list, status, position, commands, lock + S-PIN)
src/audi/vehicleState.js     selectivestatus + position -> one flat state per car
src/capabilities/scenes.js   scene actions (manifest `scene_actions`)
src/capabilities/widget.js   dashboard widget (manifest `widgets`)
src/actions.js               Configuration screen buttons (manifest `actions`)
src/messages.js, src/i18n.js user-facing texts, { en, fr, de, es }
src/logging.js               "Detailed logs" switch (LOG_LEVEL)
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (mandatory)
test/helpers/fakeAudi.js     fake Audi cloud plugged in place of fetch
```

### Invariants worth knowing

- **No password sign-in.** Audi requires a Play Integrity attestation for the password flow in
  Europe and Canada; the integration uses the OAuth device authorization grant (RFC 8628) and a
  manifest `account_link` field. US / China accounts (password flow + X-QMAuth) are not
  supported: adding them is a separate piece of work.
- **The IDK refresh token rotates.** Every refresh may return a new one and kill the old one:
  `onRefreshToken` stores it at once with `gladys.setConfig({ audi_refresh_token })`, a key
  outside the config_schema (never shown, never sent to the browser). `onConfigUpdated` keeps it
  when a form save does not carry it. Concurrent refreshes are merged into one.
- **Three tokens.** IDK for every CARIAD BFF call (`emea.bff.cariad.digital`), AZS for the
  GraphQL car list only, MBB (lazy) for lock/unlock only, which still lives on the MBB platform
  with the S-PIN challenge (SHA-512 of PIN bytes + challenge bytes).
- **Metered allowance.** Audi counts calls per account and day (`Vcf-Remaining-Calls`). A read is
  two calls (selectivestatus + parkingposition). Nothing wakes the car on its own: only the
  user (action, scene) does. Default interval 15 min, minimum 5 min.
- **Commands are asynchronous.** The cloud queues the order; `pendingrequests` gives the car's
  verdict. "No verdict in time" is `unconfirmed`, never a failure. `onSetValue` must ack within
  5 s, so commands run in the background, queued per car; a refusal fires `command_failed` and
  republishes the real state.
- **climatisation/start replaces the whole settings object**: with a temperature, read the car's
  settings and send them back with only the temperature changed; without one, send no body.
- **A job may fail alone** (207 with an error object): `mergeVehicleState` keeps the last value,
  so a feature never disappears nor resets because of one bad answer.
- **Features follow the car**: a feature is declared only when the car reports its value; a new
  one appearing later republishes the device first (Gladys refuses states of unknown features).
- **Every feature declares `min`/`max`** (NOT NULL in Gladys).
- **Polling**: `poll_frequency` published to Gladys is `EVERY_MINUTES` (ms, an enum: any other
  value rejects the whole discovery); the config interval is seconds and applied by skipping.
- **First read is a state, not a change**: triggers fire only between two reads.
- Never log tokens, the S-PIN or a full VIN (`http.js` masks VINs in paths).
- Device external ids use the VIN; feature, trigger, action and widget keys are stored by users:
  never rename them.

## Rules

- **Versions belong to the Release workflow** (Actions → Release). Never edit `version` in
  `package.json` or in the manifest, nor the `docker_image` tag, by hand. `test/manifest.test.js`
  checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in `CHANGELOG.md`
  (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version heading.
- **Manifest.** Texts are `{ en, fr, de, es }` objects (label, description, placeholder);
  `test/manifest.test.js` enforces the four languages and ties the manifest to the code
  (defaults, actions, scene actions, triggers, widgets, catalog categories and keywords, the
  `gladys_version` floor).
- **User-facing text** is in the four languages: `src/messages.js`, widget texts, manifest and
  `docs/*.md`, kept in sync.
- **The container rootfs is read-only.** Nothing is written to disk; tokens stay in memory and
  in the Gladys config.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English. Tests
  never touch the network (`test/helpers/fakeAudi.js`, `createFakeGladys`).

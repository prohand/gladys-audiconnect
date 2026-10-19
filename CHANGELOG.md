# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release workflow moves that
section under the version it ships, and the section becomes the notes of the version's GitHub
Release.

## [Unreleased]

### Added

- First version of the Audi Connect integration, built on the official Gladys integration
  template (SDK 0.15, Gladys 5.1 or later).
- One Gladys device per car of the myAudi account: mileage, range, battery and fuel level,
  charging (state, power, plug, target level), climate, locks, doors, windows, outside
  temperature, position and next service.
- Commands: start and stop charging, set the target charge level, start and stop the climate
  (with its target temperature), lock and unlock (with the S-PIN).
- Scene triggers: charging state changed, lock state changed, a remote command failed.
- Scene actions: start the climate, stop the climate, refresh a car (its values as outputs).
- "Audi car" dashboard widget: battery, range, mileage, locks, openings, charging, climate,
  refresh and climate buttons, and a map link.
- Configuration actions: "Test the connection" and "Refresh now".
- English, French, German and Spanish for every text (configuration screen, messages, widget,
  scenes and documentation).
- CI (Prettier, ESLint, tests on Node 22 and 24, store checks and Docker build on pull
  requests), Release, image build and GitHub release workflows, Dependabot.
- `SECURITY.md`, `CHANGELOG.md` and `CLAUDE.md`.

[Unreleased]: https://github.com/prohand/gladys-audiconnect/commits/main

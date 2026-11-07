# Changelog

All notable changes to Track Forge are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `npm run first-use` (`scripts/first-use.sh`): walks through the README from
  a fresh clone, or with `RELEASE=x.y.z` against the published tag and the
  hosted demo, and stops at the first step that does not behave as
  documented: the player before setup, the fastest start, a new track
  through validation, tests and build, a refused occupied port, and the LAN
  player over TLS against the generated local CA. Testing levels in
  `docs/TESTING.md`.

### Fixed

- `npm run player:start` on a fresh clone no longer lets Docker create
  root-owned directories where the TLS certificate files belong. It asks for
  `./setup.sh` first, Compose refuses missing mount sources instead of creating
  them, and setup explains how to remove such leftovers from earlier versions.
- `./setup.sh` checks the player ports before it starts anything and names
  `PLAYER_HTTP_PORT` and `PLAYER_HTTPS_PORT` when 80 or 443 is taken. It prints
  the real URLs including the port and removes the stack again when Docker
  cannot start it. The HTTP to HTTPS redirect keeps a non-default port.
- The sample library build restores the Wikimedia Commons banks `bot_braam`,
  `bot_djembe` and `bot_kantele` from their recorded URLs and checks them
  against the recorded SHA-256. If a recorded file cannot be restored,
  curation names the banks and leaves the manifests unchanged.
- The sample browser says when the sample audio is not installed (hosted demo,
  `--no-samples`) and turns previews off instead of failing silently.
- `npm run piece:create` scaffolds a small playable arrangement that matches
  its `piece.json`, and `npm run timeline:previews` names the field it misses.
- The Studio and the Player request the source service relative to the app's
  base path, and not at all in the Vite dev server or the hosted demo.
- The first notes of a track no longer fail with an AudioWorklet `getTrigger`
  error: the first playback waits for Strudel's audio worklets.
- Generated files keep their timestamp when their content is unchanged, so
  setup on a fresh clone leaves the working tree clean. The VCSL seed uses the
  commit pinned in `manifests/sources.json`.

### Changed

- The local certificate authority is named "Track Forge Local CA" and
  downloads as `track-forge-local-ca.crt`. Existing CA files keep working.
- The Studio and the Player have a favicon.

### Removed

- `deploy/player.Dockerfile`, `deploy/source-api.Dockerfile` and
  `.dockerignore`, unused since `./setup.sh --image` was removed.

## [0.1.0] - 2026-11-03

First tagged release.

### Added

- Hosted demo on GitHub Pages with the example track, built on every push to
  `main`.
- License and Strudel attribution line in the Studio and the Player.
- Contributing guide, security policy, changelog and issue templates.

### Changed

- Renamed from "Strudel Track Forge" to "Track Forge", following the Strudel
  community's request that projects built on Strudel do not use its name.
- Relicensed the application code from MIT to AGPL-3.0-or-later, matching the
  bundled Strudel packages. The example track stays CC0 1.0.
- App URLs resolve against Vite's base path, so the same build works at the
  domain root and under a sub-path.
- `soundPalette` is now free-form optional metadata; the validator no longer
  enforces a fixed set of sound families.

### Removed

- `./setup.sh --image`, which pulled container images that were never public.
- Project-specific `aiHooks` metadata and AI agent instructions.
- The duplicate example under `docs/examples/`; the example track lives in
  `src/pieces/example-track/`.

[Unreleased]: https://github.com/RainerGewalt/track-forge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/RainerGewalt/track-forge/releases/tag/v0.1.0

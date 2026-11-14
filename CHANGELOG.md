# Changelog

All notable changes to Track Forge are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Security

- Source writing stays off unless `SOURCE_EDITOR_TOKEN` holds a private value
  of at least 32 characters. The service refuses the example value that
  `.env.example` set up to 0.1.1, and `.env.example` no longer sets a token.
  Setup and `npm run player:start` say when the configured token does not
  enable writing. If your `.env` was copied from an earlier `.env.example`,
  generate a token with `openssl rand -hex 24`.

### Fixed

- A draft that fails to evaluate no longer counts as playing and no longer
  unlocks **Prepare Overwrite**. Strudel reports evaluation errors without
  rejecting; the transport now treats them as a failure, and the Source
  Inspector shows the error.
- A draft that evaluates but reports an error while it plays, such as a sound
  that is not loaded, does not unlock **Prepare Overwrite** either.
- The source service refuses a source that is empty or does not parse (422),
  writes the new file and a backup of the previous one
  (`.main.strudel.bak`) before it replaces the source in one rename, and
  leaves the source unchanged when any step fails.
- The player's spectrum shows the music again, and Stop silences the output
  within 100 ms in the Studio and the player, reverb tails and notes that
  were already scheduled included. Reverb renders in an offline audio context
  had replaced the master gain that Stop and the spectrum use.
- The hosted demo says in the Studio and the player that drafts and tracks
  play in the browser and nothing is saved. The Source Inspector no longer
  reports an unreachable source service in the demo and the dev server, where
  there is none by design.

### Changed

- **Stop and Back to start are two actions.** Stop halts playback at once,
  as before, but keeps the position: the next Play of the same track, in the
  Studio and in the player, continues there. **Back to start** (the Studio
  button that was Restart, Shift + Space, and a new button in the player)
  returns to the beginning; while a track plays it continues from the top,
  while it is stopped it stays stopped. At the end of a track, in Layer Lab
  mode and for a track without a BPM, Stop keeps no position. Up to 0.1.1,
  Stop always returned to the beginning.
- Vite 6.4.5 (development dependency), which resolves the advisories reported
  for 6.4.3.
- `npm run test:e2e`: browser scenarios in headless Chrome for the draft
  gate, the audio master, Stop and Back to start, and the demo notice, also
  in CI. `npm audit` is a step before every tag (`docs/TESTING.md`).

## [0.1.1] - 2026-11-07

### Added

- `npm run first-use` (`scripts/first-use.sh`): walks through the README from
  a fresh clone, or with `RELEASE=x.y.z` against the published tag and the
  hosted demo, and stops at the first step that does not behave as
  documented: the player before setup, the fastest start, a new track
  through validation, tests and build, a refused occupied port, and the LAN
  player over TLS against the generated local CA. Testing levels in
  `docs/TESTING.md`.

### Changed

- The wording of one 0.1.0 entry under "Removed" is more general; what 0.1.0
  removed is unchanged.

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
- Removed internal development-only metadata and instructions.
- The duplicate example under `docs/examples/`; the example track lives in
  `src/pieces/example-track/`.

[Unreleased]: https://github.com/RainerGewalt/track-forge/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/RainerGewalt/track-forge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/RainerGewalt/track-forge/releases/tag/v0.1.0

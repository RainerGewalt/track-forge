# Changelog

All notable changes to Track Forge are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/RainerGewalt/track-forge/releases/tag/v0.1.0

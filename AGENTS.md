# Agent Instructions

- Preserve existing musical content unless the user explicitly asks for musical changes.
- Do not treat files in `src/sketches/` as release tracks.
- When a track opts into the six-family framework, keep it within Pulse, Skin,
  Seed, Tremor, Memory and Ground, with at most one culturally distinctive main voice.
- Do not add decorative instruments, extra drum families, a second lead melody,
  extra drone foundations or cultural color that is not declared in `piece.json`.
- Do not invent rights, ownership, license, distributor, ISRC or release-date information.
- Do not set `rights.commercialUseChecked` to `true` without explicit evidence from the user.
- Do not edit generated files in `dist/` or dependencies in `node_modules/`.
- Run `npm run pieces:validate` and `npm run build` before completing code changes.
- Keep source code, comments, documentation, commit messages, user-facing labels
  and metadata descriptions in natural English.
- Keep the architecture lightweight. Do not add databases, cloud services,
  distributor integrations or agent pipelines unless explicitly requested.
- Do not invent image creator, source, license, AI-tool or commercial-clearance metadata.

Detailed composition and safe-editing guidance lives in [`agents/`](agents/README.md).

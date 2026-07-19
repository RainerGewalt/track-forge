# Editing Workflow for AI Agents

## Repository shape

- `src/pieces/<track-id>/` — one directory per track: `piece.json`
  (metadata + guardrails), `piece.js` (module glue), `main.strudel`
  (the full arrangement) and one standalone `.strudel` file per layer.
  Tracks are auto-discovered; never add a manual track list.
- Every `.strudel` file is a standalone REPL program (own `setcpm`, own
  `samples(…)` line, no cross-file imports). Shared material must be
  duplicated verbatim into the layer solo files.
- `scripts/samples/` — the rights-aware CC0 sample-library pipeline.
- `scripts/timeline/` — offline extraction of real note/sample events into
  `public/timeline-previews/` (piano-roll and waveform lanes in the UI).
- One audio **orbit per sound family** inside a track. The UI's live layer
  mutes and the timeline lanes depend on this — keep orbits stable.

## Before you finish any change

```sh
npm run pieces:validate     # metadata + file integrity
npm test                    # transport behavior
npm run build               # the app must build
npm run timeline:previews   # after changing any main.strudel
```

## When editing music

1. Read the track's `piece.json` first: `soundPalette`, `aiHooks`
   (`mustPreserve`, `mustAvoid`, `compositionLimits`) are hard constraints.
2. Keep `piece.json` consistent with the code: `timeline` segment
   boundaries must equal the `arrange()` bar sums times the bar length;
   `arrangement` times must match; `rights.samples` must list every
   `bot_` bank the code uses.
3. Mirror musical changes into the affected layer solo files.
4. Update the track's `notes.md` with what changed and why.

## When adding samples

Use the pipeline, never manual downloads:

```sh
npm run samples:discover    # Openverse/Commons discovery -> queues
npm run samples:download    # verified CC0 queue only
npm run samples:curate && npm run samples:build && npm run samples:audit
```

Only provider-verified CC0 is auto-accepted. Anything else stays in
`sample-library/candidates/manual-review.json` for a human decision.

## Common pitfalls

- Identifiers `sub` and `resonance` collide with Strudel exports inside
  `.strudel` files — rename locals.
- The validator requires `rights.samples[]` entries to carry `name` and
  `source`.
- Stale timeline previews are not detected automatically — regenerate them
  after musical edits.
- `transport.playFull()` takes a payload `{ id, title, code, bpm, … }`
  built from the main scene, not the piece object.

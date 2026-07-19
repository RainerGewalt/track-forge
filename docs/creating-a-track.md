# Creating a Track

This guide walks through creating a complete track, from scaffold to a
playable arrangement with lane previews. The canonical neutral reference lives
in [`docs/examples/example-track/`](examples/example-track/); the public mirror
also installs it as the immediately playable `src/pieces/example-track` demo.

## 1. Scaffold

```sh
npm run piece:create -- my-track "My Track"
```

This creates `src/pieces/my-track/` with `piece.json`, `piece.js`,
`main.strudel` and `notes.md`. IDs must be kebab-case.

## 2. Write the music

`main.strudel` is a standalone Strudel program: it needs its own `setcpm(…)`
and, if it uses recorded material, its own
`samples('/samples/library/strudel-samples.json')` line.

Structural conventions the tooling expects:

- **One cycle = one 4/4 bar.** `setcpm(bpm / 4)`.
- **One audio orbit per sound family** (`.orbit(n)` on every voice of that
  family). Live layer mutes and the timeline lanes depend on this.
- **`arrange([bars, pattern], …)` per layer**, stacked at the end. The bar
  counts of each layer must sum to the same total.
- Each layer also gets a standalone solo file (`pulse.strudel`,
  `skin.strudel`, …), registered in `piece.js`. Solo files duplicate their
  material verbatim — there are no cross-file imports.

The creative framework (six families, one motif, transformation instead of
drops) is documented in [`agents/composition-rules.md`](../agents/composition-rules.md).

## 3. Fill the metadata

`piece.json` drives the whole UI. The important fields:

| Field | Meaning |
| --- | --- |
| `bpm`, `durationTargetMinutes` | Tempo and target length; the bar math must agree with the code |
| `arrangement` | Named phases with `"at": "m:ss"` — the seekable ruler |
| `timeline` | `durationSeconds` + per-layer labeled segments; boundaries must equal the `arrange()` bar sums × bar length |
| `sectionDescriptions` | One line per scene, shown next to layers |
| `soundPalette` | The declared six families and the (at most one) cultural voice |
| `aiHooks` | Hard guardrails for AI-assisted edits: `mustPreserve`, `mustAvoid`, `compositionLimits` |
| `rights.samples` | Every sample bank the code uses: `name`, `source`, `license`, `banks`, `provenance` |
| `artwork` | Image reference with its own rights block; `src: null` until a file exists |
| `release`, `rights.review` | Release-preparation state; never claim clearance that has not happened |

Validate early and often:

```sh
npm run pieces:validate
```

## 4. Use the sample library

Browse sounds in the app (topbar → **Samples**) and copy snippets:
indexed banks play via `s("bot_framedrum:2")`, pitched banks via
`note("e4").s("bot_ocarina")`. Document every used bank in
`rights.samples`. To extend the library, see
[`sample-library/README.md`](../sample-library/README.md).

## 5. Generate the lane previews

```sh
npm run timeline:previews
```

This evaluates your `main.strudel` offline and extracts every event into
`public/timeline-previews/<id>.json` — the piano-roll and waveform lanes in
the Layer Timeline and the player. Re-run it after every musical change.

## 6. Artwork (optional)

Drop an image at `public/images/tracks/<id>.jpg` and run
`npm run images:manifest`. An explicit `artwork.src` in `piece.json` wins
over the convention; raster files replace SVG placeholders by name.

## 7. Checklist before calling it done

```text
[ ] npm run pieces:validate is green
[ ] npm run timeline:previews ran after the last musical change
[ ] every used bot_ bank is listed in rights.samples
[ ] notes.md describes intent, families, transitions and open questions
[ ] npm test and npm run build pass
```

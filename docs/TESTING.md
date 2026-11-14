# Testing

How Track Forge is tested: which levels exist, what each one proves, and how
to run it. The npm scripts in `package.json` are the entry points; this page
explains what they mean.

## Levels

**L1 Unit.** Logic decided in one module, with Node's built-in test runner:
playback transport, seeking, mutes and solos, Layer Lab channel assignment
and error states, including an evaluation error that Strudel reports through
its update event instead of a rejection (`tests/player.test.mjs`); the audio
master, which keeps one master per realtime context while reverb renders run
offline, and the hard stop (`tests/audio-master.test.mjs`, against a stand-in
for the Web Audio graph); which mode a build runs in and what the Source
Inspector says in it (`tests/app-mode.test.mjs`); generated JSON that keeps
its bytes when nothing changed (`tests/generated-json.test.mjs`).
`npm test`; needs nothing.

**L2 Component.** The source service and the source sync with their real file
handling: paths restricted to declared Strudel source locations, writes only
with the current revision, a source that is empty or does not parse refused
with 422, the previous version kept as a backup, a failed write (temporary
file, backup or final rename) that leaves the source unchanged, writing off
without a private token of at least 32 characters, with the example value,
and after `cp .env.example .env`, the setup warning for such a token, a
service that is off or answers without JSON (`tests/source-api.test.mjs`,
`tests/source-sync.test.mjs`). `npm test`; needs nothing.

**L3 Conformance.** Track Forge writes no evidence records, so the
conformance level of the other projects does not apply. The sample library
has its own check of provenance and checksums: `npm run samples:audit`.

**L4 Scenario.** The tracks as they are: `npm run pieces:validate` checks
metadata and file integrity of every track, `npm run timeline:previews`
evaluates the real patterns into arrangement lanes, and `npm run build`
builds the Studio and the Player. CI runs these on every push and pull
request.

The browser scenarios, `npm run test:e2e` (`tests/e2e/safety.e2e.mjs`), cover
what only the real Strudel runtime and real Web Audio show. They build the
LAN player and the hosted demo into a temporary directory, serve them on
ports the system picks, let the unchanged source service write to a copy of
`src/`, and drive headless Chrome over the DevTools protocol
(`tests/e2e/browser.mjs`, no dependencies):

- the draft gate: a draft with a syntax error, and a draft whose sound is not
  loaded, leave **Prepare Overwrite** disabled, show the error and leave
  `main.strudel` unchanged; a draft that plays unlocks it, and **Confirm
  Overwrite** writes exactly that draft;
- the audio master: 100 ms after Stop, in the Studio and in the player, the
  peak at the speakers is below -60 dBFS, and while the music plays the
  player's spectrum shows it;
- the modes: the hosted demo says in the Studio and the player that nothing
  is saved, does not claim local files or "your own machine", and its
  inspector reports no outage; the LAN player build shows no demo notice.

They need Chrome or Chromium (`CHROME_PATH` to choose one;
`E2E_CHROME_NO_SANDBOX=1` where the sandbox cannot start). What they cannot
check is sound: a person listening still has to judge the stop and the
spectrum.

**L5 First use.** `npm run first-use` (`scripts/first-use.sh`) walks through
the README as a new user would and stops at the first step that does not
behave as documented:

- the LAN player before setup: it asks for `./setup.sh` and creates no
  certificate paths;
- the fastest start, `./setup.sh --dev --no-samples`: Studio and Player are
  served, setup validates the tracks;
- adding a track: `piece:create`, previews, validation, tests and build
  with the new track, and a track with broken metadata that the validator
  names;
- the LAN player on ports 18080 and 18443: an occupied port is named with
  `PLAYER_HTTP_PORT` before anything starts; then the player answers over
  TLS with a certificate that verifies against the generated local CA, serves
  the CA, redirects HTTP to HTTPS with the port, and stops with
  `npm run player:stop`.

Two modes:

- `npm run first-use` checks the committed `HEAD` from a fresh clone, so
  files that exist only in a working copy cannot help. This is the check
  before a tag.
- `RELEASE=0.1.1 npm run first-use` checks the tag from GitHub and the hosted
  demo on GitHub Pages. This is the check after a tag.

It needs what the README asks of a user (Git, Node.js 20 or newer, npm,
Docker with Compose v2, OpenSSL) and runs without the sample download, which
the README allows. It uses its own Compose project name, so a player that is
already running is not touched, and removes its containers and working
directory afterwards (`FIRST_USE_KEEP=1` keeps the directory). What it cannot
check is sound: audio needs a browser and a person listening.

No tag without a passing `npm run first-use` on the release commit; if the
check after the tag fails, a patch release follows.

## Determinism

A check proves a property with a signal that is ordered with it, never by
waiting. The first-use check waits for the port it needs and then reads the
page; the time bounds only stop a hang and are never the assertion.

## Dependencies

Before every tag, `npm audit` and `npm audit --omit=dev` run on the release
commit, and the release record lists each remaining advisory with an
assessment. State of 0.1.2: no advisory in the development tools; four low
advisories in one production chain (`@strudel/repl` → `@strudel/hydra` →
`hydra-synth` → `meyda` → `@rollup/plugin-node-resolve` → `deepmerge`,
GHSA-gcqx-w48m-w2h4) without a fixed version. `meyda` declares the Rollup
plugin as a runtime dependency although it only builds with it; neither
`deepmerge` nor the plugin is part of the built Studio or Player (checked by
searching `dist/assets`), so the advisory does not reach shipped code.

## Every fix ships with a negative control

A test for a fix has to be shown to fail without it: remove or mutate the
code under test, run the test, record that it fails, restore the file and
check that it is identical.

Recorded controls:

- Certificate paths before setup (fixed after 0.1.0): with
  `player_require_certificates` removed from `scripts/player-stack.sh
  start`, `npm run player:start` on a fresh clone runs on into validation
  and build and ends with an unrelated error (`vite: not found`, exit 127)
  instead of naming `./setup.sh`, so the first player step of
  `npm run first-use` fails on its exit code and message; restored, it
  passes.
- A draft that fails to evaluate (fixed after 0.1.1): with the check of
  `repl.state.evalError` removed from `createEditorEngine` and the check of
  an error reported while loading removed from `playFull` in `src/player.js`,
  the new tests in `tests/player.test.mjs` and the first browser scenario
  fail (status `playing`, Prepare Overwrite enabled); restored, they pass.
  With only the check that reports each engine error once removed, the test
  for an error left over from an earlier evaluation and the first browser
  scenario fail (the saved track no longer starts after a failed draft).
- A draft that fails while it plays (fixed after 0.1.1): with the
  `strudel.log` listener of the draft gate in `src/main.js` turned off, the
  second browser scenario fails (Prepare Overwrite enabled); restored, it
  passes.
- A source that does not parse (fixed after 0.1.1): with the parse check
  removed from `replaceSource` in `scripts/source-api.mjs`, the parse tests
  in `tests/source-api.test.mjs` fail (the broken source is written);
  restored, they pass. With the backup rename removed, the backup tests
  fail.
- The example token (fixed after 0.1.1): with `editorTokenProblem` always
  returning `null`, the token tests in `tests/source-api.test.mjs` fail
  (`writeEnabled: true`); restored, they pass.
- The audio master (fixed after 0.1.1): with an offline destination treated
  like a realtime one in `src/audioMaster.js`, `tests/audio-master.test.mjs`
  and both audio browser scenarios fail (peak after Stop above -60 dBFS,
  flat spectrum while music plays); restored, they pass. Without the stop
  hooks in the player, its browser scenario fails. Without the final cut to
  silence after 100 ms, only the unit test fails: the browser scenarios
  measured the exponential fade alone below -60 dBFS, which depends on the
  music, so the cut is what guarantees the bound.
- Stop keeps the position, Back to start returns to zero (changed after
  0.1.1 at the owner's request): with the stop setting the position to zero
  again, three tests in `tests/player.test.mjs` fail; with Back to start
  leaving the position unchanged while stopped, two fail; restored, all
  pass. The browser scenario "Stop keeps the position, Play continues there,
  Back to start returns to zero" checks the same in the Studio and the
  player with real audio, including the silence 100 ms after each Stop.
- The demo notice (fixed after 0.1.1): with `appModeFor` never returning
  `demo`, `tests/app-mode.test.mjs` and the demo browser scenarios fail;
  restored, they pass.

## Commands

- `npm test`: L1 and L2.
- `npm run pieces:validate`, `npm run timeline:previews`, `npm run build`,
  `npm run test:e2e`: L4.
- `npm audit`, `npm audit --omit=dev`: dependencies, before every tag.
- `npm run first-use`, `RELEASE=x.y.z npm run first-use`: L5.

## CI

`.github/workflows/ci.yml` runs `npm ci`, `npm run pieces:validate`,
`npm test` and `npm run build` on every push and pull request, and the
browser scenarios (`npm run test:e2e`) in a second job.
`npm run first-use` is not part of CI: it needs Docker on fixed ports and a
fresh clone of the release commit. It runs by hand before and after every
tag.

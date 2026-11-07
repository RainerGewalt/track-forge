# Testing

How Track Forge is tested: which levels exist, what each one proves, and how
to run it. The npm scripts in `package.json` are the entry points; this page
explains what they mean.

## Levels

**L1 Unit.** Logic decided in one module, with Node's built-in test runner:
playback transport, seeking, mutes and solos, Layer Lab channel assignment
and error states (`tests/player.test.mjs`), generated JSON that keeps its
bytes when nothing changed (`tests/generated-json.test.mjs`). `npm test`;
needs nothing.

**L2 Component.** The source service and the source sync with their real file
handling: paths restricted to declared Strudel source locations, writes only
with the current revision, a service that is off or answers without JSON
(`tests/source-api.test.mjs`, `tests/source-sync.test.mjs`). `npm test`;
needs nothing.

**L3 Conformance.** Track Forge writes no evidence records, so the
conformance level of the other projects does not apply. The sample library
has its own check of provenance and checksums: `npm run samples:audit`.

**L4 Scenario.** The tracks as they are: `npm run pieces:validate` checks
metadata and file integrity of every track, `npm run timeline:previews`
evaluates the real patterns into arrangement lanes, and `npm run build`
builds the Studio and the Player. CI runs these on every push and pull
request.

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

## Every fix ships with a negative control

A test for a fix has to be shown to fail without it: remove or mutate the
code under test, run the test, record that it fails, restore the file and
check that it is identical.

Recorded controls:

- Certificate paths before setup (fixed after 0.1.0): with the
  certificate check removed from `scripts/player-stack.sh start`,
  `npm run first-use` fails at its first player step; restored, it passes.

## Commands

- `npm test`: L1 and L2.
- `npm run pieces:validate`, `npm run timeline:previews`, `npm run build`:
  L4.
- `npm run first-use`, `RELEASE=x.y.z npm run first-use`: L5.

## CI

`.github/workflows/ci.yml` runs `npm ci`, `npm run pieces:validate`,
`npm test` and `npm run build` on every push and pull request.
`npm run first-use` is not part of CI: it needs Docker on fixed ports and a
fresh clone of the release commit. It runs by hand before and after every
tag.

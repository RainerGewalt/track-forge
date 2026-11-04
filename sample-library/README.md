# Sample Library

A small, rights-aware, locally rebuildable sound library organized by six
sound families (`pulse`, `skin`, `seed`, `tremor`, `memory`, `ground`).

Guiding principle:

> Few source materials, many musical transformations.

The first version prefers raw one-shots and material recordings over
polished loops. Density in the music comes from transforming these sounds
in Strudel (filtering, pitch, articulation, reversal, slicing), not from
collecting more files.

## Rights policy

Accepted automatically:

- **CC0 1.0** and explicit public-domain dedications, confirmed at the
  canonical provider (not merely reported by a search aggregator).

Manual-review queue only: Public Domain Mark, CC BY, provider-specific
permissive licenses. Rejected automatically: all NC/ND/SA variants,
unknown or conflicting license information.

Never used: Spotify/YouTube rips, commercial recordings, stems, unofficial
mirrors, files behind bypassed authentication, aggressive scraping.

## Sources

| Source | Mode | Evidence |
| --- | --- | --- |
| [VCSL](https://github.com/sgossner/VCSL) | seed library, selected paths only, pinned to a commit | `licenses/vcsl/` |
| Wikimedia Commons | supplementary one-shots via the official API, extmetadata verification | `licenses/sources/*.json` |
| Openverse | discovery only; canonical provider verification before any download; Freesound results become manual candidates | `candidates/manual-review.json` |

## Workflow

```bash
npm run samples:seed       # select + download VCSL sounds at the pinned commit
npm run samples:discover   # Openverse/Commons discovery -> queue + candidates
npm run samples:download   # restore recorded Commons files, then download
                           # verified queue entries (re-verifies first)
npm run samples:inspect    # WAV header/duration/peak report
npm run samples:curate     # raw -> curated/<family>/<bank>/ + manifests/library.json
npm run samples:build      # -> public/samples/library (audio + strudel-samples.json)
npm run samples:audit      # consistency + rights traceability report
```

Audio payloads (`raw/`, `curated/`, `public/samples/library/audio/`) are
gitignored; the manifests record where every file came from. On a fresh clone,
`samples:seed` downloads the VCSL files at the commit pinned in
`manifests/sources.json` (`--refresh` moves the pin to the current branch head),
and `samples:download` restores the Wikimedia Commons files from their recorded
URLs. Every restored file must match its SHA-256 in
`manifests/downloads.jsonl`; a Commons file whose license no longer checks out
or whose content changed is not restored. If any recorded file is missing,
`samples:curate` lists the affected banks and stops without rewriting the
manifests.

Curation decisions live in `curation-overrides.json` (exclude or reassign
by sha256). Search intent per family lives in `search-plan.json`.

## Using the sounds in a piece

Load the map at the top of a `.strudel` file:

```js
samples('/samples/library/strudel-samples.json')
```

Unpitched banks are indexed: `s("bot_framedrum:2")`. Pitched banks map note
names: `note("e4").s("bot_ocarina")`. The in-app browser (topbar → Samples)
previews every sound and copies these snippets.

# Composition Rules — The Six-Family Framework

Tracks in this workspace opt into a reduced sound framework: a fixed
electronic–organic core built from at most six sound families, plus at most
one culturally distinctive main voice. Density comes from transforming few
sounds, never from adding instruments.

## The six families

| Family | Role |
| --- | --- |
| **Pulse** | The physical or mental time axis: kick, sub pressure, soft thud. Does not have to be danceable. |
| **Skin** | Exactly one drum family per track (frame drum, bongo, goblet drum, conga, slit drum, …) with open/muted/ghost articulations. |
| **Seed** | One small high-frequency motion family: shaker, claves, wood clicks, hat ticks — at most two closely related variants. |
| **Tremor** | The rough tonal source: detuned saw walls, tuned scrape resonances, tremolo material. Ideally transforms from noise into pitch. |
| **Memory** | The single recognizable melodic voice. One motif per track. Often hidden first and revealed by removing masking. |
| **Ground** | One foundation: drone, controlled noise air, one coherent room. Never a stack of pads. |

## Hard limits (enforced per track via `aiHooks.compositionLimits`)

```text
Maximum six sound families
Maximum one drum family
Maximum one culturally distinctive main voice
Maximum one central melodic motif
Maximum one drone foundation
No decorative instruments without a dramaturgical role
No genre quotations as shortcuts
No cultural sound collage
```

## Dramaturgy

States change through transformation, not through drops. Every major
transition should answer five roles: **Anchor** (what stays), **Messenger**
(what announces the next state early), **Transformer** (which existing
element changes function), **Memory** (what remains of the old state) and
**Revealer** (what is removed so something already present becomes audible).

> Never end a state before the next one is already breathing.

## Refinement vocabulary

Techniques the existing tracks use and that new work should prefer over
randomization:

- ghost strokes at ~0.3 velocity between call and answer,
- answers placed slightly behind the grid (`.late(.004–.012)`),
- degraded ornaments via `.off(1/16, …)` so graces feel found, not played,
- accent contours as velocity patterns instead of static gain,
- `iter(4)` phrase rotation for an "uncounted" feel,
- a reversed sample as the Messenger of a coming state,
- filters that breathe over 8-bar phrases instead of standing still.

## Sound material

- Tonal layers stay low (octave 3 region); never park a static treble line
  on top of the drums.
- Pitch should emerge from material (tuned band resonance on a scrape, wood
  bars, sample envelopes), not sit beside it.
- Rooms stay small (`roomsize` 2–4) unless a track's palette explicitly
  declares distance as its articulation.
- Recorded one-shots come from the local CC0 sample library
  (`samples('/samples/library/strudel-samples.json')`, banks prefixed
  `bot_`); document every bank a track uses in `rights.samples`.

## What agents must never add

- a second lead or answering melodic voice,
- another drum family or decorative percussion set,
- extra pad/drone foundations,
- risers, drops, impacts, transition effects,
- undeclared cultural color or authenticity claims.

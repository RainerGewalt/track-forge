# AI Agent Instructions

This folder contains the working instructions for AI assistants (Claude,
Codex, Copilot and similar) that edit this repository. The root `AGENTS.md`
is the short authoritative rule list; these documents explain how to apply
it in practice.

| Document | Purpose |
| --- | --- |
| [composition-rules.md](composition-rules.md) | The six-family sound framework and the hard creative limits per track |
| [editing-workflow.md](editing-workflow.md) | How to change code, tracks and metadata safely — validation, previews, commits |

## Ground rules (summary)

- Preserve existing musical content unless the user explicitly asks for
  musical changes.
- Every track declares its own creative guardrails in `piece.json` under
  `soundPalette` and `aiHooks`. Those fields are hard constraints, not
  suggestions.
- Never invent rights, ownership, license, distributor, ISRC or release
  information. Never set `rights.commercialUseChecked` to `true` without
  explicit evidence from the user.
- Only CC0 or explicitly verified material enters the sample library; the
  discovery tooling's manual-review queue exists precisely so unclear
  licenses never ship.
- Run `npm run pieces:validate` and `npm run build` before finishing any
  code change; run `npm run timeline:previews` after changing any
  `main.strudel`.
- Keep source code, comments, documentation, commit messages and metadata
  in natural English.

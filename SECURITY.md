# Security

## Reporting a problem

Please report security problems privately through GitHub's
[private vulnerability reporting](https://github.com/RainerGewalt/track-forge/security/advisories/new)
instead of a public issue. You will get a reply; fixes are made on a
best-effort basis, as this is a personal project without a support contract.

## What Track Forge assumes

Track Forge is built for a single person on a trusted home network.

- The optional source service writes `.strudel` files on the host. Writing is
  off unless `SOURCE_EDITOR_TOKEN` holds a private value of at least 32
  characters; the service refuses the example value that `.env.example` of
  0.1.1 and earlier set. A write must carry that token and the revision of the
  file as it was opened; the service compares that revision with the file
  just before it writes and refuses a stale one. It also refuses a source that is empty or does not parse,
  replaces the file in one rename and keeps the previous version next to it
  (`.main.strudel.bak` for `main.strudel`).
- What the service does not check: whether the draft was tried in the
  browser, and whether it plays. The Studio unlocks the overwrite only after
  the exact draft evaluated and played without an error, but that check runs
  in the browser; anyone with the token can write any source that parses.
- Reading needs no token: every device that can reach the player can read
  all track sources through the service (`/api/sources`). The nginx player
  listens on all addresses unless `PLAYER_BIND_ADDRESS` is set. Run the stack
  on a trusted network only and never expose it to the internet.
- `./setup.sh` creates a local certificate authority so that phones can use the
  HTTPS player. Its private key stays in `deploy/certs/` on the host and must
  not be copied or committed.
- Strudel code runs in your browser with the same rights as any web page. Only
  open tracks whose source you trust.
- The hosted demo on GitHub Pages has no source service and cannot write files.

# Security

## Reporting a problem

Please report security problems privately through GitHub's
[private vulnerability reporting](https://github.com/RainerGewalt/track-forge/security/advisories/new)
instead of a public issue. You will get a reply; fixes are made on a
best-effort basis, as this is a personal project without a support contract.

## What Track Forge assumes

Track Forge is built for a single person on a trusted home network.

- The optional source service writes `.strudel` files on the host. It only
  accepts writes when `SOURCE_EDITOR_TOKEN` is set, and only for the exact
  revision that was tried in the browser. Run it on a trusted network only and
  never expose it to the internet.
- `./setup.sh` creates a local certificate authority so that phones can use the
  HTTPS player. Its private key stays in `deploy/certs/` on the host and must
  not be copied or committed.
- Strudel code runs in your browser with the same rights as any web page. Only
  open tracks whose source you trust.
- The hosted demo on GitHub Pages has no source service and cannot write files.

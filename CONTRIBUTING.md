# Contributing to Track Forge

Track Forge is a small personal tool that is shared in case it helps other
Strudel musicians. Bug reports, questions and pull requests are welcome and get
a reply, but there is no roadmap and no release schedule.

Everyone taking part is expected to follow the
[code of conduct](CODE_OF_CONDUCT.md).

## Before you start

- For a bug, open an issue with the steps that reproduce it, your browser and
  whether you run the dev server or the LAN player.
- For a larger change, open an issue first so we can agree on the scope before
  you spend time on it.
- Questions about the Strudel language itself are better asked in the Strudel
  community; see [strudel.cc](https://strudel.cc/).

## Scope

Track Forge stays lightweight on purpose: plain files, no accounts, no
database, no cloud service. Changes that add one of these are unlikely to be
merged. It is also not a DAW, mastering suite or distributor integration.

## Development

You need Node.js 20 or newer and npm.

```sh
npm ci
npm run dev
```

Before you open a pull request, run:

```sh
npm run pieces:validate
npm test
npm run build
```

After changing any `main.strudel`, also run `npm run timeline:previews` and
commit the regenerated preview.

## Content rules

- Do not add private tracks, artwork or artist data. The repository ships
  exactly one neutral example track under CC0.
- Only provider-confirmed CC0 material enters the sample library; anything
  unclear goes to the manual-review queue.
- Never fill rights, ownership, license or release fields with guesses.
  Unknown values stay explicitly unknown.
- Write code, comments, documentation and commit messages in English.

## License of contributions

Track Forge is licensed under the GNU AGPL-3.0-or-later. By submitting a pull
request you agree that your contribution is licensed under the same terms.
Contributions to `src/pieces/example-track/` are licensed under CC0 1.0, like
the rest of that directory.

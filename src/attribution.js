// License and attribution line shown in the Studio and the Player.
//
// Track Forge bundles Strudel, which is AGPL-3.0-or-later. Strudel asks
// projects built on it to keep its copyright notice visible in the interface,
// and the AGPL requires that users of a hosted copy can reach the source code.

export const SOURCE_URL = 'https://github.com/RainerGewalt/track-forge';

export function attributionHtml(className) {
  return `
    <p class="${className}">
      Track Forge is free software under the
      <a href="https://www.gnu.org/licenses/agpl-3.0.html">AGPL-3.0-or-later</a>
      (<a href="${SOURCE_URL}">source code</a>).
      Built on <a href="https://strudel.cc/">Strudel</a>,
      © Strudel contributors, AGPL-3.0-or-later
      (<a href="https://codeberg.org/uzu/strudel">source code</a>).
    </p>
  `;
}

// Local sample library browser.
//
// Reads the generated manifest at /samples/library/library.json and renders
// a small, self-contained browser dialog: filter by family, preview a sound,
// copy a ready-to-paste Strudel snippet, and see license + provenance for
// every file. The module owns all events inside its dialog element.

export const STRUDEL_MAP_URL = '/samples/library/strudel-samples.json';
export const LIBRARY_MANIFEST_URL = '/samples/library/library.json';

const FAMILIES = ['all', 'pulse', 'skin', 'seed', 'tremor', 'memory', 'ground'];

export function strudelSnippet(entry) {
  if (entry.note) {
    return `note("${entry.note}").s("${entry.bank}")`;
  }
  return entry.index > 0 ? `s("${entry.bank}:${entry.index}")` : `s("${entry.bank}")`;
}

export async function loadSampleLibrary(fetchImpl = fetch) {
  const response = await fetchImpl(LIBRARY_MANIFEST_URL);

  if (!response.ok) {
    throw new Error(`sample library manifest not available (HTTP ${response.status})`);
  }

  return response.json();
}

export function filterEntries(entries, { family = 'all', term = '' } = {}) {
  const needle = term.trim().toLowerCase();

  return entries.filter((entry) => {
    if (family !== 'all' && entry.family !== family) {
      return false;
    }

    if (needle === '') {
      return true;
    }

    return [entry.bank, entry.title, entry.creator, entry.license]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(needle));
  });
}

export function createSampleBrowser(dialog) {
  const state = {
    manifest: null,
    error: null,
    family: 'all',
    term: '',
    playingId: null,
  };

  let audio = null;

  function stopPreview() {
    if (audio) {
      audio.pause();
      audio = null;
    }
    state.playingId = null;
  }

  function preview(entry) {
    stopPreview();
    audio = new Audio(`/samples/library/audio/${entry.file}`);
    state.playingId = entry.id;
    audio.addEventListener('ended', () => {
      state.playingId = null;
      renderList();
    });
    audio.play().catch(() => {
      state.playingId = null;
      renderList();
    });
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderShell() {
    dialog.innerHTML = `
      <header class="inspector-header">
        <div>
          <p class="eyebrow">Sample Library</p>
          <h2>Local CC0 Sounds</h2>
        </div>
        <div class="inspector-actions">
          <button type="button" data-samples-action="copy-setup">Copy setup line</button>
          <button type="button" data-samples-action="close">Close</button>
        </div>
      </header>
      <p class="inspector-hint">
        Load the map in any piece with
        <code>samples('${STRUDEL_MAP_URL}')</code>, then play a sound via its snippet.
        Every file is CC0 with recorded provenance (see <code>sample-library/manifests/</code>).
      </p>
      <div class="samples-controls">
        <nav class="samples-families" aria-label="Filter by sound family"></nav>
        <input type="search" data-samples-search placeholder="Search banks, titles, creators…"
          aria-label="Search samples" />
      </div>
      <div class="samples-list" data-samples-list></div>
    `;
  }

  function renderFamilies() {
    const nav = dialog.querySelector('.samples-families');
    nav.innerHTML = FAMILIES.map(
      (family) => `
        <button type="button" data-samples-action="family" data-family="${family}"
          class="${state.family === family ? 'is-active' : ''}">${family}</button>
      `,
    ).join('');
  }

  function renderList() {
    const list = dialog.querySelector('[data-samples-list]');

    if (state.error) {
      list.innerHTML = `
        <p class="group-hint">
          ${escapeHtml(state.error)} — run
          <code>npm run samples:build</code> to generate the library.
        </p>
      `;
      return;
    }

    if (!state.manifest) {
      list.innerHTML = '<p class="group-hint">Loading…</p>';
      return;
    }

    const entries = filterEntries(state.manifest.entries, state);
    const byBank = new Map();

    for (const entry of entries) {
      if (!byBank.has(entry.bank)) {
        byBank.set(entry.bank, []);
      }
      byBank.get(entry.bank).push(entry);
    }

    if (byBank.size === 0) {
      list.innerHTML = '<p class="group-hint">No samples match the current filter.</p>';
      return;
    }

    list.innerHTML = [...byBank.entries()]
      .map(
        ([bank, bankEntries]) => `
          <section class="samples-bank">
            <header class="samples-bank-header">
              <h3>${escapeHtml(bank)}</h3>
              <span class="samples-bank-meta">
                ${escapeHtml(bankEntries[0].family)} · ${bankEntries.length}
                ${bankEntries.length === 1 ? 'sound' : 'sounds'}
              </span>
            </header>
            <ul class="samples-entries">
              ${bankEntries
                .map(
                  (entry) => `
                    <li class="samples-entry ${state.playingId === entry.id ? 'is-playing' : ''}">
                      <button type="button" class="samples-play"
                        data-samples-action="preview" data-sample-id="${entry.id}"
                        aria-label="Preview ${escapeHtml(entry.title)}">
                        ${state.playingId === entry.id ? '■' : '▶'}
                      </button>
                      <div class="samples-entry-main">
                        <code>${escapeHtml(strudelSnippet(entry))}</code>
                        <small>
                          ${escapeHtml(entry.title)}
                          ${entry.durationSeconds ? ` · ${entry.durationSeconds}s` : ''}
                          · ${escapeHtml(entry.license)}
                          ${
                            entry.canonicalUrl
                              ? ` · <a href="${escapeHtml(entry.canonicalUrl)}" target="_blank" rel="noreferrer">source</a>`
                              : ''
                          }
                        </small>
                      </div>
                      <button type="button" data-samples-action="copy" data-sample-id="${entry.id}">
                        Copy
                      </button>
                    </li>
                  `,
                )
                .join('')}
            </ul>
          </section>
        `,
      )
      .join('');
  }

  async function open() {
    if (!dialog.open) {
      renderShell();
      renderFamilies();
      renderList();
      dialog.showModal();
    }

    if (!state.manifest && !state.error) {
      try {
        state.manifest = await loadSampleLibrary();
      } catch (error) {
        state.error = error.message;
      }
      renderList();
    }
  }

  function close() {
    stopPreview();
    if (dialog.open) {
      dialog.close();
    }
  }

  dialog.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-samples-action]');

    if (!button) {
      return;
    }

    const action = button.dataset.samplesAction;

    if (action === 'close') {
      close();
      return;
    }

    if (action === 'family') {
      state.family = button.dataset.family;
      renderFamilies();
      renderList();
      return;
    }

    if (action === 'copy-setup') {
      await navigator.clipboard?.writeText(`samples('${STRUDEL_MAP_URL}')`);
      return;
    }

    const entry = state.manifest?.entries.find(
      (candidate) => candidate.id === button.dataset.sampleId,
    );

    if (!entry) {
      return;
    }

    if (action === 'preview') {
      if (state.playingId === entry.id) {
        stopPreview();
      } else {
        preview(entry);
      }
      renderList();
      return;
    }

    if (action === 'copy') {
      await navigator.clipboard?.writeText(strudelSnippet(entry));
    }
  });

  dialog.addEventListener('input', (event) => {
    if (event.target.matches('[data-samples-search]')) {
      state.term = event.target.value;
      renderList();
    }
  });

  dialog.addEventListener('close', stopPreview);

  return { open, close };
}

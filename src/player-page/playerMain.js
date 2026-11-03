// LAN listening player: one track at a time, phase-grouped library,
// live frequency monitor, metadata on demand. The full workspace stays
// available at /index.html ("Studio").

import '@strudel/repl';
import './player.css';

import { pieces } from '../music.js';
import { STATUS_LABELS } from '../statuses.js';
import {
  createEditorEngine,
  createTransport,
  formatClock,
  getMainScene,
} from '../player.js';
import { installDestinationTap, createSpectrumView } from './monitor.js';
import { fetchPreview, createLaneView } from './lanes.js';
import { artistProfile, hasImage, imagePosition, resolveArtwork } from '../visuals.js';
import { hydratePieceSources } from '../sourceSync.js';
import { appUrl } from '../appUrl.js';
import { attributionHtml } from '../attribution.js';

// The tap must be in place before the first engine connects anything.
installDestinationTap();

// --------------------------------------------------------------------------
// Lifecycle phases: a reading of the existing statuses, not a new schema.
// --------------------------------------------------------------------------

const PHASES = [
  { id: 'init', label: 'Init', statuses: ['sketch'] },
  { id: 'in-progress', label: 'In Progress', statuses: ['arranging'] },
  { id: 'pre-release', label: 'Pre-Release', statuses: ['mix-ready', 'release-ready'] },
  { id: 'released', label: 'Released', statuses: ['released'] },
];

function phaseOf(piece) {
  return PHASES.find((phase) => phase.statuses.includes(piece.status)) ?? PHASES[0];
}

function trackDurationSeconds(piece) {
  if (piece.timeline?.durationSeconds > 0) {
    return piece.timeline.durationSeconds;
  }
  if (piece.durationTargetMinutes > 0) {
    return Math.round(piece.durationTargetMinutes * 60);
  }
  return 0;
}

function parseClock(text) {
  const match = /^(\d+):(\d{2})$/.exec(text ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

const playable = pieces.filter((piece) => getMainScene(piece));

// --------------------------------------------------------------------------
// Shell
// --------------------------------------------------------------------------

const root = document.querySelector('#player-root');
const profileIsPlaceholder = artistProfile.artistName === 'Your Artist Name';
const playerTitle = profileIsPlaceholder ? 'Strudel listening room' : artistProfile.artistName;
const playerMotto = profileIsPlaceholder
  ? 'Complete tracks built from live-coded patterns, served from your own machine.'
  : artistProfile.motto;

root.innerHTML = `
  <main class="pp-shell" id="player-main" tabindex="-1">
    <header class="pp-top">
      <div class="pp-identity">
        ${
          hasImage(artistProfile.profileImage)
            ? `<img class="pp-profile-image" src="${escapeHtml(artistProfile.profileImage.src)}"
                alt="${escapeHtml(artistProfile.profileImage.alt)}"
                style="object-position: ${imagePosition(artistProfile.profileImage)}" />`
            : ''
        }
        <div>
          <p class="pp-eyebrow">Track Forge · Listening player</p>
          <h1>${escapeHtml(playerTitle)}</h1>
          <p class="pp-motto">${escapeHtml(playerMotto)}</p>
        </div>
      </div>
      <a class="pp-studio-link" href="${appUrl('index.html')}">Open Studio</a>
    </header>

    <section class="pp-intro" aria-labelledby="player-intro-title">
      <p class="pp-eyebrow">Code becomes a complete arrangement</p>
      <h2 id="player-intro-title">Choose a track, press play and follow how its layers evolve.</h2>
      <p>The focused player uses the same plain Strudel files as the Studio—no account or cloud service required.</p>
    </section>

    <section class="pp-now" data-now hidden aria-labelledby="now-playing-title">
      <div data-now-artwork></div>
      <div class="pp-now-head">
        <div class="pp-now-title">
          <p class="pp-eyebrow">Now selected</p>
          <h2 id="now-playing-title" data-now-title></h2>
          <span class="pp-chip" data-now-status></span>
        </div>
        <button type="button" class="pp-meta-button" data-action="show-meta">Info</button>
      </div>

      <canvas class="pp-spectrum" data-spectrum aria-hidden="true"></canvas>

      <div class="pp-progress">
        <div class="pp-progress-fill" data-progress-fill aria-hidden="true"></div>
        <input class="pp-progress-input" type="range" min="0" max="0" step="1" value="0"
          data-progress aria-label="Track position" aria-valuetext="0:00 of 0:00" />
      </div>

      <div class="pp-phases" data-now-phases></div>

      <div class="pp-lanes-wrap" data-lanes aria-hidden="true" hidden></div>

      <div class="pp-controls">
        <button type="button" data-action="back30" aria-label="Back 30 seconds">−30</button>
        <button type="button" class="pp-play" data-action="toggle">
          <span data-play-icon aria-hidden="true"></span>
        </button>
        <button type="button" data-action="fwd30" aria-label="Forward 30 seconds">+30</button>
        <output class="pp-clock" data-clock aria-label="Playback time">0:00 / 0:00</output>
      </div>
      <p class="pp-status-line" data-status-line role="status" aria-live="polite"></p>
    </section>

    <section class="pp-library" data-library></section>
    ${attributionHtml('pp-attribution')}
  </main>

  <dialog class="pp-meta" data-meta aria-labelledby="player-meta-title"></dialog>
  <div class="pp-engine" aria-hidden="true" data-engine></div>
`;

// --------------------------------------------------------------------------
// Engine + transport (one full-track engine; the lab channels stay unused)
// --------------------------------------------------------------------------

function createHiddenEngine() {
  const element = document.createElement('strudel-editor');
  element.sync = false;
  element.solo = false;
  element.setAttribute('code', 'silence');
  root.querySelector('[data-engine]').append(element);
  return createEditorEngine(element);
}

const transport = createTransport({
  engines: { full: createHiddenEngine(), channels: [] },
  onChange: render,
});

const spectrum = createSpectrumView(root.querySelector('[data-spectrum]'));
const laneView = createLaneView(root.querySelector('[data-lanes]'), {
  onSeek: (seconds) => playSelected(seconds),
});

let selectedId = playable[0]?.id ?? null;
let clockTimer = null;
let lanesForId = null;

async function loadLanes(piece) {
  if (!piece || lanesForId === piece.id) {
    return;
  }

  lanesForId = piece.id;
  const preview = await fetchPreview(piece.id);

  if (lanesForId !== piece.id) {
    return; // superseded by a newer selection
  }

  if (!preview) {
    laneView.clear();
    return;
  }

  const boundaries = (Array.isArray(piece.arrangement) ? piece.arrangement : [])
    .map((entry) => parseClock(entry.at))
    .filter((seconds) => seconds > 0);
  laneView.load(preview, boundaries);
}

function selectedPiece() {
  return playable.find((piece) => piece.id === selectedId) ?? null;
}

async function playSelected(offsetSeconds = 0) {
  const piece = selectedPiece();
  const mainScene = getMainScene(piece);
  if (!piece || !mainScene) {
    return;
  }

  const result = await transport.playFull(
    {
      id: piece.id,
      title: piece.title,
      code: mainScene.code,
      bpm: piece.bpm,
      durationTargetMinutes: piece.durationTargetMinutes,
      durationSeconds: trackDurationSeconds(piece) || undefined,
    },
    { offsetSeconds },
  );
  if (!result.ok && result.message) {
    root.querySelector('[data-status-line]').textContent = result.message;
  }
}

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLibrary() {
  const playback = transport.getState();
  const container = root.querySelector('[data-library]');

  const phaseGroups = PHASES.map((phase) => {
    const phasePieces = playable.filter((piece) => phaseOf(piece).id === phase.id);

    if (phasePieces.length === 0) {
      return '';
    }

    return `
      <section class="pp-phase-group">
        <h3 class="pp-phase-title">${phase.label}
          <span class="pp-phase-count">${phasePieces.length}</span>
        </h3>
        <ul class="pp-track-list">
          ${phasePieces
            .map((piece) => {
              const isActive = piece.id === selectedId;
              const isPlaying =
                isActive && playback.activeTrack?.id === piece.id && playback.status === 'playing';
              const artwork = resolveArtwork(piece);
              return `
                <li class="pp-track-card ${isActive ? 'is-active' : ''}">
                  <button type="button" class="pp-track ${isActive ? 'is-active' : ''}"
                    data-action="pick" data-id="${piece.id}"
                    ${isActive ? 'aria-current="true"' : ''}>
                    <span class="pp-sr-only">${isPlaying ? 'Stop' : 'Play'} </span>
                    <span class="pp-track-play" aria-hidden="true">${isPlaying ? '■' : '▶'}</span>
                    ${
                      hasImage(artwork)
                        ? `<img class="pp-track-artwork" src="${escapeHtml(artwork.src)}"
                            alt="" style="object-position: ${imagePosition(artwork)}" />`
                        : ''
                    }
                    <span class="pp-track-main">
                      <strong>${escapeHtml(piece.title)}</strong>
                      <small>${piece.bpm} BPM · ${formatClock(trackDurationSeconds(piece))}
                        · ${STATUS_LABELS[piece.status] ?? piece.status}</small>
                    </span>
                  </button>
                  <button type="button" class="pp-track-info" data-action="meta" data-id="${piece.id}"
                    aria-label="About ${escapeHtml(piece.title)}"><span aria-hidden="true">i</span></button>
                </li>
              `;
            })
            .join('')}
        </ul>
      </section>
    `;
  }).join('');

  container.innerHTML = `
    <header class="pp-library-head">
      <p class="pp-eyebrow">Track library</p>
      <h2>Choose a track to listen</h2>
      <p>Selecting a track starts it immediately. Use the separate Info button for its story and sound palette.</p>
    </header>
    ${phaseGroups || '<p class="pp-empty">No playable tracks were found.</p>'}
  `;
}

function renderNow() {
  const playback = transport.getState();
  const piece = selectedPiece();
  const panel = root.querySelector('[data-now]');

  if (!piece) {
    panel.hidden = true;
    spectrum.stop();
    return;
  }

  panel.hidden = false;

  const artwork = resolveArtwork(piece);
  panel.querySelector('[data-now-artwork]').innerHTML = hasImage(artwork)
    ? `<img class="pp-now-artwork" src="${escapeHtml(artwork.src)}"
        alt="${escapeHtml(artwork.alt)}"
        style="object-position: ${imagePosition(artwork)}" />`
    : '';

  const duration = trackDurationSeconds(piece);
  const isThisTrack = playback.activeTrack?.id === piece.id;
  const playing = isThisTrack && playback.status === 'playing';
  const loading = isThisTrack && playback.status === 'loading';
  const position = isThisTrack ? playback.elapsedSeconds : 0;

  panel.querySelector('[data-now-title]').textContent = piece.title;
  const statusChip = panel.querySelector('[data-now-status]');
  statusChip.textContent = `${phaseOf(piece).label} · ${STATUS_LABELS[piece.status] ?? piece.status}`;

  const playButton = panel.querySelector('[data-action="toggle"]');
  playButton.querySelector('[data-play-icon]').textContent = loading ? '…' : playing ? '■' : '▶';
  playButton.disabled = loading;
  playButton.setAttribute(
    'aria-label',
    loading ? `Loading ${piece.title}` : playing ? `Stop ${piece.title}` : `Play ${piece.title}`,
  );

  panel.querySelector('[data-clock]').textContent =
    `${formatClock(Math.min(position, duration))} / ${formatClock(duration)}`;

  const fill = panel.querySelector('[data-progress-fill]');
  fill.style.width = duration > 0 ? `${Math.min(100, (position / duration) * 100)}%` : '0%';
  const progress = panel.querySelector('[data-progress]');
  progress.max = String(duration);
  progress.value = String(Math.min(position, duration));
  progress.disabled = duration === 0 || loading;
  progress.setAttribute(
    'aria-valuetext',
    `${formatClock(Math.min(position, duration))} of ${formatClock(duration)}`,
  );

  const phaseStrip = panel.querySelector('[data-now-phases]');
  const arrangement = Array.isArray(piece.arrangement) ? piece.arrangement : [];
  phaseStrip.innerHTML = arrangement
    .map((entry, index) => {
      const start = parseClock(entry.at);
      const end = index + 1 < arrangement.length ? parseClock(arrangement[index + 1].at) : duration;
      const isCurrent = playing && position >= start && position < end;
      return `
        <button type="button" class="pp-phase ${isCurrent ? 'is-current' : ''}"
          data-action="seek" data-seconds="${start}">
          ${escapeHtml(entry.phase)}<small>${escapeHtml(entry.at)}</small>
        </button>
      `;
    })
    .join('');

  panel.querySelector('[data-status-line]').textContent =
    playback.status === 'error' ? (playback.lastError ?? 'Playback error.') : '';

  laneView.setPosition(position, isThisTrack);

  if (playing) {
    spectrum.start();
  } else if (!loading) {
    spectrum.stop();
  }
}

function render() {
  renderLibrary();
  renderNow();

  const playback = transport.getState();
  const running = playback.status === 'playing';

  if (running && clockTimer === null) {
    clockTimer = setInterval(renderNow, 500);
  } else if (!running && clockTimer !== null) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}

// --------------------------------------------------------------------------
// Metadata on demand
// --------------------------------------------------------------------------

function showMeta(piece) {
  const dialog = root.querySelector('[data-meta]');
  const families = piece.soundPalette?.families ?? {};
  const samples = piece.rights?.samples ?? [];
  const duration = trackDurationSeconds(piece);

  const artwork = resolveArtwork(piece);
  dialog.innerHTML = `
    ${
      hasImage(artwork)
        ? `<img class="pp-meta-artwork" src="${escapeHtml(artwork.src)}"
            alt="${escapeHtml(artwork.alt)}"
            style="object-position: ${imagePosition(artwork)}" />`
        : ''
    }
    <header class="pp-meta-head">
      <div>
        <p class="pp-eyebrow">${phaseOf(piece).label} · ${STATUS_LABELS[piece.status] ?? piece.status}</p>
        <h2 id="player-meta-title">${escapeHtml(piece.title)}</h2>
      </div>
      <button type="button" data-action="close-meta">Close</button>
    </header>
    <p class="pp-meta-desc">${escapeHtml(piece.description || 'No description yet.')}</p>
    <dl class="pp-meta-facts">
      <div><dt>Tempo</dt><dd>${piece.bpm} BPM</dd></div>
      <div><dt>Duration</dt><dd>${formatClock(duration)}</dd></div>
      ${piece.tags?.length ? `<div><dt>Tags</dt><dd>${piece.tags.map(escapeHtml).join(', ')}</dd></div>` : ''}
    </dl>
    ${
      Object.keys(families).length
        ? `<h3>Sound families</h3>
           <ul class="pp-meta-families">
             ${Object.entries(families)
               .map(([name, text]) => `<li><strong>${escapeHtml(name)}</strong> ${escapeHtml(text)}</li>`)
               .join('')}
           </ul>`
        : ''
    }
    ${
      samples.length
        ? `<h3>Samples</h3>
           <ul class="pp-meta-families">
             ${samples
               .map(
                 (sample) =>
                   `<li><strong>${escapeHtml(sample.license)}</strong> ${escapeHtml(sample.name)} (${escapeHtml(sample.source)})</li>`,
               )
               .join('')}
           </ul>`
        : ''
    }
  `;

  dialog.showModal();
}

// --------------------------------------------------------------------------
// Events
// --------------------------------------------------------------------------

root.addEventListener('click', async (event) => {
  const metaTarget = event.target.closest('[data-action="meta"]');
  if (metaTarget) {
    event.stopPropagation();
    const piece = playable.find((candidate) => candidate.id === metaTarget.dataset.id);
    if (piece) showMeta(piece);
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button) {
    return;
  }

  const { action } = button.dataset;
  const playback = transport.getState();
  const piece = selectedPiece();

  if (action === 'pick') {
    const id = button.dataset.id;
    const isPlayingThis =
      playback.activeTrack?.id === id && playback.status === 'playing';

    if (isPlayingThis) {
      await transport.stop();
      render();
      return;
    }

    selectedId = id;
    loadLanes(playable.find((candidate) => candidate.id === id));
    await playSelected(0);
    render();
    return;
  }

  if (action === 'toggle') {
    if (playback.status === 'playing') {
      await transport.stop();
    } else {
      await playSelected(0);
    }
    render();
    return;
  }

  if (action === 'seek') {
    await playSelected(Number(button.dataset.seconds));
    return;
  }

  if (action === 'back30' || action === 'fwd30') {
    const delta = action === 'back30' ? -30 : 30;
    const position =
      playback.activeTrack?.id === piece?.id ? playback.elapsedSeconds : 0;
    await playSelected(Math.max(0, position + delta));
    return;
  }

  if (action === 'show-meta' && piece) {
    showMeta(piece);
    return;
  }

  if (action === 'close-meta') {
    root.querySelector('[data-meta]').close();
  }
});

root.querySelector('[data-progress]').addEventListener('input', (event) => {
  const piece = selectedPiece();
  const duration = piece ? trackDurationSeconds(piece) : 0;

  if (!piece || duration === 0) {
    return;
  }

  const position = Number(event.currentTarget.value);
  root.querySelector('[data-progress-fill]').style.width = `${(position / duration) * 100}%`;
  root.querySelector('[data-clock]').textContent =
    `${formatClock(position)} / ${formatClock(duration)}`;
  event.currentTarget.setAttribute(
    'aria-valuetext',
    `${formatClock(position)} of ${formatClock(duration)}`,
  );
});

root.querySelector('[data-progress]').addEventListener('change', async (event) => {
  await playSelected(Number(event.currentTarget.value));
});

render();
void loadLanes(selectedPiece());
void hydratePieceSources(pieces).then((state) => {
  if (state.updated > 0) {
    render();
  }
});

import '@strudel/repl';
import './styles.css';

import { pieces } from './music.js';
import { PIECE_STATUSES, STATUS_LABELS } from './statuses.js';
import {
  MESSAGES,
  createEditorEngine,
  createTransport,
  formatClock,
  formatTargetDuration,
  getLayerScenes,
  getMainScene,
  isTextEntryTarget,
} from './player.js';
import { createSampleBrowser } from './sample-library/sampleLibrary.js';
import { artistProfile, hasImage, imagePosition, resolveArtwork, resolveProfileImage } from './visuals.js';
import { drawLane } from './laneRendering.js';
import { installAudioMaster, killAudio, openAudio } from './audioMaster.js';
import { hydratePieceSources, savePieceSource } from './sourceSync.js';

// --------------------------------------------------------------------------
// UI state (playback state lives in the transport, not here)
// --------------------------------------------------------------------------

const ui = {
  selectedPieceId: pieces[0]?.id ?? null,
  searchTerm: '',
  statusFilter: 'all',
  libraryOpen: false,
  notice: null,
  scrubPreviewSeconds: null,
};

let noticeTimer = null;

const DEFAULT_TIMELINE_WINDOW_SECONDS = 240;
const ARRANGEMENT_TAIL_SECONDS = 60;

// --------------------------------------------------------------------------
// Static shell
// --------------------------------------------------------------------------

const app = document.querySelector('#root');

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div class="topbar-identity">
        ${
          hasImage(artistProfile.profileImage)
            ? `<img class="topbar-profile-image" src="${escapeHtml(artistProfile.profileImage.src)}"
                alt="${escapeHtml(artistProfile.profileImage.alt)}"
                style="object-position: ${imagePosition(artistProfile.profileImage)}" />`
            : ''
        }
        <div class="topbar-title">
          <p class="eyebrow">${escapeHtml(artistProfile.artistName)}</p>
          <h1>Track Workspace</h1>
          <p class="topbar-motto">${escapeHtml(artistProfile.motto)}</p>
        </div>
      </div>
      <button class="library-toggle" type="button" data-action="toggle-library"
        aria-expanded="false" aria-controls="library-panel">
        Library
      </button>
      <button class="samples-toggle" type="button" data-action="open-samples">
        Samples
      </button>
      <div class="summary-strip" aria-label="Workspace summary">
        <span>${pieces.length} ${pieces.length === 1 ? 'track' : 'tracks'}</span>
      </div>
    </header>

    <div class="workspace">
      <aside class="library" id="library-panel" aria-label="Track library">
        <div class="library-controls">
          <input type="search" data-library-search placeholder="Search tracks…"
            aria-label="Search tracks by title or tag" />
          <select data-status-filter aria-label="Filter tracks by lifecycle status">
            <option value="all">All statuses</option>
            ${PIECE_STATUSES.map(
              (status) => `<option value="${status}">${STATUS_LABELS[status]}</option>`,
            ).join('')}
          </select>
        </div>
        <section class="library-group">
          <p class="eyebrow">Tracks</p>
          <div class="track-list" data-track-list></div>
        </section>
      </aside>

      <section class="stage" aria-label="Listening workspace">
        <header class="track-header" data-track-header></header>
        <p class="notice" data-notice role="status" hidden></p>
        <section class="stage-panel" data-stage-panel></section>
        <div class="track-details" data-track-details></div>
      </section>
    </div>

    <footer class="transport" data-transport aria-label="Playback transport"></footer>
  </main>

  <dialog class="inspector" data-inspector aria-label="Source inspector">
    <header class="inspector-header">
      <div>
        <p class="eyebrow">Source Inspector</p>
        <h2 data-inspector-title></h2>
      </div>
      <div class="inspector-actions">
        <button type="button" data-action="copy-source">Copy</button>
        <button type="button" data-action="close-inspector">Close</button>
      </div>
    </header>
    <p class="inspector-hint">
      Paste or edit Strudel here. Try Draft changes playback only; it does not touch the file on disk.
    </p>
    <textarea class="inspector-editor" data-inspector-editor aria-label="Editable Strudel source"
      spellcheck="false" wrap="off"></textarea>
    <div class="inspector-workflow">
      <button type="button" data-action="try-source">Try Draft</button>
      <button type="button" data-action="prepare-source-save" disabled>Prepare Overwrite</button>
      <span data-inspector-state role="status">Disk source loaded. No changes.</span>
    </div>
    <section class="source-confirm" data-source-confirm hidden>
      <p>
        This permanently replaces <code data-source-path></code>. The draft must still match the
        version you just tried.
      </p>
      <label>
        Editor token
        <input type="password" data-source-token autocomplete="current-password" />
      </label>
      <div class="source-confirm-actions">
        <button type="button" data-action="confirm-source-save">Confirm Overwrite</button>
        <button type="button" data-action="cancel-source-save">Cancel</button>
      </div>
    </section>
  </dialog>

  <dialog class="shortcuts" data-shortcuts aria-label="Keyboard shortcuts">
    <header class="inspector-header">
      <div>
        <p class="eyebrow">Keyboard</p>
        <h2>Shortcuts</h2>
      </div>
      <button type="button" data-action="close-shortcuts">Close</button>
    </header>
    <dl class="shortcut-list">
      <div><dt>Space</dt><dd>Play or stop, depending on the current state</dd></div>
      <div><dt>Shift + Space</dt><dd>Restart the current session</dd></div>
      <div><dt>Escape</dt><dd>Stop all playback</dd></div>
    </dl>
    <p class="inspector-hint">Shortcuts are ignored while typing in a text field.</p>
  </dialog>

  <dialog class="inspector samples" data-samples aria-label="Sample library browser"></dialog>

  <div class="engine-rack" aria-hidden="true" data-engine-rack></div>
  <span class="sr-only" role="status" aria-live="polite" data-live></span>
`;

// --------------------------------------------------------------------------
// Playback engines (hidden <strudel-editor> instances, reused architecture)
// --------------------------------------------------------------------------

const engineRack = document.querySelector('[data-engine-rack]');
const sampleBrowser = createSampleBrowser(document.querySelector('[data-samples]'));

function createEngine({ sync }) {
  const element = document.createElement('strudel-editor');

  // Property assignment must happen before the element connects: the web
  // component reads .sync and .solo when it builds its StrudelMirror.
  element.sync = sync;
  element.solo = false;
  element.setAttribute('code', 'silence');
  engineRack.append(element);

  return createEditorEngine(element);
}

installAudioMaster();

const transport = createTransport({
  engines: {
    // The full track runs on its own clock so Stop + Play restarts from bar 1.
    full: createEngine({ sync: false }),
    // The Layer Lab was removed: no channel engines.
    channels: [],
  },
  onChange: handleTransportChange,
  // Stop means stop: the master output is killed with a ~20 ms fade so
  // reverb and delay tails do not ring past a stop or a track switch.
  hooks: { onSilence: killAudio, onWake: openAudio },
});

let sourceApiState = { available: false, writeEnabled: false, updated: 0 };
let inspectorSource = null;
const sourceHydration = hydratePieceSources(pieces).then((state) => {
  sourceApiState = state;
  return state;
});

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Timeline lane previews: real note and sample events per layer, generated
// by `npm run timeline:previews`. Notes lanes render as piano-roll blocks,
// audio lanes as the composed waveform of their recorded one-shots.
// --------------------------------------------------------------------------

const timelinePreviewCache = new Map();

function getTimelinePreview(pieceId) {
  if (timelinePreviewCache.has(pieceId)) {
    return timelinePreviewCache.get(pieceId);
  }

  timelinePreviewCache.set(pieceId, null);
  fetch(`/timeline-previews/${pieceId}.json`)
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (data) {
        timelinePreviewCache.set(pieceId, data);
        render();
      }
    })
    .catch(() => {});

  return null;
}

function studioLaneColor(alpha, role, amplitude = 0.5) {
  if (role === 'wave') {
    const hue = 18 + amplitude * 26;
    return `hsla(${hue}, 62%, ${30 + amplitude * 22}%, ${alpha})`;
  }
  if (role === 'center') {
    return `rgba(31, 28, 24, ${alpha})`;
  }
  if (role === 'tick') {
    return `rgba(142, 94, 37, ${alpha})`;
  }
  return `rgba(23, 79, 69, ${Math.min(1, alpha + 0.15)})`;
}

function paintTimelineLanes() {
  const piece = getSelectedPiece();

  if (!piece) {
    return;
  }

  const preview = getTimelinePreview(piece.id);

  if (!preview) {
    return;
  }

  const totalSteps = preview.bars * preview.stepsPerBar;

  app.querySelectorAll('.timeline-lane').forEach((laneElement, index) => {
    const layerId = laneElement.dataset.layerId;
    const lane =
      preview.lanes.find((candidate) => candidate.label === layerId) ?? preview.lanes[index];

    if (!lane || laneElement.clientWidth === 0) {
      return;
    }

    let canvas = laneElement.querySelector('.timeline-lane-canvas');

    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'timeline-lane-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      laneElement.prepend(canvas);
    }

    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(laneElement.clientWidth * ratio));
    canvas.height = Math.max(1, Math.round(laneElement.clientHeight * ratio));

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawLane(ctx, lane, {
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
      ratio,
      totalSteps,
      color: studioLaneColor,
    });
  });
}

function render() {
  renderLibrary();
  renderTrackHeader();
  renderStagePanel();
  renderTrackDetails();
  renderTransport();
  paintTimelineLanes();
}

function renderLibrary() {
  const term = ui.searchTerm.trim().toLowerCase();
  const visiblePieces = pieces.filter((piece) => {
    if (ui.statusFilter !== 'all' && piece.status !== ui.statusFilter) {
      return false;
    }
    if (!term) {
      return true;
    }
    const haystack = `${piece.title} ${piece.tags.join(' ')}`.toLowerCase();
    return haystack.includes(term);
  });

  const trackList = app.querySelector('[data-track-list]');

  trackList.innerHTML = visiblePieces.length
    ? visiblePieces
        .map((piece) => {
          const isActive = piece.id === ui.selectedPieceId;
          const playback = transport.getState();
          const isPlayingThis =
            playback.mode === 'full' &&
            playback.activeTrack?.id === piece.id &&
            (playback.status === 'playing' || playback.status === 'loading');
          const playable = Boolean(getMainScene(piece));
          return `
            <span class="track-row">
            <button class="track-card-play${isPlayingThis ? ' is-playing' : ''}" type="button"
              data-action="card-play" data-piece-id="${piece.id}" ${playable ? '' : 'disabled'}
              aria-label="${isPlayingThis ? 'Stop' : 'Play'} ${escapeHtml(piece.title)}">
              ${isPlayingThis ? '■' : '▶'}
            </button>
            <button class="track-button${isActive ? ' is-active' : ' is-compact'}" type="button"
              data-action="select-piece" data-piece-id="${piece.id}"
              title="${escapeHtml(piece.title)}"
              ${isActive ? 'aria-current="true"' : ''}>
              ${
                hasImage(resolveArtwork(piece))
                  ? `<img class="track-button-artwork" src="${escapeHtml(resolveArtwork(piece).src)}"
                      alt="" style="object-position: ${imagePosition(resolveArtwork(piece))}" />`
                  : ''
              }
              <span class="track-button-copy">
                <strong>${isActive ? '<span aria-hidden="true">● </span>' : ''}${escapeHtml(piece.title)}</strong>
                <small>${STATUS_LABELS[piece.status]} · ${piece.bpm} BPM</small>
                ${piece.tags.length ? `<em>${escapeHtml(piece.tags.slice(0, 4).join(', '))}</em>` : ''}
              </span>
            </button>
            </span>
          `;
        })
        .join('')
    : `<p class="empty-state">${pieces.length ? 'No tracks match the current filter.' : 'No tracks were discovered under src/pieces.'}</p>`;

}

function renderTrackHeader() {
  const piece = getSelectedPiece();
  const host = app.querySelector('[data-track-header]');

  if (!piece) {
    host.classList.remove('has-artwork');
    host.innerHTML = '<p class="empty-state">Select a track from the library.</p>';
    return;
  }

  host.classList.toggle('has-artwork', hasImage(resolveArtwork(piece)));

  const duration = formatTargetDuration(piece.durationTargetMinutes);
  const mainScene = getMainScene(piece);
  const layerCount = getLayerScenes(piece).length;

  host.innerHTML = `
    ${
      hasImage(resolveArtwork(piece))
        ? `<img class="track-header-artwork" src="${escapeHtml(resolveArtwork(piece).src)}"
            alt="${escapeHtml(resolveArtwork(piece).alt)}"
            style="object-position: ${imagePosition(resolveArtwork(piece))}" />`
        : ''
    }
    <div class="track-header-copy">
      <div class="track-header-main">
        <div>
          <p class="eyebrow">Selected Track</p>
          <h2>${escapeHtml(piece.title)}</h2>
        </div>
        <span class="status-pill">${STATUS_LABELS[piece.status]}</span>
      </div>
      <p class="track-header-meta">
        ${piece.bpm} BPM · v${escapeHtml(piece.version)}${duration ? ` · ${duration}` : ''}
        ${
          mainScene
            ? ` · full arrangement + ${layerCount} standalone ${layerCount === 1 ? 'layer' : 'layers'}`
            : ` · ${layerCount} standalone ${layerCount === 1 ? 'scene' : 'scenes'}, no full arrangement`
        }
      </p>
      ${piece.tags.length ? `<p class="track-header-tags">${escapeHtml(piece.tags.join(' · '))}</p>` : ''}
      ${piece.description ? `<p class="track-header-description">${escapeHtml(piece.description)}</p>` : ''}
    </div>
  `;
}

function renderStagePanel() {
  const piece = getSelectedPiece();
  const host = app.querySelector('[data-stage-panel]');
  const playback = transport.getState();

  if (!piece) {
    host.innerHTML = `<p class="empty-state">${
      pieces.length ? 'Select a track from the library.' : 'No tracks were discovered under src/pieces.'
    }</p>`;
    return;
  }

  host.innerHTML = renderFullTrackPanel(piece, playback);
}

function renderFullTrackPanel(piece, playback) {
  const mainScene = getMainScene(piece);
  const layers = getLayerScenes(piece);
  const duration = formatTargetDuration(piece.durationTargetMinutes);
  const isThisTrackActive =
    playback.mode === 'full' &&
    playback.activeTrack?.id === piece.id &&
    (playback.status === 'playing' || playback.status === 'loading');

  const arrangement = Array.isArray(piece.arrangement)
    ? piece.arrangement.filter((entry) => entry && entry.phase)
    : [];

  return `
    <div class="full-panel">
      <div class="full-panel-primary">
        <button type="button" class="play-hero" data-action="play-full" ${mainScene ? '' : 'disabled'}>
          <span class="play-hero-icon" aria-hidden="true">${isThisTrackActive ? '■' : '▶'}</span>
          <span>${isThisTrackActive ? 'Stop Full Track' : 'Play Full Track'}</span>
        </button>
        <div class="full-panel-facts">
          <p class="full-panel-name">${
            mainScene ? '<code>main.strudel</code> — the complete arrangement' : escapeHtml(MESSAGES.noMainScene)
          }</p>
          <p class="full-panel-meta">${piece.bpm} BPM${duration ? ` · target ${duration}` : ''}</p>
          ${
            mainScene
              ? `<button type="button" class="link-button" data-action="view-source"
                  data-source-kind="scene" data-piece-id="${piece.id}" data-scene-id="main">
                  View main source
                </button>`
              : ''
          }
        </div>
      </div>

      ${renderTrackTimeline(piece, layers, playback, arrangement, Boolean(mainScene))}

      <div class="included-layers">
        <p class="eyebrow">${layers.length ? 'Included Layers' : 'Layers'}</p>
        ${
          layers.length
            ? `
              <p class="group-hint">Mute or unmute layers live in the timeline below; view any layer's source here.</p>
              <ul class="layer-chip-list">
                ${layers
                  .map(
                    (scene) => `
                      <li class="layer-chip">
                        <div class="layer-chip-text">
                          <strong>${escapeHtml(scene.name)}</strong>
                          ${
                            layerDescription(piece, scene.id)
                              ? `<small>${escapeHtml(layerDescription(piece, scene.id))}</small>`
                              : ''
                          }
                        </div>
                        <span class="layer-chip-actions">
                          <button type="button" data-action="view-source"
                            data-source-kind="scene" data-piece-id="${piece.id}" data-scene-id="${scene.id}">
                            Source
                          </button>
                        </span>
                      </li>
                    `,
                  )
                  .join('')}
              </ul>
            `
            : '<p class="empty-state">This track only contains a full arrangement.</p>'
        }
      </div>
    </div>
  `;
}

function renderTrackTimeline(piece, layers, playback, arrangement, hasMainScene) {
  const durationSeconds = getTimelineDurationSeconds(piece);

  if (layers.length === 0) {
    return '';
  }

  const selectedTrackIsActive =
    playback.mode === 'full' && playback.activeTrack?.id === piece.id;
  const positionSeconds = selectedTrackIsActive ? Math.min(playback.elapsedSeconds, durationSeconds) : 0;
  const playheadPercent = Math.min(100, Math.max(0, (positionSeconds / durationSeconds) * 100));
  const phaseMarkers = arrangement
    .map((entry) => ({ ...entry, seconds: parseClockTime(entry.at) }))
    .filter((entry) => entry.seconds >= 0 && entry.seconds <= durationSeconds);
  const timelineHint = phaseMarkers.length
    ? 'Drag across the lanes or choose a phase. Audio restarts at the selected musical position.'
    : 'Drag across the lanes to restart the arrangement at the selected musical position.';

  return `
    <section class="song-timeline" aria-label="Interactive layer timeline">
      <header class="timeline-header">
        <div>
          <p class="eyebrow">Layer Timeline</p>
          <p class="group-hint">${timelineHint}</p>
        </div>
        <div class="timeline-actions">
          <button type="button" data-action="seek-relative" data-seconds="-30" ${hasMainScene ? '' : 'disabled'}>
            −30 sec
          </button>
          <output class="timeline-position" data-timeline-position>
            ${formatClock(positionSeconds)} / ${formatClock(durationSeconds)}
          </output>
          <button type="button" data-action="seek-relative" data-seconds="30" ${hasMainScene ? '' : 'disabled'}>
            +30 sec
          </button>
        </div>
      </header>

      <div class="timeline-ruler-row">
        <span class="timeline-axis-label">Position</span>
        <div class="timeline-ruler">
          ${phaseMarkers
            .map(
              (entry, index) => `
                <button type="button" class="timeline-marker${index === 0 ? ' is-first' : ''}"
                  data-action="seek-to" data-seconds="${entry.seconds}"
                  style="--marker: ${(entry.seconds / durationSeconds) * 100}%"
                  title="Start ${escapeHtml(entry.phase)} at ${escapeHtml(entry.at || formatClock(entry.seconds))}">
                  <span>${escapeHtml(entry.phase)}</span>
                  <small>${escapeHtml(entry.at || formatClock(entry.seconds))}</small>
                </button>
              `,
            )
            .join('')}
        </div>
      </div>

      <div class="timeline-body">
        <div class="timeline-layer-labels">
          ${layers
            .map((scene) => {
              const layerTimeline = getLayerTimeline(piece, scene.id, durationSeconds);

              return `
                <div class="timeline-layer-label${isLayerMuted(piece.id, scene.id) ? ' is-muted' : ''}">
                  <span>
                    <strong>${escapeHtml(scene.name)}</strong>
                    <small>${escapeHtml(titleFromId(layerTimeline.family))}</small>
                  </span>
                  <button type="button" data-action="toggle-layer-mute"
                    data-piece-id="${piece.id}" data-scene-id="${scene.id}"
                    class="layer-mute${isLayerMuted(piece.id, scene.id) ? ' is-muted' : ''}"
                    ${canMuteLayers(piece) ? '' : 'disabled'}
                    title="${isLayerMuted(piece.id, scene.id) ? 'Unmute' : 'Mute'} ${escapeHtml(scene.name)} — playback continues">
                    ${isLayerMuted(piece.id, scene.id) ? '🔇' : '🔊'}
                  </button>
                </div>
              `;
            })
            .join('')}
        </div>

        <div class="timeline-canvas" style="--playhead: ${playheadPercent}%">
          <div class="timeline-lanes">
            ${layers
              .map((scene) => {
                const layerTimeline = getLayerTimeline(piece, scene.id, durationSeconds);

                return `
                  <div class="timeline-lane${isLayerMuted(piece.id, scene.id) ? ' is-muted' : ''}"
                    data-family="${escapeHtml(layerTimeline.family)}"
                    data-layer-id="${escapeHtml(scene.id)}">
                    ${layerTimeline.segments
                      .map((segment) => {
                        const left = (segment.from / durationSeconds) * 100;
                        const width = ((segment.to - segment.from) / durationSeconds) * 100;
                        const activityClass = segment.active === false ? ' is-inactive' : '';

                        return `
                          <span class="timeline-segment${activityClass}"
                            style="left: ${left}%; width: ${width}%"
                            title="${escapeHtml(segment.label)} · ${formatClock(segment.from)}–${formatClock(segment.to)}">
                            <span>${escapeHtml(segment.label)}</span>
                          </span>
                        `;
                      })
                      .join('')}
                  </div>
                `;
              })
              .join('')}
          </div>
          <div class="timeline-playhead" aria-hidden="true">
            <span data-timeline-playhead-clock>${formatClock(positionSeconds)}</span>
          </div>
          <input class="timeline-scrubber" type="range" min="0" max="${durationSeconds}" step="1"
            value="${Math.min(positionSeconds, durationSeconds)}" data-song-position
            aria-label="Song position" ${hasMainScene ? '' : 'disabled'} />
        </div>
      </div>
    </section>
  `;
}

function renderTrackDetails() {
  const piece = getSelectedPiece();
  const host = app.querySelector('[data-track-details]');

  if (!piece) {
    host.innerHTML = '';
    return;
  }

  const checks = releaseChecks(piece);
  const soundFamilies = piece.soundPalette?.families;
  const artworkRights = piece.artwork?.rights;
  const soundPalette =
    soundFamilies && typeof soundFamilies === 'object'
      ? `
        <details>
          <summary>Sound Palette</summary>
          <dl class="fact-list">
            ${factItem('Framework', titleFromId(piece.soundPalette.framework || 'custom'))}
            ${Object.entries(soundFamilies)
              .map(([role, description]) => factItem(titleFromId(role), description))
              .join('')}
            ${factItem('Cultural voice', piece.soundPalette.culturalVoice || 'None')}
            ${factItem('Cultural focus', piece.soundPalette.culturalFocus)}
          </dl>
        </details>
      `
      : '';
  const aiHooks = piece.aiHooks
    ? `
      <details>
        <summary>AI Hooks</summary>
        <dl class="fact-list">
          ${factItem('Framework', piece.aiHooks.framework)}
          ${factItem('Track type', titleFromId(piece.aiHooks.trackType || 'custom'))}
          ${factItem('Primary rule', piece.aiHooks.primaryRule)}
          ${factItem('Density methods', piece.aiHooks.densityMethods || [])}
          ${factItem('Must preserve', piece.aiHooks.mustPreserve || [])}
          ${factItem('Must avoid', piece.aiHooks.mustAvoid || [])}
        </dl>
        <p class="group-hint">AI hooks are creative guardrails, not rights clearance or cultural certification.</p>
      </details>
    `
    : '';

  host.innerHTML = `
    ${soundPalette}
    ${aiHooks}
    <details>
      <summary>Track Details</summary>
      <dl class="fact-list">
        ${factItem('Artist', piece.artist)}
        ${factItem('Recording type', piece.instrumental ? 'Instrumental' : 'Contains vocals')}
        ${factItem('Version', `v${piece.version}`)}
        ${factItem('Duration target', piece.durationTargetMinutes ? `${piece.durationTargetMinutes} min` : '')}
        ${factItem('Next step', piece.workflow.nextStep)}
        ${factItem('Last reviewed', piece.workflow.lastReviewedAt)}
      </dl>
    </details>
    <details>
      <summary>Release Preparation</summary>
      <ul class="check-list">
        ${checks
          .map(
            (check) => `
              <li class="${check.ok ? 'is-ok' : 'is-missing'}">
                <span aria-hidden="true">${check.ok ? '✓' : '!'}</span>
                ${check.label}
              </li>
            `,
          )
          .join('')}
      </ul>
      <p class="group-hint">These are documentation checks, not legal certification.</p>
    </details>
    <details>
      <summary>Rights Documentation</summary>
      <dl class="fact-list">
        ${factItem('Distribution mode', metadataLabel(piece.release.distributionMode))}
        ${factItem('Label', piece.release.label)}
        ${factItem('Monetization', piece.release.monetizationEnabled ? 'Enabled' : 'Disabled')}
        ${factItem('YouTube Content ID', piece.release.youtubeContentIdEnabled ? 'Enabled' : 'Disabled')}
        ${factItem('Composition owner', piece.rights.compositionOwner)}
        ${factItem('Composition status', metadataLabel(piece.rights.review.compositionStatus))}
        ${factItem('Human contribution', piece.rights.review.humanContributionDocumented ? 'Documented' : 'Not documented')}
        ${factItem('Master owner', piece.rights.masterOwner)}
        ${factItem('Master status', metadataLabel(piece.rights.review.masterStatus))}
        ${factItem('AI assisted', piece.rights.aiAssisted ? 'Yes' : 'No')}
        ${factItem('AI terms review', piece.rights.review.aiTermsChecked ? 'Completed' : 'Not completed')}
        ${factItem('Sample sources', sampleSummary(piece.rights.samples))}
        ${factItem('Sample-use review', piece.rights.review.sampleUseChecked ? 'Completed' : 'Not completed')}
        ${factItem('Content ID status', metadataLabel(piece.rights.review.contentIdStatus))}
        ${factItem('Commercial-use review', piece.rights.commercialUseChecked ? 'Documented as checked' : 'Not completed')}
        ${factItem('Review notes', piece.rights.review.notes)}
      </dl>
    </details>
    <details>
      <summary>Artwork Documentation</summary>
      <dl class="fact-list">
        ${factItem('Visual brief', piece.artwork?.brief)}
        ${factItem('Image file', piece.artwork?.src)}
        ${factItem('Alt text', piece.artwork?.alt)}
        ${factItem('Creator', artworkRights?.creator)}
        ${factItem('Source', artworkRights?.source)}
        ${factItem('License or permission', artworkRights?.license)}
        ${factItem(
          'AI assisted',
          artworkRights?.aiAssisted === null || artworkRights?.aiAssisted === undefined
            ? 'Not documented'
            : artworkRights.aiAssisted
              ? 'Yes'
              : 'No',
        )}
        ${factItem('AI tool', artworkRights?.aiTool)}
        ${factItem('AI terms review', artworkRights?.termsChecked ? 'Completed' : 'Not completed')}
        ${factItem(
          'Commercial-use review',
          artworkRights?.commercialUseChecked ? 'Documented as checked' : 'Not completed',
        )}
      </dl>
      <p class="group-hint">Artwork rights are separate from composition and master rights.</p>
    </details>
  `;
}

function renderTransport() {
  const playback = transport.getState();
  const piece = getSelectedPiece();
  const host = app.querySelector('[data-transport]');

  const statusLabels = {
    idle: 'Idle',
    loading: 'Loading…',
    playing: 'Playing',
    stopped: 'Stopped',
    error: 'Error',
  };

  const mainScene = piece ? getMainScene(piece) : null;
  const assignedChannels = playback.channels.filter(Boolean).length;
  const canPlayLab = playback.mode === 'lab' && assignedChannels > 0;
  const isBusy = playback.status === 'playing' || playback.status === 'loading';
  const selectedFullTrackIsBusy =
    playback.mode === 'full' && isBusy && playback.activeTrack?.id === piece?.id;
  const primaryStopsCurrent =
    isBusy && (playback.mode === 'lab' || selectedFullTrackIsBusy || (playback.mode === 'full' && !mainScene));
  const primaryIcon = primaryStopsCurrent ? '■' : '▶';
  const primaryLabel = primaryStopsCurrent
    ? 'Stop'
    : playback.mode === 'full'
      ? 'Play Full Track'
      : 'Play Layers';
  const primaryEnabled = playback.mode === 'full' ? Boolean(mainScene) || isBusy : canPlayLab || isBusy;

  const nowPlayingLabel =
    playback.mode === 'full'
      ? isBusy && playback.activeTrack
        ? `${playback.activeTrack.title} — full arrangement`
        : piece
          ? `${piece.title} — full arrangement`
          : 'No track selected'
      : `Layer Lab session (${assignedChannels} ${assignedChannels === 1 ? 'layer' : 'layers'})`;

  const durationSource = isBusy && playback.activeTrack ? playback.activeTrack : piece;
  const durationSeconds = playback.mode === 'full' ? getTrackDurationSeconds(durationSource) : null;
  const durationLabel =
    playback.mode === 'full'
      ? durationSeconds
        ? formatClock(durationSeconds)
        : formatTargetDuration(durationSource?.durationTargetMinutes)
      : null;

  host.innerHTML = `
    <div class="transport-inner">
      <div class="transport-buttons">
        <button type="button" class="transport-play" data-action="transport-toggle"
          ${primaryEnabled ? '' : 'disabled'}>
          <span aria-hidden="true">${primaryIcon}</span>
          <span>${primaryLabel}</span>
        </button>
        <button type="button" data-action="transport-restart" ${isBusy ? '' : 'disabled'}>Restart</button>
      </div>
      <div class="transport-now">
        <strong>${escapeHtml(nowPlayingLabel)}</strong>
        <small>${playback.mode === 'full' ? 'Full Track mode' : 'Layer Lab mode'}</small>
      </div>
      <div class="transport-clock">
        <span data-elapsed>${formatClock(playback.elapsedSeconds)}</span>${durationLabel ? ` / ${durationLabel}` : ''}
      </div>
      <span class="status-pill transport-status is-${playback.status}">${statusLabels[playback.status]}</span>
      <button type="button" class="shortcut-button" data-action="open-shortcuts">? Keys</button>
    </div>
    ${
      playback.lastError
        ? `
          <div class="transport-error" role="alert">
            <span>${escapeHtml(playback.lastError)} Open the source inspector or browser console for technical details.</span>
            <button type="button" data-action="dismiss-error">Dismiss</button>
          </div>
        `
        : ''
    }
  `;
}

// Lightweight tick: update clocks and the timeline playhead without rerendering.
setInterval(() => {
  const playback = transport.getState();

  if (playback.status !== 'playing') {
    return;
  }

  const elapsedNode = app.querySelector('[data-elapsed]');

  if (elapsedNode) {
    elapsedNode.textContent = formatClock(playback.elapsedSeconds);
  }

  const selectedPiece = getSelectedPiece();

  if (
    ui.scrubPreviewSeconds === null &&
    playback.mode === 'full' &&
    playback.activeTrack?.id === selectedPiece?.id
  ) {
    updateTimelinePosition(playback.elapsedSeconds);
  }

  if (
    playback.mode === 'full' &&
    playback.activeTrack?.durationSeconds &&
    playback.elapsedSeconds >= playback.activeTrack.durationSeconds
  ) {
    void transport.stop();
  }
}, 500);

// --------------------------------------------------------------------------
// Transport change handling
// --------------------------------------------------------------------------

let lastAnnouncedStatus = null;

function handleTransportChange(playback) {
  renderLibrary();
  renderStagePanel();
  renderTransport();
  // The stage rebuild above discards the timeline lane canvases — repaint
  // them so the piano-roll and waveform content stays visible during play.
  paintTimelineLanes();

  if (playback.status !== lastAnnouncedStatus) {
    lastAnnouncedStatus = playback.status;

    const labels = {
      idle: '',
      loading: 'Loading playback.',
      playing:
        playback.mode === 'full'
          ? `Playing ${playback.activeTrack?.title ?? 'track'}, full arrangement.`
          : 'Playing Layer Lab session.',
      stopped: 'Playback stopped.',
      error: 'Playback error. See the transport bar for details.',
    };

    document.querySelector('[data-live]').textContent = labels[playback.status] ?? '';
  }
}

// --------------------------------------------------------------------------
// Actions
// --------------------------------------------------------------------------

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');

  if (!button) {
    return;
  }

  const { action } = button.dataset;

  if (action === 'select-piece') {
    ui.selectedPieceId = button.dataset.pieceId;
    ui.libraryOpen = false;
    syncLibraryDrawer();
    render();
    return;
  }

  if (action === 'toggle-library') {
    ui.libraryOpen = !ui.libraryOpen;
    syncLibraryDrawer();
    return;
  }

  if (action === 'open-samples') {
    await sampleBrowser.open();
    return;
  }

  if (action === 'card-play') {
    const pieceId = button.dataset.pieceId;
    const playback = transport.getState();
    const isPlayingThis =
      playback.mode === 'full' &&
      playback.activeTrack?.id === pieceId &&
      (playback.status === 'playing' || playback.status === 'loading');

    if (isPlayingThis) {
      await transport.stop();
      return;
    }

    ui.selectedPieceId = pieceId;
    render();
    await playSelectedFullTrack(0);
    return;
  }

  if (action === 'toggle-layer-mute') {
    await toggleLayerMute(button.dataset.pieceId, button.dataset.sceneId);
    return;
  }

  if (action === 'play-full' || action === 'transport-toggle') {
    await handlePrimaryAction();
    return;
  }

  if (action === 'transport-restart') {
    const result = await transport.restart();

    if (!result.ok && result.message) {
      showNotice(result.message);
    }
    return;
  }

  if (action === 'seek-to') {
    await playSelectedFullTrack(Number(button.dataset.seconds));
    return;
  }

  if (action === 'seek-relative') {
    const piece = getSelectedPiece();
    const playback = transport.getState();
    const currentPosition =
      playback.mode === 'full' && playback.activeTrack?.id === piece?.id
        ? playback.elapsedSeconds
        : 0;

    await playSelectedFullTrack(currentPosition + Number(button.dataset.seconds));
    return;
  }

  if (action === 'view-source') {
    await openSourceFor(button.dataset);
    return;
  }

  if (action === 'copy-source') {
    const code = document.querySelector('[data-inspector-editor]').value;

    try {
      await navigator.clipboard.writeText(code);
      showNotice('Source copied to the clipboard.');
    } catch {
      showNotice('Copying failed. Select the text manually instead.');
    }
    return;
  }

  if (action === 'try-source') {
    await tryInspectorDraft();
    return;
  }

  if (action === 'prepare-source-save') {
    prepareSourceOverwrite();
    return;
  }

  if (action === 'confirm-source-save') {
    await confirmSourceOverwrite(button);
    return;
  }

  if (action === 'cancel-source-save') {
    document.querySelector('[data-source-confirm]').hidden = true;
    setInspectorStatus('Permanent overwrite cancelled. The draft remains in the editor.');
    return;
  }

  if (action === 'close-inspector') {
    document.querySelector('[data-inspector]').close();
    return;
  }

  if (action === 'open-shortcuts') {
    document.querySelector('[data-shortcuts]').showModal();
    return;
  }

  if (action === 'close-shortcuts') {
    document.querySelector('[data-shortcuts]').close();
    return;
  }

  if (action === 'dismiss-error') {
    transport.clearError();
  }
});

app.addEventListener('input', (event) => {
  if (event.target.matches('[data-inspector-editor]')) {
    invalidateInspectorTrial();
    return;
  }

  if (event.target.matches('[data-library-search]')) {
    ui.searchTerm = event.target.value;
    renderLibrary();
    return;
  }

  if (event.target.matches('[data-song-position]')) {
    ui.scrubPreviewSeconds = Number(event.target.value);
    updateTimelinePosition(ui.scrubPreviewSeconds);
  }
});

app.addEventListener('change', async (event) => {
  if (event.target.matches('[data-status-filter]')) {
    ui.statusFilter = event.target.value;
    renderLibrary();
    return;
  }

  if (event.target.matches('[data-song-position]')) {
    const requestedPosition = Number(event.target.value);

    ui.scrubPreviewSeconds = null;
    await playSelectedFullTrack(requestedPosition);
  }
});

async function handlePrimaryAction() {
  const playback = transport.getState();
  const piece = getSelectedPiece();
  const isBusy = playback.status === 'playing' || playback.status === 'loading';
  const selectedHasMainScene = Boolean(piece && getMainScene(piece));
  const selectedTrackIsRunning = isBusy && playback.activeTrack?.id === piece?.id;

  if (selectedTrackIsRunning || (isBusy && !selectedHasMainScene)) {
    await transport.stop();
    return;
  }

  await playSelectedFullTrack();
}

// --------------------------------------------------------------------------
// Live layer mutes: every sound family owns one audio orbit, so a muted
// layer is removed by filtering its orbit out of the pattern. Applying a
// change re-evaluates the program at the current position — the track keeps
// running, only the muted family falls silent.
// --------------------------------------------------------------------------

const mutedLayersByPiece = new Map();

function mutedSetFor(pieceId) {
  if (!mutedLayersByPiece.has(pieceId)) {
    mutedLayersByPiece.set(pieceId, new Set());
  }
  return mutedLayersByPiece.get(pieceId);
}

function isLayerMuted(pieceId, layerId) {
  return mutedLayersByPiece.get(pieceId)?.has(layerId) ?? false;
}

function canMuteLayers(piece) {
  return Boolean(getTimelinePreview(piece.id)?.lanes?.some((lane) => lane.orbit !== undefined));
}

function mutedOrbitsFor(piece) {
  const muted = mutedLayersByPiece.get(piece.id);
  const preview = getTimelinePreview(piece.id);

  if (!muted || muted.size === 0 || !preview) {
    return [];
  }

  const layers = getLayerScenes(piece);

  return preview.lanes
    .filter((lane, index) => {
      const byLabel = layers.find((scene) => scene.id === lane.label);
      const scene = byLabel ?? layers[index];
      return scene && muted.has(scene.id) && lane.orbit !== undefined;
    })
    .map((lane) => lane.orbit);
}

function withMutedOrbits(code, orbits) {
  if (orbits.length === 0) {
    return code;
  }

  const chainable = code.trim().replace(/;\s*$/, '');
  return `${chainable}\n  .filterValues((v) => ![${orbits.join(', ')}].includes(v?.orbit ?? -1))`;
}

async function toggleLayerMute(pieceId, layerId) {
  const piece = pieces.find((candidate) => candidate.id === pieceId);

  if (!piece) {
    return;
  }

  const muted = mutedSetFor(pieceId);

  if (muted.has(layerId)) {
    muted.delete(layerId);
  } else {
    muted.add(layerId);
  }

  const playback = transport.getState();
  const isRunningThis =
    playback.mode === 'full' &&
    playback.activeTrack?.id === pieceId &&
    (playback.status === 'playing' || playback.status === 'loading');

  if (isRunningThis && ui.selectedPieceId === pieceId) {
    // Re-evaluate at the current position: the music keeps going, the
    // muted family drops out (or comes back).
    await playSelectedFullTrack(playback.elapsedSeconds);
  }

  render();
}

async function playSelectedFullTrack(offsetSeconds = 0) {
  const piece = getSelectedPiece();

  if (!piece) {
    showNotice('Select a track from the library.');
    return;
  }

  const mainScene = getMainScene(piece);

  if (!mainScene) {
    showNotice(MESSAGES.noMainScene);
    return;
  }

  const result = await transport.playFull(
    {
      id: piece.id,
      title: piece.title,
      code: withMutedOrbits(mainScene.code, mutedOrbitsFor(piece)),
      bpm: piece.bpm,
      durationTargetMinutes: piece.durationTargetMinutes,
      durationSeconds: getTrackDurationSeconds(piece),
    },
    { offsetSeconds: Math.max(0, Number(offsetSeconds) || 0) },
  );

  if (result.message) {
    showNotice(result.message);
  }
}

async function openSourceFor(dataset) {
  await sourceHydration;

  if (dataset.sourceKind === 'scene') {
    const piece = pieces.find((candidate) => candidate.id === dataset.pieceId);
    const scene = piece?.scenes.find((candidate) => candidate.id === dataset.sceneId);

    if (piece && scene) {
      openInspector(piece, scene);
    } else {
      showNotice('The selected scene is missing.');
    }
    return;
  }
}

function openInspector(piece, scene) {
  const dialog = document.querySelector('[data-inspector]');
  const title = `${piece.id}/${scene.id}.strudel`;

  dialog.querySelector('[data-inspector-title]').textContent = title;
  dialog.querySelector('[data-inspector-editor]').value = scene.code;
  dialog.querySelector('[data-source-path]').textContent = scene.sourcePath ?? `pieces/${title}`;
  dialog.querySelector('[data-source-confirm]').hidden = true;

  inspectorSource = {
    piece,
    scene,
    originalCode: scene.code,
    triedCode: null,
    revision: scene.sourceRevision ?? null,
  };

  const saveButton = dialog.querySelector('[data-action="prepare-source-save"]');
  saveButton.disabled = true;
  setInspectorStatus(
    sourceApiState.available
      ? sourceApiState.writeEnabled
        ? 'Disk source loaded. Edit, then try the draft before overwriting.'
        : 'Draft playback is available. Permanent writes need SOURCE_EDITOR_TOKEN on the server.'
      : 'Draft playback is available. The source service is not reachable, so disk writes are off.',
  );

  dialog.showModal();
}

function invalidateInspectorTrial() {
  if (!inspectorSource) {
    return;
  }

  inspectorSource.triedCode = null;
  const dialog = document.querySelector('[data-inspector]');
  dialog.querySelector('[data-action="prepare-source-save"]').disabled = true;
  dialog.querySelector('[data-source-confirm]').hidden = true;
  setInspectorStatus('Unsaved draft. Try it before preparing a permanent overwrite.');
}

async function tryInspectorDraft() {
  if (!inspectorSource) {
    return;
  }

  const code = document.querySelector('[data-inspector-editor]').value;

  if (!code.trim()) {
    setInspectorStatus('The draft is empty. Add Strudel code before trying it.', true);
    return;
  }

  setInspectorStatus('Evaluating the draft. The disk source remains unchanged.');

  const { piece, scene } = inspectorSource;
  const isMainScene = scene.id === 'main';
  const result = await transport.playFull({
    id: `draft:${piece.id}:${scene.id}`,
    title: `${piece.title} — ${scene.name} draft`,
    code,
    bpm: piece.bpm,
    durationTargetMinutes: isMainScene ? piece.durationTargetMinutes : null,
    durationSeconds: isMainScene ? getTrackDurationSeconds(piece) : null,
  });

  if (!result.ok) {
    inspectorSource.triedCode = null;
    setInspectorStatus(result.message ?? 'The draft could not be evaluated.', true);
    return;
  }

  inspectorSource.triedCode = code;
  const prepareButton = document.querySelector('[data-action="prepare-source-save"]');
  prepareButton.disabled = !inspectorSource.revision || !sourceApiState.writeEnabled;
  setInspectorStatus(
    prepareButton.disabled
      ? 'Draft is playing. Disk source unchanged; permanent writing is not configured.'
      : 'Draft is playing. Disk source unchanged. You can now prepare the overwrite.',
  );
}

function prepareSourceOverwrite() {
  if (!inspectorSource) {
    return;
  }

  const dialog = document.querySelector('[data-inspector]');
  const currentCode = dialog.querySelector('[data-inspector-editor]').value;

  if (!inspectorSource.triedCode || inspectorSource.triedCode !== currentCode) {
    invalidateInspectorTrial();
    return;
  }

  const tokenInput = dialog.querySelector('[data-source-token]');
  tokenInput.value = sessionStorage.getItem('strudel-track-forge-source-editor-token') ?? '';
  dialog.querySelector('[data-source-confirm]').hidden = false;
  setInspectorStatus('Review the file path and confirm once more to overwrite the disk source.');
  tokenInput.focus();
}

async function confirmSourceOverwrite(button) {
  if (!inspectorSource) {
    return;
  }

  const dialog = document.querySelector('[data-inspector]');
  const code = dialog.querySelector('[data-inspector-editor]').value;
  const editorToken = dialog.querySelector('[data-source-token]').value;

  if (inspectorSource.triedCode !== code) {
    invalidateInspectorTrial();
    return;
  }

  if (!editorToken) {
    setInspectorStatus('Enter the editor token before confirming the overwrite.', true);
    return;
  }

  button.disabled = true;
  setInspectorStatus('Writing the source atomically…');

  const result = await savePieceSource({
    pieceId: inspectorSource.piece.id,
    sceneId: inspectorSource.scene.id,
    code,
    expectedRevision: inspectorSource.revision,
    editorToken,
  });

  button.disabled = false;

  if (!result.ok) {
    const conflictHint =
      result.status === 409 ? ' Close and reopen the inspector before trying again.' : '';
    setInspectorStatus(`${result.error}${conflictHint}`, true);
    return;
  }

  inspectorSource.scene.code = result.source.code;
  inspectorSource.scene.sourceRevision = result.source.revision;
  inspectorSource.scene.sourcePath = result.source.path;
  inspectorSource.originalCode = result.source.code;
  inspectorSource.revision = result.source.revision;
  inspectorSource.triedCode = result.source.code;
  sessionStorage.setItem('strudel-track-forge-source-editor-token', editorToken);
  dialog.querySelector('[data-source-confirm]').hidden = true;
  dialog.querySelector('[data-action="prepare-source-save"]').disabled = true;
  setInspectorStatus('Saved to disk. The current draft is now the source of truth.');
  showNotice(`${result.source.path} was overwritten after draft playback and confirmation.`);
}

function setInspectorStatus(message, isError = false) {
  const node = document.querySelector('[data-inspector-state]');
  node.textContent = message;
  node.classList.toggle('is-error', isError);
}

// --------------------------------------------------------------------------
// Keyboard shortcuts
// --------------------------------------------------------------------------

window.addEventListener('keydown', async (event) => {
  if (isTextEntryTarget(event.target)) {
    return;
  }

  const dialogOpen =
    document.querySelector('[data-inspector]').open ||
    document.querySelector('[data-shortcuts]').open ||
    document.querySelector('[data-samples]').open;

  if (dialogOpen) {
    // Dialogs own their keys; Escape closes them natively.
    return;
  }

  if (event.code === 'Space') {
    event.preventDefault();

    if (event.shiftKey) {
      const result = await transport.restart();

      if (!result.ok && result.message) {
        showNotice(result.message);
      }
    } else {
      await handlePrimaryAction();
    }
    return;
  }

  if (event.key === 'Escape') {
    await transport.stop();
    return;
  }

});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function syncLibraryDrawer() {
  const library = app.querySelector('.library');
  const toggle = app.querySelector('.library-toggle');

  library.classList.toggle('is-open', ui.libraryOpen);
  toggle.setAttribute('aria-expanded', String(ui.libraryOpen));
}

function showNotice(text) {
  const node = app.querySelector('[data-notice]');

  ui.notice = text;
  node.textContent = text;
  node.hidden = false;

  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    node.hidden = true;
    ui.notice = null;
  }, 7000);
}

function getSelectedPiece() {
  return pieces.find((piece) => piece.id === ui.selectedPieceId) ?? null;
}

function layerDescription(piece, sceneId) {
  const descriptions = piece.sectionDescriptions;

  if (descriptions && typeof descriptions === 'object') {
    const value = descriptions[sceneId];
    return typeof value === 'string' ? value : '';
  }

  return '';
}

function getTrackDurationSeconds(piece) {
  if (typeof piece?.timeline?.durationSeconds === 'number' && piece.timeline.durationSeconds > 0) {
    return piece.timeline.durationSeconds;
  }

  if (typeof piece?.durationSeconds === 'number' && piece.durationSeconds > 0) {
    return piece.durationSeconds;
  }

  if (typeof piece?.durationTargetMinutes === 'number' && piece.durationTargetMinutes > 0) {
    return piece.durationTargetMinutes * 60;
  }

  return null;
}

function getTimelineDurationSeconds(piece) {
  if (!piece) {
    return null;
  }

  const trackDurationSeconds = getTrackDurationSeconds(piece);

  if (trackDurationSeconds) {
    return trackDurationSeconds;
  }

  const arrangementDurationSeconds = getArrangementTimelineDurationSeconds(piece);

  if (arrangementDurationSeconds) {
    return arrangementDurationSeconds;
  }

  return DEFAULT_TIMELINE_WINDOW_SECONDS;
}

function getArrangementTimelineDurationSeconds(piece) {
  if (!Array.isArray(piece?.arrangement)) {
    return null;
  }

  const markerSeconds = piece.arrangement
    .map((entry) => parseClockTime(entry?.at))
    .filter((seconds) => seconds > 0);

  if (markerSeconds.length === 0) {
    return null;
  }

  return Math.max(...markerSeconds) + ARRANGEMENT_TAIL_SECONDS;
}

function parseClockTime(value) {
  if (typeof value !== 'string' || !/^\d+:\d{2}$/.test(value)) {
    return 0;
  }

  const [minutes, seconds] = value.split(':').map(Number);
  return minutes * 60 + seconds;
}

function getLayerTimeline(piece, sceneId, durationSeconds) {
  const metadata = piece.timeline?.layers?.[sceneId];
  const rawSegments = Array.isArray(metadata?.segments) ? metadata.segments : [];
  const segments = rawSegments
    .filter(
      (segment) =>
        segment &&
        Number.isFinite(segment.from) &&
        Number.isFinite(segment.to) &&
        segment.to > segment.from,
    )
    .map((segment) => ({
      from: Math.max(0, Math.min(durationSeconds, segment.from)),
      to: Math.max(0, Math.min(durationSeconds, segment.to)),
      label: typeof segment.label === 'string' && segment.label ? segment.label : 'Active',
      active: segment.active !== false,
    }))
    .filter((segment) => segment.to > segment.from);

  return {
    family: typeof metadata?.family === 'string' && metadata.family ? metadata.family : sceneId,
    segments:
      segments.length > 0
        ? segments
        : [{ from: 0, to: durationSeconds, label: layerDescription(piece, sceneId) || 'Active', active: true }],
  };
}

function updateTimelinePosition(seconds) {
  const piece = getSelectedPiece();
  const durationSeconds = getTimelineDurationSeconds(piece);

  if (!durationSeconds) {
    return;
  }

  const positionSeconds = Math.min(durationSeconds, Math.max(0, Number(seconds) || 0));
  const playheadPercent = (positionSeconds / durationSeconds) * 100;
  const canvas = app.querySelector('[data-stage-panel] .timeline-canvas');
  const scrubber = app.querySelector('[data-stage-panel] [data-song-position]');
  const positionOutput = app.querySelector('[data-stage-panel] [data-timeline-position]');
  const playheadClock = app.querySelector('[data-stage-panel] [data-timeline-playhead-clock]');

  canvas?.style.setProperty('--playhead', `${playheadPercent}%`);

  if (scrubber && ui.scrubPreviewSeconds === null) {
    scrubber.value = String(positionSeconds);
  }

  if (positionOutput) {
    positionOutput.textContent = `${formatClock(positionSeconds)} / ${formatClock(durationSeconds)}`;
  }

  if (playheadClock) {
    playheadClock.textContent = formatClock(positionSeconds);
  }
}

function releaseChecks(piece) {
  const review = piece.rights.review;
  const compositionOwnerRequired = review.compositionStatus !== 'not-claimed';
  const humanContributionRequired = ['human-authored', 'ai-assisted-human-authored'].includes(
    review.compositionStatus,
  );

  return [
    {
      label:
        piece.release.distributionMode === 'private-library'
          ? 'Private-library mode active; no public release'
          : 'Public-streaming mode selected',
      ok: true,
    },
    {
      label: piece.release.monetizationEnabled ? 'Monetization enabled' : 'Monetization disabled',
      ok: true,
    },
    {
      label: 'Metadata documented',
      ok: Boolean(
        piece.title && piece.version && piece.bpm && piece.description && piece.durationTargetMinutes,
      ),
    },
    {
      label: piece.artist.trim() ? 'Artist name documented' : 'Artist name missing',
      ok: piece.artist.trim() !== '',
    },
    {
      label: hasImage(piece.artwork) ? 'Artwork file documented' : 'Artwork not assigned',
      ok: hasImage(piece.artwork),
    },
    {
      label: piece.artwork?.rights?.commercialUseChecked
        ? 'Artwork commercial-use review documented'
        : 'Artwork commercial-use review not completed',
      ok: Boolean(piece.artwork?.rights?.commercialUseChecked),
    },
    {
      label:
        review.compositionStatus === 'undetermined'
          ? 'Composition status requires review'
          : `Composition status: ${metadataLabel(review.compositionStatus)}`,
      ok: review.compositionStatus !== 'undetermined',
    },
    {
      label: compositionOwnerRequired
        ? piece.rights.compositionOwner.trim()
          ? 'Composition owner documented'
          : 'Composition owner missing'
        : 'No composition rights claimed',
      ok: !compositionOwnerRequired || piece.rights.compositionOwner.trim() !== '',
    },
    {
      label: humanContributionRequired
        ? review.humanContributionDocumented
          ? 'Human contribution documented'
          : 'Human contribution not documented'
        : 'Human contribution decision pending',
      ok: !humanContributionRequired || review.humanContributionDocumented,
    },
    {
      label: piece.rights.masterOwner.trim() ? 'Master owner documented' : 'Master owner missing',
      ok: piece.rights.masterOwner.trim() !== '',
    },
    {
      label: review.masterStatus === 'final' ? 'Final master documented' : 'Final master missing',
      ok: review.masterStatus === 'final',
    },
    {
      label:
        !piece.rights.aiAssisted || review.aiTermsChecked
          ? 'AI terms reviewed'
          : 'AI terms review not completed',
      ok: !piece.rights.aiAssisted || review.aiTermsChecked,
    },
    {
      label: piece.rights.samples.length ? 'External samples declared' : 'No external samples declared',
      ok: true,
    },
    {
      label: review.sampleUseChecked ? 'Sample use reviewed' : 'Sample-use review not completed',
      ok: review.sampleUseChecked,
    },
    {
      label: piece.release.youtubeContentIdEnabled
        ? 'YouTube Content ID enabled'
        : `YouTube Content ID disabled (${metadataLabel(review.contentIdStatus)})`,
      ok: !piece.release.youtubeContentIdEnabled || review.contentIdStatus === 'eligible',
    },
    {
      label: piece.rights.commercialUseChecked
        ? 'Commercial-use review documented'
        : 'Commercial-use review not completed',
      ok: piece.rights.commercialUseChecked,
    },
  ];
}

function metadataLabel(value) {
  return String(value || '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function factItem(label, value) {
  const displayValue = Array.isArray(value) ? value.join(', ') : value;

  return `
    <div>
      <dt>${label}</dt>
      <dd class="${displayValue ? '' : 'is-missing-text'}">${escapeHtml(String(displayValue || 'Missing'))}</dd>
    </div>
  `;
}

function sampleSummary(samples) {
  if (!samples.length) {
    return 'No sample sources documented';
  }

  return samples.map((sample) => `${sample.name}: ${sample.source}`).join(', ');
}

function titleFromId(id) {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };

    return entities[character];
  });
}

// Console helper for driving playback while developing.
window.strudelWorkspace = {
  pieces,
  transport,
};

render();
void sourceHydration.then((state) => {
  if (state.updated > 0) {
    render();
  }
});

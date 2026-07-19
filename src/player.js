// Playback transport for the track workspace.
//
// The Strudel runtime is reached exclusively through "engines". An engine
// wraps one <strudel-editor> element (a StrudelMirror instance) and exposes
// setCode / evaluate / stop / onUpdate. The transport itself is pure state
// logic, so tests can drive it with fake engines instead of real audio.
//
// Runtime facts this design relies on (verified against @strudel/repl 1.3.0):
// - StrudelMirror.evaluate() compiles and starts the pattern; it rejects on
//   evaluation errors.
// - StrudelMirror.stop() stops the scheduler. With sync disabled the clock
//   resets to zero, so the next evaluate starts the piece from the top.
// - Editors created with sync = true share one clock, so several Layer Lab
//   channels started together stay phase-aligned.
// - There is no reliable clock-seek path through the REPL component. Full-track
//   seeking is implemented by restarting the source with an `.early(cycles)`
//   pattern offset, which keeps the musical arrangement deterministic.

export const PLAYBACK_STATUSES = ['idle', 'loading', 'playing', 'stopped', 'error'];

export const CHANNEL_COUNT = 3;

export const MESSAGES = {
  duplicateLayer: 'This layer is already active.',
  channelsFull: 'All available layer channels are in use.',
  mainInLab: 'The full arrangement cannot be combined with standalone layers.',
  replacedPlayback: 'Previous playback was stopped before starting the new selection.',
  modeSwitchStopped: 'Playback was stopped because the mode changed.',
  emptySession: 'Add a layer to the session first.',
  noMainScene: 'This track contains standalone scenes but no complete main arrangement.',
};

// --- scene classification ---------------------------------------------------

export function getMainScene(piece) {
  return piece?.scenes?.find((scene) => scene.id === 'main') ?? null;
}

export function getLayerScenes(piece) {
  return piece?.scenes?.filter((scene) => scene.id !== 'main') ?? [];
}

// --- formatting helpers ------------------------------------------------------

export function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = String(safe % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function formatTargetDuration(durationTargetMinutes) {
  if (typeof durationTargetMinutes !== 'number' || durationTargetMinutes <= 0) {
    return null;
  }
  return `~${formatClock(durationTargetMinutes * 60)}`;
}

export function secondsToCycles(seconds, bpm, beatsPerCycle = 4) {
  if (
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    typeof bpm !== 'number' ||
    !Number.isFinite(bpm) ||
    bpm <= 0 ||
    typeof beatsPerCycle !== 'number' ||
    !Number.isFinite(beatsPerCycle) ||
    beatsPerCycle <= 0
  ) {
    return 0;
  }

  return (Math.max(0, seconds) * bpm) / (60 * beatsPerCycle);
}

export function buildSeekedCode(code, offsetSeconds, bpm, beatsPerCycle = 4) {
  const trimmedCode = typeof code === 'string' ? code.trim() : '';
  const offsetCycles = secondsToCycles(offsetSeconds, bpm, beatsPerCycle);

  if (!trimmedCode || offsetCycles <= 0) {
    return trimmedCode;
  }

  const chainableCode = trimmedCode.replace(/;\s*$/, '');
  const formattedCycles = Number(offsetCycles.toFixed(6));

  return `${chainableCode}\n  .early(${formattedCycles})`;
}

// --- keyboard guard ----------------------------------------------------------

// Shortcuts must never fire while the user is typing. Written defensively so
// tests can pass plain objects instead of DOM nodes.
export function isTextEntryTarget(target) {
  if (!target) {
    return false;
  }

  const tag = (target.tagName || '').toLowerCase();

  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return true;
  }

  if (target.isContentEditable) {
    return true;
  }

  if (typeof target.closest === 'function' && target.closest('.cm-editor, [contenteditable="true"]')) {
    return true;
  }

  return false;
}

// --- engine wrapper for <strudel-editor> -------------------------------------

// The web component builds its StrudelMirror asynchronously after being
// attached, so every call waits until element.editor exists.
export function createEditorEngine(element, { timeoutMs = 5000 } = {}) {
  const waitForMirror = () =>
    new Promise((resolve, reject) => {
      const startedAt = performance.now();

      const check = () => {
        if (element.editor) {
          resolve(element.editor);
          return;
        }
        if (performance.now() - startedAt > timeoutMs) {
          reject(new Error('The Strudel editor did not finish initializing.'));
          return;
        }
        requestAnimationFrame(check);
      };

      check();
    });

  return {
    async setCode(code) {
      const mirror = await waitForMirror();
      mirror.setCode(code.trim());
    },
    async evaluate() {
      const mirror = await waitForMirror();
      await mirror.evaluate();
    },
    async stop() {
      const mirror = await waitForMirror();
      await mirror.stop();
    },
    onUpdate(callback) {
      element.addEventListener('update', (event) => callback(event.detail));
    },
  };
}

// --- transport ----------------------------------------------------------------

// engines: { full, channels: [engine, engine, engine] }
// hooks (optional, both may be async):
//   onWake    — called right before an engine starts producing audio,
//   onSilence — called after engines stop; used to kill the master output
//               so reverb/delay tails do not ring past a stop.
export function createTransport({
  engines,
  onChange = () => {},
  now = () => performance.now(),
  hooks = {},
}) {
  const state = {
    mode: 'full', // 'full' | 'lab'
    status: 'idle', // see PLAYBACK_STATUSES
    audioReady: false,
    lastError: null,
    // full-track session
    activeTrack: null, // { id, title, durationTargetMinutes }
    offsetSeconds: 0,
    // layer-lab session: one entry per channel or null
    channels: Array.from({ length: engines.channels.length }, () => null),
    soloChannel: null,
    startedAt: null,
  };

  // The last successfully requested full-track payload, kept for Restart.
  let lastFullPayload = null;
  let generation = 0;

  const allEngines = [engines.full, ...engines.channels];

  // Surface scheduler errors that happen after a successful evaluate.
  allEngines.forEach((engine, index) => {
    engine.onUpdate?.((update) => {
      const runtimeError = update?.schedulerError || update?.evalError;
      if (runtimeError && (state.status === 'playing' || state.status === 'loading')) {
        state.status = 'error';
        state.lastError = describeError(runtimeError, index === 0 ? 'full track' : `channel ${index}`);
        emit();
      }
    });
  });

  function emit() {
    onChange(getState());
  }

  function getState() {
    const runningSeconds =
      state.startedAt === null
        ? state.offsetSeconds
        : state.offsetSeconds + (now() - state.startedAt) / 1000;
    const durationSeconds = state.mode === 'full' ? state.activeTrack?.durationSeconds : null;
    const elapsedSeconds =
      typeof durationSeconds === 'number' && durationSeconds > 0
        ? Math.min(runningSeconds, durationSeconds)
        : runningSeconds;

    return {
      ...state,
      channels: state.channels.map((channel) => (channel ? { ...channel } : null)),
      elapsedSeconds,
    };
  }

  function describeError(error, where) {
    const detail = error instanceof Error ? error.message : String(error);
    return `The Strudel source failed during evaluation (${where}): ${detail}`;
  }

  async function stopEngines(list) {
    // Stopping must be safe even when an engine was never started.
    await Promise.allSettled(list.map((engine) => engine.stop()));
  }

  function audibleChannelIndexes() {
    return state.channels
      .map((channel, index) => ({ channel, index }))
      .filter(({ channel, index }) => {
        if (!channel || channel.muted) {
          return false;
        }
        return state.soloChannel === null || state.soloChannel === index;
      })
      .map(({ index }) => index);
  }

  async function playFull(track, { offsetSeconds = 0 } = {}) {
    // track: { id, title, code, bpm, durationTargetMinutes, durationSeconds? }
    if (!track || typeof track.code !== 'string') {
      state.status = 'error';
      state.lastError = MESSAGES.noMainScene;
      emit();
      return { ok: false, message: MESSAGES.noMainScene };
    }

    const myGeneration = ++generation;
    const durationSeconds =
      typeof track.durationSeconds === 'number' && track.durationSeconds > 0
        ? track.durationSeconds
        : typeof track.durationTargetMinutes === 'number' && track.durationTargetMinutes > 0
          ? track.durationTargetMinutes * 60
          : null;
    const requestedOffset = Number.isFinite(Number(offsetSeconds)) ? Math.max(0, Number(offsetSeconds)) : 0;
    const safeOffset =
      durationSeconds === null ? requestedOffset : Math.min(requestedOffset, Math.max(0, durationSeconds - 0.001));

    if (safeOffset > 0 && (typeof track.bpm !== 'number' || track.bpm <= 0)) {
      state.status = 'error';
      state.lastError = 'Seeking requires a valid BPM value.';
      emit();
      return { ok: false, message: state.lastError };
    }

    state.mode = 'full';
    state.status = 'loading';
    state.lastError = null;
    state.startedAt = null;
    state.offsetSeconds = safeOffset;
    state.activeTrack = {
      id: track.id,
      title: track.title,
      bpm: track.bpm ?? null,
      durationTargetMinutes: track.durationTargetMinutes ?? null,
      durationSeconds,
    };
    lastFullPayload = track;
    emit();

    try {
      // Rule: the full arrangement never runs on top of Layer Lab audio.
      await stopEngines(allEngines);
      await hooks.onSilence?.();
      await engines.full.setCode(buildSeekedCode(track.code, safeOffset, track.bpm));
      await hooks.onWake?.();
      await engines.full.evaluate();

      if (generation !== myGeneration) {
        return { ok: false, message: 'Superseded by a newer action.' };
      }

      state.status = 'playing';
      state.audioReady = true;
      state.startedAt = now();
      emit();
      return { ok: true };
    } catch (error) {
      if (generation === myGeneration) {
        state.status = 'error';
        state.lastError = describeError(error, 'full track');
        state.startedAt = null;
        emit();
      }
      return { ok: false, message: state.lastError };
    }
  }

  async function playLab() {
    const audible = audibleChannelIndexes();

    if (audible.length === 0) {
      return { ok: false, message: MESSAGES.emptySession };
    }

    const myGeneration = ++generation;
    state.mode = 'lab';
    state.status = 'loading';
    state.lastError = null;
    state.offsetSeconds = 0;
    emit();

    try {
      // Rebuild the whole session so channels start together on the shared
      // clock. This intentionally restarts the combination from the top.
      await stopEngines(allEngines);
      await hooks.onSilence?.();

      for (const index of audible) {
        const channel = state.channels[index];
        await engines.channels[index].setCode(channel.code);
      }
      await hooks.onWake?.();
      for (const index of audible) {
        await engines.channels[index].evaluate();
      }

      if (generation !== myGeneration) {
        return { ok: false, message: 'Superseded by a newer action.' };
      }

      state.status = 'playing';
      state.audioReady = true;
      state.startedAt = now();
      emit();
      return { ok: true };
    } catch (error) {
      if (generation === myGeneration) {
        state.status = 'error';
        state.lastError = describeError(error, 'layer session');
        state.startedAt = null;
        emit();
      }
      return { ok: false, message: state.lastError };
    }
  }

  async function stop() {
    generation += 1;
    await stopEngines(allEngines);
    // Stop means stop: the master output is killed too, so reverb and
    // delay tails do not ring past this point.
    await hooks.onSilence?.();
    state.status = state.status === 'idle' ? 'idle' : 'stopped';
    state.startedAt = null;
    state.offsetSeconds = 0;
    emit();
    return { ok: true };
  }

  async function restart() {
    if (state.mode === 'full') {
      if (!lastFullPayload) {
        return { ok: false, message: 'Nothing to restart yet.' };
      }
      return playFull(lastFullPayload, { offsetSeconds: 0 });
    }
    return playLab();
  }

  // Assign a standalone source to a free Layer Lab channel. Does not start audio.
  // source: { id, label, code, isMain?, trackTitle? }
  function assignLayer(source) {
    if (source.isMain) {
      return { ok: false, message: MESSAGES.mainInLab };
    }

    if (state.channels.some((channel) => channel && channel.sourceId === source.id)) {
      return { ok: false, message: MESSAGES.duplicateLayer };
    }

    const freeIndex = state.channels.findIndex((channel) => channel === null);

    if (freeIndex === -1) {
      return { ok: false, message: MESSAGES.channelsFull };
    }

    state.channels[freeIndex] = {
      sourceId: source.id,
      label: source.label,
      trackTitle: source.trackTitle ?? null,
      code: source.code,
      muted: false,
    };
    emit();
    return { ok: true, channelIndex: freeIndex };
  }

  // Audition path used by the UI: starting a standalone layer replaces any
  // running full-track playback instead of allowing audio to overlap.
  async function auditionLayer(source) {
    const replacesPlayback = state.mode === 'full' && (state.status === 'playing' || state.status === 'loading');

    const assigned = assignLayer(source);

    if (!assigned.ok && assigned.message !== MESSAGES.duplicateLayer) {
      return assigned;
    }

    state.mode = 'lab';
    const result = await playLab();

    if (replacesPlayback && result.ok) {
      return { ...result, message: MESSAGES.replacedPlayback };
    }

    return result;
  }

  async function removeLayer(channelIndex) {
    if (!state.channels[channelIndex]) {
      return { ok: true };
    }

    state.channels[channelIndex] = null;

    if (state.soloChannel === channelIndex) {
      state.soloChannel = null;
    }

    if (state.status === 'playing' || state.status === 'loading') {
      if (audibleChannelIndexes().length === 0) {
        return stop();
      }
      return playLab();
    }

    emit();
    return { ok: true };
  }

  async function toggleMute(channelIndex) {
    const channel = state.channels[channelIndex];

    if (!channel) {
      return { ok: false, message: 'This channel is empty.' };
    }

    channel.muted = !channel.muted;
    return applyMixChange();
  }

  async function toggleSolo(channelIndex) {
    if (!state.channels[channelIndex]) {
      return { ok: false, message: 'This channel is empty.' };
    }

    state.soloChannel = state.soloChannel === channelIndex ? null : channelIndex;
    return applyMixChange();
  }

  // The runtime cannot silently swap running patterns, so every mix change
  // rebuilds and restarts the session. This is documented, honest behavior.
  async function applyMixChange() {
    if (state.status === 'playing' || state.status === 'loading') {
      if (audibleChannelIndexes().length === 0) {
        return stop();
      }
      return playLab();
    }

    emit();
    return { ok: true };
  }

  async function setMode(mode) {
    if (mode !== 'full' && mode !== 'lab') {
      return { ok: false, message: `Unsupported mode: ${mode}` };
    }

    if (mode === state.mode) {
      return { ok: true };
    }

    const wasAudible = state.status === 'playing' || state.status === 'loading';

    if (wasAudible) {
      await stop();
    }

    state.mode = mode;
    emit();
    return { ok: true, message: wasAudible ? MESSAGES.modeSwitchStopped : undefined };
  }

  function clearError() {
    state.lastError = null;
    if (state.status === 'error') {
      state.status = state.startedAt === null ? 'stopped' : 'playing';
    }
    emit();
  }

  return {
    getState,
    playFull,
    playLab,
    stop,
    restart,
    setMode,
    assignLayer,
    auditionLayer,
    removeLayer,
    toggleMute,
    toggleSolo,
    clearError,
  };
}

// Transport and scene-selection behavior, run against fake engines.
// The Strudel runtime boundary (engines) is mocked; no audio is produced.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MESSAGES,
  buildSeekedCode,
  createEditorEngine,
  createTransport,
  formatClock,
  formatTargetDuration,
  getLayerScenes,
  getMainScene,
  isTextEntryTarget,
  secondsToCycles,
} from '../src/player.js';

// --- helpers -----------------------------------------------------------------

function fakeEngine(name, log, options = {}) {
  let updateCallback = null;

  return {
    name,
    code: null,
    async setCode(code) {
      this.code = code;
      log.push(`${name}:setCode`);
    },
    async evaluate() {
      log.push(`${name}:evaluate`);
      if (options.failEvaluate) {
        throw new Error('synthetic evaluation failure');
      }
    },
    async stop() {
      log.push(`${name}:stop`);
    },
    onUpdate(callback) {
      updateCallback = callback;
    },
    emitUpdate(update) {
      updateCallback?.(update);
    },
  };
}

function makeHarness(options = {}) {
  const log = [];
  let clockMs = 0;

  const engines = {
    full: fakeEngine('full', log, options.full),
    channels: [
      fakeEngine('ch0', log, options.ch0),
      fakeEngine('ch1', log, options.ch1),
      fakeEngine('ch2', log, options.ch2),
    ],
  };

  const transport = createTransport({
    engines,
    now: () => clockMs,
  });

  return {
    log,
    engines,
    transport,
    advance(ms) {
      clockMs += ms;
    },
  };
}

const fullTrack = {
  id: 'demo',
  title: 'Demo',
  code: 'full code',
  bpm: 120,
  durationTargetMinutes: 9.5,
  durationSeconds: 570,
};
const alternateFullTrack = {
  ...fullTrack,
  id: 'alternate',
  title: 'Alternate',
  code: 'alternate full code',
};
const layerA = { id: 'demo/anchor', label: 'Anchor', code: 'anchor code' };
const layerB = { id: 'demo/clave', label: 'Clave', code: 'clave code' };
const layerC = { id: 'demo/dust', label: 'Dust', code: 'dust code' };
const layerD = { id: 'demo/tremor', label: 'Tremor', code: 'tremor code' };

// --- scene classification -------------------------------------------------------

test('main scene is classified as the full arrangement, others as layers', () => {
  const piece = {
    scenes: [
      { id: 'main', code: 'a' },
      { id: 'anchor', code: 'b' },
      { id: 'clave', code: 'c' },
    ],
  };

  assert.equal(getMainScene(piece).id, 'main');
  assert.deepEqual(
    getLayerScenes(piece).map((scene) => scene.id),
    ['anchor', 'clave'],
  );

  const noMain = { scenes: [{ id: 'drone', code: 'd' }] };
  assert.equal(getMainScene(noMain), null);
});

// --- full-track playback -----------------------------------------------------------

test('Play Full Track loads main into the full engine and evaluates it', async () => {
  const { transport, engines, log } = makeHarness();

  const result = await transport.playFull(fullTrack);

  assert.equal(result.ok, true);
  assert.equal(engines.full.code, 'full code');
  assert.ok(log.includes('full:setCode'));
  assert.ok(log.includes('full:evaluate'));

  const state = transport.getState();
  assert.equal(state.status, 'playing');
  assert.equal(state.mode, 'full');
  assert.equal(state.activeTrack.id, 'demo');
  assert.equal(state.audioReady, true);
});

test('playing the full track stops any active Layer Lab session first', async () => {
  const { transport, log } = makeHarness();

  transport.assignLayer(layerA);
  await transport.playLab();
  log.length = 0;

  await transport.playFull(fullTrack);

  const stops = log.filter((entry) => entry.endsWith(':stop'));
  assert.ok(stops.includes('ch0:stop'), 'lab channel must be stopped');
  assert.ok(log.indexOf('ch0:stop') < log.indexOf('full:evaluate'), 'stop happens before evaluate');
  // The lab channels must not be re-evaluated alongside the full track.
  assert.ok(!log.includes('ch0:evaluate'));
});

test('playing another full track replaces the active full track', async () => {
  const { transport, engines, log } = makeHarness();

  await transport.playFull(fullTrack);
  log.length = 0;

  const result = await transport.playFull(alternateFullTrack);

  assert.equal(result.ok, true);
  assert.equal(engines.full.code, 'alternate full code');
  assert.ok(log.indexOf('full:stop') < log.indexOf('full:evaluate'), 'active track is stopped before replacement');
  assert.equal(transport.getState().activeTrack.id, 'alternate');
  assert.equal(transport.getState().status, 'playing');
});

test('a track without a main payload cannot start full playback', async () => {
  const { transport } = makeHarness();

  const result = await transport.playFull({ id: 'x', title: 'X', code: undefined });

  assert.equal(result.ok, false);
  assert.equal(result.message, MESSAGES.noMainScene);
  assert.equal(transport.getState().status, 'error');
});

test('full-track seeking restarts the pattern at the requested musical cycle', async () => {
  const { transport, engines, advance } = makeHarness();

  const result = await transport.playFull(fullTrack, { offsetSeconds: 120 });

  assert.equal(result.ok, true);
  assert.equal(engines.full.code, 'full code\n  .early(60)');
  assert.equal(Math.floor(transport.getState().elapsedSeconds), 120);

  advance(15000);
  assert.equal(Math.floor(transport.getState().elapsedSeconds), 135);
});

test('seeking is clamped before the end so a finite arrangement does not wrap', async () => {
  const { transport, engines } = makeHarness();

  await transport.playFull(fullTrack, { offsetSeconds: 999 });

  assert.match(engines.full.code, /\.early\(284\.9995\)$/);
  assert.ok(transport.getState().elapsedSeconds < 570);
});

// --- stop and restart ------------------------------------------------------------------

test('Stop halts playback, keeps the position and is safe to press repeatedly', async () => {
  const { transport, log, advance } = makeHarness();

  await transport.playFull(fullTrack);
  advance(5000);

  await transport.stop();
  const state = transport.getState();
  assert.equal(state.status, 'stopped');
  assert.equal(state.elapsedSeconds, 5);
  assert.equal(state.startedAt, null);

  // Pressing stop again must not throw and must keep the state stable.
  advance(3000);
  await transport.stop();
  await transport.stop();
  assert.equal(transport.getState().status, 'stopped');
  assert.equal(transport.getState().elapsedSeconds, 5, 'time standing still while stopped does not move the position');
  assert.ok(log.filter((entry) => entry === 'full:stop').length >= 3);
});

test('Stop silences the master output, so nothing rings on past the stop', async () => {
  let silenced = 0;
  const log = [];
  const transport = createTransport({
    engines: { full: fakeEngine('full', log), channels: [] },
    now: () => 0,
    hooks: { onSilence: () => { silenced += 1; } },
  });

  await transport.playFull(fullTrack);
  const before = silenced;
  await transport.stop();
  assert.equal(silenced, before + 1);
});

test('Play after Stop continues the same track at the kept position', async () => {
  const { transport, engines, advance } = makeHarness();

  await transport.playFull(fullTrack);
  advance(60000);
  await transport.stop();
  const kept = transport.getState().elapsedSeconds;
  assert.equal(kept, 60);

  // The Studio and the player pass the kept position as the offset.
  await transport.playFull(fullTrack, { offsetSeconds: kept });
  const state = transport.getState();
  assert.equal(state.status, 'playing');
  assert.equal(state.elapsedSeconds, 60);
  assert.notEqual(engines.full.code, fullTrack.code, 'the code is seeked to the kept position');
  advance(2000);
  assert.equal(transport.getState().elapsedSeconds, 62);
});

test('Back to start while stopped returns the position to zero without playing', async () => {
  const { transport, log, advance } = makeHarness();

  await transport.playFull(fullTrack);
  advance(42000);
  await transport.stop();
  log.length = 0;

  const result = await transport.reset();
  assert.equal(result.ok, true);
  assert.equal(transport.getState().status, 'stopped');
  assert.equal(transport.getState().elapsedSeconds, 0);
  assert.ok(!log.includes('full:evaluate'), 'back to start while stopped does not start playback');
});

test('Back to start while playing continues from the top', async () => {
  const { transport, log, advance } = makeHarness();

  await transport.playFull(fullTrack);
  advance(42000);
  log.length = 0;

  await transport.reset();
  assert.ok(log.indexOf('full:stop') < log.indexOf('full:evaluate'), 'the running track is stopped before it starts again');
  assert.equal(transport.getState().status, 'playing');
  assert.equal(transport.getState().elapsedSeconds, 0);
});

test('a stop at the end of a finite track keeps no position, so Play starts from the top', async () => {
  const { transport, advance } = makeHarness();

  await transport.playFull(fullTrack);
  advance((fullTrack.durationSeconds + 10) * 1000);
  await transport.stop();
  assert.equal(transport.getState().elapsedSeconds, 0);
});

test('a track without a BPM keeps no position, because resuming needs a seek', async () => {
  const { transport, advance } = makeHarness();
  const { bpm, ...withoutBpm } = fullTrack;

  await transport.playFull(withoutBpm);
  advance(30000);
  await transport.stop();
  assert.equal(transport.getState().elapsedSeconds, 0);
});

test('a Layer Lab stop keeps no position', async () => {
  const { transport, advance } = makeHarness();

  transport.assignLayer(layerA);
  await transport.playLab();
  advance(30000);
  await transport.stop();
  assert.equal(transport.getState().elapsedSeconds, 0);
});

test('switching modes drops the kept position of the full track', async () => {
  const { transport, advance } = makeHarness();

  await transport.playFull(fullTrack);
  advance(30000);
  await transport.setMode('lab');
  await transport.setMode('full');
  assert.equal(transport.getState().elapsedSeconds, 0);
});

test('Restart re-evaluates the active full track and resets elapsed time', async () => {
  const { transport, log, advance } = makeHarness();

  await transport.playFull(fullTrack);
  advance(60000);
  assert.ok(transport.getState().elapsedSeconds >= 60);

  log.length = 0;
  const result = await transport.restart();

  assert.equal(result.ok, true);
  assert.ok(log.indexOf('full:stop') < log.indexOf('full:evaluate'), 'restart stops before re-evaluating');
  assert.equal(transport.getState().elapsedSeconds, 0);
  assert.equal(transport.getState().status, 'playing');
});

test('Restart in Layer Lab rebuilds the session', async () => {
  const { transport, log } = makeHarness();

  transport.assignLayer(layerA);
  transport.assignLayer(layerB);
  await transport.playLab();
  log.length = 0;

  await transport.restart();

  assert.ok(log.includes('ch0:evaluate'));
  assert.ok(log.includes('ch1:evaluate'));
});

// --- layer assignment rules ---------------------------------------------------------------

test('the same layer cannot be assigned twice', () => {
  const { transport } = makeHarness();

  assert.equal(transport.assignLayer(layerA).ok, true);
  const second = transport.assignLayer(layerA);

  assert.equal(second.ok, false);
  assert.equal(second.message, MESSAGES.duplicateLayer);
});

test('main cannot be combined with standalone layers', () => {
  const { transport } = makeHarness();

  const result = transport.assignLayer({ id: 'demo/main', label: 'Main', code: 'x', isMain: true });

  assert.equal(result.ok, false);
  assert.equal(result.message, MESSAGES.mainInLab);
});

test('assignment fails with a clear message when all channels are in use', () => {
  const { transport } = makeHarness();

  transport.assignLayer(layerA);
  transport.assignLayer(layerB);
  transport.assignLayer(layerC);
  const overflow = transport.assignLayer(layerD);

  assert.equal(overflow.ok, false);
  assert.equal(overflow.message, MESSAGES.channelsFull);
});

test('auditioning a layer while the full track plays replaces playback', async () => {
  const { transport, log } = makeHarness();

  await transport.playFull(fullTrack);
  log.length = 0;

  const result = await transport.auditionLayer(layerA);

  assert.equal(result.ok, true);
  assert.equal(result.message, MESSAGES.replacedPlayback);
  assert.ok(log.indexOf('full:stop') < log.indexOf('ch0:evaluate'), 'full track is stopped before the layer starts');
  assert.ok(!log.includes('full:evaluate'), 'full track is not re-evaluated');

  const state = transport.getState();
  assert.equal(state.mode, 'lab');
  assert.equal(state.status, 'playing');
  assert.equal(state.channels.filter(Boolean).length, 1);
  assert.equal(state.channels[0].sourceId, 'demo/anchor');
});

test('playing an empty Layer Lab session is rejected with guidance', async () => {
  const { transport } = makeHarness();

  await transport.setMode('lab');
  const result = await transport.playLab();

  assert.equal(result.ok, false);
  assert.equal(result.message, MESSAGES.emptySession);
});

// --- mode switching --------------------------------------------------------------------------

test('switching modes stops playback and reports it', async () => {
  const { transport, log } = makeHarness();

  await transport.playFull(fullTrack);
  log.length = 0;

  const result = await transport.setMode('lab');

  assert.equal(result.ok, true);
  assert.equal(result.message, MESSAGES.modeSwitchStopped);
  assert.ok(log.includes('full:stop'));
  assert.equal(transport.getState().status, 'stopped');
  assert.equal(transport.getState().mode, 'lab');
});

test('switching to the current mode is a no-op', async () => {
  const { transport, log } = makeHarness();

  await transport.playFull(fullTrack);
  log.length = 0;

  const result = await transport.setMode('full');

  assert.equal(result.ok, true);
  assert.equal(result.message, undefined);
  assert.deepEqual(log, []);
  assert.equal(transport.getState().status, 'playing');
});

// --- mute and solo ------------------------------------------------------------------------------

test('mute removes a channel from the rebuilt session and unmute restores it', async () => {
  const { transport, log } = makeHarness();

  transport.assignLayer(layerA);
  transport.assignLayer(layerB);
  await transport.playLab();

  log.length = 0;
  await transport.toggleMute(1);

  assert.ok(log.includes('ch0:evaluate'), 'unmuted channel keeps playing after rebuild');
  assert.ok(!log.includes('ch1:evaluate'), 'muted channel is not evaluated');

  log.length = 0;
  await transport.toggleMute(1);
  assert.ok(log.includes('ch1:evaluate'), 'unmuting restores the channel');
});

test('solo silences the other channels and unsolo restores the previous mix', async () => {
  const { transport, log } = makeHarness();

  transport.assignLayer(layerA);
  transport.assignLayer(layerB);
  await transport.playLab();

  log.length = 0;
  await transport.toggleSolo(0);
  assert.ok(log.includes('ch0:evaluate'));
  assert.ok(!log.includes('ch1:evaluate'));

  log.length = 0;
  await transport.toggleSolo(0);
  assert.ok(log.includes('ch0:evaluate'));
  assert.ok(log.includes('ch1:evaluate'), 'previous configuration is restored');
});

test('muting the last audible channel stops the session instead of playing silence', async () => {
  const { transport } = makeHarness();

  transport.assignLayer(layerA);
  await transport.playLab();

  await transport.toggleMute(0);

  assert.equal(transport.getState().status, 'stopped');
});

test('removing the last layer of a playing session stops playback', async () => {
  const { transport } = makeHarness();

  transport.assignLayer(layerA);
  await transport.playLab();

  await transport.removeLayer(0);

  const state = transport.getState();
  assert.equal(state.status, 'stopped');
  assert.equal(state.channels[0], null);
});

// --- error handling ----------------------------------------------------------------------------

test('an evaluation failure produces a visible error state', async () => {
  const { transport } = makeHarness({ full: { failEvaluate: true } });

  const result = await transport.playFull(fullTrack);

  assert.equal(result.ok, false);
  const state = transport.getState();
  assert.equal(state.status, 'error');
  assert.match(state.lastError, /synthetic evaluation failure/);
  assert.equal(state.elapsedSeconds, 0);
});

// StrudelMirror does not reject when the code fails to evaluate: evaluate()
// resolves, and the error arrives in an "update" event while the transport
// is still loading. That must count as a failure, never as playback.
test('an evaluation error reported through the update event is a failure, not playback', async () => {
  const { transport, engines } = makeHarness();
  engines.full.evaluate = async function evaluate() {
    this.emitUpdate({ evalError: new Error('Unexpected token (1:22)'), pending: false });
  };

  const result = await transport.playFull(fullTrack);

  assert.equal(result.ok, false);
  assert.match(result.message, /Unexpected token \(1:22\)/);
  const state = transport.getState();
  assert.equal(state.status, 'error');
  assert.equal(state.startedAt, null);
});

// StrudelMirror sends its whole state with every update, so an evaluation
// error stays in later updates (setCode, pending) until the next successful
// evaluation. A stale error must not fail the next playback.
test('an error left over from an earlier evaluation does not fail the next playback', async () => {
  const { transport, engines } = makeHarness();
  const earlier = new Error('Unexpected token (1:22)');
  const replState = { evalError: undefined };
  engines.full.setCode = async function setCode(code) {
    this.code = code;
    this.emitUpdate({ ...replState, code });
  };
  engines.full.evaluate = async function evaluate() {
    this.emitUpdate({ ...replState, pending: true });
    replState.evalError = this.code.includes('broken') ? earlier : undefined;
    this.emitUpdate({ ...replState, pending: false });
  };

  const failed = await transport.playFull({ ...fullTrack, code: 'broken draft' });
  assert.equal(failed.ok, false);

  const played = await transport.playFull(fullTrack);
  assert.equal(played.ok, true, played.message);
  assert.equal(transport.getState().status, 'playing');
});

test('the editor engine rejects when StrudelMirror keeps an evaluation error in its state', async () => {
  const mirror = {
    repl: { state: { evalError: undefined } },
    setCode() {},
    async evaluate() {
      // What StrudelMirror 1.3.0 does: catch, record, resolve.
      this.repl.state.evalError = new SyntaxError('Unexpected token (1:22)');
    },
    async stop() {},
  };
  const engine = createEditorEngine({ editor: mirror, addEventListener() {} });

  await assert.rejects(engine.evaluate(), /Unexpected token \(1:22\)/);

  mirror.evaluate = async function evaluate() {
    this.repl.state.evalError = undefined;
  };
  await engine.evaluate();
});

test('a scheduler error reported by the runtime surfaces while playing', async () => {
  const { transport, engines } = makeHarness();

  await transport.playFull(fullTrack);
  engines.full.emitUpdate({ schedulerError: new Error('runtime exploded') });

  const state = transport.getState();
  assert.equal(state.status, 'error');
  assert.match(state.lastError, /runtime exploded/);
});

test('dismissing an error returns to a stable state', async () => {
  const { transport } = makeHarness({ full: { failEvaluate: true } });

  await transport.playFull(fullTrack);
  transport.clearError();

  const state = transport.getState();
  assert.equal(state.lastError, null);
  assert.notEqual(state.status, 'error');
});

// --- elapsed clock -------------------------------------------------------------------------------

test('the elapsed timer starts on play, holds on stop and returns to zero on back to start', async () => {
  const { transport, advance } = makeHarness();

  assert.equal(transport.getState().elapsedSeconds, 0);

  await transport.playFull(fullTrack);
  advance(194000);
  assert.equal(Math.floor(transport.getState().elapsedSeconds), 194);

  await transport.stop();
  advance(10000);
  assert.equal(Math.floor(transport.getState().elapsedSeconds), 194);

  await transport.reset();
  assert.equal(transport.getState().elapsedSeconds, 0);
});

test('clock formatting matches the transport display format', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(194), '3:14');
  assert.equal(formatClock(3601), '60:01');
  assert.equal(formatTargetDuration(9.5), '~9:30');
  assert.equal(formatTargetDuration(null), null);
  assert.equal(formatTargetDuration(0), null);
});

test('seek helpers convert wall-clock position into Strudel cycles', () => {
  assert.equal(secondsToCycles(120, 120), 60);
  assert.equal(secondsToCycles(100, 144), 60);
  assert.equal(secondsToCycles(-10, 120), 0);
  assert.equal(buildSeekedCode('stack(a, b);', 100, 144), 'stack(a, b)\n  .early(60)');
  assert.equal(buildSeekedCode('stack(a, b)', 0, 144), 'stack(a, b)');
});

// --- keyboard guard --------------------------------------------------------------------------------

test('keyboard shortcuts ignore text-editing contexts', () => {
  assert.equal(isTextEntryTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTextEntryTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTextEntryTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTextEntryTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(
    isTextEntryTarget({ tagName: 'SPAN', closest: (selector) => (selector.includes('.cm-editor') ? {} : null) }),
    true,
  );
  assert.equal(isTextEntryTarget({ tagName: 'BUTTON', closest: () => null }), false);
  assert.equal(isTextEntryTarget(null), false);
});

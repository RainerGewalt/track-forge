// The engine wrapper around <strudel-editor>: the first evaluate waits for
// Strudel's audio initialisation (AudioWorklet effects), bounded so playback
// never hangs on it. Each test imports its own copy of src/player.js,
// because the initialisation is shared module state by design, and runs
// with mocked timers, so the three-second bound is stepped, not waited for.

import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';

let copy = 0;

async function freshPlayerModule() {
  copy += 1;
  return import(`../src/player.js?copy=${copy}`);
}

function fakeEditor(calls) {
  return {
    editor: {
      setCode: (code) => calls.push(`setCode ${code}`),
      evaluate: async () => calls.push('evaluate'),
      stop: async () => calls.push('stop'),
    },
    addEventListener() {},
  };
}

afterEach(() => {
  delete globalThis.initAudio;
  mock.timers.reset();
});

test('the first evaluate waits until Strudel has finished its audio initialisation', async () => {
  const { createEditorEngine } = await freshPlayerModule();
  const calls = [];
  let finishInit;
  globalThis.initAudio = () => {
    calls.push('initAudio');
    return new Promise((resolve) => {
      finishInit = resolve;
    });
  };
  mock.timers.enable({ apis: ['setTimeout'] });

  const engine = createEditorEngine(fakeEditor(calls));
  const evaluating = engine.evaluate();
  // One full event-loop turn runs every pending promise job.
  await nextTurn();
  assert.deepEqual(calls, ['initAudio'], 'evaluate must not start while the initialisation is pending');

  finishInit();
  await evaluating;
  assert.deepEqual(calls, ['initAudio', 'evaluate']);
});

test('the audio initialisation runs once for every engine and every later evaluate', async () => {
  const { createEditorEngine } = await freshPlayerModule();
  const calls = [];
  globalThis.initAudio = async () => calls.push('initAudio');
  mock.timers.enable({ apis: ['setTimeout'] });

  const first = createEditorEngine(fakeEditor(calls));
  const second = createEditorEngine(fakeEditor(calls));
  await first.evaluate();
  await second.evaluate();
  await first.evaluate();

  assert.deepEqual(calls, ['initAudio', 'evaluate', 'evaluate', 'evaluate']);
});

test('a hanging audio initialisation delays the first evaluate by at most three seconds', async () => {
  const { createEditorEngine } = await freshPlayerModule();
  const calls = [];
  globalThis.initAudio = () => {
    calls.push('initAudio');
    return new Promise(() => {});
  };
  mock.timers.enable({ apis: ['setTimeout'] });

  const evaluating = createEditorEngine(fakeEditor(calls)).evaluate();
  await nextTurn();
  mock.timers.tick(2999);
  await nextTurn();
  assert.deepEqual(calls, ['initAudio'], 'still waiting just before the bound');

  mock.timers.tick(1);
  await evaluating;
  assert.deepEqual(calls, ['initAudio', 'evaluate']);
});

test('a failing audio initialisation does not block playback', async () => {
  const { createEditorEngine } = await freshPlayerModule();
  const calls = [];
  globalThis.initAudio = async () => {
    calls.push('initAudio');
    throw new Error('no audio device');
  };
  mock.timers.enable({ apis: ['setTimeout'] });

  await createEditorEngine(fakeEditor(calls)).evaluate();
  assert.deepEqual(calls, ['initAudio', 'evaluate']);
});

test('without Strudel loaded the engine evaluates directly', async () => {
  const { createEditorEngine } = await freshPlayerModule();
  const calls = [];

  await createEditorEngine(fakeEditor(calls)).evaluate();
  assert.deepEqual(calls, ['evaluate']);
});

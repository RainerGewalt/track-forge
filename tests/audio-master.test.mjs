// The audio master in src/audioMaster.js, against a minimal stand-in for the
// Web Audio node graph. Superdough renders reverb impulse responses in an
// OfflineAudioContext while the music plays in the realtime context; the
// master of the realtime context must stay the one the music flows through.
// Each test imports its own copy of the module, because the patch of
// AudioNode.prototype.connect is module state by design.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

const saved = {};
const GLOBALS = ['AudioNode', 'AudioDestinationNode', 'GainNode', 'AnalyserNode', 'AudioContext', 'OfflineAudioContext'];

class FakeParam {
  constructor(value) {
    this.value = value;
    this.events = [];
  }
  cancelScheduledValues(time) {
    this.events.push(['cancel', time]);
  }
  setTargetAtTime(value, time, constant) {
    this.events.push(['target', value, time, constant]);
  }
  setValueAtTime(value, time) {
    this.events.push(['set', value, time]);
  }
  // The value the parameter holds once every scheduled event has run.
  finalValue() {
    let value = this.value;
    for (const event of this.events) {
      if (event[0] === 'target' || event[0] === 'set') value = event[1];
    }
    return value;
  }
}

function installFakeWebAudio() {
  class AudioNode {
    constructor(context) {
      this.context = context;
      this.outputs = [];
    }
    connect(target) {
      this.outputs.push(target);
      return target;
    }
  }
  class AudioDestinationNode extends AudioNode {}
  class GainNode extends AudioNode {
    constructor(context, { gain = 1 } = {}) {
      super(context);
      this.gain = new FakeParam(gain);
    }
  }
  class AnalyserNode extends AudioNode {}
  class BaseContext {
    constructor() {
      this.currentTime = 10;
      this.destination = new AudioDestinationNode(this);
    }
  }
  class AudioContext extends BaseContext {}
  class OfflineAudioContext extends BaseContext {}

  Object.assign(globalThis, { AudioNode, AudioDestinationNode, GainNode, AnalyserNode, AudioContext, OfflineAudioContext });
}

beforeEach(() => {
  for (const name of GLOBALS) saved[name] = globalThis[name];
  installFakeWebAudio();
});

afterEach(() => {
  for (const name of GLOBALS) {
    if (saved[name] === undefined) delete globalThis[name];
    else globalThis[name] = saved[name];
  }
});

let copy = 0;

async function freshAudioMaster() {
  copy += 1;
  return import(`../src/audioMaster.js?copy=${copy}`);
}

// The node the music reaches: follows the graph from a source to the
// realtime destination and returns the gain nodes on the way.
function gainsOnPath(node, destination, seen = new Set()) {
  if (node === destination) return [];
  if (seen.has(node)) return null;
  seen.add(node);
  for (const output of node.outputs) {
    const rest = gainsOnPath(output, destination, seen);
    if (rest) return node instanceof GainNode ? [node, ...rest] : rest;
  }
  return null;
}

test('an offline reverb render does not take the master away from the music', async () => {
  const master = await freshAudioMaster();
  master.installAudioMaster();
  const realtime = new AudioContext();
  const offline = new OfflineAudioContext();

  const music = new AudioNode(realtime);
  music.connect(realtime.destination);
  const analyser = master.getMasterAnalyser();

  // Superdough's reverbGen: filter.connect(offlineContext.destination).
  const reverbFilter = new AudioNode(offline);
  reverbFilter.connect(offline.destination);
  assert.deepEqual(reverbFilter.outputs, [offline.destination], 'the offline render reaches its own destination directly');

  // A later realtime connection, as superdough makes for every scheduled note.
  const later = new AudioNode(realtime);
  later.connect(realtime.destination);

  assert.equal(master.getMasterAnalyser(), analyser, 'the spectrum still reads the master the music flows through');
  const [musicGain] = gainsOnPath(music, realtime.destination);
  const [laterGain] = gainsOnPath(later, realtime.destination);
  assert.equal(laterGain, musicGain, 'every realtime source shares one master gain');

  master.killAudio();
  assert.equal(musicGain.gain.finalValue(), 0, 'Stop silences the master the music flows through');
});

test('Stop reaches exact silence 100 ms after it starts its fade, and play reopens the master', async () => {
  const master = await freshAudioMaster();
  master.installAudioMaster();
  const realtime = new AudioContext();
  const music = new AudioNode(realtime);
  music.connect(realtime.destination);
  const [musicGain] = gainsOnPath(music, realtime.destination);

  master.killAudio();
  const silence = musicGain.gain.events.find((event) => event[0] === 'set');
  assert.deepEqual(silence, ['set', 0, realtime.currentTime + 0.1]);

  master.openAudio();
  assert.equal(musicGain.gain.finalValue(), 1);
});

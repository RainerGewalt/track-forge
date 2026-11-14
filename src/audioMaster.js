// Master audio control for both pages.
//
// Superdough does not export its output chain, so every connection into the
// destination of a realtime AudioContext is rerouted through a master gain
// we own, with an analyser tapped after it. This gives two capabilities:
//
//   - killAudio(): a ~20 ms fade that reaches silence after 100 ms and
//     silences EVERYTHING, including reverb and delay tails and notes that
//     were already scheduled ("stop means stop"),
//   - a post-master analyser for the live frequency monitor.
//
// There is one master per realtime context. Connections into the
// destination of an OfflineAudioContext pass through unchanged: superdough
// renders reverb impulse responses offline while the music plays, and those
// renders must not replace the master the music flows through.
//
// The patch is page-local and adds one gain node to the chain.

let installed = false;
const masters = new WeakMap(); // realtime context -> { context, gain, analyser }
let active = null; // the master of the most recent realtime context

const FADE_TIME_CONSTANT = 0.02;
const SILENT_AFTER = 0.1;

function isOfflineContext(context) {
  return typeof OfflineAudioContext !== 'undefined' && context instanceof OfflineAudioContext;
}

function ensureMaster(context) {
  let master = masters.get(context);

  if (!master) {
    const gain = new GainNode(context, { gain: 1 });
    const analyser = new AnalyserNode(context, {
      fftSize: 4096,
      smoothingTimeConstant: 0.82,
    });

    gain.connect(analyser);
    master = { context, gain, analyser };
    masters.set(context, master);
  }

  active = master;
  return master;
}

export function installAudioMaster() {
  if (installed) {
    return;
  }
  installed = true;

  const originalConnect = AudioNode.prototype.connect;

  AudioNode.prototype.connect = function connectViaMaster(target, ...rest) {
    if (target instanceof AudioDestinationNode && !isOfflineContext(target.context)) {
      const master = ensureMaster(target.context);

      if (this === master.gain) {
        return originalConnect.call(this, target, ...rest);
      }

      // Reroute: source -> master gain (-> analyser) -> destination.
      originalConnect.call(master.gain, target);
      return originalConnect.call(this, master.gain);
    }

    return originalConnect.call(this, target, ...rest);
  };
}

export function killAudio() {
  if (!active) {
    return;
  }

  const now = active.context.currentTime;
  const gain = active.gain.gain;
  gain.cancelScheduledValues(now);
  gain.setTargetAtTime(0, now, FADE_TIME_CONSTANT);
  // The exponential fade never reaches zero by itself; after five time
  // constants it is below -43 dB, and from here on the output is silent.
  gain.setValueAtTime(0, now + SILENT_AFTER);
}

export function openAudio() {
  if (!active) {
    return;
  }

  const now = active.context.currentTime;
  active.gain.gain.cancelScheduledValues(now);
  active.gain.gain.setTargetAtTime(1, now, 0.01);
}

export function getMasterAnalyser() {
  return active?.analyser ?? null;
}

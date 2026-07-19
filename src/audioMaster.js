// Master audio control for both pages.
//
// Superdough does not export its output chain, so the first connection into
// an AudioDestinationNode is rerouted through a master gain we own, with an
// analyser tapped after it. This gives two capabilities:
//
//   - killAudio(): a ~20 ms fade to zero that silences EVERYTHING —
//     including reverb and delay tails ("stop means stop"),
//   - a post-master analyser for the live frequency monitor.
//
// The patch is page-local and adds one gain node to the chain.

let installed = false;
let active = null; // { context, gain, analyser }

function ensureMaster(context) {
  if (active && active.context === context) {
    return active;
  }

  const gain = new GainNode(context, { gain: 1 });
  const analyser = new AnalyserNode(context, {
    fftSize: 4096,
    smoothingTimeConstant: 0.82,
  });

  gain.connect(analyser);
  active = { context, gain, analyser };
  return active;
}

export function installAudioMaster() {
  if (installed) {
    return;
  }
  installed = true;

  const originalConnect = AudioNode.prototype.connect;

  AudioNode.prototype.connect = function connectViaMaster(target, ...rest) {
    if (target instanceof AudioDestinationNode) {
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
  active.gain.gain.cancelScheduledValues(now);
  active.gain.gain.setTargetAtTime(0, now, 0.02);
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

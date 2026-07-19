// Live audio monitor for the player page.
//
// The spectrum reads the shared post-master analyser from audioMaster.js,
// so it shows exactly what reaches the speakers — including the master
// kill fade when playback stops.

import { installAudioMaster, getMasterAnalyser } from '../audioMaster.js';

export function installDestinationTap() {
  installAudioMaster();
}

// --------------------------------------------------------------------------
// Spectrum rendering: log-frequency bars from 30 Hz to 16 kHz.
// --------------------------------------------------------------------------

const BAND_COUNT = 56;
const MIN_HZ = 30;
const MAX_HZ = 16000;
const FREQ_LABELS = [
  [60, '60'],
  [250, '250'],
  [1000, '1k'],
  [4000, '4k'],
  [12000, '12k'],
];

function bandEdges(sampleRate, binCount) {
  const edges = [];
  const logMin = Math.log(MIN_HZ);
  const logMax = Math.log(Math.min(MAX_HZ, sampleRate / 2));

  for (let i = 0; i <= BAND_COUNT; i += 1) {
    const hz = Math.exp(logMin + ((logMax - logMin) * i) / BAND_COUNT);
    edges.push(Math.min(binCount - 1, Math.round((hz / (sampleRate / 2)) * binCount)));
  }

  return edges;
}

export function createSpectrumView(canvas) {
  const ctx2d = canvas.getContext('2d');
  let raf = null;
  let bins = null;
  let edges = null;
  let peakHold = new Float32Array(BAND_COUNT);

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const box = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(box.width * ratio));
    canvas.height = Math.max(1, Math.round(box.height * ratio));
  }

  function drawIdle() {
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);
    drawLabels();
  }

  function drawLabels() {
    const { width, height } = canvas;
    const ratio = window.devicePixelRatio || 1;
    ctx2d.font = `${10 * ratio}px system-ui, sans-serif`;
    ctx2d.fillStyle = 'rgba(214, 202, 178, .45)';
    ctx2d.textAlign = 'center';

    const logMin = Math.log(MIN_HZ);
    const logMax = Math.log(MAX_HZ);

    for (const [hz, label] of FREQ_LABELS) {
      const x = ((Math.log(hz) - logMin) / (logMax - logMin)) * width;
      ctx2d.fillText(label, x, height - 4 * ratio);
    }
  }

  function frame() {
    raf = requestAnimationFrame(frame);

    const analyser = getMasterAnalyser();

    if (!analyser) {
      drawIdle();
      return;
    }
    const binCount = analyser.frequencyBinCount;

    if (!bins || bins.length !== binCount) {
      bins = new Uint8Array(binCount);
      edges = bandEdges(analyser.context.sampleRate, binCount);
    }

    analyser.getByteFrequencyData(bins);

    const { width, height } = canvas;
    const ratio = window.devicePixelRatio || 1;
    const labelSpace = 16 * ratio;
    const plotHeight = height - labelSpace;
    const barWidth = width / BAND_COUNT;

    ctx2d.clearRect(0, 0, width, height);

    for (let band = 0; band < BAND_COUNT; band += 1) {
      let sum = 0;
      let count = 0;

      for (let bin = edges[band]; bin <= edges[band + 1]; bin += 1) {
        sum += bins[bin];
        count += 1;
      }

      const value = count > 0 ? sum / count / 255 : 0;
      peakHold[band] = Math.max(value, peakHold[band] * 0.96);

      const barHeight = value * plotHeight;
      const x = band * barWidth;

      // Ember gradient: deep soil red at the bottom, dry gold at the top.
      const hue = 18 + value * 26;
      ctx2d.fillStyle = `hsl(${hue} 68% ${28 + value * 30}%)`;
      ctx2d.fillRect(x + 1, plotHeight - barHeight, Math.max(1, barWidth - 2), barHeight);

      const peakY = plotHeight - peakHold[band] * plotHeight;
      ctx2d.fillStyle = 'rgba(224, 196, 148, .8)';
      ctx2d.fillRect(x + 1, peakY, Math.max(1, barWidth - 2), 1.5 * ratio);
    }

    drawLabels();
  }

  function start() {
    resize();
    if (raf === null) {
      frame();
    }
  }

  function stop() {
    if (raf !== null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
    peakHold = new Float32Array(BAND_COUNT);
    drawIdle();
  }

  window.addEventListener('resize', resize);
  resize();
  drawIdle();

  return { start, stop };
}

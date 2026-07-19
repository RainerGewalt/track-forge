// Generate per-piece timeline previews: the actual note and sample events
// of every arrangement lane, extracted by evaluating main.strudel offline
// and querying the pattern over the full form.
//
// Lanes are grouped by audio orbit — each sound family in this project owns
// one orbit — and labeled with the piece's timeline layer names when the
// counts line up (falling back to the dominant sound name).
//
// Lane kinds follow the DAW metaphor:
//   - "notes": programmed pitched events → piano-roll blocks,
//   - "audio": recorded one-shots → a waveform, composed by stamping each
//     event with the peak envelope of its actual WAV file from the local
//     sample library (synthetic percussion falls back to a short decay).
//
// Output: public/timeline-previews/<piece-id>.json
//
//   { bars, stepsPerBar, durationSeconds, lanes: [
//       { label, kind, sounds, pitchRange, events, wave? } ] }
//   events: [startStep, durationSteps, midiPitch|-1, velocity0to9]
//   wave:   WAVE_BINS amplitudes 0..9 across the whole track
//
// Usage: node --experimental-loader ./scripts/timeline/stub-loader.mjs \
//          scripts/timeline/generate.mjs [piece-id ...]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const piecesDir = path.join(projectRoot, 'src', 'pieces');
const outputDir = path.join(projectRoot, 'public', 'timeline-previews');
const sampleAudioDir = path.join(projectRoot, 'public', 'samples', 'library', 'audio');

const core = await import(path.join(projectRoot, 'node_modules/@strudel/core/dist/index.mjs'));
const mini = await import(path.join(projectRoot, 'node_modules/@strudel/mini/dist/index.mjs'));
const tonal = await import(path.join(projectRoot, 'node_modules/@strudel/tonal/dist/index.mjs'));
const { transpiler } = await import(
  path.join(projectRoot, 'node_modules/@strudel/transpiler/dist/index.mjs')
);

const scope = { ...core, ...mini, ...tonal, setcpm: () => {}, samples: () => {} };

const STEPS_PER_BAR = 16;
const WAVE_BINS = 1024;
const ENVELOPE_POINTS = 24;
const NOTE_NAMES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

let sampleMap = {};
try {
  sampleMap = JSON.parse(
    await fs.readFile(
      path.join(projectRoot, 'public', 'samples', 'library', 'strudel-samples.json'),
      'utf8',
    ),
  );
} catch {
  console.warn('! no strudel sample map found; waveforms use synthetic envelopes only');
}

function noteToMidi(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const midi = Math.round(value + 48); // strudel note numbers center on c3 = 48
    return midi >= 0 && midi <= 127 ? midi : -1;
  }

  if (typeof value !== 'string') {
    return -1;
  }

  const match = /^([a-gA-G])([#bs]*)(-?\d+)$/.exec(value.trim());
  if (!match) {
    return -1;
  }

  let semis = NOTE_NAMES[match[1].toLowerCase()];
  for (const accidental of match[2]) {
    if (accidental === '#' || accidental === 's') semis += 1;
    if (accidental === 'b') semis -= 1;
  }

  const midi = (Number(match[3]) + 1) * 12 + semis;
  return midi >= 0 && midi <= 127 ? midi : -1;
}

// --------------------------------------------------------------------------
// WAV peak envelopes
// --------------------------------------------------------------------------

const SYNTHETIC_ENVELOPE = {
  durationSeconds: 0.12,
  peaks: Array.from({ length: ENVELOPE_POINTS }, (_, i) => Math.exp(-i / 4)),
};

const envelopeCache = new Map();

async function wavEnvelope(relativeFile) {
  if (envelopeCache.has(relativeFile)) {
    return envelopeCache.get(relativeFile);
  }

  let result = SYNTHETIC_ENVELOPE;

  try {
    const buffer = await fs.readFile(path.join(sampleAudioDir, relativeFile));

    if (buffer.subarray(0, 4).toString() === 'RIFF') {
      let offset = 12;
      let fmt = null;
      let dataOffset = 0;
      let dataLength = 0;

      while (offset + 8 <= buffer.length) {
        const chunkId = buffer.subarray(offset, offset + 4).toString();
        const chunkSize = buffer.readUInt32LE(offset + 4);

        if (chunkId === 'fmt ') {
          fmt = {
            audioFormat: buffer.readUInt16LE(offset + 8),
            channels: buffer.readUInt16LE(offset + 10),
            sampleRate: buffer.readUInt32LE(offset + 12),
            bits: buffer.readUInt16LE(offset + 22),
          };
        } else if (chunkId === 'data') {
          dataOffset = offset + 8;
          dataLength = chunkSize;
        }

        offset += 8 + chunkSize + (chunkSize % 2);
      }

      if (fmt && dataLength > 0 && fmt.audioFormat === 1 && (fmt.bits === 16 || fmt.bits === 24)) {
        const bytesPerSample = fmt.bits / 8;
        const frameBytes = bytesPerSample * fmt.channels;
        const frames = Math.floor(dataLength / frameBytes);
        const durationSeconds = frames / fmt.sampleRate;
        const peaks = new Array(ENVELOPE_POINTS).fill(0);
        const full = fmt.bits === 16 ? 32768 : 8388608;
        const stride = Math.max(1, Math.floor(frames / 2000));

        for (let frame = 0; frame < frames; frame += stride) {
          const at = dataOffset + frame * frameBytes;
          const value =
            fmt.bits === 16 ? Math.abs(buffer.readInt16LE(at)) : Math.abs(buffer.readIntLE(at, 3));
          const bucket = Math.min(ENVELOPE_POINTS - 1, Math.floor((frame / frames) * ENVELOPE_POINTS));
          peaks[bucket] = Math.max(peaks[bucket], value / full);
        }

        const top = Math.max(...peaks, 0.001);
        result = { durationSeconds, peaks: peaks.map((p) => p / top) };
      }
    }
  } catch {
    // Missing or non-WAV file: keep the synthetic envelope.
  }

  envelopeCache.set(relativeFile, result);
  return result;
}

function resolveSampleFile(soundName, n, noteValue) {
  const entry = sampleMap[soundName];

  if (!entry) {
    return null;
  }

  if (Array.isArray(entry)) {
    const index = Number.isFinite(Number(n)) ? Math.abs(Math.round(Number(n))) : 0;
    return entry[index % entry.length];
  }

  // Pitched map: nearest key to the requested note.
  const targetMidi = noteToMidi(noteValue);
  let best = null;
  let bestDistance = Infinity;

  for (const [key, file] of Object.entries(entry)) {
    const keyMidi = noteToMidi(key);
    const distance = targetMidi >= 0 && keyMidi >= 0 ? Math.abs(keyMidi - targetMidi) : 0;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = file;
    }
  }

  return best;
}

// --------------------------------------------------------------------------
// Piece generation
// --------------------------------------------------------------------------

async function evaluatePattern(source) {
  const { output } = transpiler(source, { wrapAsync: false, addReturn: true });
  const keys = Object.keys(scope);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction(...keys, output);
  return run(...keys.map((key) => scope[key]));
}

async function generateForPiece(pieceId) {
  const dir = path.join(piecesDir, pieceId);
  const metadata = JSON.parse(await fs.readFile(path.join(dir, 'piece.json'), 'utf8'));
  const source = await fs.readFile(path.join(dir, 'main.strudel'), 'utf8');

  const durationSeconds =
    metadata.timeline?.durationSeconds ?? (metadata.durationTargetMinutes ?? 0) * 60;
  const bpm = metadata.bpm;

  if (!durationSeconds || !bpm) {
    console.warn(`- ${pieceId}: missing duration or bpm, skipped`);
    return;
  }

  const bars = Math.round((durationSeconds * bpm) / 240);
  const barSeconds = 240 / bpm;
  const pattern = await evaluatePattern(source);

  if (!pattern || typeof pattern.queryArc !== 'function') {
    console.warn(`- ${pieceId}: main.strudel did not return a pattern, skipped`);
    return;
  }

  const lanes = new Map();

  const CHUNK = 16;
  for (let start = 0; start < bars; start += CHUNK) {
    const end = Math.min(bars, start + CHUNK);

    for (const hap of pattern.queryArc(start, end)) {
      if (!hap.whole || hap.whole.begin.valueOf() !== hap.part.begin.valueOf()) {
        continue; // only onsets
      }

      const value = hap.value ?? {};
      const orbit = value.orbit ?? 0;
      const begin = hap.whole.begin.valueOf();
      const startStep = Math.round(begin * STEPS_PER_BAR);

      if (startStep >= bars * STEPS_PER_BAR) {
        continue;
      }

      const eventCycles = hap.whole.end.valueOf() - hap.whole.begin.valueOf();
      const durationSteps = Math.max(1, Math.round(eventCycles * STEPS_PER_BAR));
      const pitch = 'note' in value ? noteToMidi(value.note) : -1;
      const velocityRaw = Number(value.velocity ?? value.gain ?? 0.8);
      const velocity = Math.max(
        0,
        Math.min(9, Math.round((Number.isFinite(velocityRaw) ? velocityRaw : 0.8) * 9)),
      );

      if (!lanes.has(orbit)) {
        lanes.set(orbit, { orbit, events: [], raw: [], sounds: new Map(), pitched: 0, hits: 0 });
      }

      const lane = lanes.get(orbit);
      lane.events.push([startStep, durationSteps, pitch, velocity]);
      lane.raw.push({
        startSeconds: begin * barSeconds,
        eventSeconds: eventCycles * barSeconds,
        s: typeof value.s === 'string' ? value.s : null,
        n: value.n,
        note: value.note,
        speed: Number(value.speed) || 1,
        clip: Number(value.clip) || null,
        velocity: velocity / 9,
      });

      if (typeof value.s === 'string') {
        lane.sounds.set(value.s, (lane.sounds.get(value.s) ?? 0) + 1);
      }
      if (pitch >= 0) lane.pitched += 1;
      else lane.hits += 1;
    }
  }

  const sortedLanes = [...lanes.values()].sort((a, b) => a.orbit - b.orbit);
  const layerNames = Object.keys(metadata.timeline?.layers ?? {});
  const useLayerNames = layerNames.length === sortedLanes.length;

  const outputLanes = [];

  for (const [index, lane] of sortedLanes.entries()) {
    const sounds = [...lane.sounds.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);
    const pitches = lane.events.filter(([, , pitch]) => pitch >= 0).map(([, , pitch]) => pitch);
    const kind = lane.pitched > lane.hits ? 'notes' : 'audio';

    const outputLane = {
      label: useLayerNames ? layerNames[index] : (sounds[0] ?? `orbit ${lane.orbit}`),
      orbit: lane.orbit,
      kind,
      sounds,
      pitchRange: pitches.length ? [Math.min(...pitches), Math.max(...pitches)] : null,
      eventCount: lane.events.length,
      events: lane.events.sort((a, b) => a[0] - b[0]),
    };

    if (kind === 'audio') {
      // Compose the lane waveform: stamp each event with the peak envelope
      // of its actual sample (or a short synthetic decay).
      const wave = new Float32Array(WAVE_BINS);

      for (const event of lane.raw) {
        const file = event.s ? resolveSampleFile(event.s, event.n, event.note) : null;
        const envelope = file ? await wavEnvelope(file) : SYNTHETIC_ENVELOPE;

        let soundSeconds = envelope.durationSeconds / Math.max(0.05, Math.abs(event.speed));
        if (event.clip) {
          soundSeconds = Math.min(soundSeconds, event.eventSeconds * event.clip);
        }

        for (let point = 0; point < ENVELOPE_POINTS; point += 1) {
          const at = event.startSeconds + (point / ENVELOPE_POINTS) * soundSeconds;
          const bin = Math.floor((at / durationSeconds) * WAVE_BINS);

          if (bin >= 0 && bin < WAVE_BINS) {
            wave[bin] = Math.max(wave[bin], envelope.peaks[point] * event.velocity);
          }
        }
      }

      outputLane.wave = [...wave].map((v) => Math.max(0, Math.min(9, Math.round(v * 9))));
    }

    outputLanes.push(outputLane);
  }

  const output = {
    pieceId,
    generatedAt: new Date().toISOString(),
    bars,
    stepsPerBar: STEPS_PER_BAR,
    durationSeconds,
    lanes: outputLanes,
  };

  await fs.mkdir(outputDir, { recursive: true });
  const file = path.join(outputDir, `${pieceId}.json`);
  await fs.writeFile(file, JSON.stringify(output));

  const totalEvents = output.lanes.reduce((sum, lane) => sum + lane.eventCount, 0);
  const kinds = output.lanes.map((lane) => `${lane.label}:${lane.kind}`).join(' ');
  console.log(
    `✓ ${pieceId}: ${output.lanes.length} lanes (${kinds}), ${totalEvents} events, ${Math.round((await fs.stat(file)).size / 1024)} kB`,
  );
}

const requested = process.argv.slice(2);
const all = (await fs.readdir(piecesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const targets = requested.length > 0 ? requested : all;

for (const pieceId of targets) {
  try {
    await generateForPiece(pieceId);
  } catch (error) {
    console.error(`! ${pieceId}: ${error.message}`);
    process.exitCode = 1;
  }
}

// Inspect downloaded audio files: WAV header data, duration, peak level.
// Pure Node, no dependencies — non-WAV formats report container info only.
//
// Usage:
//   node scripts/samples/inspect-audio.mjs             # all raw files
//   node scripts/samples/inspect-audio.mjs <file...>   # specific files

import fs from 'node:fs/promises';
import path from 'node:path';
import { rawDir, libraryRoot } from './shared/paths.mjs';

export async function inspectWav(filePath) {
  const buffer = await fs.readFile(filePath);

  if (buffer.length < 44 || buffer.subarray(0, 4).toString() !== 'RIFF') {
    return { format: path.extname(filePath).slice(1) || 'unknown', bytes: buffer.length };
  }

  let offset = 12;
  let fmt = null;
  let dataLength = 0;
  let dataOffset = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.subarray(offset, offset + 4).toString();
    const chunkSize = buffer.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buffer.readUInt16LE(offset + 8),
        channels: buffer.readUInt16LE(offset + 10),
        sampleRate: buffer.readUInt32LE(offset + 12),
        bitsPerSample: buffer.readUInt16LE(offset + 22),
      };
    } else if (chunkId === 'data') {
      dataLength = chunkSize;
      dataOffset = offset + 8;
    }

    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (!fmt || dataLength === 0) {
    return { format: 'wav', bytes: buffer.length, warning: 'missing fmt or data chunk' };
  }

  const bytesPerSample = fmt.bitsPerSample / 8;
  const frames = dataLength / (bytesPerSample * fmt.channels);
  const durationSeconds = frames / fmt.sampleRate;

  // Peak scan (PCM 16/24-bit only), sampled every 16th frame for speed.
  let peak = 0;
  if (fmt.audioFormat === 1 && (fmt.bitsPerSample === 16 || fmt.bitsPerSample === 24)) {
    const step = bytesPerSample * fmt.channels * 16;
    const full = fmt.bitsPerSample === 16 ? 32768 : 8388608;

    for (let i = dataOffset; i + bytesPerSample <= dataOffset + dataLength; i += step) {
      const value =
        fmt.bitsPerSample === 16
          ? Math.abs(buffer.readInt16LE(i))
          : Math.abs((buffer.readIntLE(i, 3)));
      if (value > peak) peak = value;
    }

    peak = peak / full;
  }

  return {
    format: 'wav',
    bytes: buffer.length,
    channels: fmt.channels,
    sampleRate: fmt.sampleRate,
    bitsPerSample: fmt.bitsPerSample,
    durationSeconds: Number(durationSeconds.toFixed(3)),
    peak: Number(peak.toFixed(3)),
  };
}

async function collectFiles(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full)));
    } else if (/\.(wav|ogg|flac|mp3)$/i.test(entry.name)) {
      out.push(full);
    }
  }

  return out;
}

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));

if (isMain) {
  const targets = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const files = targets.length > 0 ? targets : await collectFiles(rawDir);

  for (const file of files) {
    const info = await inspectWav(file);
    const rel = path.relative(libraryRoot, file);
    const details =
      info.format === 'wav' && info.durationSeconds !== undefined
        ? `${info.durationSeconds}s ${info.sampleRate}Hz ${info.bitsPerSample}bit ${info.channels}ch peak=${info.peak}`
        : `${info.format} ${Math.round(info.bytes / 1024)}kB`;
    console.log(`${rel}: ${details}${info.warning ? ` (! ${info.warning})` : ''}`);
  }
}

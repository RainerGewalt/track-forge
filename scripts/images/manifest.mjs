// Scan public/images and write src/generated/images-manifest.json.
//
// Convention: dropping public/images/tracks/<piece-id>.<ext> (or
// public/images/profile/<anything>.<ext>) is enough — the UI picks the file
// up through this manifest without editing piece.json. An explicit
// piece.json artwork.src always wins over the convention.
//
// Usage: node scripts/images/manifest.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGeneratedJson } from '../shared/generated-json.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imagesDir = path.join(projectRoot, 'public', 'images');
const outputFile = path.join(projectRoot, 'src', 'generated', 'images-manifest.json');

// Raster formats beat SVG so a real photograph replaces a placeholder by
// simply being added next to it.
const EXTENSION_PRIORITY = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'svg'];

async function listImages(dir) {
  try {
    return (await fs.readdir(dir)).filter((name) =>
      EXTENSION_PRIORITY.includes(path.extname(name).slice(1).toLowerCase()),
    );
  } catch {
    return [];
  }
}

function pickBest(candidates) {
  return candidates.sort(
    (a, b) =>
      EXTENSION_PRIORITY.indexOf(path.extname(a).slice(1).toLowerCase()) -
      EXTENSION_PRIORITY.indexOf(path.extname(b).slice(1).toLowerCase()),
  )[0];
}

const trackFiles = await listImages(path.join(imagesDir, 'tracks'));
const tracks = {};

for (const file of trackFiles) {
  const id = file.replace(/\.[^.]+$/, '');
  const existing = tracks[id];
  tracks[id] = existing ? pickBest([existing, file]) : file;
}

const profileFiles = await listImages(path.join(imagesDir, 'profile'));
const profile = profileFiles.length > 0 ? pickBest(profileFiles) : null;

await writeGeneratedJson(outputFile, { generatedAt: new Date().toISOString(), tracks, profile });

console.log(
  `images manifest: ${Object.keys(tracks).length} track image(s), profile ${profile ? 'yes' : 'no'}`,
);

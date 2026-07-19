// Build the web-served library from the curated manifest:
//
//   public/samples/library/audio/<family>/<bank>/<file>   audio payload
//   public/samples/library/library.json                   browser manifest
//   public/samples/library/strudel-samples.json           Strudel sample map
//
// Sample-map naming: every bank becomes a `bot_` sound (bot_framedrum,
// bot_shaker, ...). Banks whose entries carry note names become pitched
// maps ({ "c4": ... }); everything else becomes an indexed array usable
// with `.n()`.
//
// Usage: node scripts/samples/build-library.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson } from './shared/manifest.mjs';
import { libraryRoot, publicLibraryDir, publicAudioDir, manifestFiles } from './shared/paths.mjs';

async function main() {
  const library = await readJson(manifestFiles.library);

  await fs.rm(publicAudioDir, { recursive: true, force: true });
  await fs.mkdir(publicAudioDir, { recursive: true });

  const banks = new Map();

  for (const entry of library.entries) {
    const relative = path.join(entry.family, entry.bank, entry.fileName);
    const target = path.join(publicAudioDir, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.join(libraryRoot, entry.file), target);

    const bankName = `bot_${entry.bank}`;
    if (!banks.has(bankName)) {
      banks.set(bankName, []);
    }
    banks.get(bankName).push({ ...entry, webPath: relative.split(path.sep).join('/') });
  }

  const sampleMap = { _base: '/samples/library/audio/' };

  for (const [bankName, entries] of [...banks.entries()].sort()) {
    entries.sort((a, b) => a.fileName.localeCompare(b.fileName));
    const pitched = entries.every((entry) => entry.note);

    if (pitched && entries.length > 1) {
      const map = {};
      for (const entry of entries) {
        map[entry.note] = entry.webPath;
      }
      sampleMap[bankName] = map;
    } else {
      sampleMap[bankName] = entries.map((entry) => entry.webPath);
    }
  }

  await writeJson(path.join(publicLibraryDir, 'strudel-samples.json'), sampleMap);

  // Browser manifest: entries plus their bank/index addressing for the UI.
  const browserEntries = [];
  for (const [bankName, entries] of banks.entries()) {
    entries.forEach((entry, index) => {
      browserEntries.push({
        id: entry.id,
        family: entry.family,
        bank: bankName,
        index,
        note: entry.note,
        file: entry.webPath,
        title: entry.title,
        creator: entry.creator,
        source: entry.source,
        license: entry.license,
        licenseUrl: entry.licenseUrl,
        canonicalUrl: entry.provenance.canonicalUrl,
        durationSeconds: entry.audio?.durationSeconds ?? null,
      });
    });
  }

  browserEntries.sort((a, b) => a.id.localeCompare(b.id));

  await writeJson(path.join(publicLibraryDir, 'library.json'), {
    generatedAt: new Date().toISOString(),
    strudelMap: '/samples/library/strudel-samples.json',
    counts: library.counts,
    entries: browserEntries,
  });

  console.log(
    `built ${browserEntries.length} samples in ${banks.size} banks -> public/samples/library`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

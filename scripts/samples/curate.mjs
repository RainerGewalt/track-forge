// Promote downloaded raw files into the curated library.
//
// Curation is manifest-driven: every entry in manifests/downloads.jsonl is
// copied to curated/<family>/<bank>/ unless it is listed in
// sample-library/curation-overrides.json (excluded or re-assigned).
// The result is recorded in manifests/library.json, which is the single
// source of truth for build-library.mjs.
//
// Usage: node scripts/samples/curate.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson, readJsonl } from './shared/manifest.mjs';
import { inspectWav } from './inspect-audio.mjs';
import { libraryRoot, curatedDir, manifestFiles, families } from './shared/paths.mjs';

const overridesFile = path.join(libraryRoot, 'curation-overrides.json');

async function main() {
  const downloads = await readJsonl(manifestFiles.downloads);
  const overrides = await readJson(overridesFile, { exclude: [], reassign: {} });

  const entries = [];
  let excluded = 0;

  for (const download of downloads) {
    const key = download.sha256;
    if (overrides.exclude.includes(key)) {
      excluded += 1;
      continue;
    }

    const reassign = overrides.reassign[key] ?? {};
    const family = reassign.family ?? download.family;
    const bank = reassign.bank ?? download.bank;

    if (!families.includes(family)) {
      console.warn(`! skipping ${download.localPath}: unknown family ${family}`);
      continue;
    }

    const sourcePath = path.join(libraryRoot, download.localPath);
    const fileName = path.basename(download.localPath);
    const curatedRelative = path.join('curated', family, bank, fileName);
    const curatedPath = path.join(curatedDir, family, bank, fileName);

    try {
      await fs.mkdir(path.dirname(curatedPath), { recursive: true });
      await fs.copyFile(sourcePath, curatedPath);
    } catch (error) {
      console.warn(`! cannot curate ${download.localPath}: ${error.message}`);
      continue;
    }

    const audio = await inspectWav(curatedPath);

    entries.push({
      id: `${family}-${bank}-${fileName.replace(/\.[a-z0-9]+$/i, '')}`,
      family,
      bank,
      file: curatedRelative,
      fileName,
      note: download.note ?? null,
      source: download.source,
      title: download.title ?? download.originalPath ?? fileName,
      creator: download.creator ?? (download.source === 'vcsl' ? 'VCSL contributors' : null),
      license: download.license,
      licenseUrl: download.licenseUrl ?? null,
      licenseEvidence: download.licenseEvidence,
      provenance: {
        url: download.url ?? download.fileUrl ?? null,
        canonicalUrl: download.canonicalUrl ?? download.repository ?? null,
        commit: download.commit ?? null,
        originalPath: download.originalPath ?? null,
        sha256: download.sha256,
        downloadedAt: download.downloadedAt,
      },
      audio,
    });
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));

  const byFamily = {};
  for (const family of families) {
    byFamily[family] = entries.filter((entry) => entry.family === family).length;
  }

  await writeJson(manifestFiles.library, {
    generatedAt: new Date().toISOString(),
    principle: 'Few source materials, many musical transformations.',
    counts: { total: entries.length, excluded, ...byFamily },
    entries,
  });

  console.log(`curated ${entries.length} files (${excluded} excluded)`);
  console.log(Object.entries(byFamily).map(([k, v]) => `${k}: ${v}`).join(', '));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

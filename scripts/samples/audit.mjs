// Audit the sample library for consistency and rights traceability:
//
//   - every curated entry has an existing file with a matching checksum,
//   - every entry carries an accepted license plus stored evidence,
//   - the public build matches the curated manifest,
//   - counts per family and source are reported.
//
// Writes manifests/audit-report.json and exits non-zero on failures.
//
// Usage: node scripts/samples/audit.mjs

import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson } from './shared/manifest.mjs';
import { sha256File } from './shared/hash.mjs';
import { classifyLicense, VERDICT } from './shared/license.mjs';
import { libraryRoot, publicAudioDir, publicLibraryDir, manifestFiles } from './shared/paths.mjs';

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const library = await readJson(manifestFiles.library, null);
  const problems = [];
  const stats = { families: {}, sources: {}, licenses: {} };

  if (!library) {
    problems.push('manifests/library.json missing — run curate.mjs first.');
  }

  for (const entry of library?.entries ?? []) {
    const curatedPath = path.join(libraryRoot, entry.file);

    if (!(await exists(curatedPath))) {
      problems.push(`${entry.id}: curated file missing (${entry.file})`);
      continue;
    }

    const rawPath = entry.provenance?.sha256
      ? curatedPath
      : null;

    if (rawPath) {
      const checksum = await sha256File(curatedPath);
      if (checksum !== entry.provenance.sha256) {
        problems.push(`${entry.id}: checksum mismatch against download provenance`);
      }
    } else {
      problems.push(`${entry.id}: no provenance checksum recorded`);
    }

    const verdict = classifyLicense(entry.license, entry.licenseUrl ?? '');
    if (verdict.verdict !== VERDICT.accept) {
      problems.push(`${entry.id}: license not auto-acceptable (${entry.license})`);
    }

    if (!entry.licenseEvidence || !(await exists(path.join(libraryRoot, entry.licenseEvidence)))) {
      problems.push(`${entry.id}: license evidence file missing (${entry.licenseEvidence})`);
    }

    if (!entry.provenance?.canonicalUrl && !entry.provenance?.url) {
      problems.push(`${entry.id}: no source URL recorded`);
    }

    stats.families[entry.family] = (stats.families[entry.family] ?? 0) + 1;
    stats.sources[entry.source] = (stats.sources[entry.source] ?? 0) + 1;
    stats.licenses[entry.license] = (stats.licenses[entry.license] ?? 0) + 1;
  }

  // Public build consistency.
  const publicManifest = await readJson(path.join(publicLibraryDir, 'library.json'), null);

  if (!publicManifest) {
    problems.push('public/samples/library/library.json missing — run build-library.mjs.');
  } else {
    for (const entry of publicManifest.entries) {
      if (!(await exists(path.join(publicAudioDir, entry.file)))) {
        problems.push(`public build: audio file missing (${entry.file})`);
      }
    }

    if (library && publicManifest.entries.length !== library.entries.length) {
      problems.push(
        `public build has ${publicManifest.entries.length} entries but curated manifest has ${library.entries.length}`,
      );
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    entryCount: library?.entries.length ?? 0,
    stats,
    problems,
  };

  await writeJson(manifestFiles.auditReport, report);

  console.log(JSON.stringify(stats, null, 2));

  if (problems.length > 0) {
    console.error(`AUDIT FAILED (${problems.length} problems):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`audit ok: ${report.entryCount} entries fully traceable`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

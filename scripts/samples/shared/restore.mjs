// Restore recorded Wikimedia Commons files that are missing locally.
// Used by download.mjs; a separate module so tests can import it without
// running a download.

import fs from 'node:fs/promises';
import path from 'node:path';
import { downloadToFile } from './http.mjs';
import { sha256File } from './hash.mjs';
import { classifyLicense, VERDICT } from './license.mjs';
import { getCommonsFileInfo, commonsMetadataProblems } from './wikimedia.mjs';
import { libraryRoot } from './paths.mjs';

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Re-download recorded Wikimedia Commons files that are missing locally. The
// license is re-checked at Commons first; the file comes from its recorded
// URL and must match the recorded size and SHA-256. The manifest and the
// stored license evidence stay as they are. Tests pass their own metadata
// lookup and library root.
export async function restoreRecorded(recorded, { lookup = getCommonsFileInfo, root = libraryRoot } = {}) {
  let restored = 0;
  const failed = [];

  for (const entry of recorded) {
    if (entry.source !== 'wikimedia' || (await fileExists(path.join(root, entry.localPath)))) {
      continue;
    }

    const label = `${entry.family} <- ${entry.title}`;
    const info = await lookup(entry.title).catch(() => null);
    const problems = info ? commonsMetadataProblems(info) : ['metadata lookup failed'];
    const verdict = info ? classifyLicense(info.licenseShortName || info.license, info.licenseUrl) : null;

    if (problems.length > 0 || verdict?.verdict !== VERDICT.accept) {
      failed.push(`${label}: license re-check failed (${[...problems, verdict?.reason].filter(Boolean).join('; ')})`);
      continue;
    }

    const localPath = path.join(root, entry.localPath);
    await fs.mkdir(path.dirname(localPath), { recursive: true });

    let bytes;
    try {
      bytes = await downloadToFile(entry.fileUrl, localPath);
    } catch (error) {
      failed.push(`${label}: ${error.message}`);
      continue;
    }

    const checksum = await sha256File(localPath);
    if (checksum !== entry.sha256 || (entry.bytes && bytes !== entry.bytes)) {
      await fs.rm(localPath, { force: true });
      failed.push(`${label}: ${entry.fileUrl} no longer matches the recorded SHA-256`);
      continue;
    }

    restored += 1;
    console.log(`✓ restored ${label} (${Math.round(bytes / 1024)} kB, sha256 verified)`);
  }

  return { restored, failed };
}

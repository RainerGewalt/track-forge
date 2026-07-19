// Download entries from the verified queue (candidates/verified-queue.json).
//
// Every entry in the queue was already license-verified against its
// canonical provider by discover.mjs. This script re-checks the provider
// metadata immediately before download (defense in depth), stores the
// provider metadata snapshot as license evidence, and records provenance.
//
// Usage: node scripts/samples/download.mjs [--limit N]

import fs from 'node:fs/promises';
import path from 'node:path';
import { downloadToFile } from './shared/http.mjs';
import { readJson, writeJson, appendJsonl, readJsonl } from './shared/manifest.mjs';
import { sha256File } from './shared/hash.mjs';
import { classifyLicense, VERDICT } from './shared/license.mjs';
import { getCommonsFileInfo, commonsMetadataProblems } from './shared/wikimedia.mjs';
import { rawDir, licensesDir, candidatesDir, manifestFiles } from './shared/paths.mjs';

const queueFile = path.join(candidatesDir, 'verified-queue.json');

function slugify(text) {
  return text
    .replace(/^File:/, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/#/g, 's')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);
}

function extensionFor(mime, fileUrl) {
  const fromUrl = (fileUrl.match(/\.([a-z0-9]{2,4})$/i) ?? [])[1];
  if (fromUrl) return fromUrl.toLowerCase();
  if (mime === 'audio/ogg' || mime === 'application/ogg') return 'ogg';
  if (mime === 'audio/x-flac' || mime === 'audio/flac') return 'flac';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav';
  if (mime === 'audio/mpeg') return 'mp3';
  return 'bin';
}

async function main() {
  const limitIndex = process.argv.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : Infinity;

  const queue = await readJson(queueFile, []);
  const rejected = await readJson(manifestFiles.rejected, []);
  const existing = await readJsonl(manifestFiles.downloads);
  const alreadyDownloaded = new Set(existing.map((entry) => entry.canonicalUrl).filter(Boolean));

  const remaining = [];
  let downloaded = 0;

  for (const entry of queue) {
    if (downloaded >= limit) {
      remaining.push(entry);
      continue;
    }

    if (alreadyDownloaded.has(entry.canonicalUrl)) {
      continue;
    }

    if (entry.canonicalProvider !== 'wikimedia-commons') {
      remaining.push(entry);
      console.warn(`! no downloader for provider ${entry.canonicalProvider}: ${entry.title}`);
      continue;
    }

    // Re-verify at the canonical source right before downloading.
    const info = await getCommonsFileInfo(entry.title);
    const problems = info ? commonsMetadataProblems(info) : ['metadata lookup failed'];
    const verdict = info
      ? classifyLicense(info.licenseShortName || info.license, info.licenseUrl)
      : { verdict: VERDICT.reject, reason: 'metadata lookup failed' };

    if (problems.length > 0 || verdict.verdict !== VERDICT.accept) {
      rejected.push({
        ...entry,
        reason: `failed re-verification: ${[...problems, verdict.reason].join('; ')}`,
      });
      console.warn(`! re-verification failed, rejected: ${entry.title}`);
      continue;
    }

    const slug = slugify(entry.title);
    const ext = extensionFor(info.mime, info.fileUrl);
    const family = entry.family ?? 'unassigned';
    const localRelative = path.join('raw', 'wikimedia', family, `${slug}.${ext}`);
    const localPath = path.join(rawDir, 'wikimedia', family, `${slug}.${ext}`);

    await fs.mkdir(path.dirname(localPath), { recursive: true });

    let bytes;
    try {
      bytes = await downloadToFile(info.fileUrl, localPath);
    } catch (error) {
      console.warn(`! download failed, kept in queue: ${entry.title} (${error.message})`);
      remaining.push(entry);
      continue;
    }

    const checksum = await sha256File(localPath);

    // License evidence: snapshot of the canonical Commons metadata.
    const evidenceRelative = path.join('licenses', 'sources', `${slug}.json`);
    await writeJson(path.join(licensesDir, 'sources', `${slug}.json`), {
      verifiedAt: new Date().toISOString(),
      canonicalProvider: 'wikimedia-commons',
      commonsMetadata: info,
      licenseVerdict: verdict.reason,
    });

    await appendJsonl(manifestFiles.downloads, {
      source: 'wikimedia',
      family,
      bank: entry.bank ?? slug.split('-')[0],
      title: entry.title,
      creator: info.creator,
      canonicalUrl: info.pageUrl,
      fileUrl: info.fileUrl,
      localPath: localRelative,
      license: info.licenseShortName || info.license,
      licenseUrl: info.licenseUrl,
      licenseEvidence: evidenceRelative,
      mime: info.mime,
      bytes,
      sha256: checksum,
      downloadedAt: new Date().toISOString(),
    });

    downloaded += 1;
    console.log(`✓ ${family} <- ${entry.title} (${Math.round(bytes / 1024)} kB)`);
  }

  await writeJson(queueFile, remaining);
  await writeJson(manifestFiles.rejected, rejected);
  console.log(`done: ${downloaded} downloaded, ${remaining.length} left in queue`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

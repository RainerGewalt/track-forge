// Discover candidate sounds via the Openverse API and Wikimedia Commons
// search, verify licenses at the canonical provider, and sort results into:
//
//   - a verified download queue (CC0 confirmed at the provider),
//   - candidates/manual-review.json (permissive but not CC0, or Freesound),
//   - candidates/rejected.json (restricted, unknown or inconsistent).
//
// Openverse license metadata is treated as a hint only — nothing is queued
// for download without confirmation from the canonical provider record.
//
// Usage:
//   node scripts/samples/discover.mjs                 # all search-plan queries
//   node scripts/samples/discover.mjs --family skin   # one family
//   node scripts/samples/discover.mjs --query "frame drum" --family skin

import { fetchJson } from './shared/http.mjs';
import { readJson, writeJson } from './shared/manifest.mjs';
import { classifyLicense, VERDICT } from './shared/license.mjs';
import {
  searchCommonsAudio,
  getCommonsFileInfo,
  commonsMetadataProblems,
} from './shared/wikimedia.mjs';
import { manifestFiles, candidatesDir } from './shared/paths.mjs';
import path from 'node:path';

const OPENVERSE_API = 'https://api.openverse.org/v1/audio/';
const queueFile = path.join(candidatesDir, 'verified-queue.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { family: null, query: null, perQuery: 8 };

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--family') options.family = args[++i];
    if (args[i] === '--query') options.query = args[++i];
  }

  return options;
}

async function openverseSearch(query, perQuery) {
  const params = new URLSearchParams({
    q: query,
    page_size: String(perQuery),
    license: 'cc0,pdm,by',
  });

  try {
    const data = await fetchJson(`${OPENVERSE_API}?${params}`);
    return data.results ?? [];
  } catch (error) {
    console.warn(`! openverse search failed for "${query}": ${error.message}`);
    return [];
  }
}

function dedupeKey(entry) {
  return entry.canonicalUrl ?? entry.foreignUrl ?? entry.title;
}

async function main() {
  const options = parseArgs();
  const searchPlan = await readJson(manifestFiles.searchPlan);

  const jobs = [];

  if (options.query) {
    jobs.push({ family: options.family ?? 'unassigned', query: options.query });
  } else {
    for (const [family, spec] of Object.entries(searchPlan.families)) {
      if (options.family && family !== options.family) continue;
      for (const query of spec.queries) {
        jobs.push({ family, query });
      }
    }
  }

  const queue = await readJson(queueFile, []);
  const manualReview = await readJson(manifestFiles.manualReview, []);
  const rejected = await readJson(manifestFiles.rejected, []);

  const seen = new Set([
    ...queue.map(dedupeKey),
    ...manualReview.map(dedupeKey),
    ...rejected.map(dedupeKey),
  ]);

  const counts = { queued: 0, manual: 0, rejected: 0, duplicate: 0 };

  for (const job of jobs) {
    console.log(`\n# ${job.family}: "${job.query}"`);

    // Layer 1: Openverse discovery (license filter is only a pre-filter).
    const openverseResults = await openverseSearch(job.query, options.perQuery ?? 8);

    for (const result of openverseResults) {
      const record = {
        discoveredVia: 'openverse',
        family: job.family,
        query: job.query,
        title: result.title,
        creator: result.creator ?? null,
        provider: result.source ?? result.provider ?? 'unknown',
        foreignUrl: result.foreign_landing_url ?? null,
        openverseLicense: `${result.license ?? ''} ${result.license_version ?? ''}`.trim(),
        openverseId: result.id,
        tags: (result.tags ?? []).slice(0, 8).map((tag) => tag.name),
        discoveredAt: new Date().toISOString(),
      };

      const key = dedupeKey(record);
      if (seen.has(key)) {
        counts.duplicate += 1;
        continue;
      }
      seen.add(key);

      if (record.provider === 'freesound') {
        // Freesound originals are never downloaded automatically here.
        manualReview.push({
          ...record,
          reason: 'Freesound result: verify license and download manually via the Freesound API/OAuth.',
        });
        counts.manual += 1;
        continue;
      }

      if (record.provider === 'wikimedia_audio' && result.title) {
        // Canonical verification happens against Commons below via search;
        // queue a Commons lookup using the foreign landing title.
        const fileTitle = decodeURIComponent(
          (record.foreignUrl ?? '').split('/wiki/')[1] ?? '',
        ).replace(/_/g, ' ');

        if (fileTitle.startsWith('File:')) {
          const info = await getCommonsFileInfo(fileTitle);
          sortCommonsCandidate(info, record, { queue, manualReview, rejected, counts });
          continue;
        }
      }

      manualReview.push({
        ...record,
        reason: `provider "${record.provider}" has no automated canonical verification; review manually.`,
      });
      counts.manual += 1;
    }

    // Layer 2: direct Wikimedia Commons search (canonical source).
    const titles = await searchCommonsAudio(job.query, 8);

    for (const title of titles) {
      const record = {
        discoveredVia: 'commons-search',
        family: job.family,
        query: job.query,
        title,
        discoveredAt: new Date().toISOString(),
      };

      const info = await getCommonsFileInfo(title);
      if (info && seen.has(info.pageUrl)) {
        counts.duplicate += 1;
        continue;
      }
      if (info) seen.add(info.pageUrl);

      sortCommonsCandidate(info, record, { queue, manualReview, rejected, counts });
    }
  }

  await writeJson(queueFile, queue);
  await writeJson(manifestFiles.manualReview, manualReview);
  await writeJson(manifestFiles.rejected, rejected);

  console.log(
    `\nqueued ${counts.queued}, manual review ${counts.manual}, rejected ${counts.rejected}, duplicates ${counts.duplicate}`,
  );
  console.log(`verified queue: ${queueFile}`);
}

function sortCommonsCandidate(info, record, { queue, manualReview, rejected, counts }) {
  if (!info) {
    rejected.push({ ...record, reason: 'Commons metadata lookup failed.' });
    counts.rejected += 1;
    return;
  }

  const problems = commonsMetadataProblems(info);
  const enriched = {
    ...record,
    canonicalProvider: 'wikimedia-commons',
    canonicalUrl: info.pageUrl,
    fileUrl: info.fileUrl,
    creator: info.creator,
    mime: info.mime,
    bytes: info.bytes,
    license: info.licenseShortName || info.license,
    licenseUrl: info.licenseUrl,
    description: info.description,
  };

  if (problems.length > 0) {
    rejected.push({ ...enriched, reason: `inconsistent metadata: ${problems.join('; ')}` });
    counts.rejected += 1;
    return;
  }

  const verdict = classifyLicense(enriched.license, enriched.licenseUrl);

  if (verdict.verdict === VERDICT.accept) {
    queue.push({ ...enriched, licenseVerdict: verdict.reason });
    counts.queued += 1;
    console.log(`  ✓ queue: ${enriched.title} [${enriched.license}]`);
  } else if (verdict.verdict === VERDICT.manualReview) {
    manualReview.push({ ...enriched, reason: verdict.reason });
    counts.manual += 1;
  } else {
    rejected.push({ ...enriched, reason: verdict.reason });
    counts.rejected += 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

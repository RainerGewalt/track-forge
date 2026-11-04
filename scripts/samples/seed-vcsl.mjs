// Seed the local sample library from the Versilian Community Sample Library.
//
// VCSL is a CC0 1.0 library (LICENSE at the repository root). This script
// never clones the multi-gigabyte repository: it uses the commit pinned in
// manifests/sources.json, inspects the git tree via the GitHub API, selects a
// small, deterministic set of musically relevant files, and downloads only
// those. --refresh moves the pin to the current head of the branch.
//
// Usage: node scripts/samples/seed-vcsl.mjs [--dry-run] [--refresh]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchJson, downloadToFile, request } from './shared/http.mjs';
import { readJson, writeJson, appendJsonl, readJsonl } from './shared/manifest.mjs';
import { sha256File } from './shared/hash.mjs';
import { rawDir, cacheDir, licensesDir, manifestFiles } from './shared/paths.mjs';

const REPO = 'sgossner/VCSL';
const REPO_URL = `https://github.com/${REPO}`;
const BRANCH = 'master';

// Deterministic selection: one rule per musical role. `match` is applied to
// the full repository path; the first `take` matches (path-sorted) win.
// Few source materials, many musical transformations — keep every list short.
const SELECTION = [
  // PULSE — low membrane strikes that can become kicks, thuds or sub pressure.
  { family: 'pulse', bank: 'bassdrum', match: /Bass Drum 1\/BDrumNew_hit_v[235]_rr1/, take: 3 },
  { family: 'pulse', bank: 'lowtom', match: /Tom 2\/Mallet\/TomL_HitM_v[23]_rr1/, take: 2 },
  { family: 'pulse', bank: 'timpani', match: /Timpani 1\/Hit\/Timpani1_Hit_v[24]_rr1/, take: 2 },

  // SKIN — several one-per-song drum families with open/muted articulations.
  { family: 'skin', bank: 'framedrum', match: /Frame Drum\/HDrumL_(Hit_v[23]|HitMuted_v[23])_rr1/, take: 4 },
  { family: 'skin', bank: 'framedrum', match: /Frame Drum\/HDrum(L_Hand_rr1|S_Hand_v1_rr1|S_HitMuted_v2_rr1)/, take: 3 },
  { family: 'skin', bank: 'bongo', match: /Bongos\/BongoH_(Hit1_v[23]|HitMuted1_v2)_rr1/, take: 3 },
  { family: 'skin', bank: 'bongo', match: /Bongos\/BongoL_(Hit1_v[23]|HitMuted2_v1)_rr1/, take: 3 },
  { family: 'skin', bank: 'darbuka', match: /Darbuka\/Darbuka_[1-5]_hit_vl1_rr1/, take: 5 },
  { family: 'skin', bank: 'conga', match: /Conga\/Conga_Hit(N|FM)_v1_rr1/, take: 2 },
  { family: 'skin', bank: 'logdrum', match: /Slit Drum\/LogDrum(Hi|Lo)_MedM_v1_rr1/, take: 2 },

  // SEED — small high-frequency motion: shaker, claves, wood, friction.
  { family: 'seed', bank: 'shaker', match: /Shaker, Small\/Mid_Shaker(Double_(Down|Up)|HighFaster_Down|LowFaster_Down)_rr1/, take: 4 },
  { family: 'seed', bank: 'claves', match: /Claves\/(Claves2_Hit_v2_rr1|Legacy\/claves_(mf|pp1))/, take: 3 },
  { family: 'seed', bank: 'woodblock', match: /Woodblock\/wood_click_(pp_rr1|mp)\.wav/, take: 2 },
  { family: 'seed', bank: 'cabasa', match: /Cabasa\/Cabasa1_(Hit_rr1|Rub_v1_rr1)/, take: 2 },
  { family: 'seed', bank: 'guiro', match: /Guiro\/(Legacy\/guiro_short\.wav|Legacy\/guiro_long\.wav|Guiro_Hit_rr1)/, take: 3 },

  // TREMOR — rough tonal material: bowed and scraped metal, glass, resonance.
  { family: 'tremor', bank: 'bowedcymbal', match: /Suspended Cymbal 1\/susCymb1_bow_(7|13|17)\.wav/, take: 3 },
  { family: 'tremor', bank: 'bowedbrake', match: /Brake Drum\/BrakeDrum1_Bowed_rr2/, take: 1 },
  { family: 'tremor', bank: 'gongscrape', match: /Gong 1\/gong_scrape_mf/, take: 1 },
  { family: 'tremor', bank: 'glass', match: /Wine Glasses\/Releases\/Slow\/glass[134]_[A-G]#?[0-9]_Slow_[12]_Decay/, take: 3 },
  { family: 'tremor', bank: 'glasssus', match: /Wine Glasses\/Sustains\/Slow\/glass[13]_[A-G]#?[0-9]_Slow_[12]_Main/, take: 2 },
  { family: 'tremor', bank: 'anvil', match: /Anvil\/Anvil_Hit1_v1_rr1/, take: 1 },

  // MEMORY — restrained melodic colors; note names are kept for pitch maps.
  { family: 'memory', bank: 'ocarina', match: /Ocarina, Typical\/Sustains\/Sus\/StdOcarina_Sus_(A3|B3|D4|E4|F#4|A4)\.wav/, take: 6 },
  { family: 'memory', bank: 'recorder', match: /Baroque Tenor Recorder\/SusVib\/TenRecorder_SusVib_(A3|C4|D4|E4|F#4)_rr1/, take: 5 },
  { family: 'memory', bank: 'recorderstac', match: /Baroque Tenor Recorder\/Staccato\/TenRecorder_Stac_(C4|D4|E4)_rr1/, take: 3 },
  { family: 'memory', bank: 'mbira', match: /Kalimba, Kenya\/Mbira6_Normal_MainSpirit_(B2|B3_k12|C#4|D#4_k13|F#4|A4)/, take: 6 },
  { family: 'memory', bank: 'psalterybow', match: /Psaltery.*BowedPsaltery_(C4|D4|E4)_Main_LongBow_rr[12]/, take: 3 },
  { family: 'memory', bank: 'psalterypluck', match: /Psaltery.*BowedPsaltery_(C4|E4|A#3)_Main_Pluck_rr1/, take: 3 },

  // Extension: wooden bars, hat ticks and high toms.
  { family: 'memory', bank: 'balafonsoft', match: /Balafon\/Soft Mallet\/EthnicXylo_softM_(C#3|C4|F3|F4)_vl2/, take: 4 },
  { family: 'memory', bank: 'balafonhard', match: /Balafon\/Hard Mallet\/EthnicXylo_hardM_(C#3|C4|C5|F3|F4)_vl2/, take: 5 },
  { family: 'seed', bank: 'hihat', match: /Hi-Hat Cymbal\/HiHat_(Close_rr1|HitC_v[123]_rr1|HitLoose_rr1)/, take: 5 },
  { family: 'skin', bank: 'hightom', match: /Tom 1\/(Stick\/TomH_HitS_v[23]_rr1|TomH_rimS_v2_rr1)/, take: 3 },

  // GROUND — drones, breath, sea, long metal decay.
  { family: 'ground', bank: 'didgeridoo', match: /Didgeridoo\/Didgeridoo1_(Sus2|Sus3)_Main/, take: 2 },
  { family: 'ground', bank: 'didgepulse', match: /Didgeridoo\/Didgeridoo1_(Bark1_Main_rr3|Tap1_Main_rr16|Short1_Main_rr2)/, take: 3 },
  { family: 'ground', bank: 'oceandrum', match: /Ocean Drum\/OceanDrum_Sus_2_Mid/, take: 1 },
  { family: 'ground', bank: 'gong', match: /Gong 1\/gong_2_mp/, take: 1 },
];

const NOTE_PATTERN = /_([A-Ga-g]#?[0-9])(?:_|\.)/;

function slugify(fileName) {
  return fileName
    .replace(/\.wav$/i, '')
    .replace(/#/g, 's')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

async function fileExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function loadTree(commitSha) {
  const cachePath = path.join(cacheDir, `vcsl-tree-${commitSha}.json`);
  const cached = await readJson(cachePath, null);

  if (cached) {
    return cached;
  }

  const tree = await fetchJson(
    `https://api.github.com/repos/${REPO}/git/trees/${commitSha}?recursive=1`,
  );

  if (tree.truncated) {
    throw new Error('VCSL tree is truncated; a different inspection strategy is required.');
  }

  await writeJson(cachePath, tree);
  return tree;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const refresh = process.argv.includes('--refresh');
  const sources = await readJson(manifestFiles.sources, {});
  const pinnedSha = sources.vcsl?.commit ?? null;
  let commitSha = pinnedSha;

  if (!commitSha || refresh) {
    const branch = await fetchJson(`https://api.github.com/repos/${REPO}/branches/${BRANCH}`);
    commitSha = branch.commit.sha;
    console.log(`VCSL ${BRANCH} @ ${commitSha}`);
  } else {
    console.log(`VCSL pinned @ ${commitSha} (--refresh moves the pin to the current ${BRANCH})`);
  }

  // Provenance files only change when the pinned commit changes, so a fresh
  // clone does not rewrite them with a new timestamp.
  const pinChanged = commitSha !== pinnedSha;

  const tree = await loadTree(commitSha);
  const blobs = tree.tree.filter((entry) => entry.type === 'blob');

  // License evidence: store the canonical CC0 text from the pinned commit.
  const licenseDir = path.join(licensesDir, 'vcsl');
  await fs.mkdir(licenseDir, { recursive: true });
  const licenseUrl = `https://raw.githubusercontent.com/${REPO}/${commitSha}/LICENSE`;
  const licenseResponse = await request(licenseUrl);
  const licenseText = await licenseResponse.text();

  if (!/CC0 1\.0 Universal/i.test(licenseText)) {
    throw new Error('VCSL LICENSE no longer reads as CC0 1.0 — stopping, manual review needed.');
  }

  const provenanceFile = path.join(licenseDir, 'PROVENANCE.md');

  if (!dryRun && (pinChanged || !(await fileExists(provenanceFile)))) {
    await fs.writeFile(path.join(licenseDir, 'LICENSE'), licenseText);
    await fs.writeFile(
      provenanceFile,
      [
        '# VCSL license evidence',
        '',
        `- Repository: ${REPO_URL}`,
        `- Branch: ${BRANCH}`,
        `- Commit: ${commitSha}`,
        `- License file: ${licenseUrl}`,
        `- Verified: CC0 1.0 Universal, ${new Date().toISOString()}`,
        '',
        'The LICENSE file in this directory is the unmodified text from the pinned commit.',
      ].join('\n'),
    );
  }

  const existing = await readJsonl(manifestFiles.downloads);
  const alreadyDownloaded = new Set(
    existing.filter((entry) => entry.source === 'vcsl').map((entry) => entry.originalPath),
  );

  const picks = [];

  for (const rule of SELECTION) {
    const matches = blobs
      .filter((blob) => rule.match.test(blob.path))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, rule.take);

    if (matches.length === 0) {
      console.warn(`! no matches for ${rule.family}/${rule.bank}: ${rule.match}`);
    }

    for (const blob of matches) {
      picks.push({ rule, blob });
    }
  }

  console.log(`selected ${picks.length} files`);

  let downloaded = 0;
  let skipped = 0;

  for (const { rule, blob } of picks) {
    const fileName = blob.path.split('/').pop();
    const slug = slugify(fileName);
    const localRelative = path.join('raw', 'vcsl', rule.family, `${rule.bank}--${slug}.wav`);
    const localPath = path.join(rawDir, 'vcsl', rule.family, `${rule.bank}--${slug}.wav`);
    const recorded = alreadyDownloaded.has(blob.path);

    // Skip only when the download is both recorded AND present on disk. A
    // committed manifest paired with absent raw audio — a fresh clone or a
    // clean container build — must re-download rather than silently skip and
    // leave an empty library.
    if (recorded && (await fileExists(localPath))) {
      skipped += 1;
      continue;
    }

    const url = `https://raw.githubusercontent.com/${REPO}/${commitSha}/${blob.path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;

    if (dryRun) {
      console.log(`[dry] ${rule.family}/${rule.bank} <- ${blob.path} (${Math.round(blob.size / 1024)} kB)`);
      continue;
    }

    await fs.mkdir(path.dirname(localPath), { recursive: true });
    const bytes = await downloadToFile(url, localPath);

    const header = await fs.readFile(localPath);
    if (bytes < 128 || header.subarray(0, 4).toString() !== 'RIFF') {
      await fs.rm(localPath);
      console.warn(`! not a RIFF wav, removed: ${blob.path}`);
      continue;
    }

    const checksum = await sha256File(localPath);
    const noteMatch = fileName.match(NOTE_PATTERN);

    // Only record genuinely new downloads; re-fetching a file that was already
    // in the manifest must not append a duplicate line.
    if (!recorded) {
      await appendJsonl(manifestFiles.downloads, {
        source: 'vcsl',
        family: rule.family,
        bank: rule.bank,
        originalPath: blob.path,
        localPath: localRelative,
        url,
        repository: REPO_URL,
        commit: commitSha,
        license: 'CC0-1.0',
        licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        licenseEvidence: 'licenses/vcsl/LICENSE',
        note: noteMatch ? noteMatch[1].toLowerCase() : null,
        bytes,
        sha256: checksum,
        downloadedAt: new Date().toISOString(),
      });
    }

    downloaded += 1;
    console.log(`✓ ${rule.family}/${rule.bank} <- ${fileName} (${Math.round(bytes / 1024)} kB)`);
  }

  if (!dryRun && pinChanged) {
    sources.vcsl = {
      repository: REPO_URL,
      branch: BRANCH,
      commit: commitSha,
      license: 'CC0-1.0',
      licenseEvidence: 'licenses/vcsl/LICENSE',
      seededAt: new Date().toISOString(),
    };
    await writeJson(manifestFiles.sources, sources);
  }

  console.log(`done: ${downloaded} downloaded, ${skipped} already present`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

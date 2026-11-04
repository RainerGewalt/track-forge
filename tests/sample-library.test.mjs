// Restoring the recorded sample library on a fresh clone: Wikimedia Commons
// files come back only with their recorded SHA-256, and curation refuses to
// drop banks whose files are missing. Real files in temporary directories and
// an in-process HTTP server stand in for Commons; the license lookup is the
// only stand-in.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { restoreRecorded } from '../scripts/samples/shared/restore.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// A valid 16-bit mono WAV with a short synthetic ramp.
function syntheticWav(samples = 64) {
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) data.writeInt16LE((i * 512) % 32768, i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const CC0_INFO = {
  fileUrl: 'set per test',
  mime: 'audio/x-wav',
  restrictions: '',
  licenseShortName: 'CC0',
  licenseUrl: 'http://creativecommons.org/publicdomain/zero/1.0/deed.en',
  license: 'cc0',
};

async function tempDir(t, prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// One server per test: request() spaces requests to the same host:port.
async function fileServer(t, body) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(200, { 'content-type': 'audio/x-wav' });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}/braam.wav`, requests };
}

function recordedEntry({ fileUrl, bytes }) {
  return {
    source: 'wikimedia',
    family: 'ground',
    bank: 'braam',
    title: 'File:Synthetic braam.wav',
    fileUrl,
    localPath: 'raw/wikimedia/ground/synthetic-braam.wav',
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}

async function quietly(fn) {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

test('a recorded Commons file is restored when its bytes match the recorded SHA-256', async (t) => {
  const root = await tempDir(t, 'track-forge-restore-');
  const audio = syntheticWav();
  const server = await fileServer(t, audio);
  const entry = recordedEntry({ fileUrl: server.url, bytes: audio });

  const result = await quietly(() =>
    restoreRecorded([entry], { root, lookup: async () => ({ ...CC0_INFO, fileUrl: server.url }) }),
  );

  assert.deepEqual(result, { restored: 1, failed: [] });
  assert.ok(audio.equals(await readFile(path.join(root, entry.localPath))));
});

test('a download that no longer matches the recorded SHA-256 is removed and reported', async (t) => {
  const root = await tempDir(t, 'track-forge-restore-');
  const recorded = syntheticWav();
  const changed = Buffer.from(recorded);
  changed[changed.length - 1] ^= 0xff;
  const server = await fileServer(t, changed);
  const entry = recordedEntry({ fileUrl: server.url, bytes: recorded });

  const result = await quietly(() =>
    restoreRecorded([entry], { root, lookup: async () => ({ ...CC0_INFO, fileUrl: server.url }) }),
  );

  assert.equal(result.restored, 0);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0], /bot_braam|ground <- File:Synthetic braam\.wav/);
  assert.match(result.failed[0], /no longer matches the recorded SHA-256/);
  assert.equal(await exists(path.join(root, entry.localPath)), false, 'the mismatching file is not kept');
});

test('a recorded file whose license no longer checks out as CC0 is not downloaded', async (t) => {
  const root = await tempDir(t, 'track-forge-restore-');
  const audio = syntheticWav();
  const server = await fileServer(t, audio);
  const entry = recordedEntry({ fileUrl: server.url, bytes: audio });

  const result = await quietly(() =>
    restoreRecorded([entry], {
      root,
      lookup: async () => ({ ...CC0_INFO, fileUrl: server.url, licenseShortName: 'CC BY-SA 4.0', license: 'cc-by-sa-4.0', licenseUrl: '' }),
    }),
  );

  assert.equal(result.restored, 0);
  assert.match(result.failed[0], /license re-check failed/);
  assert.deepEqual(server.requests, [], 'nothing was downloaded');
});

test('a recorded file that is present locally is neither looked up nor downloaded again', async (t) => {
  const root = await tempDir(t, 'track-forge-restore-');
  const audio = syntheticWav();
  const entry = recordedEntry({ fileUrl: 'http://127.0.0.1:9/unused.wav', bytes: audio });
  await mkdir(path.dirname(path.join(root, entry.localPath)), { recursive: true });
  await writeFile(path.join(root, entry.localPath), audio);
  let lookups = 0;

  const result = await restoreRecorded([entry, { ...entry, source: 'vcsl' }], {
    root,
    lookup: async () => {
      lookups += 1;
      return CC0_INFO;
    },
  });

  assert.deepEqual(result, { restored: 0, failed: [] });
  assert.equal(lookups, 0);
});

// ---------------------------------------------------------------------------
// Curation runs as `npm run samples:curate` does, in a copy of the project.

async function curationProject(t, { present }) {
  const dir = await tempDir(t, 'track-forge-curate-');
  await cp(path.join(repoRoot, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  const library = path.join(dir, 'sample-library');
  await mkdir(path.join(library, 'manifests'), { recursive: true });

  const kick = syntheticWav(32);
  const braam = syntheticWav(96);
  const downloads = [
    { source: 'vcsl', family: 'pulse', bank: 'kick', localPath: 'raw/vcsl/kick.wav', sha256: sha256(kick), license: 'CC0-1.0', url: 'https://example.invalid/kick.wav' },
    { source: 'wikimedia', family: 'ground', bank: 'braam', localPath: 'raw/wikimedia/ground/braam.wav', sha256: sha256(braam), license: 'CC0', fileUrl: 'https://example.invalid/braam.wav' },
  ];
  await writeFile(path.join(library, 'manifests', 'downloads.jsonl'), downloads.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
  const previous = `${JSON.stringify({ generatedAt: '2026-01-01T00:00:00.000Z', counts: { total: 2 }, entries: ['previous'] }, null, 2)}\n`;
  await writeFile(path.join(library, 'manifests', 'library.json'), previous);

  const files = { 'raw/vcsl/kick.wav': kick, 'raw/wikimedia/ground/braam.wav': braam };
  for (const relative of present) {
    await mkdir(path.dirname(path.join(library, relative)), { recursive: true });
    await writeFile(path.join(library, relative), files[relative]);
  }

  return {
    library,
    previous,
    curate: () => spawnSync(process.execPath, [path.join(dir, 'scripts', 'samples', 'curate.mjs')], { encoding: 'utf8' }),
  };
}

test('curation names the banks of missing recorded files and leaves library.json unchanged', async (t) => {
  const project = await curationProject(t, { present: ['raw/vcsl/kick.wav'] });

  const result = project.curate();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /these banks would be incomplete: bot_braam/);
  assert.match(result.stderr, /manifests\/library\.json was left unchanged/);
  assert.equal(await readFile(path.join(project.library, 'manifests', 'library.json'), 'utf8'), project.previous);
});

test('curation records every recorded file with its checksum when all are present', async (t) => {
  const project = await curationProject(t, { present: ['raw/vcsl/kick.wav', 'raw/wikimedia/ground/braam.wav'] });

  const result = project.curate();

  assert.equal(result.status, 0, result.stderr);
  const library = JSON.parse(await readFile(path.join(project.library, 'manifests', 'library.json'), 'utf8'));
  assert.equal(library.counts.total, 2);
  assert.deepEqual(
    library.entries.map((entry) => [entry.family, entry.bank, entry.provenance.sha256.length]),
    [
      ['ground', 'braam', 64],
      ['pulse', 'kick', 64],
    ],
  );
  for (const entry of library.entries) {
    assert.equal(sha256(await readFile(path.join(project.library, entry.file))), entry.provenance.sha256);
  }
});

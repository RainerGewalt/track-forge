// `npm run piece:create` and what the README promises about the new track:
// the four listed files, valid metadata, and a starting arrangement that
// plays on all of its layers for exactly the form piece.json declares.
//
// Each test runs the real scripts in a copy of the project with the
// repository's node_modules linked in. The timeline generator evaluates the
// Strudel pattern offline, as `npm run timeline:previews` does.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function project(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'track-forge-create-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const part of ['scripts', 'templates', 'releases', path.join('src', 'statuses.js')]) {
    await cp(path.join(repoRoot, part), path.join(dir, part), { recursive: true });
  }
  await mkdir(path.join(dir, 'src', 'pieces'), { recursive: true });
  await mkdir(path.join(dir, 'public', 'timeline-previews'), { recursive: true });
  await symlink(path.join(repoRoot, 'node_modules'), path.join(dir, 'node_modules'), 'dir');

  const run = (...args) => spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
  return {
    dir,
    create: (id, title) => run('scripts/create-piece.mjs', id, title),
    previews: (...ids) =>
      run('--experimental-loader', './scripts/timeline/stub-loader.mjs', 'scripts/timeline/generate.mjs', ...ids),
    validate: () => run('scripts/validate-pieces.mjs'),
    pieceFile: (id, file) => path.join(dir, 'src', 'pieces', id, file),
  };
}

test('piece:create writes the four files of a new track with its id and title', async (t) => {
  const p = await project(t);
  const title = 'Night "Signal" – Ä';

  const result = p.create('night-signal', title);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readdir(path.join(p.dir, 'src', 'pieces', 'night-signal'))).sort(), [
    'main.strudel',
    'notes.md',
    'piece.js',
    'piece.json',
  ]);
  const metadata = JSON.parse(await readFile(p.pieceFile('night-signal', 'piece.json'), 'utf8'));
  assert.equal(metadata.id, 'night-signal');
  assert.equal(metadata.title, title);
  const notes = await readFile(p.pieceFile('night-signal', 'notes.md'), 'utf8');
  assert.doesNotMatch(notes, /__PIECE_(ID|TITLE)__/);
});

test('piece:create refuses an existing id and a non-kebab-case id without writing anything', async (t) => {
  const p = await project(t);
  assert.equal(p.create('night-signal', 'Night Signal').status, 0);
  const before = await readFile(p.pieceFile('night-signal', 'piece.json'));

  const again = p.create('night-signal', 'Other Title');
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already exists for id: night-signal/);
  assert.ok(before.equals(await readFile(p.pieceFile('night-signal', 'piece.json'))));

  const invalid = p.create('Night_Signal', 'Night Signal');
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /must be kebab-case/);
  assert.deepEqual(await readdir(path.join(p.dir, 'src', 'pieces')), ['night-signal']);
});

test('a new track passes pieces:validate', async (t) => {
  const p = await project(t);
  assert.equal(p.create('night-signal', 'Night Signal').status, 0);

  const result = p.validate();

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /✓ night-signal/);
});

test("the new track's pattern plays on every layer of piece.json for exactly its declared form", async (t) => {
  const p = await project(t);
  assert.equal(p.create('night-signal', 'Night Signal').status, 0);
  const metadata = JSON.parse(await readFile(p.pieceFile('night-signal', 'piece.json'), 'utf8'));

  const result = p.previews('night-signal');

  assert.equal(result.status, 0, result.stderr);
  const preview = JSON.parse(await readFile(path.join(p.dir, 'public', 'timeline-previews', 'night-signal.json'), 'utf8'));
  const barSeconds = 240 / metadata.bpm;
  assert.equal(metadata.timeline.durationSeconds, metadata.durationTargetMinutes * 60);
  assert.equal(preview.bars, metadata.timeline.durationSeconds / barSeconds);

  // One lane per declared layer, each with events.
  const layerIds = Object.keys(metadata.timeline.layers);
  assert.deepEqual(preview.lanes.map((lane) => lane.label), layerIds);
  for (const lane of preview.lanes) {
    assert.ok(lane.eventCount > 0, `${lane.label} plays`);
  }

  // Every timeline segment matches the pattern: an active segment has
  // onsets inside it, an inactive one has none.
  const stepSeconds = barSeconds / preview.stepsPerBar;
  for (const lane of preview.lanes) {
    for (const segment of metadata.timeline.layers[lane.label].segments) {
      const onsets = lane.events.filter(([step]) => {
        const seconds = step * stepSeconds;
        return seconds >= segment.from && seconds < segment.to;
      }).length;
      if (segment.active === false) {
        assert.equal(onsets, 0, `${lane.label} is silent during "${segment.label}"`);
      } else {
        assert.ok(onsets > 0, `${lane.label} plays during "${segment.label}"`);
      }
    }
  }

  // The arrangement markers fall on bar lines.
  for (const marker of metadata.arrangement) {
    const [minutes, seconds] = marker.at.split(':').map(Number);
    assert.equal(((minutes * 60 + seconds) / barSeconds) % 1, 0, `${marker.phase} starts on a bar line`);
  }
});

test('timeline:previews names the piece.json field a track is missing', async (t) => {
  const p = await project(t);
  assert.equal(p.create('night-signal', 'Night Signal').status, 0);
  const file = p.pieceFile('night-signal', 'piece.json');
  const metadata = JSON.parse(await readFile(file, 'utf8'));
  delete metadata.bpm;
  delete metadata.durationTargetMinutes;
  delete metadata.timeline.durationSeconds;
  await writeFile(file, JSON.stringify(metadata, null, 2));

  const result = p.previews('night-signal');

  assert.match(result.stderr, /night-signal: skipped, piece\.json needs bpm and durationTargetMinutes \(or timeline\.durationSeconds\)/);
});

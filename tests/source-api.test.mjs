import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  hasValidToken,
  listSources,
  replaceSource,
  revisionFor,
  sourcePathFor,
} from '../scripts/source-api.mjs';

test('source paths are restricted to declared Strudel source locations', () => {
  assert.equal(
    sourcePathFor('/workspace/src', {
      kind: 'scene',
      pieceId: 'example-track',
      sourceId: 'main',
    }),
    '/workspace/src/pieces/example-track/main.strudel',
  );

  assert.throws(
    () => sourcePathFor('/workspace/src', { kind: 'scene', pieceId: '..', sourceId: 'main' }),
    /piece identifier is invalid/i,
  );
  assert.throws(
    () => sourcePathFor('/workspace/src', { kind: 'scene', pieceId: 'track', sourceId: '../piece' }),
    /source identifier is invalid/i,
  );
});

test('source operations hydrate files and require the current revision for atomic writes', async (context) => {
  const sourceRoot = await mkdtemp(path.join(tmpdir(), 'track-forge-source-api-'));
  const pieceDirectory = path.join(sourceRoot, 'pieces', 'test-piece');
  const filePath = path.join(pieceDirectory, 'main.strudel');
  const originalCode = 'sound("bd")\n';
  const replacementCode = 'sound("bd sd")\n';

  await mkdir(pieceDirectory, { recursive: true });
  await writeFile(filePath, originalCode, 'utf8');

  context.after(async () => {
    await rm(sourceRoot, { recursive: true, force: true });
  });

  const sources = await listSources(sourceRoot);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].code, originalCode);
  assert.equal(sources[0].revision, revisionFor(originalCode));
  assert.equal(hasValidToken('Bearer private-test-token', 'private-test-token'), true);
  assert.equal(hasValidToken('Bearer wrong-token', 'private-test-token'), false);

  const locator = { kind: 'scene', pieceId: 'test-piece', sourceId: 'main' };
  const saved = await replaceSource(sourceRoot, locator, {
    code: replacementCode,
    expectedRevision: revisionFor(originalCode),
  });

  assert.equal(saved.code, replacementCode);
  assert.equal(saved.revision, revisionFor(replacementCode));
  assert.equal(await readFile(filePath, 'utf8'), replacementCode);

  await assert.rejects(
    replaceSource(sourceRoot, locator, {
      code: 'stale overwrite',
      expectedRevision: revisionFor(originalCode),
    }),
    (error) => error.status === 409 && /changed on disk/i.test(error.message),
  );
  assert.equal(await readFile(filePath, 'utf8'), replacementCode);
});

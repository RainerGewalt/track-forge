import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { writeGeneratedJson } from '../scripts/shared/generated-json.mjs';

async function tempFile(content) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'track-forge-generated-'));
  const file = path.join(directory, 'out.json');
  if (content !== undefined) {
    await fs.writeFile(file, content);
  }
  return file;
}

test('an unchanged generated file keeps its timestamp and bytes', async () => {
  const original = `${JSON.stringify({ generatedAt: '2026-01-01T00:00:00.000Z', items: [1, 2] }, null, 2)}\n`;
  const file = await tempFile(original);

  const written = await writeGeneratedJson(file, {
    generatedAt: '2026-11-04T12:00:00.000Z',
    items: [1, 2],
    ignored: undefined,
  });

  assert.equal(written, false);
  assert.equal(await fs.readFile(file, 'utf8'), original);
});

test('changed content is written with the new timestamp', async () => {
  const file = await tempFile(JSON.stringify({ generatedAt: 'old', items: [1] }));

  const written = await writeGeneratedJson(
    file,
    { generatedAt: 'new', items: [1, 2] },
    { serialize: JSON.stringify },
  );

  assert.equal(written, true);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { generatedAt: 'new', items: [1, 2] });
});

test('a missing file is created', async () => {
  const file = await tempFile();

  assert.equal(await writeGeneratedJson(file, { generatedAt: 'now', items: [] }), true);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { generatedAt: 'now', items: [] });
});

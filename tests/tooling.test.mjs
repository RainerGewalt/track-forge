// Checks on the repository's own documentation, scripts and workflows.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function filesIn(directory, extension) {
  const entries = await readdir(path.join(repoRoot, directory));
  return entries.filter((entry) => entry.endsWith(extension)).map((entry) => path.join(directory, entry));
}

test('every npm script that the documentation and workflows run exists in package.json', async () => {
  const { scripts } = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const documents = [
    'README.md',
    'CONTRIBUTING.md',
    'sample-library/README.md',
    ...(await filesIn('docs', '.md')),
    ...(await filesIn('.github/workflows', '.yml')),
  ];
  const missing = [];

  for (const document of documents) {
    const text = await readFile(path.join(repoRoot, document), 'utf8');
    for (const match of text.matchAll(/npm run ([a-z][\w:-]*)/g)) {
      if (!scripts[match[1]]) missing.push(`${document}: npm run ${match[1]}`);
    }
  }

  assert.deepEqual(missing, []);
});

test('the shell scripts parse', async () => {
  const scripts = ['setup.sh', ...(await filesIn('scripts', '.sh'))];
  for (const script of scripts) {
    const result = spawnSync('bash', ['-n', path.join(repoRoot, script)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
});

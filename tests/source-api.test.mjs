import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fsPromises from 'node:fs/promises';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createSourceServer,
  editorTokenProblem,
  hasValidToken,
  listSources,
  replaceSource,
  revisionFor,
  sourcePathFor,
  sourceSyntaxProblem,
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

// --- writes that must not damage a valid source ----------------------------------------------

const VALID_CODE = 'setcpm(100 / 4)\nnote("e3 g3").s("sine")\n';
const writeToken = 'f'.repeat(48);

async function sourceFixture(context) {
  const sourceRoot = await mkdtemp(path.join(tmpdir(), 'track-forge-source-api-'));
  const pieceDirectory = path.join(sourceRoot, 'pieces', 'test-piece');
  const filePath = path.join(pieceDirectory, 'main.strudel');

  await mkdir(pieceDirectory, { recursive: true });
  await writeFile(filePath, VALID_CODE, 'utf8');
  context.after(async () => {
    await chmod(pieceDirectory, 0o755).catch(() => {});
    await rm(sourceRoot, { recursive: true, force: true });
  });

  return {
    sourceRoot,
    pieceDirectory,
    filePath,
    backupPath: path.join(pieceDirectory, '.main.strudel.bak'),
    locator: { kind: 'scene', pieceId: 'test-piece', sourceId: 'main' },
  };
}

async function startServer(context, options) {
  const server = createSourceServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    async sources() {
      return (await fetch(`${base}/api/sources`)).json();
    },
    async put(code, { token = writeToken, expectedRevision = revisionFor(VALID_CODE) } = {}) {
      const response = await fetch(`${base}/api/source/scene/test-piece/main`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, expectedRevision }),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}

async function leftoverTemporaryFiles(directory) {
  return (await readdir(directory)).filter((name) => name.endsWith('.tmp'));
}

test('a source that does not parse is refused, and the file stays as it was', async (context) => {
  const fixture = await sourceFixture(context);

  await assert.rejects(
    replaceSource(fixture.sourceRoot, fixture.locator, {
      code: 'note("c3 e3".s("sine")',
      expectedRevision: revisionFor(VALID_CODE),
    }),
    (error) => error.status === 422 && /does not parse/i.test(error.message),
  );

  assert.equal(await readFile(fixture.filePath, 'utf8'), VALID_CODE);
  assert.deepEqual(await leftoverTemporaryFiles(fixture.pieceDirectory), []);
  await assert.rejects(stat(fixture.backupPath), { code: 'ENOENT' });
});

test('an empty source is refused, and the file stays as it was', async (context) => {
  const fixture = await sourceFixture(context);

  for (const code of ['', ' \n\t\n']) {
    await assert.rejects(
      replaceSource(fixture.sourceRoot, fixture.locator, { code, expectedRevision: revisionFor(VALID_CODE) }),
      (error) => error.status === 422 && /empty/i.test(error.message),
    );
  }

  assert.equal(await readFile(fixture.filePath, 'utf8'), VALID_CODE);
});

test('the parse check accepts what Strudel accepts: top-level await, labels, comments only', () => {
  for (const code of [
    'await samples("github:tidalcycles/dirt-samples")\ns("bd sd")',
    '$: s("bd*4")\n$: note("c3 e3").s("sine")',
    'setcpm(30)\nconst motif = `<c3 e3>`\nnote(motif).s("triangle")',
    '// only a comment',
  ]) {
    assert.equal(sourceSyntaxProblem(code), null, code);
  }
});

test('the parse check does not run the source', () => {
  globalThis.__trackForgeRan = false;
  assert.equal(sourceSyntaxProblem('globalThis.__trackForgeRan = true'), null);
  assert.equal(globalThis.__trackForgeRan, false);
  delete globalThis.__trackForgeRan;
});

test('a confirmed write keeps the previous version as a hidden backup next to the source', async (context) => {
  const fixture = await sourceFixture(context);
  const replacement = 'note("e3 b3").s("sine")\n';

  await replaceSource(fixture.sourceRoot, fixture.locator, {
    code: replacement,
    expectedRevision: revisionFor(VALID_CODE),
  });

  assert.equal(await readFile(fixture.filePath, 'utf8'), replacement);
  assert.equal(await readFile(fixture.backupPath, 'utf8'), VALID_CODE);
  assert.deepEqual(await leftoverTemporaryFiles(fixture.pieceDirectory), []);
  // The backup is not a source: the service does not list it.
  assert.deepEqual((await listSources(fixture.sourceRoot)).map((source) => source.path), [
    'pieces/test-piece/main.strudel',
  ]);
});

test('when the final rename fails, the source stays unchanged and no temporary file remains', async (context) => {
  const fixture = await sourceFixture(context);
  const fileSystem = {
    ...fsPromises,
    async rename(from, to) {
      if (to === fixture.filePath) {
        throw Object.assign(new Error('simulated I/O error'), { code: 'EIO' });
      }
      return fsPromises.rename(from, to);
    },
  };

  await assert.rejects(
    replaceSource(
      fixture.sourceRoot,
      fixture.locator,
      { code: 'note("e3 b3").s("sine")\n', expectedRevision: revisionFor(VALID_CODE) },
      { fileSystem },
    ),
    /simulated I\/O error/,
  );

  assert.equal(await readFile(fixture.filePath, 'utf8'), VALID_CODE);
  assert.deepEqual(await leftoverTemporaryFiles(fixture.pieceDirectory), []);
});

test('when the backup cannot be written, nothing is replaced', async (context) => {
  const fixture = await sourceFixture(context);
  const fileSystem = {
    ...fsPromises,
    async rename(from, to) {
      if (to === fixture.backupPath) {
        throw Object.assign(new Error('simulated full disk'), { code: 'ENOSPC' });
      }
      return fsPromises.rename(from, to);
    },
  };

  await assert.rejects(
    replaceSource(
      fixture.sourceRoot,
      fixture.locator,
      { code: 'note("e3 b3").s("sine")\n', expectedRevision: revisionFor(VALID_CODE) },
      { fileSystem },
    ),
    /simulated full disk/,
  );

  assert.equal(await readFile(fixture.filePath, 'utf8'), VALID_CODE);
  assert.deepEqual(await leftoverTemporaryFiles(fixture.pieceDirectory), []);
});

test('when the directory is not writable, the source stays unchanged', async (context) => {
  if (process.getuid?.() === 0) {
    context.skip('root ignores directory permissions');
    return;
  }

  const fixture = await sourceFixture(context);
  await chmod(fixture.pieceDirectory, 0o555);

  await assert.rejects(
    replaceSource(fixture.sourceRoot, fixture.locator, {
      code: 'note("e3 b3").s("sine")\n',
      expectedRevision: revisionFor(VALID_CODE),
    }),
    { code: 'EACCES' },
  );

  assert.equal(await readFile(fixture.filePath, 'utf8'), VALID_CODE);
  assert.deepEqual(await leftoverTemporaryFiles(fixture.pieceDirectory), []);
});

test('over HTTP, a source that does not parse is answered with 422 and not written', async (context) => {
  const fixture = await sourceFixture(context);
  const api = await startServer(context, { sourceRoot: fixture.sourceRoot, editorToken: writeToken });

  const refused = await api.put('note("c3 e3".s("sine")');
  assert.equal(refused.status, 422);
  assert.match(refused.body.error, /does not parse/i);
  assert.equal(await readFile(fixture.filePath, 'utf8'), VALID_CODE);

  const accepted = await api.put('note("e3 b3").s("sine")\n');
  assert.equal(accepted.status, 200);
  assert.equal(await readFile(fixture.filePath, 'utf8'), 'note("e3 b3").s("sine")\n');
});

// --- the editor token -------------------------------------------------------------------------

const EXAMPLE_TOKEN = 'replace-with-a-long-random-token';

test('the example token and short tokens never enable writing', async (context) => {
  const fixture = await sourceFixture(context);

  for (const editorToken of [EXAMPLE_TOKEN, ` ${EXAMPLE_TOKEN} `, 'short-token', '', '   ']) {
    const api = await startServer(context, { sourceRoot: fixture.sourceRoot, editorToken });
    assert.equal((await api.sources()).writeEnabled, false, `writeEnabled with ${JSON.stringify(editorToken)}`);

    const refused = await api.put('note("e3 b3").s("sine")\n', { token: editorToken.trim() });
    assert.equal(refused.status, 503, `PUT with ${JSON.stringify(editorToken)}`);
    assert.match(refused.body.error, /SOURCE_EDITOR_TOKEN/);
  }

  assert.match(editorTokenProblem(EXAMPLE_TOKEN), /example/i);
  assert.match(editorTokenProblem('short-token'), /32 characters/);
  assert.match(editorTokenProblem(''), /not set/i);
  assert.equal(editorTokenProblem(writeToken), null);
  assert.equal(await readFile(fixture.filePath, 'utf8'), VALID_CODE);

  const api = await startServer(context, { sourceRoot: fixture.sourceRoot, editorToken: writeToken });
  assert.equal((await api.sources()).writeEnabled, true, 'a 48-character random token enables writing');
});

// Docker Compose reads .env as KEY=VALUE lines and ignores comments.
function composeEnv(text) {
  const env = {};
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return env;
}

test('copying .env.example to .env leaves source writing off', async (context) => {
  const fixture = await sourceFixture(context);
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  const env = composeEnv(example);
  const api = await startServer(context, {
    sourceRoot: fixture.sourceRoot,
    editorToken: env.SOURCE_EDITOR_TOKEN ?? '',
  });

  assert.equal((await api.sources()).writeEnabled, false);
});

test('setup warns when .env carries the example token', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'track-forge-env-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const playerStack = fileURLToPath(new URL('../scripts/player-stack.sh', import.meta.url));

  const check = (envFile) => {
    return writeFile(path.join(directory, '.env'), envFile).then(() =>
      spawnSync('bash', ['-c', `source "${playerStack}"; player_check_editor_token`], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, SOURCE_EDITOR_TOKEN: '' },
      }),
    );
  };

  const example = await check(`SOURCE_EDITOR_TOKEN=${EXAMPLE_TOKEN}\n`);
  assert.equal(example.status, 0, example.stderr);
  assert.match(`${example.stdout}${example.stderr}`, /example/i);
  assert.match(`${example.stdout}${example.stderr}`, /openssl rand -hex 24/);

  const unset = await check('# SOURCE_EDITOR_TOKEN=\n');
  assert.equal(unset.status, 0, unset.stderr);
  assert.match(`${unset.stdout}${unset.stderr}`, /writ\w* (stays |is )?off/i);

  const good = await check(`SOURCE_EDITOR_TOKEN=${writeToken}\n`);
  assert.equal(good.status, 0, good.stderr);
  assert.doesNotMatch(`${good.stdout}${good.stderr}`, /example|off/i);
});

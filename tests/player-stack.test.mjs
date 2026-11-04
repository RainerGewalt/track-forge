// scripts/player-stack.sh, the checks behind `npm run player:start` and
// ./setup.sh, run for real in a temporary project. `docker` and `npm` are
// stubs on PATH that record their calls, so nothing is built or started.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const STUB = `#!/usr/bin/env bash
printf '%s %s\\n' "$(basename "$0")" "$*" >> "$STUB_LOG"
if [ "$(basename "$0") $1 $2" = "docker compose up" ]; then exit "\${STUB_COMPOSE_UP_EXIT:-0}"; fi
exit 0
`;

async function project(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'track-forge-player-stack-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'scripts'));
  await mkdir(path.join(dir, 'stub-bin'));
  await copyFile(path.join(repoRoot, 'scripts', 'player-stack.sh'), path.join(dir, 'scripts', 'player-stack.sh'));
  for (const name of ['docker', 'npm']) {
    await writeFile(path.join(dir, 'stub-bin', name), STUB);
    await chmod(path.join(dir, 'stub-bin', name), 0o755);
  }
  const log = path.join(dir, 'stub-calls.log');
  await writeFile(log, '');

  return {
    dir,
    run(args, env = {}) {
      return spawnSync('bash', args, {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PLAYER_HTTP_PORT: '',
          PLAYER_HTTPS_PORT: '',
          PLAYER_BIND_ADDRESS: '',
          ...env,
          PATH: `${path.join(dir, 'stub-bin')}${path.delimiter}${process.env.PATH}`,
          STUB_LOG: log,
        },
      });
    },
    async calls() {
      return (await readFile(log, 'utf8')).split('\n').filter(Boolean);
    },
    async addCertificates() {
      await mkdir(path.join(dir, 'deploy', 'certs'), { recursive: true });
      for (const file of ['player.crt', 'player.key', 'local-ca.crt']) {
        await writeFile(path.join(dir, 'deploy', 'certs', file), 'synthetic test content\n');
      }
    },
  };
}

async function listening(t) {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

test('player:start refuses without a certificate and builds or starts nothing', async (t) => {
  const stack = await project(t);

  const result = stack.run(['scripts/player-stack.sh', 'start']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing deploy\/certs\/player\.crt/);
  assert.match(result.stderr, /Run \.\/setup\.sh once/);
  assert.deepEqual(await stack.calls(), [], 'no npm or docker call');
  assert.equal(await exists(path.join(stack.dir, 'deploy')), false, 'no certificate path was created');
});

test('player:start names a certificate path that Docker left as a directory and how to remove it', async (t) => {
  const stack = await project(t);
  await mkdir(path.join(stack.dir, 'deploy', 'certs', 'player.crt'), { recursive: true });

  const result = stack.run(['scripts/player-stack.sh', 'start']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /deploy\/certs\/player\.crt should be certificate files but are directories/);
  assert.match(result.stderr, /sudo rmdir deploy\/certs\/player\.crt/);
  assert.deepEqual(await stack.calls(), []);
});

test('player:start refuses a taken port and names the override variables before anything starts', async (t) => {
  const stack = await project(t);
  await stack.addCertificates();
  const taken = await listening(t);

  const result = stack.run(['scripts/player-stack.sh', 'start'], {
    PLAYER_HTTP_PORT: String(taken),
    PLAYER_HTTPS_PORT: String(taken),
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`port ${taken} is already in use on 127\\.0\\.0\\.1`));
  assert.match(result.stderr, /PLAYER_HTTP_PORT=8080 PLAYER_HTTPS_PORT=8443 \.\/setup\.sh/);
  const calls = await stack.calls();
  assert.ok(calls.every((call) => call.startsWith('docker compose ps')), `only the running-player check: ${calls}`);
});

test('player:start validates, builds and starts the stack when certificates and ports are ready', async (t) => {
  const stack = await project(t);
  await stack.addCertificates();
  // A port that was bound and released: nothing accepts connections there.
  const closed = net.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const closedPort = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));

  const result = stack.run(['scripts/player-stack.sh', 'start'], {
    PLAYER_HTTP_PORT: String(closedPort),
    PLAYER_HTTPS_PORT: String(closedPort),
  });

  assert.equal(result.status, 0, result.stderr);
  const calls = (await stack.calls()).filter((call) => !call.startsWith('docker compose ps'));
  assert.deepEqual(calls, ['npm run pieces:validate', 'npm run build', 'docker compose up -d']);
  assert.match(result.stdout, new RegExp(`https://[^ ]+:${closedPort}/`), 'the printed URL carries the port');
});

test('a failed docker compose up is rolled back and reported', async (t) => {
  const stack = await project(t);
  await stack.addCertificates();

  const result = stack.run(['-c', 'source scripts/player-stack.sh; player_compose_up'], { STUB_COMPOSE_UP_EXIT: '1' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /could not start the player .* nothing was left running/);
  assert.deepEqual(await stack.calls(), ['docker compose up -d', 'docker compose down']);
});

test('player ports come from the environment first, then .env, then the defaults 80 and 443', async (t) => {
  const stack = await project(t);
  const ports = (env) =>
    stack.run(['-c', 'source scripts/player-stack.sh; echo "$(player_http_port) $(player_https_port)"'], env).stdout.trim();

  assert.equal(ports(), '80 443');

  await writeFile(path.join(stack.dir, '.env'), 'PLAYER_HTTP_PORT = "8080"\nPLAYER_HTTPS_PORT=8443\n');
  assert.equal(ports(), '8080 8443');
  assert.equal(ports({ PLAYER_HTTPS_PORT: '18443' }), '8080 18443');
});

test('printed player URLs leave out default ports and keep the others', async (t) => {
  const stack = await project(t);
  const urls = (env) =>
    stack.run(['-c', 'source scripts/player-stack.sh; player_print_urls 192.0.2.10'], env).stdout;

  assert.match(urls(), /Player {3}https:\/\/192\.0\.2\.10\/ /);
  assert.match(urls(), /CA cert {2}http:\/\/192\.0\.2\.10\/local-ca\.crt/);

  const custom = urls({ PLAYER_HTTP_PORT: '18080', PLAYER_HTTPS_PORT: '18443' });
  assert.match(custom, /Player {3}https:\/\/192\.0\.2\.10:18443\/ /);
  assert.match(custom, /Studio {3}https:\/\/192\.0\.2\.10:18443\/index\.html/);
  assert.match(custom, /CA cert {2}http:\/\/192\.0\.2\.10:18080\/local-ca\.crt/);
});

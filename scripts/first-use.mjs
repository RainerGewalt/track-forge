#!/usr/bin/env node
// First-use acceptance (L5): follow the README from outside, the way a new
// user does, and print a pass/fail line per step.
//
//   npm run first-use -- --ref <git ref>        a fresh clone of a ref (before a tag)
//   npm run first-use -- --version <x.y.z>      the published release vX.Y.Z (after a tag)
//
// Options:
//   --repo <url>        repository to clone (default: the public repository)
//   --workdir <dir>     clone, logs and report go here (default: a new temporary directory)
//   --skip-full-setup   stop after the dev-server steps and the failure case:
//                       no sample download, no Docker player
//   --keep              keep the clone after the run
//
// Environment: PLAYER_HTTP_PORT and PLAYER_HTTPS_PORT (default here 18080 and
// 18443, the README's override for taken ports), COMPOSE_PROJECT_NAME (default
// track-forge-first-use), CHROME_PATH, GITHUB_TOKEN (optional, for API calls).
//
// Steps: clone -> ./setup.sh --dev --no-samples -> README "Try these first"
// in headless Chrome -> README "Add your first track" with its commands and
// the new track playing -> `npm run player:start` without certificates must
// refuse cleanly -> full ./setup.sh with the sample download -> the restored
// sample library -> the LAN player over HTTPS -> npm run player:stop.
// VERSION mode first checks the GitHub release and the hosted demo.
//
// Exit code 0 only when every step passed. The report is written to
// <workdir>/first-use-report.md and .json, command output to <workdir>/logs.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { findChrome, launchBrowser } from '../tests/e2e/browser.mjs';
import {
  createdTrackPlays,
  exampleTrackPlays,
  keyboardFirstPlay,
  libraryBanksPlay,
  muteAndSeek,
  playerLoadsCleanly,
  playerPlays,
  sampleBrowserNotice,
  studioLoadsCleanly,
  tryDraft,
} from '../tests/e2e/scenarios.mjs';

const DEFAULT_REPO = 'https://github.com/RainerGewalt/track-forge.git';
const GITHUB_REPO = 'RainerGewalt/track-forge';
const HOSTED_DEMO = 'https://rainergewalt.github.io/track-forge/';
const NEW_TRACK = { pieceId: 'night-signal', title: 'Night Signal' };

// Safety nets against hangs, never assertions: each command returns as soon
// as it exits, each server as soon as it prints its address.
const COMMAND_TIMEOUT_MS = 10 * 60_000;
const FULL_SETUP_TIMEOUT_MS = 30 * 60_000;

const { values: options } = parseArgs({
  options: {
    ref: { type: 'string' },
    version: { type: 'string' },
    repo: { type: 'string', default: DEFAULT_REPO },
    workdir: { type: 'string' },
    'skip-full-setup': { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
  },
});

if (Boolean(options.ref) === Boolean(options.version)) {
  console.error('Usage: npm run first-use -- --ref <git ref> | --version <x.y.z>');
  process.exit(2);
}
if (options.version && !/^\d+\.\d+\.\d+$/.test(options.version)) {
  console.error(`--version takes x.y.z, got ${options.version}`);
  process.exit(2);
}

const mode = options.ref ? 'ref' : 'version';
const target = options.ref ?? `v${options.version}`;
const workdir = path.resolve(options.workdir ?? (await mkdtemp(path.join(os.tmpdir(), 'track-forge-first-use-'))));
const logDir = path.join(workdir, 'logs');
const cloneDir = path.join(workdir, 'track-forge');
const failureCaseDir = path.join(workdir, 'failure-case');

const env = {
  ...process.env,
  PLAYER_HTTP_PORT: process.env.PLAYER_HTTP_PORT || '18080',
  PLAYER_HTTPS_PORT: process.env.PLAYER_HTTPS_PORT || '18443',
  COMPOSE_PROJECT_NAME: process.env.COMPOSE_PROJECT_NAME || 'track-forge-first-use',
  FORCE_COLOR: '0',
  NO_COLOR: '1',
};

// --------------------------------------------------------------------------
// Report

const steps = [];
const started = new Date();

function line(step) {
  const seconds = step.seconds === undefined ? '' : `${step.seconds.toFixed(1)} s`;
  return `${step.status.toUpperCase().padEnd(4)}  ${step.id.padEnd(30)} ${seconds.padStart(8)}  ${step.detail ?? ''}`;
}

async function step(id, title, fn, { needs = [] } = {}) {
  const blocked = needs.filter((need) => steps.find((done) => done.id === need)?.status !== 'pass');
  if (blocked.length > 0) {
    const record = { id, title, status: 'skip', detail: `needs ${blocked.join(', ')}` };
    steps.push(record);
    console.log(line(record));
    return null;
  }

  const begin = performance.now();
  const record = { id, title };
  try {
    const result = await fn();
    record.status = 'pass';
    record.detail = typeof result === 'string' ? result : (result?.detail ?? '');
    record.result = result;
  } catch (error) {
    record.status = 'fail';
    record.detail = (error?.message ?? String(error)).replace(/\s+/g, ' ').slice(0, 600);
  }
  record.seconds = (performance.now() - begin) / 1000;
  steps.push(record);
  console.log(line(record));
  return record.status === 'pass' ? record.result : null;
}

async function writeReport(meta) {
  const passed = steps.filter((s) => s.status === 'pass').length;
  const failed = steps.filter((s) => s.status === 'fail').length;
  const skipped = steps.filter((s) => s.status === 'skip').length;
  const markdown = [
    `# Track Forge first use: ${mode} ${target}`,
    '',
    `- Repository: ${options.repo}`,
    `- Commit: ${meta.commit ?? 'unknown'}`,
    `- Started: ${started.toISOString()}, took ${((Date.now() - started) / 60000).toFixed(1)} min`,
    `- Runner: Node ${process.version}, ${meta.chrome ?? 'no Chrome'}, ${os.platform()} ${os.release()}`,
    `- Player ports: ${env.PLAYER_HTTP_PORT} and ${env.PLAYER_HTTPS_PORT}`,
    `- Result: ${passed} passed, ${failed} failed, ${skipped} skipped`,
    '',
    '| Step | Result | Time | Detail |',
    '| --- | --- | --- | --- |',
    ...steps.map(
      (s) =>
        `| ${s.id} | ${s.status.toUpperCase()} | ${s.seconds === undefined ? '' : `${s.seconds.toFixed(1)} s`} | ${(s.detail ?? '').replace(/\|/g, '\\|')} |`,
    ),
    '',
  ].join('\n');
  await writeFile(path.join(workdir, 'first-use-report.md'), markdown);
  await writeFile(
    path.join(workdir, 'first-use-report.json'),
    `${JSON.stringify({ mode, target, repo: options.repo, ...meta, started: started.toISOString(), steps: steps.map(({ result, ...rest }) => rest) }, null, 2)}\n`,
  );
  return { passed, failed, skipped };
}

// --------------------------------------------------------------------------
// Processes. Every child gets its own process group, so stopping it stops
// everything it started (setup.sh -> npm -> vite) and nothing else.

const children = new Set();

function startProcess(command, args, { cwd, logName, input } = {}) {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  const chunks = [];
  const listeners = new Set();
  const onData = (chunk) => {
    chunks.push(chunk);
    for (const listener of listeners) listener();
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  if (input !== undefined) child.stdin.end(input);
  else child.stdin.end();

  const exited = new Promise((resolve) => {
    child.on('error', (error) => {
      chunks.push(Buffer.from(`\n${error.message}\n`));
      resolve(127);
    });
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
  exited.then(async () => {
    children.delete(child);
    if (logName) await writeFile(path.join(logDir, `${logName}.log`), Buffer.concat(chunks));
    for (const listener of listeners) listener();
  });

  return {
    child,
    exited,
    output: () => Buffer.concat(chunks).toString().replace(/\x1b\[[0-9;]*m/g, ''),
    onOutput: (listener) => listeners.add(listener),
    stop: async () => {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already gone
      }
      return exited;
    },
  };
}

async function runCommand(command, args, { cwd = cloneDir, logName, input, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  const run = startProcess(command, args, { cwd, logName, input });
  const timer = setTimeout(() => run.stop(), timeoutMs);
  const code = await run.exited;
  clearTimeout(timer);
  return { code, output: run.output() };
}

async function mustRun(command, args, opts = {}) {
  const result = await runCommand(command, args, opts);
  if (result.code !== 0) {
    const tail = result.output.trim().split('\n').slice(-6).join(' / ');
    throw new Error(`${[command, ...args].join(' ')} exited ${result.code}: ${tail}`);
  }
  return result.output;
}

// Starts a command that ends in the Vite dev server and resolves with the
// address Vite prints once it listens.
function startDevServer(command, args, logName) {
  const run = startProcess(command, args, { cwd: cloneDir, logName });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      await run.stop();
      reject(new Error(`no dev server address within ${COMMAND_TIMEOUT_MS / 1000} s`));
    }, COMMAND_TIMEOUT_MS);
    const check = () => {
      const match = /Local:\s+(http:\/\/\S+)/.exec(run.output());
      if (match) {
        clearTimeout(timer);
        resolve({ url: match[1], run, output: run.output });
      }
    };
    run.onOutput(check);
    run.exited.then((code) => {
      clearTimeout(timer);
      reject(new Error(`exited ${code} before the dev server listened: ${run.output().trim().split('\n').slice(-6).join(' / ')}`));
    });
  });
}

function git(args, cwd = cloneDir) {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function trackedChanges(cwd = cloneDir) {
  return git(['status', '--porcelain', '--untracked-files=no'], cwd)
    .split('\n')
    .filter(Boolean);
}

function composeServices(cwd) {
  const result = spawnSync('docker', ['compose', 'ps', '--all', '--quiet'], { cwd, env, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.split('\n').filter(Boolean) : [];
}

// Docker creates missing bind-mount sources as root; remove them through a
// container, as the current user cannot.
async function removeTree(dir) {
  if (!existsSync(dir)) return;
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    spawnSync('docker', ['run', '--rm', '-v', `${dir}:/cleanup`, 'nginx:1.27-alpine', 'sh', '-c', 'rm -rf /cleanup/* /cleanup/.[!.]*'], {
      env,
    });
    await rm(dir, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------------
// HTTP checks for the LAN player, with TLS verified against the local CA.

function request(url, { ca } = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { ca, timeout: 15_000 }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('timeout', () => req.destroy(new Error(`timeout for ${url}`)));
    req.on('error', reject);
  });
}

async function githubJson(apiPath) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'track-forge-first-use' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}${apiPath}`, { headers });
  if (!response.ok) throw new Error(`GitHub API ${apiPath}: HTTP ${response.status}`);
  return response.json();
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// --------------------------------------------------------------------------

const meta = {};
let browser;
let devServer;

async function main() {
  await rm(cloneDir, { recursive: true, force: true }).catch(() => removeTree(cloneDir));
  await removeTree(failureCaseDir);
  await mkdir(logDir, { recursive: true });

  console.log(`Track Forge first use: ${mode} ${target}`);
  console.log(`work directory: ${workdir}\n`);

  await step('prerequisites', 'Git, Node.js 20+, npm, Docker Compose, OpenSSL and Chrome are available', async () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 20) throw new Error(`Node.js ${process.version} is older than 20`);
    const missing = [];
    const version = (command, args) => {
      const result = spawnSync(command, args, { encoding: 'utf8' });
      if (result.status !== 0) missing.push(command);
      return result.stdout.trim().split('\n')[0];
    };
    const npm = version('npm', ['--version']);
    version('git', ['--version']);
    if (!options['skip-full-setup']) {
      version('docker', ['compose', 'version']);
      version('openssl', ['version']);
    }
    if (!findChrome()) missing.push('Chrome (set CHROME_PATH)');
    if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
    return `node ${process.version}, npm ${npm}`;
  });

  if (mode === 'version') {
    await step('release', `GitHub release ${target} is published`, async () => {
      const release = await githubJson(`/releases/tags/${target}`);
      if (release.draft) throw new Error(`${target} is still a draft`);
      meta.releasePublishedAt = release.published_at;
      return `published ${release.published_at}`;
    }, { needs: ['prerequisites'] });
  }

  await step('clone', mode === 'ref' ? `fresh clone of ${target}` : `fresh clone of the tag ${target}`, async () => {
    if (mode === 'version') {
      await mustRun('git', ['clone', '--quiet', '--depth', '1', '--branch', target, options.repo, cloneDir], { cwd: workdir, logName: 'clone' });
    } else {
      await mustRun('git', ['clone', '--quiet', '--no-checkout', options.repo, cloneDir], { cwd: workdir, logName: 'clone' });
      const remote = spawnSync('git', ['rev-parse', '--verify', '--quiet', `origin/${target}`], { cwd: cloneDir, encoding: 'utf8' });
      git(['checkout', '--quiet', '--detach', remote.status === 0 ? `origin/${target}` : target]);
    }
    meta.commit = git(['rev-parse', 'HEAD']);
    return `${options.repo.replace(/^https:\/\/github\.com\//, '')} at ${meta.commit.slice(0, 12)}`;
  }, { needs: mode === 'version' ? ['prerequisites', 'release'] : ['prerequisites'] });

  browser = existsSync(cloneDir) && findChrome() ? await launchBrowser({ ignoreCertificateErrors: true }) : null;
  meta.chrome = browser?.version;

  if (mode === 'version') {
    await step('hosted-demo', 'the hosted demo on GitHub Pages loads, plays and explains the missing sample audio', async () => {
      const deployments = await githubJson('/deployments?environment=github-pages&per_page=1');
      const deployed = deployments[0]?.sha;
      await studioLoadsCleanly(browser, HOSTED_DEMO);
      await playerLoadsCleanly(browser, HOSTED_DEMO);
      await sampleBrowserNotice(browser, HOSTED_DEMO, { installed: false });
      const played = await exampleTrackPlays(browser, HOSTED_DEMO);
      const note = deployed && deployed !== meta.commit ? `; built from ${deployed.slice(0, 12)}, not from ${target}` : '';
      return `plays (RMS ${played.level.toFixed(4)})${note}`;
    }, { needs: ['clone'] });
  }

  // README "Fastest start" -------------------------------------------------

  await step('dev-setup', './setup.sh --dev --no-samples starts the Studio', async () => {
    devServer = await startDevServer('./setup.sh', ['--dev', '--no-samples'], 'dev-setup');
    if (/✗/.test(devServer.output())) throw new Error('setup reported a failed step');
    return devServer.url;
  }, { needs: ['clone'] });

  await step('dev-setup-clean-tree', 'setup leaves the tracked files of the clone unchanged', async () => {
    const changes = trackedChanges();
    if (changes.length) throw new Error(`modified: ${changes.join(', ')}`);
    return 'no tracked file changed';
  }, { needs: ['dev-setup'] });

  // README "Try these first" -----------------------------------------------

  const devNeeds = { needs: ['dev-setup'] };
  await step('studio-loads', 'the Studio loads without failed requests or console errors', async () => {
    const result = await studioLoadsCleanly(browser, devServer.url);
    return `${result.requests} requests, none failed, no source-service request`;
  }, devNeeds);

  await step('player-loads', 'the player loads without failed requests or console errors', async () => {
    const result = await playerLoadsCleanly(browser, devServer.url);
    return `${result.requests} requests, none failed`;
  }, devNeeds);

  await step('first-play', 'Try these first 1: Play Full Track plays with signal on the first click', async () => {
    const result = await exampleTrackPlays(browser, devServer.url);
    return `RMS ${result.level.toFixed(4)}, ${result.worklets} AudioWorklet nodes, no getTrigger error`;
  }, devNeeds);

  await step('first-play-keyboard', 'the first play started with Space loads the AudioWorklet effects first', async () => {
    const result = await keyboardFirstPlay(browser, devServer.url);
    return `RMS ${result.level.toFixed(4)}, no getTrigger error`;
  }, devNeeds);

  await step('mute-and-seek', 'Try these first 2: mute a lane and drag the position marker', async () => {
    const result = await muteAndSeek(browser, devServer.url);
    return `seek to ${result.committed} s (.early(${result.cycles})), muted ${result.muted}, still playing`;
  }, devNeeds);

  await step('try-draft', 'Try these first 3: View main source, change a value, Try Draft', async () => {
    const result = await tryDraft(browser, devServer.url, {
      mainFile: path.join(cloneDir, 'src', 'pieces', 'example-track', 'main.strudel'),
    });
    return `draft plays (RMS ${result.level.toFixed(4)}), main.strudel unchanged`;
  }, devNeeds);

  if (devServer) await devServer.run.stop();
  devServer = null;

  // README "Add your first track" ------------------------------------------

  const commands = [
    ['piece-create', ['run', 'piece:create', '--', NEW_TRACK.pieceId, NEW_TRACK.title]],
    ['timeline-previews', ['run', 'timeline:previews']],
    ['pieces-validate', ['run', 'pieces:validate']],
    ['npm-test', ['test']],
    ['npm-build', ['run', 'build']],
  ];
  for (const [id, args] of commands) {
    await step(id, `npm ${args.join(' ')}`, async () => {
      const output = await mustRun('npm', args, { logName: id });
      if (id === 'piece-create') {
        const files = (await readdir(path.join(cloneDir, 'src', 'pieces', NEW_TRACK.pieceId))).sort();
        const expected = ['main.strudel', 'notes.md', 'piece.js', 'piece.json'];
        if (files.join() !== expected.join()) throw new Error(`created ${files.join(', ')}, the README lists ${expected.join(', ')}`);
        return files.join(', ');
      }
      if (id === 'timeline-previews') {
        const preview = path.join(cloneDir, 'public', 'timeline-previews', `${NEW_TRACK.pieceId}.json`);
        if (!existsSync(preview)) {
          const skipped = output.split('\n').find((text) => text.includes(NEW_TRACK.pieceId)) ?? 'no preview written';
          throw new Error(`no preview for ${NEW_TRACK.pieceId}: ${skipped.trim()}`);
        }
        const lanes = JSON.parse(await readFile(preview, 'utf8')).lanes;
        return `${NEW_TRACK.pieceId}: ${lanes.map((lane) => `${lane.label} ${lane.eventCount}`).join(', ')} events`;
      }
      return output.trim().split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 120) ?? '';
    }, { needs: id === 'piece-create' ? ['clone'] : ['piece-create'] });
  }

  await step('new-track-plays', 'the new track shows up and plays with signal in the Studio and the player', async () => {
    devServer = await startDevServer('npm', ['run', 'dev'], 'dev-server-new-track');
    try {
      const result = await createdTrackPlays(browser, devServer.url, NEW_TRACK);
      return `Studio RMS ${result.studioLevel.toFixed(4)}, player RMS ${result.playerLevel.toFixed(4)}`;
    } finally {
      await devServer.run.stop();
      devServer = null;
    }
  }, { needs: ['piece-create', 'dev-setup'] });

  // Failure case: the LAN player before ./setup.sh created a certificate.
  // It runs in a second copy of the same commit with the installed
  // dependencies, so whatever it leaves behind cannot affect later steps.

  await step('player-start-refuses', 'npm run player:start without certificates refuses cleanly and starts nothing', async () => {
    await mkdir(failureCaseDir, { recursive: true });
    await mustRun('bash', ['-c', `git -C "${cloneDir}" archive HEAD | tar -x -C "${failureCaseDir}"`], { cwd: workdir });
    await symlink(path.join(cloneDir, 'node_modules'), path.join(failureCaseDir, 'node_modules'), 'dir');
    const result = await runCommand('npm', ['run', 'player:start'], { cwd: failureCaseDir, logName: 'player-start-refuses' });
    const certs = path.join(failureCaseDir, 'deploy', 'certs');
    const leftovers = existsSync(certs)
      ? (await readdir(certs, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => `deploy/certs/${entry.name}/`)
      : [];
    const containers = composeServices(failureCaseDir);
    if (containers.length) spawnSync('docker', ['compose', 'down'], { cwd: failureCaseDir, env });
    const problems = [];
    if (result.code === 0) problems.push('exited 0');
    if (!/missing deploy\/certs\/.*Run \.\/setup\.sh/s.test(result.output)) problems.push('no message naming the missing certificate and ./setup.sh');
    if (leftovers.length) problems.push(`Docker created directories ${leftovers.join(', ')}`);
    if (containers.length) problems.push(`${containers.length} containers were created`);
    if (problems.length) throw new Error(problems.join('; '));
    return `exit ${result.code}: ${result.output.split('\n').find((text) => text.includes('missing'))?.trim()}`;
  }, { needs: ['dev-setup'] });
  await removeTree(failureCaseDir);

  if (options['skip-full-setup']) {
    return;
  }

  // README "Put the player on your local network" --------------------------

  await step('full-setup', `./setup.sh with PLAYER_HTTP_PORT=${env.PLAYER_HTTP_PORT} PLAYER_HTTPS_PORT=${env.PLAYER_HTTPS_PORT}`, async () => {
    // The setup asks for the LAN address once; Enter accepts its suggestion.
    const output = await mustRun('./setup.sh', [], { logName: 'full-setup', input: '\n', timeoutMs: FULL_SETUP_TIMEOUT_MS });
    if (!/Done\./.test(output)) throw new Error('setup did not print Done.');
    const playerUrl = /Player\s+(https:\/\/\S+)/.exec(output)?.[1];
    return `player at ${playerUrl}`;
  }, { needs: ['dev-setup'] });

  await step('sample-library', 'every recorded sample bank is restored with its recorded checksum', async () => {
    const committed = JSON.parse(git(['show', 'HEAD:sample-library/manifests/library.json']));
    const expectedBanks = new Set(committed.entries.map((entry) => `bot_${entry.bank}`));
    const problems = [];
    for (const entry of committed.entries) {
      const file = path.join(cloneDir, 'public', 'samples', 'library', 'audio', entry.family, entry.bank, entry.fileName);
      try {
        if (sha256(await readFile(file)) !== entry.provenance.sha256) problems.push(`${entry.bank}/${entry.fileName}: checksum differs`);
      } catch {
        problems.push(`bot_${entry.bank}/${entry.fileName}: missing`);
      }
    }
    const map = JSON.parse(await readFile(path.join(cloneDir, 'public', 'samples', 'library', 'strudel-samples.json'), 'utf8'));
    const banks = Object.keys(map).filter((key) => !key.startsWith('_'));
    const samples = banks.reduce((sum, bank) => sum + Object.values(map[bank]).length, 0);
    const lost = [...expectedBanks].filter((bank) => !banks.includes(bank));
    if (lost.length) problems.unshift(`banks missing from strudel-samples.json: ${lost.join(', ')}`);
    const changes = trackedChanges().filter((change) => /sample-library|public\/samples/.test(change));
    if (changes.length) problems.push(`tracked manifests rewritten: ${changes.join(', ')}`);
    if (problems.length) throw new Error(`${banks.length} of ${expectedBanks.size} banks, ${samples} of ${committed.entries.length} samples; ${problems.slice(0, 8).join('; ')}`);
    return `${banks.length} banks, ${samples} samples, all ${committed.entries.length} checksums match`;
  }, { needs: ['clone'] });

  const httpsBase = `https://127.0.0.1:${env.PLAYER_HTTPS_PORT}/`;
  const httpBase = `http://127.0.0.1:${env.PLAYER_HTTP_PORT}/`;

  await step('lan-player-https', 'the LAN player answers over HTTPS with the local CA, redirects HTTP and serves the CA', async () => {
    const ca = await readFile(path.join(cloneDir, 'deploy', 'certs', 'local-ca.crt'));
    const problems = [];
    const player = await request(httpsBase, { ca });
    if (player.status !== 200 || !player.body.includes('player-root')) problems.push(`/ answered ${player.status}`);
    const studio = await request(`${httpsBase}index.html`, { ca });
    if (studio.status !== 200 || !studio.body.includes('id="root"')) problems.push(`/index.html answered ${studio.status}`);
    const api = await request(`${httpsBase}api/sources`, { ca });
    let sources = null;
    try {
      sources = JSON.parse(api.body).sources;
    } catch {
      // reported below
    }
    if (api.status !== 200 || !Array.isArray(sources)) problems.push(`/api/sources answered ${api.status} without a source list`);
    const redirect = await request(`${httpBase}player.html`);
    const expected = `${httpsBase}player.html`;
    if (redirect.headers.location !== expected) problems.push(`HTTP redirects to ${redirect.headers.location}, expected ${expected}`);
    const caFile = await request(`${httpBase}local-ca.crt`);
    if (caFile.status !== 200 || !/BEGIN CERTIFICATE/.test(caFile.body)) problems.push(`/local-ca.crt answered ${caFile.status}`);
    const disposition = caFile.headers['content-disposition'] ?? '';
    if (!/track-forge-local-ca\.crt/.test(disposition)) problems.push(`CA downloads as "${disposition}"`);
    if (problems.length) throw new Error(problems.join('; '));
    return 'TLS verified with deploy/certs/local-ca.crt, redirect keeps the port, source service reachable';
  }, { needs: ['full-setup'] });

  const lanNeeds = { needs: ['full-setup'] };
  await step('lan-studio-loads', 'the Studio over HTTPS loads cleanly and reaches the source service', async () => {
    const result = await studioLoadsCleanly(browser, httpsBase, { pieceIds: ['example-track', NEW_TRACK.pieceId], sourceService: true });
    if (result.apiRequests === 0) throw new Error('the Studio did not ask the source service');
    return `${result.requests} requests, none failed`;
  }, lanNeeds);

  await step('lan-player-plays', 'the LAN player plays the example track and the new track with signal', async () => {
    const example = await playerPlays(browser, httpsBase);
    const created = await playerPlays(browser, httpsBase, { ...NEW_TRACK, usesWorklet: false });
    return `example RMS ${example.level.toFixed(4)}, ${NEW_TRACK.pieceId} RMS ${created.level.toFixed(4)}`;
  }, lanNeeds);

  await step('lan-sample-banks-play', 'the restored Wikimedia Commons banks play from the LAN player', async () => {
    const committed = JSON.parse(git(['show', 'HEAD:sample-library/manifests/library.json']));
    const banks = [...new Set(committed.entries.filter((entry) => entry.source === 'wikimedia').map((entry) => `bot_${entry.bank}`))];
    await sampleBrowserNotice(browser, httpsBase, { installed: true });
    const result = await libraryBanksPlay(browser, httpsBase, { banks });
    return `${banks.join(', ')}: RMS ${result.level.toFixed(4)}; sample browser without the not-installed notice`;
  }, { needs: ['full-setup', 'sample-library'] });

  await step('player-stop', 'npm run player:stop stops and removes the player', async () => {
    await mustRun('npm', ['run', 'player:stop'], { logName: 'player-stop' });
    const left = composeServices(cloneDir);
    if (left.length) throw new Error(`${left.length} containers remain`);
    return 'no containers left';
  }, { needs: ['full-setup'] });
}

async function cleanup() {
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // gone
    }
  }
  await browser?.close().catch(() => {});
  for (const dir of [cloneDir, failureCaseDir]) {
    if (existsSync(path.join(dir, 'compose.yaml')) && composeServices(dir).length) {
      spawnSync('docker', ['compose', 'down'], { cwd: dir, env });
    }
  }
  await removeTree(failureCaseDir);
  if (!options.keep) await removeTree(cloneDir);
}

let exitCode = 1;
try {
  await main();
} catch (error) {
  steps.push({ id: 'runner', title: 'first-use runner', status: 'fail', detail: error.stack ?? String(error) });
  console.log(line(steps.at(-1)));
} finally {
  await cleanup();
  const { passed, failed, skipped } = await writeReport(meta);
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`report: ${path.join(workdir, 'first-use-report.md')}`);
  exitCode = failed === 0 && passed > 0 ? 0 : 1;
}
process.exit(exitCode);

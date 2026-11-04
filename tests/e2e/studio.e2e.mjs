// L4 browser scenarios: the Studio and the player in headless Chrome against
// the Vite dev server, plus the hosted-demo build served like GitHub Pages.
//
// Run with `npm run test:e2e`. Needs Chrome or Chromium (CHROME_PATH) and
// network access for Strudel's default sample maps.
//
// The suite scaffolds one track with `npm run piece:create` before the dev
// server starts and removes it afterwards. It refuses to run when a track
// with that id already exists.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { launchBrowser } from './browser.mjs';
import {
  createdTrackPlays,
  exampleTrackPlays,
  keyboardFirstPlay,
  muteAndSeek,
  playerLoadsCleanly,
  playerPlays,
  sampleBrowserNotice,
  studioLoadsCleanly,
  tryDraft,
} from './scenarios.mjs';
import { buildHostedDemo, sampleAudioInstalled, servePages, startDevServer } from './servers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NEW_TRACK = { pieceId: 'e2e-new-track', title: 'E2E New Track' };
const newTrackDir = path.join(repoRoot, 'src', 'pieces', NEW_TRACK.pieceId);
const newTrackPreview = path.join(repoRoot, 'public', 'timeline-previews', `${NEW_TRACK.pieceId}.json`);
const audioInstalled = sampleAudioInstalled(repoRoot);

let browser;
let devServer;
let pages;
let demoDir;
let createdTrack = false;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

before(async () => {
  assert.ok(!existsSync(newTrackDir), `${path.relative(repoRoot, newTrackDir)} exists; remove it before running the suite`);

  // The hosted-demo build comes first, so it contains only committed tracks.
  demoDir = await mkdtemp(path.join(os.tmpdir(), 'track-forge-demo-'));
  await buildHostedDemo(repoRoot, demoDir);
  pages = await servePages(demoDir);

  // The README's "Add your first track", for one scaffolded track.
  createdTrack = true;
  run(process.execPath, ['scripts/create-piece.mjs', NEW_TRACK.pieceId, NEW_TRACK.title]);
  run(process.execPath, [
    '--experimental-loader',
    './scripts/timeline/stub-loader.mjs',
    'scripts/timeline/generate.mjs',
    NEW_TRACK.pieceId,
  ]);

  devServer = await startDevServer(repoRoot, { port: Number(process.env.E2E_PORT ?? 5173) });
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await devServer?.close();
  await pages?.close();
  if (demoDir) await rm(demoDir, { recursive: true, force: true });
  if (createdTrack) {
    await rm(newTrackDir, { recursive: true, force: true });
    await rm(newTrackPreview, { force: true });
  }
});

describe('Studio and player on the dev server', () => {
  it('the Studio loads without failed requests or console errors and asks for no source service', async () => {
    await studioLoadsCleanly(browser, devServer.url, { pieceIds: ['example-track', NEW_TRACK.pieceId] });
  });

  it('the player loads without failed requests or console errors', async () => {
    await playerLoadsCleanly(browser, devServer.url);
  });

  it('the example track plays with signal on the first play, without an AudioWorklet error', async () => {
    const result = await exampleTrackPlays(browser, devServer.url);
    assert.ok(result.worklets > 0, 'the example track exercised an AudioWorklet effect');
  });

  it('the first play started with the Space key loads the AudioWorklet effects before the first notes', async () => {
    await keyboardFirstPlay(browser, devServer.url);
  });

  it('dragging the position marker restarts at that position and a muted lane drops out while the rest plays', async () => {
    await muteAndSeek(browser, devServer.url);
  });

  it('Try Draft plays the edited source and leaves main.strudel on disk unchanged', async () => {
    await tryDraft(browser, devServer.url, {
      mainFile: path.join(repoRoot, 'src', 'pieces', 'example-track', 'main.strudel'),
    });
  });

  it('a track created with piece:create shows up and plays with signal in the Studio and the player', async () => {
    await createdTrackPlays(browser, devServer.url, NEW_TRACK);
  });

  it('the player plays the example track with signal', async () => {
    await playerPlays(browser, devServer.url);
  });
});

describe('hosted-demo build served under /track-forge/', () => {
  it('the Studio loads every file under the base path and asks for no source service', async () => {
    await studioLoadsCleanly(browser, pages.url);
  });

  it('the player loads every file under the base path', async () => {
    await playerLoadsCleanly(browser, pages.url);
  });

  it('the sample browser says that the sample audio is not installed', async (t) => {
    if (audioInstalled) {
      t.skip('public/samples/library/audio is installed here, so the build contains the audio');
      return;
    }
    await sampleBrowserNotice(browser, pages.url, { installed: false });
  });

  it('the example track plays with signal in the hosted demo', async () => {
    await exampleTrackPlays(browser, pages.url);
  });
});

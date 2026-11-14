// L4 browser scenarios for behavior that only the real Strudel runtime and
// real Web Audio show: the draft gate in front of "Prepare Overwrite", the
// audio master behind the spectrum and the hard stop, and what the hosted
// demo says about itself.
//
// Run with `npm run test:e2e`. Needs Chrome or Chromium (CHROME_PATH). It
// builds the app twice into a temporary directory (the LAN player build and
// the hosted-demo build), serves them on ports the system picks, and lets the
// source service write to a copy of src/, never to the repository.
//
// Each scenario opens its own page. A wait ends on the signal it waits for;
// the bounds in browser.mjs only stop a hang.

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { launchBrowser } from './browser.mjs';
import { buildApp, serveLocalStack, servePages } from './stack.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// -60 dBFS: the hard-stop bound. Music in the example track peaks far above.
const SILENCE_PEAK = 0.001;

let work;
let sourceRoot;
let mainFile;
let editorToken;
let browser;
let stack;
let pages;

before(async () => {
  work = await mkdtemp(path.join(os.tmpdir(), 'track-forge-e2e-'));
  sourceRoot = path.join(work, 'src');
  mainFile = path.join(sourceRoot, 'pieces', 'example-track', 'main.strudel');
  await cp(path.join(repoRoot, 'src'), sourceRoot, { recursive: true });
  editorToken = randomBytes(24).toString('hex');

  await buildApp(repoRoot, path.join(work, 'local'));
  await buildApp(repoRoot, path.join(work, 'demo'), { base: '/track-forge/', sourceService: 'off' });

  stack = await serveLocalStack(path.join(work, 'local'), { sourceRoot, editorToken });
  pages = await servePages(path.join(work, 'demo'));
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  await stack?.close();
  await pages?.close();
  if (work) await rm(work, { recursive: true, force: true });
});

// --------------------------------------------------------------------------
// Page helpers
// --------------------------------------------------------------------------

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function waitForStrudel(page) {
  await page.waitFor(`document.querySelector('strudel-editor')?.editor`, { what: 'the Strudel editor engine' });
  await page.evaluate(
    `Promise.resolve(document.querySelector('strudel-editor').editor.prebaked).then(() => true, () => true)`,
  );
}

async function openStudio(url) {
  const page = await browser.newPage();
  await page.goto(url);
  await page.waitFor(`document.querySelector('[data-track-list] [data-piece-id]')`, { what: 'the Studio track list' });
  await waitForStrudel(page);
  return page;
}

async function openPlayer(url) {
  const page = await browser.newPage();
  await page.goto(new URL('player.html', url).href);
  await page.waitFor(`document.querySelector('[data-library] [data-action="pick"]')`, {
    what: 'the player track library',
  });
  await waitForStrudel(page);
  return page;
}

const transportStatus = `window.strudelWorkspace.transport.getState().status`;
const inspectorState = `document.querySelector('[data-inspector-state]')`;
const prepareButton = `document.querySelector('[data-action="prepare-source-save"]')`;

async function openMainSource(page) {
  await page.click('[data-action="view-source"][data-scene-id="main"]');
  await page.waitFor(`document.querySelector('[data-inspector]').open`, { what: 'the source inspector' });
  return page.evaluate(`${inspectorState}.textContent`);
}

// Replaces the editor contents the way a paste does, then runs Try Draft and
// waits until the trial has an outcome.
async function tryDraft(page, code) {
  await page.evaluate(`(() => {
    const editor = document.querySelector('[data-inspector-editor]');
    editor.focus();
    editor.select();
    return true;
  })()`);
  await page.insertText(code);
  await page.click('[data-action="try-source"]');
  await page.waitFor(
    `${transportStatus} !== 'loading' && !${inspectorState}.textContent.startsWith('Evaluating')`,
    { what: 'the outcome of Try Draft' },
  );
}

async function trialState(page) {
  return page.evaluate(`({
    prepareDisabled: ${prepareButton}.disabled,
    status: ${transportStatus},
    message: ${inspectorState}.textContent,
    isError: ${inspectorState}.classList.contains('is-error'),
  })`);
}

// Peak of what reaches the speakers of the realtime AudioContext, read from
// the probe's analyser (connected to everything that reaches a destination).
const OUTPUT_PEAK = `(() => {
  const tap = __tf.taps.find((candidate) => !(candidate.context instanceof OfflineAudioContext));
  if (!tap) return 0;
  const samples = new Float32Array(tap.fftSize);
  tap.getFloatTimeDomainData(samples);
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
})()`;

async function waitForMusic(page, what) {
  return page.waitFor(`(() => { const peak = ${OUTPUT_PEAK}; return peak > 0.01 ? peak : 0; })()`, {
    what: `music at the speakers (${what})`,
  });
}

// Waits on the audio clock until the analyser window lies completely after
// the first 100 ms past the stop, then returns the peak in that window.
async function peakAfterStop(page) {
  return page.evaluate(`new Promise((resolve) => {
    const tap = __tf.taps.find((candidate) => !(candidate.context instanceof OfflineAudioContext));
    const context = tap.context;
    const until = context.currentTime + 0.1 + tap.fftSize / context.sampleRate;
    const check = () => {
      if (context.currentTime >= until) resolve(${OUTPUT_PEAK});
      else setTimeout(check, 10);
    };
    check();
  })`);
}

// --------------------------------------------------------------------------
// The draft gate (E1)
// --------------------------------------------------------------------------

describe('the draft gate in front of Prepare Overwrite (LAN player build with source service)', () => {
  it('a draft that does not evaluate is not playing, keeps Prepare Overwrite disabled and leaves the file unchanged', async () => {
    const page = await openStudio(stack.url);
    const before = await sha256(mainFile);
    const opened = await openMainSource(page);
    assert.match(opened, /try the draft before overwriting/i, 'the source service allows writes in this stack');

    await tryDraft(page, 'note("c3 e3".s("sine")');
    const state = await trialState(page);

    assert.equal(state.status, 'error', 'transport status after a draft with a syntax error');
    assert.equal(state.prepareDisabled, true, `Prepare Overwrite after a failed draft; inspector says: ${state.message}`);
    assert.equal(state.isError, true, 'the inspector shows the failure as an error');
    assert.match(state.message, /failed during evaluation/i);
    assert.doesNotMatch(state.message, /draft is playing/i);
    assert.equal(await sha256(mainFile), before, 'main.strudel on disk');

    // The failed draft leaves its error in Strudel's state; the saved
    // version must still play afterwards.
    await page.click('[data-action="close-inspector"]');
    await page.click('[data-action="play-full"]');
    await page.waitFor(`${transportStatus} !== 'loading'`, { what: 'the saved version to start' });
    assert.equal(await page.evaluate(transportStatus), 'playing', 'the saved version plays after a failed draft');
    await waitForMusic(page, 'the saved version after a failed draft');
    await page.close();
  });

  it('a draft that evaluates but cannot play its sound keeps Prepare Overwrite disabled and leaves the file unchanged', async () => {
    const page = await openStudio(stack.url);
    const before = await sha256(mainFile);
    await openMainSource(page);

    await tryDraft(page, 'note("e3 g3").s("sine-typo")');
    // The ordered signal: Strudel reports the failed note in its log.
    await page.waitFor(`__tf.logs.some((entry) => /\\[getTrigger\\] error: sound sine-typo not found/.test(entry.message))`, {
      what: 'the runtime error of the draft',
    });
    const state = await trialState(page);

    assert.equal(state.prepareDisabled, true, `Prepare Overwrite after a draft that plays nothing; inspector says: ${state.message}`);
    assert.equal(state.isError, true, 'the inspector shows the failure as an error');
    assert.match(state.message, /sine-typo/);
    assert.equal(await sha256(mainFile), before, 'main.strudel on disk');
    await page.close();
  });

  it('a draft that plays unlocks Prepare Overwrite, and Confirm writes exactly that draft', async () => {
    const page = await openStudio(stack.url);
    await openMainSource(page);
    const original = await readFile(mainFile, 'utf8');
    const draft = original.replace('setcpm(100 / 4)', 'setcpm(120 / 4)');
    assert.notEqual(draft, original);

    await tryDraft(page, draft);
    await waitForMusic(page, 'the valid draft');
    const state = await trialState(page);
    assert.equal(state.status, 'playing');
    assert.equal(state.prepareDisabled, false, `Prepare Overwrite after a draft that plays; inspector says: ${state.message}`);

    await page.click('[data-action="prepare-source-save"]');
    await page.waitFor(`!document.querySelector('[data-source-confirm]').hidden`, { what: 'the confirmation panel' });
    await page.evaluate(`(() => { document.querySelector('[data-source-token]').focus(); return true; })()`);
    await page.insertText(editorToken);
    await page.click('[data-action="confirm-source-save"]');
    await page.waitFor(`${inspectorState}.textContent.startsWith('Saved to disk')`, { what: 'the confirmed write' });

    assert.equal(await readFile(mainFile, 'utf8'), draft, 'main.strudel holds the tried draft');
    await page.close();
  });
});

// --------------------------------------------------------------------------
// The audio master (E2)
// --------------------------------------------------------------------------

describe('the audio master behind the spectrum and the hard stop', () => {
  it('Stop in the Studio silences the output within 100 ms, reverb and long notes included', async () => {
    const page = await openStudio(stack.url);
    await page.click('[data-action="play-full"]');
    await page.waitFor(`${transportStatus} === 'playing'`, { what: 'Studio playback' });
    await waitForMusic(page, 'Studio');

    await page.click('[data-action="transport-toggle"]');
    await page.waitFor(`${transportStatus} === 'stopped'`, { what: 'the Studio stop' });
    const peak = await peakAfterStop(page);

    assert.ok(peak < SILENCE_PEAK, `peak 100 ms after Stop is ${peak.toFixed(5)}, want below ${SILENCE_PEAK} (-60 dBFS)`);
    await page.close();
  });

  it('the player spectrum shows the music, and its stop silences the output within 100 ms', async () => {
    const page = await openPlayer(stack.url);
    await page.click('[data-library] [data-action="pick"]');
    await waitForMusic(page, 'player');

    // Twelve readings over three seconds of playback, after the first notes
    // with reverb: whenever the speakers carry music, the spectrum shows bars
    // above its baseline. Silence draws only the labels and the baseline.
    const readings = await page.evaluate(`new Promise((resolve) => {
      const readings = [];
      const timer = setInterval(() => {
        const canvas = document.querySelector('[data-spectrum]');
        const ratio = window.devicePixelRatio || 1;
        const top = Math.max(1, canvas.height - 20 * ratio);
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, top).data;
        let painted = 0;
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) painted += 1;
        readings.push({ peak: ${OUTPUT_PEAK}, painted });
        if (readings.length === 12) {
          clearInterval(timer);
          resolve(readings);
        }
      }, 250);
    })`);
    const withMusic = readings.filter((reading) => reading.peak > 0.02);
    assert.ok(withMusic.length >= 6, `music in only ${withMusic.length} of 12 readings`);
    const flat = withMusic.filter((reading) => reading.painted < 200);
    assert.deepEqual(flat, [], 'readings where the speakers carry music but the spectrum is flat');

    await page.click('[data-action="toggle"]');
    await page.waitFor(`document.querySelector('[data-play-icon]').textContent === '▶'`, { what: 'the player stop' });
    const peak = await peakAfterStop(page);

    assert.ok(peak < SILENCE_PEAK, `peak 100 ms after Stop is ${peak.toFixed(5)}, want below ${SILENCE_PEAK} (-60 dBFS)`);
    await page.close();
  });
});

// --------------------------------------------------------------------------
// Stop keeps the position, Back to start returns to zero (owner request of
// 14 November 2026: Stop and Reset are different things)
// --------------------------------------------------------------------------

const transportElapsed = `window.strudelWorkspace.transport.getState().elapsedSeconds`;
const wait = (ms) => `new Promise((resolve) => setTimeout(resolve, ${ms}))`;

describe('Stop keeps the position, Play continues there, Back to start returns to zero', () => {
  it('in the Studio', async () => {
    const page = await openStudio(stack.url);
    await page.click('[data-action="play-full"]');
    await page.waitFor(`${transportStatus} === 'playing'`, { what: 'Studio playback' });
    await waitForMusic(page, 'Studio');
    await page.evaluate(wait(2500));

    await page.click('[data-action="transport-toggle"]');
    await page.waitFor(`${transportStatus} === 'stopped'`, { what: 'the Studio stop' });
    const peak = await peakAfterStop(page);
    assert.ok(peak < SILENCE_PEAK, `peak 100 ms after Stop is ${peak.toFixed(5)}, want below ${SILENCE_PEAK}`);
    const kept = await page.evaluate(transportElapsed);
    assert.ok(kept >= 2, `Stop kept ${kept} s, want the position after about three seconds of playback`);
    await page.evaluate(wait(1000));
    assert.equal(await page.evaluate(transportElapsed), kept, 'the position does not move while stopped');

    await page.click('[data-action="transport-toggle"]');
    await page.waitFor(`${transportStatus} === 'playing'`, { what: 'Play after Stop' });
    const resumedAt = await page.evaluate(transportElapsed);
    assert.ok(resumedAt >= kept - 0.05, `Play after Stop started at ${resumedAt} s, want ${kept} s or later`);
    await waitForMusic(page, 'the resumed Studio playback');

    await page.click('[data-action="transport-reset"]');
    await page.waitFor(`${transportStatus} === 'playing' && ${transportElapsed} < 1`, { what: 'back to start while playing' });

    await page.click('[data-action="transport-toggle"]');
    await page.waitFor(`${transportStatus} === 'stopped'`, { what: 'the second Studio stop' });
    await page.click('[data-action="transport-reset"]');
    await page.waitFor(`${transportStatus} === 'stopped' && ${transportElapsed} === 0`, { what: 'back to start while stopped' });
    await page.close();
  });

  it('in the player', async () => {
    const page = await openPlayer(stack.url);
    const playerElapsed = `window.trackForgePlayer?.transport?.getState().elapsedSeconds ?? Number((document.querySelector('[data-clock]').textContent.split(' / ')[0] || '0:00').split(':').reduce((m, s) => m * 60 + Number(s), 0))`;
    await page.click('[data-library] [data-action="pick"]');
    await waitForMusic(page, 'player');
    await page.evaluate(wait(3000));

    await page.click('[data-action="toggle"]');
    await page.waitFor(`document.querySelector('[data-play-icon]').textContent === '▶'`, { what: 'the player stop' });
    const peak = await peakAfterStop(page);
    assert.ok(peak < SILENCE_PEAK, `peak 100 ms after Stop is ${peak.toFixed(5)}, want below ${SILENCE_PEAK}`);
    const kept = await page.evaluate(playerElapsed);
    assert.ok(kept >= 2, `the player clock shows ${kept} s after Stop, want the kept position`);

    await page.click('[data-action="toggle"]');
    await page.waitFor(`document.querySelector('[data-play-icon]').textContent === '■'`, { what: 'Play after Stop in the player' });
    assert.ok((await page.evaluate(playerElapsed)) >= kept, 'the player continues at the kept position');

    await page.click('[data-action="toggle"]');
    await page.waitFor(`document.querySelector('[data-play-icon]').textContent === '▶'`, { what: 'the second player stop' });
    await page.click('[data-action="reset"]');
    await page.waitFor(`(${playerElapsed}) === 0`, { what: 'back to start in the player' });
    await page.close();
  });
});

// --------------------------------------------------------------------------
// What the hosted demo says about itself (U4)
// --------------------------------------------------------------------------

describe('the hosted demo says that nothing is saved', () => {
  it('the Studio of the demo shows the demo notice, claims no local files, and the inspector reports no outage', async () => {
    const page = await openStudio(pages.url);
    const text = await page.evaluate('document.body.innerText');
    assert.match(text, /Demo: drafts play in your browser; nothing is saved/);
    assert.doesNotMatch(text, /plain local files/);

    const opened = await openMainSource(page);
    assert.doesNotMatch(opened, /not reachable/i);
    assert.match(opened, /nothing is saved/i);
    await page.close();
  });

  it('the player of the demo shows the demo notice and does not claim to be served from your machine', async () => {
    const page = await openPlayer(pages.url);
    const text = await page.evaluate('document.body.innerText');
    assert.match(text, /Demo: tracks play in your browser; nothing is saved/);
    assert.doesNotMatch(text, /your own machine/);
    await page.close();
  });

  it('the LAN player build shows no demo notice', async () => {
    const studio = await openStudio(stack.url);
    assert.doesNotMatch(await studio.evaluate('document.body.innerText'), /Demo:/);
    await studio.close();
    const player = await openPlayer(stack.url);
    assert.doesNotMatch(await player.evaluate('document.body.innerText'), /Demo:/);
    await player.close();
  });
});

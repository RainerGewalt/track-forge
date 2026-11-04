// Browser scenarios shared by the L4 suite (tests/e2e/studio.e2e.mjs) and
// the first-use run (scripts/first-use.mjs). Each scenario opens its own
// page, so every play is the first play after a page load, and throws with
// a readable message when a property does not hold.
//
// "Plays" is proven in this order, each step an observed signal:
//   1. the app reports playback (transport status, play button label),
//   2. the Strudel scheduler reports started,
//   3. the AudioContext is running,
//   4. the analyser tapped onto the speakers sees non-zero signal energy,
//   5. no getTrigger or AudioWorklet error was logged on that first play,
//      and the first AudioWorklet effect node, if the track uses one, was
//      created successfully.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Root mean square above -80 dBFS counts as signal. A stopped or silent
// graph reads exactly zero.
export const SIGNAL_THRESHOLD = 1e-4;

const AUDIO_PROBLEM = /getTrigger|AudioWorkletNode cannot be created|could not load AudioWorklet|AudioWorkletGlobalScope/i;

export function joinUrl(base, relative = '') {
  return new URL(relative, base.endsWith('/') ? base : `${base}/`).href;
}

// --------------------------------------------------------------------------
// Page readiness
// --------------------------------------------------------------------------

// The app is ready when its track list is rendered and Strudel's prebake
// (synth registration and the default sample maps) has settled.
async function waitForStrudel(page) {
  await page.waitFor(`document.querySelector('strudel-editor')?.editor`, {
    what: 'the Strudel editor engine',
  });
  await page.evaluate(
    `Promise.resolve(document.querySelector('strudel-editor').editor.prebaked).then(() => true, () => true)`,
  );
}

export async function openStudio(browser, baseUrl) {
  const page = await browser.newPage();
  await page.goto(joinUrl(baseUrl));
  await page.waitFor(`document.querySelector('[data-track-list] [data-piece-id]')`, {
    what: 'the Studio track list',
  });
  await waitForStrudel(page);
  return page;
}

export async function openPlayer(browser, baseUrl) {
  const page = await browser.newPage();
  await page.goto(joinUrl(baseUrl, 'player.html'));
  await page.waitFor(`document.querySelector('[data-library] [data-action="pick"]')`, {
    what: 'the player track library',
  });
  await waitForStrudel(page);
  return page;
}

// Requests that reach the source service. Present in the LAN player only.
export function apiRequests(page) {
  return [...page.requests.values()].filter((request) => /\/api\//.test(new URL(request.url).pathname));
}

export async function assertCleanPage(page, label) {
  await page.settleNetwork();
  const failed = page.failedRequests();
  const errors = page.consoleErrors();
  assert.deepEqual(failed, [], `${label}: failed requests`);
  assert.deepEqual(errors, [], `${label}: console errors`);
  return { requests: page.requests.size };
}

// --------------------------------------------------------------------------
// Playback signals
// --------------------------------------------------------------------------

async function updateCount(page) {
  return page.evaluate('__tf.updates.length');
}

// Waits for a scheduler start reported after `afterUpdate` and returns the
// code it is playing.
async function waitForSchedulerStart(page, afterUpdate, what) {
  const index = await page.waitFor(
    `(() => {
      const updates = __tf.updates;
      for (let i = updates.length - 1; i >= ${afterUpdate}; i -= 1) {
        if (updates[i].started && !updates[i].error) return i + 1;
      }
      return 0;
    })()`,
    { what: `the Strudel scheduler to start (${what})` },
  );
  return page.evaluate(`__tf.updates[${index - 1}].activeCode`);
}

export async function audioProblems(page) {
  const logs = await page.evaluate('__tf.logs.map((entry) => entry.message)');
  const worklets = await page.evaluate('__tf.worklets.filter((entry) => !entry.ok)');
  return [
    ...logs.filter((message) => AUDIO_PROBLEM.test(message)).map((message) => `strudel log: ${message}`),
    ...page.consoleMessages
      .filter((message) => AUDIO_PROBLEM.test(message.text))
      .map((message) => `console ${message.type}: ${message.text}`),
    ...worklets.map((entry) => `AudioWorkletNode ${entry.name}: ${entry.error}`),
  ];
}

export async function waitForSignal(page, what) {
  const level = await page.waitFor(
    `(() => { const level = __tf.level(); return level > ${SIGNAL_THRESHOLD} ? level : 0; })()`,
    { what: `signal energy above ${SIGNAL_THRESHOLD} (${what})` },
  );
  return level;
}

// Steps 2 to 5 of the "plays" proof, after the app reported playback.
export async function assertPlaying(page, { afterUpdate, what, usesWorklet = false }) {
  const activeCode = await waitForSchedulerStart(page, afterUpdate, what);
  const contextStates = await page.evaluate('__tf.contexts.map((context) => context.state)');
  assert.ok(contextStates.includes('running'), `${what}: no running AudioContext (${contextStates.join(', ')})`);
  const level = await waitForSignal(page, what);

  if (usesWorklet) {
    // The first effect worklet node is created when its first note plays.
    await page.waitFor('__tf.worklets.length > 0', { what: `the first AudioWorklet node (${what})` });
  }

  assert.deepEqual(await audioProblems(page), [], `${what}: audio errors on the first play`);
  return { activeCode, level, worklets: await page.evaluate('__tf.worklets.length') };
}

// The scheduler's current pattern, queried ahead of the playhead: the exact
// events Strudel will play next, grouped by audio orbit.
export async function upcomingOrbits(page, cycles = 4) {
  return page.evaluate(`(() => {
    const scheduler = document.querySelector('strudel-editor').editor.repl.scheduler;
    const now = scheduler.now();
    const counts = {};
    for (const hap of scheduler.pattern.queryArc(now, now + ${cycles})) {
      if (!hap.whole || hap.whole.begin.valueOf() !== hap.part.begin.valueOf()) continue;
      const orbit = String(hap.value?.orbit ?? 0);
      counts[orbit] = (counts[orbit] ?? 0) + 1;
    }
    return counts;
  })()`);
}

// --------------------------------------------------------------------------
// Studio actions
// --------------------------------------------------------------------------

export async function selectStudioTrack(page, pieceId) {
  await page.click(`button[data-action="select-piece"][data-piece-id="${pieceId}"]`);
  await page.waitFor(
    `document.querySelector('button[data-action="select-piece"][data-piece-id="${pieceId}"][aria-current="true"]')`,
    { what: `${pieceId} to be selected` },
  );
}

export async function playStudioTrack(page, { pieceId, usesWorklet = false }) {
  await selectStudioTrack(page, pieceId);
  const before = await updateCount(page);
  await page.click('button[data-action="play-full"]');
  await page.waitFor(`document.querySelector('.transport-status.is-playing')`, {
    what: `the transport to report playing (${pieceId})`,
  });
  return assertPlaying(page, { afterUpdate: before, what: `${pieceId} in the Studio`, usesWorklet });
}

// --------------------------------------------------------------------------
// Scenarios
// --------------------------------------------------------------------------

export async function studioLoadsCleanly(browser, baseUrl, { pieceIds = ['example-track'], sourceService = false } = {}) {
  const page = await openStudio(browser, baseUrl);
  try {
    const listed = await page.evaluate(
      `[...document.querySelectorAll('[data-track-list] button[data-action="select-piece"]')].map((button) => button.dataset.pieceId)`,
    );
    for (const pieceId of pieceIds) {
      assert.ok(listed.includes(pieceId), `the Studio lists ${pieceId} (listed: ${listed.join(', ')})`);
    }
    assert.ok(
      await page.evaluate(`/Built on Strudel/.test(document.querySelector('.attribution')?.textContent ?? '')`),
      'the Studio shows the "Built on Strudel" attribution',
    );
    const clean = await assertCleanPage(page, 'Studio');
    const api = apiRequests(page);
    if (!sourceService) {
      assert.deepEqual(api.map((request) => request.url), [], 'the Studio does not ask for a source service here');
    }
    return { ...clean, listed, apiRequests: api.length };
  } finally {
    await page.close();
  }
}

export async function playerLoadsCleanly(browser, baseUrl, { sourceService = false } = {}) {
  const page = await openPlayer(browser, baseUrl);
  try {
    assert.ok(
      await page.evaluate(`/Built on Strudel/.test(document.querySelector('.pp-attribution')?.textContent ?? '')`),
      'the player shows the "Built on Strudel" attribution',
    );
    const clean = await assertCleanPage(page, 'Player');
    const api = apiRequests(page);
    if (!sourceService) {
      assert.deepEqual(api.map((request) => request.url), [], 'the player does not ask for a source service here');
    }
    return clean;
  } finally {
    await page.close();
  }
}

// README "Try these first", step 1.
export async function exampleTrackPlays(browser, baseUrl) {
  const page = await openStudio(browser, baseUrl);
  try {
    const played = await playStudioTrack(page, { pieceId: 'example-track', usesWorklet: true });
    await assertCleanPage(page, 'Studio while playing');
    return { level: played.level, worklets: played.worklets };
  } finally {
    await page.close();
  }
}

// The first play started with the Space shortcut. A key press is no
// mousedown, so Strudel's own audio initialisation on the first click never
// runs; the app has to load the AudioWorklet effects itself before the first
// notes. The example track's kick uses the "shape" worklet.
export async function keyboardFirstPlay(browser, baseUrl) {
  const page = await openStudio(browser, baseUrl);
  try {
    // Select the track from the keyboard as well: focus its button, Enter.
    const trackButton = 'button[data-action="select-piece"][data-piece-id="example-track"]';
    await page.evaluate(`document.querySelector('${trackButton}').focus()`);
    await page.press('Enter', { code: 'Enter', keyCode: 13, text: '\r' });
    await page.waitFor(`document.querySelector('${trackButton}[aria-current="true"]')`, {
      what: 'example-track to be selected from the keyboard',
    });
    // Move focus off the track button, so Space reaches the window handler
    // instead of activating the focused button.
    await page.evaluate(`document.activeElement?.blur()`);
    const before = await updateCount(page);
    await page.press(' ', { code: 'Space', keyCode: 32, text: ' ' });
    await page.waitFor(`document.querySelector('.transport-status.is-playing')`, {
      what: 'the transport to report playing after Space',
    });
    const played = await assertPlaying(page, { afterUpdate: before, what: 'example-track started with Space', usesWorklet: true });
    return { level: played.level, worklets: played.worklets };
  } finally {
    await page.close();
  }
}

// README "Try these first", step 2: mute a lane with its speaker button and
// drag the red position marker.
export async function muteAndSeek(browser, baseUrl, { bpm = 100 } = {}) {
  const page = await openStudio(browser, baseUrl);
  try {
    await playStudioTrack(page, { pieceId: 'example-track', usesWorklet: true });

    // Seek: drag the position marker from the start to the middle.
    const beforeSeek = await updateCount(page);
    await page.drag('[data-song-position]', 0.02, 0.5);
    const committed = await page.waitFor(`__tf.seeks.length > 0 ? __tf.seeks[__tf.seeks.length - 1] : 0`, {
      what: 'the position marker to commit a position',
    });
    const max = await page.evaluate(`Number(document.querySelector('[data-song-position]').max)`);
    assert.ok(committed > max * 0.4 && committed < max * 0.6, `the drag lands mid-track (${committed} of ${max} s)`);
    const seekedCode = await waitForSchedulerStart(page, beforeSeek, 'after the seek');
    const cycles = Number(((committed * bpm) / 240).toFixed(6));
    assert.ok(
      seekedCode?.trimEnd().endsWith(`.early(${cycles})`),
      `the scheduler restarts ${cycles} cycles into the arrangement`,
    );
    const seekLevel = await waitForSignal(page, 'after the seek');

    // Mute: pick a lane that has events in the next bars, then mute it.
    const preview = await page.evaluate(
      `fetch(new URL('timeline-previews/example-track.json', document.baseURI)).then((response) => response.json())`,
    );
    const ahead = await upcomingOrbits(page);
    const lane = preview.lanes.find((candidate) => ahead[String(candidate.orbit)] > 0);
    assert.ok(lane, `a lane plays in the next bars (orbits ahead: ${JSON.stringify(ahead)})`);
    const muteButton = `button[data-action="toggle-layer-mute"][data-scene-id="${lane.label}"]`;
    await page.waitFor(`document.querySelector('${muteButton}') && !document.querySelector('${muteButton}').disabled`, {
      what: `the mute button of ${lane.label}`,
    });

    const beforeMute = await updateCount(page);
    await page.click(muteButton);
    await page.waitFor(`document.querySelector('${muteButton}[aria-pressed="true"]')`, {
      what: `${lane.label} to show as muted`,
    });
    const mutedCode = await waitForSchedulerStart(page, beforeMute, 'after the mute');
    assert.match(mutedCode ?? '', new RegExp(`\\.filterValues\\(.*\\[${lane.orbit}\\]`), 'the muted orbit is filtered');

    const afterMute = await upcomingOrbits(page);
    assert.equal(afterMute[String(lane.orbit)] ?? 0, 0, `no events remain on the muted ${lane.label} orbit`);
    assert.ok(
      Object.keys(afterMute).some((orbit) => orbit !== String(lane.orbit) && afterMute[orbit] > 0),
      `the other lanes keep playing (${JSON.stringify(afterMute)})`,
    );
    const muteLevel = await waitForSignal(page, 'after the mute');
    assert.deepEqual(await audioProblems(page), [], 'audio errors during mute and seek');
    await assertCleanPage(page, 'Studio after mute and seek');

    return { committed, cycles, muted: lane.label, seekLevel, muteLevel };
  } finally {
    await page.close();
  }
}

// README "Try these first", step 3: open View main source, change a value,
// then click Try Draft. The file on disk must stay unchanged.
export async function tryDraft(browser, baseUrl, { mainFile, sourceService = false } = {}) {
  const before = mainFile ? await readFile(mainFile) : null;
  const page = await openStudio(browser, baseUrl);
  try {
    await selectStudioTrack(page, 'example-track');
    await page.click('button[data-action="view-source"][data-scene-id="main"]');
    await page.waitFor(`document.querySelector('[data-inspector]').open`, { what: 'the Source Inspector to open' });

    const original = await page.evaluate(`document.querySelector('[data-inspector-editor]').value`);
    const match = /setcpm\((\d+)/.exec(original);
    assert.ok(match, 'the example source sets its tempo with setcpm');
    const draft = original.replace(match[0], `setcpm(${Number(match[1]) + 8}`);

    await page.evaluate(`(() => { const editor = document.querySelector('[data-inspector-editor]'); editor.focus(); editor.select(); })()`);
    await page.insertText(draft);
    assert.equal(
      await page.evaluate(`document.querySelector('[data-inspector-editor]').value`),
      draft,
      'the edited draft is in the editor',
    );

    const beforeTry = await updateCount(page);
    await page.click('button[data-action="try-source"]');
    const status = await page.waitFor(
      `(() => { const text = document.querySelector('[data-inspector-state]').textContent; return /^Draft is playing/.test(text) ? text : ''; })()`,
      { what: 'the inspector to report the draft as playing' },
    );
    const played = await assertPlaying(page, { afterUpdate: beforeTry, what: 'the draft', usesWorklet: true });
    assert.equal(played.activeCode?.trim(), draft.trim(), 'the scheduler plays the edited draft');

    const prepareDisabled = await page.evaluate(`document.querySelector('[data-action="prepare-source-save"]').disabled`);
    if (!sourceService) {
      assert.equal(prepareDisabled, true, 'Prepare Overwrite stays off without a source service');
    }
    if (mainFile) {
      assert.ok(before.equals(await readFile(mainFile)), `${path.basename(mainFile)} on disk is unchanged`);
    }
    await assertCleanPage(page, 'Studio after Try Draft');
    return { status, level: played.level };
  } finally {
    await page.close();
  }
}

// A track created with `npm run piece:create` shows up in the Studio and in
// the player, and plays with signal in both. The player draws its lanes from
// the timeline preview; the Studio draws lanes only for standalone layer
// files, which the scaffold does not have.
export async function createdTrackPlays(browser, baseUrl, { pieceId, title, layers = ['pulse', 'lead', 'ground'] }) {
  const studio = await openStudio(browser, baseUrl);
  let studioLevel;
  try {
    await selectStudioTrack(studio, pieceId);
    const heading = await studio.evaluate(`document.querySelector('[data-track-header] h2')?.textContent`);
    assert.equal(heading, title, 'the Studio shows the new track title');
    const played = await playStudioTrack(studio, { pieceId });
    studioLevel = played.level;
    await assertCleanPage(studio, `Studio playing ${pieceId}`);
  } finally {
    await studio.close();
  }

  const player = await openPlayer(browser, baseUrl);
  try {
    const before = await updateCount(player);
    await player.click(`button[data-action="pick"][data-id="${pieceId}"]`);
    await player.waitFor(
      `document.querySelector('[data-action="toggle"]')?.getAttribute('aria-label') === ${JSON.stringify(`Stop ${title}`)}`,
      { what: `the player to report ${title} as playing` },
    );
    const played = await assertPlaying(player, { afterUpdate: before, what: `${pieceId} in the player` });
    await player.waitFor(`!document.querySelector('[data-lanes]').hidden`, { what: `the lanes of ${pieceId}` });
    const preview = await player.evaluate(
      `fetch(new URL('timeline-previews/${pieceId}.json', document.baseURI)).then((response) => response.json())`,
    );
    assert.deepEqual(
      preview.lanes.map((lane) => lane.label),
      layers,
      'the timeline preview has one lane per piece.json layer',
    );
    await assertCleanPage(player, `Player playing ${pieceId}`);
    return { studioLevel, playerLevel: played.level };
  } finally {
    await player.close();
  }
}

// The player page plays a track from its library.
export async function playerPlays(browser, baseUrl, { pieceId = 'example-track', title = 'Example Track', usesWorklet = true } = {}) {
  const page = await openPlayer(browser, baseUrl);
  try {
    const before = await updateCount(page);
    await page.click(`button[data-action="pick"][data-id="${pieceId}"]`);
    await page.waitFor(
      `document.querySelector('[data-action="toggle"]')?.getAttribute('aria-label') === ${JSON.stringify(`Stop ${title}`)}`,
      { what: `the player to report ${title} as playing` },
    );
    const played = await assertPlaying(page, { afterUpdate: before, what: `${pieceId} in the player`, usesWorklet });
    await assertCleanPage(page, 'Player while playing');
    return { level: played.level };
  } finally {
    await page.close();
  }
}

// The sample browser explains when the sample audio is not installed.
export async function sampleBrowserNotice(browser, baseUrl, { installed }) {
  const page = await openStudio(browser, baseUrl);
  try {
    await page.click('button[data-action="open-samples"]');
    await page.waitFor(`document.querySelector('[data-samples]').open && document.querySelector('[data-samples] .samples-bank')`, {
      what: 'the sample browser to list the banks',
    });
    const notice = await page.evaluate(`document.querySelector('[data-samples] .samples-notice')?.textContent.trim() ?? null`);
    if (installed) {
      assert.equal(notice, null, 'no "not installed" notice when the sample audio is installed');
    } else {
      assert.match(notice ?? '', /sample audio is not installed/i, 'the sample browser says the audio is not installed');
    }
    await assertCleanPage(page, 'Studio with the sample browser open');
    return { notice };
  } finally {
    await page.close();
  }
}

// Plays a draft that uses library sample banks, through the Try Draft path,
// and proves the restored files decode and sound.
export async function libraryBanksPlay(browser, baseUrl, { banks }) {
  const page = await openStudio(browser, baseUrl);
  try {
    await selectStudioTrack(page, 'example-track');
    await page.click('button[data-action="view-source"][data-scene-id="main"]');
    await page.waitFor(`document.querySelector('[data-inspector]').open`, { what: 'the Source Inspector to open' });
    const mapUrl = joinUrl(baseUrl, 'samples/library/strudel-samples.json');
    const draft = [
      `await samples('${mapUrl}')`,
      `s("${banks.join(' ')}").clip(1).gain(.8)`,
    ].join('\n');
    await page.evaluate(`(() => { const editor = document.querySelector('[data-inspector-editor]'); editor.focus(); editor.select(); })()`);
    await page.insertText(draft);

    const before = await updateCount(page);
    await page.click('button[data-action="try-source"]');
    await page.waitFor(
      `/^Draft is playing/.test(document.querySelector('[data-inspector-state]').textContent)`,
      { what: 'the sample draft to play' },
    );
    const played = await assertPlaying(page, { afterUpdate: before, what: `library banks ${banks.join(', ')}` });
    const logs = await page.evaluate('__tf.logs.map((entry) => entry.message)');
    const missing = logs.filter((message) => /sound .* not found|could not load|error/i.test(message));
    assert.deepEqual(missing, [], 'the library banks load without errors');
    await assertCleanPage(page, 'Studio playing library banks');
    return { level: played.level };
  } finally {
    await page.close();
  }
}

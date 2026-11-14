// Which mode a build runs in, and what the Source Inspector tells the user
// in each: the hosted demo and the dev server save nothing by design and
// must not read like an outage; only the LAN player reports one.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appModeFor, draftPlayingMessage, inspectorOpenMessage } from '../src/appMode.js';

test('the build settings decide the mode', () => {
  assert.equal(appModeFor({ VITE_SOURCE_SERVICE: 'off', DEV: false }), 'demo', 'hosted demo build');
  assert.equal(appModeFor({ DEV: true }), 'dev', 'Vite dev server');
  assert.equal(appModeFor({ DEV: false }), 'local', 'LAN player build');
  assert.equal(appModeFor({ VITE_SOURCE_SERVICE: 'on', DEV: true }), 'local', 'dev server with the service');
  assert.equal(appModeFor({ VITE_SOURCE_SERVICE: 'off', DEV: true }), 'demo');
});

test('the demo and the dev server say that nothing is saved, and never report an unreachable service', () => {
  const unreachable = { available: false, writeEnabled: false };

  for (const mode of ['demo', 'dev']) {
    const opened = inspectorOpenMessage(mode, unreachable);
    assert.doesNotMatch(opened, /not reachable/i, mode);
    assert.match(opened, /this browser/i, mode);
    assert.doesNotMatch(draftPlayingMessage(mode, false), /not configured|not reachable/i, mode);
  }

  assert.match(inspectorOpenMessage('demo', unreachable), /Nothing is saved/);
  assert.match(inspectorOpenMessage('dev', unreachable), /setup\.sh/);
});

test('the LAN player tells an outage, a missing token and a ready service apart', () => {
  assert.match(inspectorOpenMessage('local', { available: false, writeEnabled: false }), /not reachable/);
  assert.match(inspectorOpenMessage('local', { available: true, writeEnabled: false }), /SOURCE_EDITOR_TOKEN/);
  assert.match(inspectorOpenMessage('local', { available: true, writeEnabled: true }), /try the draft before overwriting/);
  assert.match(draftPlayingMessage('local', true), /prepare the overwrite/);
  assert.match(draftPlayingMessage('local', false), /not configured/);
});

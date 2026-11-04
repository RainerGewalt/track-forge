// Headless Chrome over the DevTools protocol, without dependencies.
//
// Chrome is started with --remote-debugging-pipe: commands go to file
// descriptor 3 and replies come back on descriptor 4, as JSON messages
// terminated by a NUL byte. No debugging port is opened, so parallel runs
// cannot collide and nothing has to wait for a port to appear.
//
// Every page gets the probe below before any page script runs. It records
// what the assertions need as ordered signals:
//   - Strudel's log events ("strudel.log") and scheduler updates
//     (the "update" event of each <strudel-editor>),
//   - every AudioContext and every AudioWorkletNode creation with its outcome,
//   - an AnalyserNode tapped onto everything that reaches the speakers,
//   - the values committed by the timeline scrubber.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Safety net against a hang, never the assertion: every wait below returns
// as soon as its signal arrives.
export const SAFETY_TIMEOUT_MS = 30_000;

const CHROME_CANDIDATES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function findChrome() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }

  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.includes('/')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
      if (dir && existsSync(path.join(dir, candidate))) return path.join(dir, candidate);
    }
  }

  return null;
}

function probe() {
  const state = {
    logs: [],
    console: [],
    updates: [],
    contexts: [],
    worklets: [],
    seeks: [],
    taps: [],
  };
  window.__tf = state;

  document.addEventListener('strudel.log', (event) => {
    state.logs.push({ message: String(event.detail?.message ?? ''), type: event.detail?.type ?? null });
  });

  // "update" does not bubble; a capturing listener still sees it.
  window.addEventListener(
    'update',
    (event) => {
      if (event.target?.tagName !== 'STRUDEL-EDITOR') return;
      const detail = event.detail ?? {};
      const error = detail.error ?? detail.evalError ?? detail.schedulerError ?? null;
      state.updates.push({
        started: Boolean(detail.started),
        pending: Boolean(detail.pending),
        error: error ? String(error.message ?? error) : null,
        activeCode: typeof detail.activeCode === 'string' ? detail.activeCode : null,
      });
    },
    true,
  );

  document.addEventListener(
    'change',
    (event) => {
      if (event.target?.matches?.('[data-song-position], [data-progress]')) {
        state.seeks.push(Number(event.target.value));
      }
    },
    true,
  );

  const NativeAudioContext = window.AudioContext;
  if (NativeAudioContext) {
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        state.contexts.push(this);
      }
    };
  }

  const NativeWorkletNode = window.AudioWorkletNode;
  if (NativeWorkletNode) {
    window.AudioWorkletNode = class extends NativeWorkletNode {
      constructor(context, name, ...rest) {
        try {
          super(context, name, ...rest);
        } catch (error) {
          state.worklets.push({ name: String(name), ok: false, error: String(error?.message ?? error) });
          throw error;
        }
        state.worklets.push({ name: String(name), ok: true });
      }
    };
  }

  // Tap everything that is connected to a destination. The analyser has no
  // output; Chrome still processes it as an automatic pull node.
  const tapsByContext = new Map();
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function connectWithTap(target, ...rest) {
    const result = connect.call(this, target, ...rest);
    if (typeof AudioDestinationNode !== 'undefined' && target instanceof AudioDestinationNode) {
      let tap = tapsByContext.get(target.context);
      if (!tap) {
        tap = new AnalyserNode(target.context, { fftSize: 2048 });
        tapsByContext.set(target.context, tap);
        state.taps.push(tap);
      }
      if (this !== tap) connect.call(this, tap);
    }
    return result;
  };

  // Root mean square of what currently reaches the speakers, all contexts.
  state.level = () => {
    let max = 0;
    for (const tap of state.taps) {
      const samples = new Float32Array(tap.fftSize);
      tap.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      max = Math.max(max, Math.sqrt(sum / samples.length));
    }
    return max;
  };
}

export const PROBE_SOURCE = `(${probe.toString()})();`;

// --------------------------------------------------------------------------

// ignoreCertificateErrors is for the LAN player's self-signed certificate;
// callers verify that certificate against its CA separately.
export async function launchBrowser({ log = () => {}, ignoreCertificateErrors = false } = {}) {
  const executable = findChrome();

  if (!executable) {
    throw new Error('No Chrome or Chromium found. Install one or set CHROME_PATH.');
  }

  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'track-forge-chrome-'));
  const args = [
    '--headless=new',
    '--remote-debugging-pipe',
    `--user-data-dir=${userDataDir}`,
    // The tests play audio without a user gesture on the AudioContext.
    '--autoplay-policy=no-user-gesture-required',
    // Rendering continues, only the speakers stay quiet.
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1280,900',
  ];

  if (process.env.E2E_CHROME_NO_SANDBOX === '1') {
    args.push('--no-sandbox');
  }
  if (ignoreCertificateErrors) {
    args.push('--ignore-certificate-errors');
  }

  args.push('about:blank');

  // Chrome writes its own temporary files (the singleton socket among them)
  // to TMPDIR. They go to a directory of this run that is removed on close.
  // A Unix socket path is limited to about 107 bytes, so a long temporary
  // directory is replaced by the shorter per-user runtime directory.
  let chromeTmpBase = os.tmpdir();
  if (path.join(chromeTmpBase, 'tf-XXXXXX', 'com.google.Chrome.XXXXXX', 'SingletonSocket').length > 100) {
    chromeTmpBase = process.env.XDG_RUNTIME_DIR ?? chromeTmpBase;
  }
  const chromeTmpDir = await mkdtemp(path.join(chromeTmpBase, 'tf-'));
  const env = { ...process.env, TMPDIR: chromeTmpDir };

  const child = spawn(executable, args, { env, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const stderr = [];
  child.stderr.on('data', (chunk) => stderr.push(chunk));

  const connection = new Connection(child.stdio[3], child.stdio[4]);
  const exited = new Promise((resolve) => child.once('exit', resolve));

  child.once('exit', (code, signal) => {
    connection.close(new Error(`Chrome exited (${code ?? signal}): ${Buffer.concat(stderr).toString().slice(-600)}`));
  });

  const version = await connection.send('Browser.getVersion');
  log(`chrome ${version.product}`);

  return {
    version: version.product,
    async newPage(options) {
      return Page.open(connection, options);
    },
    async close() {
      try {
        await connection.send('Browser.close');
      } catch {
        child.kill('SIGKILL');
      }
      await exited;
      await rm(userDataDir, { recursive: true, force: true });
      await rm(chromeTmpDir, { recursive: true, force: true });
    },
  };
}

class Connection {
  constructor(writable, readable) {
    this.writable = writable;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closedError = null;
    let buffer = '';

    readable.setEncoding('utf8');
    readable.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\0')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        this.dispatch(message);
      }
    });
  }

  dispatch(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject, method } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  send(method, params = {}, sessionId) {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.writable.write(`${JSON.stringify(message)}\0`);
    });
  }

  close(error) {
    this.closedError = error;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}

// --------------------------------------------------------------------------

export class Page {
  static async open(connection, { width = 1280, height = 900 } = {}) {
    const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(connection, targetId, sessionId);
    await page.init({ width, height });
    return page;
  }

  constructor(connection, targetId, sessionId) {
    this.connection = connection;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.requests = new Map();
    this.consoleMessages = [];
    this.exceptions = [];
    this.waiters = new Set();

    this.listener = (message) => {
      if (message.sessionId !== this.sessionId) return;
      this.onEvent(message.method, message.params);
    };
    connection.listeners.add(this.listener);
  }

  send(method, params) {
    return this.connection.send(method, params, this.sessionId);
  }

  async init({ width, height }) {
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Network.enable');
    await this.send('Log.enable');
    await this.send('Network.setCacheDisabled', { cacheDisabled: true });
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE_SOURCE });
  }

  onEvent(method, params) {
    if (method === 'Network.requestWillBeSent') {
      this.requests.set(params.requestId, {
        url: params.request.url,
        method: params.request.method,
        status: null,
        done: false,
        failed: null,
      });
    } else if (method === 'Network.responseReceived') {
      const request = this.requests.get(params.requestId);
      if (request) request.status = params.response.status;
    } else if (method === 'Network.loadingFinished') {
      const request = this.requests.get(params.requestId);
      if (request) request.done = true;
    } else if (method === 'Network.loadingFailed') {
      const request = this.requests.get(params.requestId);
      if (request) {
        request.done = true;
        // A request the page cancelled itself (navigation, aborted fetch of a
        // superseded preview) is not a failure of the server.
        request.failed = params.canceled ? null : params.errorText;
        request.canceled = Boolean(params.canceled);
      }
    } else if (method === 'Runtime.consoleAPICalled') {
      const text = params.args
        .map((arg) => (arg.value !== undefined ? String(arg.value) : (arg.description ?? '')))
        .join(' ');
      this.consoleMessages.push({ type: params.type, text });
    } else if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails;
      this.exceptions.push(details.exception?.description ?? details.text);
    } else if (method === 'Log.entryAdded') {
      this.consoleMessages.push({ type: `log-${params.entry.level}`, text: params.entry.text, url: params.entry.url });
    }

    for (const waiter of this.waiters) waiter(method, params);
  }

  // Resolves with the first event that matches.
  waitForEvent(method, predicate = () => true, { timeoutMs = SAFETY_TIMEOUT_MS, what = method } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`timed out after ${timeoutMs} ms waiting for ${what}`));
      }, timeoutMs);
      const waiter = (eventMethod, params) => {
        if (eventMethod === method && predicate(params)) {
          clearTimeout(timer);
          this.waiters.delete(waiter);
          resolve(params);
        }
      };
      this.waiters.add(waiter);
    });
  }

  async goto(url) {
    this.requests.clear();
    this.consoleMessages = [];
    this.exceptions = [];
    const loaded = this.waitForEvent('Page.loadEventFired', undefined, { what: `load of ${url}` });
    const result = await this.send('Page.navigate', { url });
    if (result.errorText) {
      throw new Error(`navigation to ${url} failed: ${result.errorText}`);
    }
    await loaded;
  }

  async evaluate(expression, { awaitPromise = true } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(`page evaluation failed: ${details.exception?.description ?? details.text}`);
    }
    return result.result.value;
  }

  // Polls a page expression until it is truthy. The expression is the
  // ordered signal; the bound only stops a hang and is reported as such.
  async waitFor(expression, { what = expression, timeoutMs = SAFETY_TIMEOUT_MS, intervalMs = 50 } = {}) {
    const value = await this.evaluate(`new Promise((resolve, reject) => {
      const started = performance.now();
      const check = () => {
        let value;
        try { value = (${expression}); } catch (error) { value = undefined; }
        if (value) { resolve(typeof value === 'object' || typeof value === 'function' ? true : value); return; }
        if (performance.now() - started > ${timeoutMs}) { resolve({ __timeout: true }); return; }
        setTimeout(check, ${intervalMs});
      };
      check();
    })`);
    if (value && value.__timeout) {
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    return value;
  }

  // Waits until every request seen so far has finished or failed.
  async settleNetwork({ timeoutMs = SAFETY_TIMEOUT_MS } = {}) {
    const started = Date.now();
    while ([...this.requests.values()].some((request) => !request.done)) {
      if (Date.now() - started > timeoutMs) {
        const open = [...this.requests.values()].filter((request) => !request.done).map((request) => request.url);
        throw new Error(`timed out waiting for requests to finish: ${open.join(', ')}`);
      }
      await new Promise((resolve) => {
        const waiter = (method) => {
          if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
            this.waiters.delete(waiter);
            resolve();
          }
        };
        this.waiters.add(waiter);
        // Re-check periodically in case the last event raced the loop.
        setTimeout(() => {
          this.waiters.delete(waiter);
          resolve();
        }, 250);
      });
    }
  }

  failedRequests() {
    return [...this.requests.values()]
      .filter((request) => request.failed || (request.status !== null && request.status >= 400))
      .map((request) => `${request.failed ?? request.status} ${request.method} ${request.url}`);
  }

  consoleErrors() {
    return [
      ...this.exceptions.map((text) => `exception: ${text}`),
      ...this.consoleMessages
        .filter((message) => message.type === 'error' || message.type === 'assert' || message.type === 'log-error')
        .map((message) => `${message.type}: ${message.text}${message.url ? ` (${message.url})` : ''}`),
    ];
  }

  async box(selector) {
    const box = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return null;
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = element.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    })()`);
    if (!box || box.width === 0 || box.height === 0) {
      throw new Error(`no visible element for ${selector}`);
    }
    return box;
  }

  async mouse(type, x, y, { buttons = 0, clickCount = 1 } = {}) {
    await this.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: type === 'mouseMoved' && buttons === 0 ? 'none' : 'left',
      buttons,
      clickCount,
    });
  }

  // A real click: mousedown and mouseup at the element's centre, like a user.
  async click(selector) {
    const box = await this.box(selector);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.mouse('mouseMoved', x, y);
    await this.mouse('mousePressed', x, y, { buttons: 1 });
    await this.mouse('mouseReleased', x, y, { buttons: 0 });
  }

  // Press at one fraction of the element's width, drag, release at another.
  async drag(selector, fromFraction, toFraction) {
    const box = await this.box(selector);
    const y = box.y + box.height / 2;
    const from = box.x + box.width * fromFraction;
    const to = box.x + box.width * toFraction;
    await this.mouse('mouseMoved', from, y);
    await this.mouse('mousePressed', from, y, { buttons: 1 });
    for (let step = 1; step <= 5; step += 1) {
      await this.mouse('mouseMoved', from + ((to - from) * step) / 5, y, { buttons: 1 });
    }
    await this.mouse('mouseReleased', to, y, { buttons: 0 });
  }

  // A key press as the keyboard sends it: keydown, then keyup.
  async press(key, { code = key, keyCode, text } = {}) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      text,
    });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  }

  async insertText(text) {
    await this.send('Input.insertText', { text });
  }

  async close() {
    this.connection.listeners.delete(this.listener);
    await this.connection.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
  }
}

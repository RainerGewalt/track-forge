// Offline render page for Track Forge (work in progress, not part of the build).
// Plays a Strudel program through the same <strudel-editor> engine as the
// studio and records everything that reaches the audio destination.
import '@strudel/repl';
import { installAudioMaster } from '../audioMaster.js';
import { createEditorEngine } from '../player.js';

installAudioMaster();

// Tap every connection into the destination into a recorder stream as well.
let tap = null;
const connect = AudioNode.prototype.connect;
AudioNode.prototype.connect = function tapped(target, ...rest) {
  const result = connect.call(this, target, ...rest);
  if (target instanceof AudioDestinationNode) {
    if (!tap || tap.context !== target.context) {
      tap = { context: target.context, node: target.context.createMediaStreamDestination() };
    }
    connect.call(this, tap.node);
  }
  return result;
};

const element = document.createElement('strudel-editor');
element.setAttribute('code', '');
element.style.display = 'none';
document.body.append(element);
const engine = createEditorEngine(element, { timeoutMs: 20000 });

window.renderStrudel = async (code, seconds) => {
  await engine.setCode(code);
  await engine.evaluate();
  const started = performance.now();
  while (!tap && performance.now() - started < 10000) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!tap) throw new Error('No audio reached the destination.');
  const recorder = new MediaRecorder(tap.node.stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 256000,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise((r) => (recorder.onstop = r));
  recorder.start(1000);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  recorder.stop();
  await done;
  await engine.stop();
  const buffer = await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};
window.renderReady = true;

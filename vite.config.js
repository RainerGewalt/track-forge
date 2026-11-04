import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Sample audio is built locally (./setup.sh, npm run samples:build) and never
// committed. Builds and dev servers without it, such as the hosted demo or
// ./setup.sh --no-samples, tell the sample browser instead of letting every
// preview fail.
function sampleAudioInstalled() {
  try {
    return readdirSync(new URL('./public/samples/library/audio', import.meta.url)).length > 0;
  } catch {
    return false;
  }
}

export default defineConfig({
  define: {
    'import.meta.env.VITE_SAMPLE_AUDIO': JSON.stringify(
      sampleAudioInstalled() ? 'installed' : 'missing',
    ),
  },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        player: fileURLToPath(new URL('./player.html', import.meta.url)),
      },
    },
  },
});

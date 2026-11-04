// Servers for the browser scenarios: the Vite dev server in process, and a
// static server that answers like GitHub Pages for the hosted-demo build.

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.txt': 'text/plain; charset=utf-8',
};

export function sampleAudioInstalled(repoRoot) {
  try {
    return readdirSync(path.join(repoRoot, 'public', 'samples', 'library', 'audio')).length > 0;
  } catch {
    return false;
  }
}

// Starts Vite from the repository's own dependency, resolved when the server
// has bound its port.
export async function startDevServer(repoRoot, { port = 5173 } = {}) {
  const { createServer } = await import(path.join(repoRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js'));
  const server = await createServer({
    root: repoRoot,
    logLevel: 'error',
    clearScreen: false,
    server: { host: '127.0.0.1', port, strictPort: true },
  });
  await server.listen();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => server.close(),
  };
}

// The hosted-demo build, with the same command and environment as
// .github/workflows/demo.yml, into outDir instead of dist/.
export function buildHostedDemo(repoRoot, outDir, { base = '/track-forge/' } = {}) {
  return new Promise((resolve, reject) => {
    const output = [];
    const child = spawn(
      process.execPath,
      [path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--base', base, '--outDir', outDir, '--emptyOutDir'],
      { cwd: repoRoot, env: { ...process.env, VITE_SOURCE_SERVICE: 'off' }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stderr.on('data', (chunk) => output.push(chunk));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`vite build exited ${code}:\n${Buffer.concat(output).toString().slice(-2000)}`));
    });
  });
}

// Serves outDir under base like GitHub Pages: directories serve index.html,
// anything missing is a 404 (no single-page fallback).
export async function servePages(outDir, { base = '/track-forge/' } = {}) {
  const server = http.createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(base)) {
      response.writeHead(404).end('not found');
      return;
    }
    let file = path.join(outDir, pathname.slice(base.length));
    if (!file.startsWith(outDir)) {
      response.writeHead(404).end('not found');
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}${base}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Builds and servers for the browser scenarios.
//
// - buildApp: `vite build` into a directory of the run, with the same base
//   and VITE_SOURCE_SERVICE as the LAN player (default) or the hosted demo
//   (.github/workflows/demo.yml).
// - serveLocalStack: what nginx does in compose.yaml, without Docker: serves
//   the build and passes /api/ to the unchanged source service, here on a
//   copy of src/ so the repository's own files are never written.
// - servePages: serves the hosted-demo build under its base like GitHub
//   Pages, without a source service.
//
// Every server listens on 127.0.0.1 on a port the system picks.

import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import { createSourceServer } from '../../scripts/source-api.mjs';

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

export function buildApp(repoRoot, outDir, { base = '/', sourceService } = {}) {
  const env = { ...process.env };
  delete env.VITE_SOURCE_SERVICE;
  if (sourceService) env.VITE_SOURCE_SERVICE = sourceService;

  return new Promise((resolve, reject) => {
    const output = [];
    const child = spawn(
      process.execPath,
      [
        path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
        'build',
        '--base',
        base,
        '--outDir',
        outDir,
        '--emptyOutDir',
      ],
      { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
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

async function serveFile(response, root, relative) {
  let file = path.join(root, relative);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
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
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

export async function serveLocalStack(outDir, { sourceRoot, editorToken }) {
  const root = path.resolve(outDir);
  const api = createSourceServer({ sourceRoot, editorToken });
  const apiHandler = api.listeners('request')[0];
  const server = http.createServer((request, response) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname.startsWith('/api/')) {
      apiHandler(request, response);
      return;
    }
    void serveFile(response, root, decodeURIComponent(pathname));
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export async function servePages(outDir, { base = '/track-forge/' } = {}) {
  const root = path.resolve(outDir);
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(base)) {
      response.writeHead(404).end('not found');
      return;
    }
    void serveFile(response, root, pathname.slice(base.length));
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}${base}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

#!/usr/bin/env node

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as defaultFileSystem from 'node:fs/promises';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 3000;
const MAX_SOURCE_BYTES = 1024 * 1024;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Writing is off unless SOURCE_EDITOR_TOKEN holds a long private value. The
// value that earlier versions of .env.example set is public and never counts.
export const MIN_EDITOR_TOKEN_LENGTH = 32;
const PUBLIC_EXAMPLE_TOKENS = new Set(['replace-with-a-long-random-token']);
const TOKEN_HINT = 'Generate one with: openssl rand -hex 24';

export function editorTokenProblem(editorToken) {
  const token = String(editorToken ?? '').trim();

  if (!token) {
    return 'SOURCE_EDITOR_TOKEN is not set.';
  }

  if (PUBLIC_EXAMPLE_TOKENS.has(token)) {
    return `SOURCE_EDITOR_TOKEN is the public example value from .env.example. ${TOKEN_HINT}`;
  }

  if (token.length < MIN_EDITOR_TOKEN_LENGTH) {
    return `SOURCE_EDITOR_TOKEN is shorter than ${MIN_EDITOR_TOKEN_LENGTH} characters. ${TOKEN_HINT}`;
  }

  return null;
}

// Strudel code is JavaScript: Strudel parses it as a script that may use
// top-level await and runs it inside an async function. Compiling it the
// same way, without calling it, refuses a source that cannot be evaluated
// because it does not parse. Whether it plays (sounds, mini-notation, names)
// only the browser can tell; that is what Try Draft is for.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

export function sourceSyntaxProblem(code) {
  if (!code.trim()) {
    return 'The Strudel source is empty.';
  }

  try {
    new AsyncFunction(code);
    return null;
  } catch (error) {
    return `The Strudel source does not parse: ${error.message}`;
  }
}

// The previous version of a source is kept next to it, hidden, and is not a
// source itself: pieces/<id>/.main.strudel.bak.
export function backupPathFor(filePath) {
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.bak`);
}

export function revisionFor(code) {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

export function sourcePathFor(sourceRoot, locator) {
  if (!locator || !SAFE_ID.test(locator.sourceId ?? '')) {
    throw new SourceApiError(400, 'The source identifier is invalid.');
  }

  if (locator.kind === 'scene') {
    if (!SAFE_ID.test(locator.pieceId ?? '')) {
      throw new SourceApiError(400, 'The piece identifier is invalid.');
    }

    return path.join(sourceRoot, 'pieces', locator.pieceId, `${locator.sourceId}.strudel`);
  }

  if (locator.kind === 'sketch') {
    return path.join(sourceRoot, 'sketches', `${locator.sourceId}.strudel`);
  }

  if (locator.kind === 'element') {
    return path.join(sourceRoot, 'library', `${locator.sourceId}.strudel`);
  }

  throw new SourceApiError(400, 'The source kind is not supported.');
}

export function createSourceServer({ sourceRoot, editorToken = '' }) {
  const root = path.resolve(sourceRoot);
  const tokenProblem = editorTokenProblem(editorToken);
  const token = tokenProblem ? '' : String(editorToken).trim();
  const writeQueues = new Map();

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://source-api.local');

      if (request.method === 'GET' && url.pathname === '/api/sources') {
        sendJson(response, 200, {
          writeEnabled: Boolean(token),
          sources: await listSources(root),
        });
        return;
      }

      if (url.pathname.startsWith('/api/source/')) {
        const locator = parseLocator(url.pathname);

        if (request.method === 'GET') {
          sendJson(response, 200, { source: await readSource(root, locator) });
          return;
        }

        if (request.method === 'PUT') {
          if (!token) {
            throw new SourceApiError(
              503,
              `Source writing is disabled: ${tokenProblem} Set a long private SOURCE_EDITOR_TOKEN and restart the service.`,
            );
          }

          if (!hasValidToken(request.headers.authorization, token)) {
            throw new SourceApiError(401, 'The editor token is missing or invalid.');
          }

          const body = await readJsonBody(request);
          const filePath = sourcePathFor(root, locator);
          const source = await serializeWrite(writeQueues, filePath, () =>
            replaceSource(root, locator, body),
          );
          sendJson(response, 200, { source });
          return;
        }

        throw new SourceApiError(405, 'This request method is not supported.');
      }

      throw new SourceApiError(404, 'The requested endpoint does not exist.');
    } catch (error) {
      const status = error instanceof SourceApiError ? error.status : 500;
      const message =
        error instanceof SourceApiError ? error.message : 'The source service could not complete the request.';

      if (status === 500) {
        console.error(error);
      }

      sendJson(response, status, { error: message, ...(error.details ?? {}) });
    }
  });
}

async function serializeWrite(writeQueues, key, operation) {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);

  writeQueues.set(key, current);

  try {
    return await current;
  } finally {
    if (writeQueues.get(key) === current) {
      writeQueues.delete(key);
    }
  }
}

export async function listSources(sourceRoot) {
  const sceneEntries = [];
  const pieceDirectories = await directoryEntries(path.join(sourceRoot, 'pieces'));

  for (const pieceDirectory of pieceDirectories) {
    if (!pieceDirectory.isDirectory() || !SAFE_ID.test(pieceDirectory.name)) {
      continue;
    }

    const files = await directoryEntries(path.join(sourceRoot, 'pieces', pieceDirectory.name));

    for (const file of files) {
      const sourceId = sourceIdFor(file);

      if (sourceId) {
        sceneEntries.push(
          await readSource(sourceRoot, {
            kind: 'scene',
            pieceId: pieceDirectory.name,
            sourceId,
          }),
        );
      }
    }
  }

  const sketches = await readFlatSources(sourceRoot, 'sketches', 'sketch');
  const elements = await readFlatSources(sourceRoot, 'library', 'element');

  return [...sceneEntries, ...sketches, ...elements].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

async function readFlatSources(sourceRoot, directory, kind) {
  const entries = await directoryEntries(path.join(sourceRoot, directory));
  const sources = [];

  for (const entry of entries) {
    const sourceId = sourceIdFor(entry);

    if (sourceId) {
      sources.push(await readSource(sourceRoot, { kind, sourceId }));
    }
  }

  return sources;
}

function sourceIdFor(entry) {
  if (!entry.isFile() || !entry.name.endsWith('.strudel')) {
    return null;
  }

  const sourceId = entry.name.slice(0, -'.strudel'.length);
  return SAFE_ID.test(sourceId) ? sourceId : null;
}

async function directoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function readSource(sourceRoot, locator) {
  const filePath = sourcePathFor(sourceRoot, locator);

  try {
    const code = await readFile(filePath, 'utf8');
    return sourceRecord(locator, code);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new SourceApiError(404, 'The selected source file does not exist.');
    }
    throw error;
  }
}

// Validates first, then writes: the new code and a copy of the current file
// go to temporary files in the same directory, the copy becomes the backup,
// and only then does the new code replace the source in one rename. Any
// failure before that rename leaves the source as it was.
export async function replaceSource(sourceRoot, locator, body, { fileSystem = defaultFileSystem } = {}) {
  if (!body || typeof body.code !== 'string') {
    throw new SourceApiError(400, 'The request must include Strudel code.');
  }

  if (Buffer.byteLength(body.code, 'utf8') > MAX_SOURCE_BYTES) {
    throw new SourceApiError(413, 'The Strudel source exceeds the 1 MiB limit.');
  }

  if (typeof body.expectedRevision !== 'string' || !body.expectedRevision) {
    throw new SourceApiError(400, 'The current source revision is required.');
  }

  const filePath = sourcePathFor(sourceRoot, locator);
  let currentBytes;

  try {
    currentBytes = await fileSystem.readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new SourceApiError(404, 'The selected source file does not exist.');
    }
    throw error;
  }

  const currentRevision = revisionFor(currentBytes.toString('utf8'));

  if (currentRevision !== body.expectedRevision) {
    throw new SourceApiError(409, 'The source changed on disk after it was opened.', {
      currentRevision,
    });
  }

  const syntaxProblem = sourceSyntaxProblem(body.code);

  if (syntaxProblem) {
    throw new SourceApiError(422, `${syntaxProblem} The file was not changed.`);
  }

  const temporaryPath = temporaryPathFor(filePath);
  const backupTemporaryPath = temporaryPathFor(filePath);

  try {
    await writeDurably(fileSystem, temporaryPath, Buffer.from(body.code, 'utf8'));
    await writeDurably(fileSystem, backupTemporaryPath, currentBytes);
    await fileSystem.rename(backupTemporaryPath, backupPathFor(filePath));
    await fileSystem.rename(temporaryPath, filePath);
  } catch (error) {
    await fileSystem.unlink(temporaryPath).catch(() => {});
    await fileSystem.unlink(backupTemporaryPath).catch(() => {});
    throw error;
  }

  return sourceRecord(locator, body.code);
}

function temporaryPathFor(filePath) {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
}

// The data reaches the disk before the rename makes it visible, so a crash
// cannot leave an empty file in place of the source.
async function writeDurably(fileSystem, filePath, data) {
  const handle = await fileSystem.open(filePath, 'wx', 0o644);

  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function sourceRecord(locator, code) {
  const prefix =
    locator.kind === 'scene'
      ? `pieces/${locator.pieceId}`
      : locator.kind === 'sketch'
        ? 'sketches'
        : 'library';

  return {
    ...locator,
    path: `${prefix}/${locator.sourceId}.strudel`,
    code,
    revision: revisionFor(code),
  };
}

function parseLocator(pathname) {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (parts[0] !== 'api' || parts[1] !== 'source') {
    throw new SourceApiError(404, 'The requested endpoint does not exist.');
  }

  if (parts[2] === 'scene' && parts.length === 5) {
    return { kind: 'scene', pieceId: parts[3], sourceId: parts[4] };
  }

  if ((parts[2] === 'sketch' || parts[2] === 'element') && parts.length === 4) {
    return { kind: parts[2], sourceId: parts[3] };
  }

  throw new SourceApiError(400, 'The source path is invalid.');
}

export function hasValidToken(authorization, editorToken) {
  const supplied = Buffer.from(String(authorization ?? ''), 'utf8');
  const expected = Buffer.from(`Bearer ${editorToken}`, 'utf8');

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;

    if (size > MAX_SOURCE_BYTES + 16 * 1024) {
      throw new SourceApiError(413, 'The request body exceeds the allowed size.');
    }

    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SourceApiError(400, 'The request body is not valid JSON.');
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

class SourceApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const isEntryPoint = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  const sourceRoot = process.env.SOURCE_ROOT ?? '/workspace/src';
  const editorToken = process.env.SOURCE_EDITOR_TOKEN ?? '';
  const port = Number(process.env.SOURCE_API_PORT) || DEFAULT_PORT;
  const server = createSourceServer({ sourceRoot, editorToken });
  const tokenProblem = editorTokenProblem(editorToken);

  server.listen(port, '0.0.0.0', () => {
    console.log(`Source API listening on port ${port}.`);
    console.log(
      tokenProblem
        ? `Source writing is off: ${tokenProblem}`
        : 'Source writing is on for requests with the editor token.',
    );
  });
}

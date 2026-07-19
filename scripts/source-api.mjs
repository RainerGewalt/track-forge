#!/usr/bin/env node

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 3000;
const MAX_SOURCE_BYTES = 1024 * 1024;
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
  const token = String(editorToken).trim();
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
              'Source writing is disabled. Set SOURCE_EDITOR_TOKEN and restart the service.',
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

export async function replaceSource(sourceRoot, locator, body) {
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
  let currentCode;

  try {
    currentCode = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new SourceApiError(404, 'The selected source file does not exist.');
    }
    throw error;
  }

  const currentRevision = revisionFor(currentCode);

  if (currentRevision !== body.expectedRevision) {
    throw new SourceApiError(409, 'The source changed on disk after it was opened.', {
      currentRevision,
    });
  }

  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );

  try {
    await writeFile(temporaryPath, body.code, { encoding: 'utf8', mode: 0o644 });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }

  return sourceRecord(locator, body.code);
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

  server.listen(port, '0.0.0.0', () => {
    console.log(`Source API listening on port ${port}.`);
  });
}

#!/usr/bin/env node

import { constants } from 'node:fs';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const piecesDir = path.join(projectRoot, 'src', 'pieces');
const templateDir = path.join(projectRoot, 'templates', 'piece');
const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const [id, ...titleParts] = process.argv.slice(2);
const title = titleParts.join(' ').trim();

try {
  if (!id || !title) {
    fail('Usage: npm run piece:create -- <kebab-case-id> "<title>"');
  }

  if (!idPattern.test(id)) {
    fail(`Piece id must be kebab-case and start with a lowercase letter: ${id}`);
  }

  await ensureDirectory(templateDir, 'Template directory is missing');
  await ensureDirectory(piecesDir, 'Pieces directory is missing');

  const targetDir = path.join(piecesDir, id);

  if (await exists(targetDir)) {
    fail(`A piece directory already exists for id: ${id}`);
  }

  await mkdir(targetDir);

  const createdPaths = [];
  const entries = await readdir(templateDir);

  for (const entry of entries) {
    const sourcePath = path.join(templateDir, entry);
    const targetPath = path.join(targetDir, entry);
    const sourceStat = await stat(sourcePath);

    if (!sourceStat.isFile()) {
      continue;
    }

    const template = await readFile(sourcePath, 'utf8');
    const output = template
      .replaceAll('__PIECE_ID__', id)
      .replaceAll('__PIECE_TITLE__', escapeJsonString(title));

    await writeFile(targetPath, output);
    createdPaths.push(path.relative(projectRoot, targetPath));
  }

  console.log(`Created piece: ${id}`);
  for (const createdPath of createdPaths.sort()) {
    console.log(`- ${createdPath}`);
  }
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
}

async function ensureDirectory(directory, message) {
  try {
    const directoryStat = await stat(directory);

    if (!directoryStat.isDirectory()) {
      fail(`${message}: ${path.relative(projectRoot, directory)}`);
    }
  } catch {
    fail(`${message}: ${path.relative(projectRoot, directory)}`);
  }
}

async function exists(targetPath) {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function escapeJsonString(value) {
  return JSON.stringify(value).slice(1, -1);
}

function fail(message) {
  throw new Error(message);
}

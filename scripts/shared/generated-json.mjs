// Writes generated JSON files without timestamp churn.
//
// Generated files that are committed carry a `generatedAt` timestamp. When a
// run produces the same content as the file on disk, the file is left alone,
// so a fresh clone or a repeated run does not show changes in git.

import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function readPrevious(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Returns true when the file was written, false when it was already current.
export async function writeGeneratedJson(
  filePath,
  value,
  { timestampKey = 'generatedAt', serialize = pretty } = {},
) {
  const previous = await readPrevious(filePath);

  if (previous && typeof previous === 'object' && timestampKey in previous) {
    // Compare in JSON form, so undefined fields and key order do not matter.
    const candidate = JSON.parse(JSON.stringify({ ...value, [timestampKey]: previous[timestampKey] }));

    if (isDeepStrictEqual(candidate, previous)) {
      return false;
    }
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, serialize(value));
  return true;
}

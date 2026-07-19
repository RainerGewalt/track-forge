import fs from 'node:fs/promises';

// Polite crawling identity. Set SAMPLE_CURATOR_CONTACT so providers can
// reach you about your requests (an email address or URL).
// Kept ASCII-only: this string ends up in the User-Agent header, and fetch
// rejects header values with characters above U+00FF (e.g. an em dash).
const CONTACT =
  process.env.SAMPLE_CURATOR_CONTACT ?? 'unset - see scripts/samples/shared/http.mjs';
const USER_AGENT = `StrudelTrackForge-SampleCurator/0.1 (local music project; contact: ${CONTACT})`;

// Minimum politeness delay per host, in milliseconds.
const HOST_DELAY_MS = {
  'api.github.com': 700,
  'raw.githubusercontent.com': 500,
  'media.githubusercontent.com': 500,
  'commons.wikimedia.org': 1000,
  'upload.wikimedia.org': 1000,
  'api.openverse.org': 1200,
  default: 1500,
};

const lastRequestAt = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function politeWait(url) {
  const host = new URL(url).host;
  const delay = HOST_DELAY_MS[host] ?? HOST_DELAY_MS.default;
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + delay - Date.now();

  if (wait > 0) {
    await sleep(wait);
  }

  lastRequestAt.set(host, Date.now());
}

export async function request(url, { headers = {}, retries = 3 } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await politeWait(url);

    try {
      const response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, ...headers },
        redirect: 'follow',
      });

      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} for ${url}`);
        await sleep(2000 * (attempt + 1));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      await sleep(1500 * (attempt + 1));
    }
  }

  throw lastError ?? new Error(`request failed: ${url}`);
}

export async function fetchJson(url, options = {}) {
  const response = await request(url, options);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

export async function downloadToFile(url, filePath, options = {}) {
  const response = await request(url, options);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, bytes);
  return bytes.length;
}

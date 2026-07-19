// Wikimedia Commons helpers: canonical metadata lookup and verification.
//
// Commons extmetadata is the authoritative record used for license
// decisions. Files with copyright/deletion warnings or inconsistent
// metadata are never auto-accepted.

import { fetchJson } from './http.mjs';

const API = 'https://commons.wikimedia.org/w/api.php';

export async function searchCommonsAudio(query, limit = 10) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    list: 'search',
    srsearch: `${query} filetype:audio`,
    srnamespace: '6',
    srlimit: String(limit),
  });

  const data = await fetchJson(`${API}?${params}`);
  return (data.query?.search ?? []).map((hit) => hit.title);
}

export async function getCommonsFileInfo(title) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    prop: 'imageinfo',
    titles: title,
    iiprop: 'url|size|mime|extmetadata|sha1',
  });

  const data = await fetchJson(`${API}?${params}`);
  const pages = data.query?.pages ?? {};
  const page = Object.values(pages)[0];
  const info = page?.imageinfo?.[0];

  if (!info) {
    return null;
  }

  const ext = info.extmetadata ?? {};
  const value = (key) => ext[key]?.value ?? '';

  return {
    title,
    pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    fileUrl: info.url,
    mime: info.mime,
    bytes: info.size,
    sha1: info.sha1,
    creator: stripHtml(value('Artist')),
    licenseShortName: value('LicenseShortName'),
    licenseUrl: value('LicenseUrl'),
    license: value('License'),
    description: stripHtml(value('ImageDescription')).slice(0, 500),
    copyrighted: value('Copyrighted'),
    restrictions: value('Restrictions'),
    assessments: value('Assessments'),
  };
}

// A Commons entry is only trustworthy for automatic acceptance when the
// structured fields are consistent and free of warnings.
export function commonsMetadataProblems(info) {
  const problems = [];

  if (!info.fileUrl) {
    problems.push('missing original file URL');
  }

  if (!info.mime?.startsWith('audio/') && info.mime !== 'application/ogg') {
    problems.push(`not an audio mime type: ${info.mime}`);
  }

  if (info.restrictions && info.restrictions.trim() !== '') {
    problems.push(`restrictions present: ${info.restrictions}`);
  }

  if (!info.licenseShortName && !info.license) {
    problems.push('no license metadata');
  }

  return problems;
}

function stripHtml(text) {
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export function applyLiveSources(pieces, sources) {
  let updated = 0;

  for (const source of sources ?? []) {
    if (source.kind !== 'scene' || typeof source.code !== 'string') {
      continue;
    }

    const piece = pieces.find((candidate) => candidate.id === source.pieceId);
    const scene = piece?.scenes.find((candidate) => candidate.id === source.sourceId);

    if (!scene) {
      continue;
    }

    scene.code = source.code;
    scene.sourceRevision = source.revision;
    scene.sourcePath = source.path;
    updated += 1;
  }

  return updated;
}

export async function hydratePieceSources(pieces, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    return { available: false, writeEnabled: false, updated: 0 };
  }

  try {
    const response = await fetchImpl('/api/sources', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok || !contentType.includes('application/json')) {
      return { available: false, writeEnabled: false, updated: 0 };
    }

    const payload = await response.json();
    const updated = applyLiveSources(pieces, payload.sources);

    return {
      available: true,
      writeEnabled: Boolean(payload.writeEnabled),
      updated,
    };
  } catch {
    return { available: false, writeEnabled: false, updated: 0 };
  }
}

export async function savePieceSource(
  { pieceId, sceneId, code, expectedRevision, editorToken },
  { fetchImpl = globalThis.fetch } = {},
) {
  try {
    const response = await fetchImpl(
      `/api/source/scene/${encodeURIComponent(pieceId)}/${encodeURIComponent(sceneId)}`,
      {
        method: 'PUT',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${editorToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, expectedRevision }),
      },
    );
    const payload = await response.json().catch(() => ({}));

    return {
      ok: response.ok,
      status: response.status,
      source: payload.source ?? null,
      error: payload.error ?? (response.ok ? null : 'The source could not be saved.'),
    };
  } catch {
    return {
      ok: false,
      status: 0,
      source: null,
      error: 'The source service is not reachable.',
    };
  }
}

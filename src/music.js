import { isSupportedPieceStatus } from './statuses.js';

const pieceModules = import.meta.glob('./pieces/*/piece.js', {
  eager: true,
  import: 'default',
});

export const pieces = discoverPieces(pieceModules);

export const releaseReadyPieces = pieces.filter((piece) => piece.status === 'release-ready');

export function getPieceById(id) {
  return pieces.find((piece) => piece.id === id) ?? null;
}

export function getPiecesByStatus(status) {
  if (!isSupportedPieceStatus(status)) {
    throw new Error(`Unsupported piece status: ${status}`);
  }

  return pieces.filter((piece) => piece.status === status);
}

function discoverPieces(modules) {
  const ids = new Set();
  const discoveredPieces = Object.entries(modules).map(([path, piece]) => {
    const normalizedPiece = normalizePiece(piece, path);

    if (ids.has(normalizedPiece.id)) {
      throw new Error(`Duplicate piece id detected: ${normalizedPiece.id}`);
    }

    ids.add(normalizedPiece.id);
    return normalizedPiece;
  });

  return discoveredPieces.sort((left, right) => {
    const titleOrder = left.title.localeCompare(right.title);

    return titleOrder || left.id.localeCompare(right.id);
  });
}

function normalizePiece(piece, path) {
  if (!piece || typeof piece !== 'object') {
    throw new Error(`Malformed piece module at ${path}`);
  }

  if (!piece.id || !piece.title || !piece.sections || typeof piece.sections !== 'object') {
    throw new Error(`Piece module at ${path} is missing id, title, or sections`);
  }

  if (!isSupportedPieceStatus(piece.status)) {
    throw new Error(`Piece ${piece.id} has unsupported status: ${piece.status}`);
  }

  const scenes = Object.entries(piece.sections).map(([id, code]) => {
    if (typeof code !== 'string') {
      throw new Error(`Piece ${piece.id} section ${id} did not load as text`);
    }

    return {
      id,
      name: titleFromId(id),
      code,
    };
  });

  if (scenes.length === 0) {
    throw new Error(`Piece ${piece.id} does not define any Strudel sections`);
  }

  return {
    ...piece,
    sourcePath: path,
    name: piece.title,
    tempo: `${piece.bpm} BPM`,
    scenes,
  };
}

function titleFromId(id) {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

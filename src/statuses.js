export const PIECE_STATUSES = [
  'sketch',
  'arranging',
  'mix-ready',
  'release-ready',
  'released',
];

export const RELEASE_PREPARATION_STATUSES = ['release-ready', 'released'];

export const STATUS_LABELS = {
  sketch: 'Sketch',
  arranging: 'Arranging',
  'mix-ready': 'Mix ready',
  'release-ready': 'Release ready',
  released: 'Released',
};

export function isSupportedPieceStatus(status) {
  return PIECE_STATUSES.includes(status);
}

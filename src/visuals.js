import artistProfile from '../releases/artist-profile.json';
import imagesManifest from './generated/images-manifest.json';
import { appUrl } from './appUrl.js';

const focalPointPattern = /^(\d{1,3})% (\d{1,3})%$/;

export { artistProfile };

// Convention fallback: an explicit artwork.src in piece.json always wins;
// otherwise a file dropped at public/images/tracks/<piece-id>.<ext> is used
// (run `npm run images:manifest` after adding files).
export function resolveArtwork(piece) {
  if (hasImage(piece?.artwork)) {
    return piece.artwork;
  }

  const file = imagesManifest.tracks?.[piece?.id];

  if (!file) {
    return null;
  }

  return {
    src: appUrl(`images/tracks/${file}`),
    alt: `${piece.title} artwork`,
    focalPoint: piece?.artwork?.focalPoint ?? '50% 50%',
    placeholder: true,
  };
}

export function resolveProfileImage() {
  if (hasImage(artistProfile.profileImage)) {
    return artistProfile.profileImage;
  }

  if (!imagesManifest.profile) {
    return null;
  }

  return {
    src: appUrl(`images/profile/${imagesManifest.profile}`),
    alt: `${artistProfile.artistName} profile image`,
    focalPoint: artistProfile.profileImage?.focalPoint ?? '50% 50%',
    placeholder: true,
  };
}

export function hasImage(image) {
  return typeof image?.src === 'string' && image.src.trim() !== '';
}

export function imagePosition(image) {
  const match = focalPointPattern.exec(image?.focalPoint ?? '');

  if (!match || Number(match[1]) > 100 || Number(match[2]) > 100) {
    return '50% 50%';
  }

  return image.focalPoint;
}

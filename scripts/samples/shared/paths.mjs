import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(here, '..', '..', '..');
export const libraryRoot = path.join(projectRoot, 'sample-library');

export const rawDir = path.join(libraryRoot, 'raw');
export const curatedDir = path.join(libraryRoot, 'curated');
export const candidatesDir = path.join(libraryRoot, 'candidates');
export const manifestsDir = path.join(libraryRoot, 'manifests');
export const licensesDir = path.join(libraryRoot, 'licenses');
export const cacheDir = path.join(libraryRoot, 'cache');

export const publicLibraryDir = path.join(projectRoot, 'public', 'samples', 'library');
export const publicAudioDir = path.join(publicLibraryDir, 'audio');

export const families = ['pulse', 'skin', 'seed', 'tremor', 'memory', 'ground'];

export const manifestFiles = {
  library: path.join(manifestsDir, 'library.json'),
  sources: path.join(manifestsDir, 'sources.json'),
  downloads: path.join(manifestsDir, 'downloads.jsonl'),
  auditReport: path.join(manifestsDir, 'audit-report.json'),
  manualReview: path.join(candidatesDir, 'manual-review.json'),
  rejected: path.join(candidatesDir, 'rejected.json'),
  searchPlan: path.join(libraryRoot, 'search-plan.json'),
};

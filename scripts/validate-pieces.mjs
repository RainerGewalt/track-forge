#!/usr/bin/env node

import { constants } from 'node:fs';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PIECE_STATUSES, RELEASE_PREPARATION_STATUSES } from '../src/statuses.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const piecesDir = path.join(projectRoot, 'src', 'pieces');
const publicDir = path.join(projectRoot, 'public');
const artistProfilePath = path.join(projectRoot, 'releases', 'artist-profile.json');
const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const requiredFields = [
  'id',
  'title',
  'artist',
  'status',
  'version',
  'bpm',
  'instrumental',
  'durationTargetMinutes',
  'description',
  'tags',
  'artwork',
  'release',
  'rights',
  'workflow',
];
const releaseFields = [
  'enabled',
  'distributionMode',
  'monetizationEnabled',
  'youtubeContentIdEnabled',
  'explicit',
  'plannedDate',
  'releaseDate',
  'label',
  'distributor',
  'isrc',
];
const rightsFields = [
  'compositionOwner',
  'masterOwner',
  'aiAssisted',
  'aiTools',
  'samples',
  'review',
  'commercialUseChecked',
];
const rightsReviewFields = [
  'compositionStatus',
  'humanContributionDocumented',
  'masterStatus',
  'aiTermsChecked',
  'sampleUseChecked',
  'contentIdStatus',
  'notes',
];
const distributionModes = ['private-library', 'public-streaming'];
const compositionStatuses = [
  'undetermined',
  'human-authored',
  'ai-assisted-human-authored',
  'not-claimed',
];
const masterStatuses = ['not-rendered', 'draft', 'final'];
const contentIdStatuses = ['not-reviewed', 'not-eligible', 'eligible'];
const workflowFields = ['nextStep', 'lastReviewedAt'];
const imageFields = ['src', 'alt', 'focalPoint', 'brief', 'rights'];
const imageRightsFields = [
  'creator',
  'source',
  'license',
  'aiAssisted',
  'aiTool',
  'termsChecked',
  'commercialUseChecked',
];
const imageFilePattern = /^[a-z0-9][a-z0-9._-]*\.(?:avif|jpe?g|png|webp)$/;
const focalPointPattern = /^(\d{1,3})% (\d{1,3})%$/;

const pieceErrors = [];
const seenIds = new Set();

try {
  const artistProfileErrors = await validateArtistProfile();

  if (artistProfileErrors.length === 0) {
    console.log('✓ releases/artist-profile.json');
  } else {
    console.log('✗ releases/artist-profile.json');
    for (const error of artistProfileErrors) {
      console.log(`  - ${error}`);
    }
  }

  const pieceDirs = await listPieceDirectories();

  for (const pieceDir of pieceDirs) {
    const errors = await validatePieceDirectory(pieceDir);

    if (errors.length === 0) {
      console.log(`✓ ${pieceDir}`);
    } else {
      pieceErrors.push({ id: pieceDir, errors });
      console.log(`✗ ${pieceDir}`);
      for (const error of errors) {
        console.log(`  - ${error}`);
      }
    }
  }

  if (pieceErrors.length > 0 || artistProfileErrors.length > 0) {
    const profileSummary = artistProfileErrors.length > 0 ? ' Artist profile is invalid.' : '';
    console.error(`\n${pieceErrors.length} piece(s) are invalid.${profileSummary}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll pieces are valid.');
  }
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
}

async function listPieceDirectories() {
  const entries = await readdir(piecesDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function validatePieceDirectory(pieceDir) {
  const directoryPath = path.join(piecesDir, pieceDir);
  const errors = [];
  const pieceJsonPath = path.join(directoryPath, 'piece.json');
  const pieceJsPath = path.join(directoryPath, 'piece.js');
  const mainStrudelPath = path.join(directoryPath, 'main.strudel');

  if (!(await exists(pieceJsonPath))) {
    errors.push('piece.json is missing.');
  }

  if (!(await exists(pieceJsPath))) {
    errors.push('piece.js is missing.');
  }

  if (!(await exists(mainStrudelPath))) {
    errors.push('main.strudel is missing.');
  }

  if (errors.length > 0) {
    return errors;
  }

  const metadata = await readJson(pieceJsonPath, errors);

  if (!metadata) {
    return errors;
  }

  validateMetadataShape(metadata, pieceDir, errors);
  await validateImageMetadata(metadata.artwork, 'artwork', 'tracks', errors, {
    publicReleaseRequired: RELEASE_PREPARATION_STATUSES.includes(metadata.status),
  });
  await validatePieceModule(pieceJsPath, directoryPath, errors);

  return errors;
}

async function validateArtistProfile() {
  const errors = [];

  if (!(await exists(artistProfilePath))) {
    return ['artist-profile.json is missing.'];
  }

  const profile = await readJson(artistProfilePath, errors, 'artist-profile.json');

  if (!profile) {
    return errors;
  }

  for (const field of [
    'artistName',
    'projectLabel',
    'label',
    'labelStatus',
    'motto',
    'shortBio',
    'longBio',
    'profileImage',
    'releaseNotes',
  ]) {
    if (!Object.hasOwn(profile, field)) {
      errors.push(`artist-profile.json is missing required field: ${field}.`);
    }
  }

  for (const field of ['artistName', 'projectLabel', 'labelStatus', 'motto', 'shortBio', 'longBio']) {
    if (typeof profile[field] !== 'string' || profile[field].trim() === '') {
      errors.push(`${field} must be a non-empty string.`);
    }
  }

  if (profile.label !== null && (typeof profile.label !== 'string' || profile.label.trim() === '')) {
    errors.push('label must be a non-empty string or null.');
  }

  if (!Array.isArray(profile.releaseNotes)) {
    errors.push('releaseNotes must be an array.');
  } else {
    profile.releaseNotes.forEach((note, index) => {
      if (typeof note !== 'string' || note.trim() === '') {
        errors.push(`releaseNotes[${index}] must be a non-empty string.`);
      }
    });
  }

  await validateImageMetadata(profile.profileImage, 'profileImage', 'profile', errors);

  return errors;
}

async function readJson(filePath, errors, label = 'piece.json') {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    errors.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

async function validateImageMetadata(
  image,
  field,
  directory,
  errors,
  { publicReleaseRequired = false } = {},
) {
  if (!isPlainObject(image)) {
    errors.push(`${field} must be an object.`);
    return;
  }

  for (const imageField of imageFields) {
    if (!Object.hasOwn(image, imageField)) {
      errors.push(`${field} is missing required field: ${imageField}.`);
    }
  }

  const srcIsNull = image.src === null;
  const srcIsString = typeof image.src === 'string' && image.src.trim() !== '';

  if (!srcIsNull && !srcIsString) {
    errors.push(`${field}.src must be a non-empty string or null.`);
  }

  if (srcIsString) {
    const prefix = `/images/${directory}/`;
    const fileName = image.src.slice(prefix.length);

    if (!image.src.startsWith(prefix) || !imageFilePattern.test(fileName)) {
      errors.push(
        `${field}.src must point to a lowercase JPG, PNG, WebP or AVIF file directly under ${prefix}.`,
      );
    } else if (!(await exists(path.join(publicDir, 'images', directory, fileName)))) {
      errors.push(`${field}.src references a missing file: ${image.src}.`);
    }
  }

  if (typeof image.alt !== 'string') {
    errors.push(`${field}.alt must be a string.`);
  } else if (srcIsString && image.alt.trim() === '') {
    errors.push(`${field}.alt must describe the image when src is set.`);
  }

  if (typeof image.brief !== 'string' || image.brief.trim() === '') {
    errors.push(`${field}.brief must be a non-empty string.`);
  }

  const focalPoint = focalPointPattern.exec(image.focalPoint ?? '');
  if (!focalPoint || Number(focalPoint[1]) > 100 || Number(focalPoint[2]) > 100) {
    errors.push(`${field}.focalPoint must contain two percentages from 0% to 100%.`);
  }

  if (!isPlainObject(image.rights)) {
    errors.push(`${field}.rights must be an object.`);
    return;
  }

  for (const rightsField of imageRightsFields) {
    if (!Object.hasOwn(image.rights, rightsField)) {
      errors.push(`${field}.rights is missing required field: ${rightsField}.`);
    }
  }

  for (const rightsField of ['creator', 'source', 'license', 'aiTool']) {
    const value = image.rights[rightsField];
    if (value !== null && (typeof value !== 'string' || value.trim() === '')) {
      errors.push(`${field}.rights.${rightsField} must be a non-empty string or null.`);
    }
  }

  if (image.rights.aiAssisted !== null && typeof image.rights.aiAssisted !== 'boolean') {
    errors.push(`${field}.rights.aiAssisted must be a boolean or null.`);
  }

  for (const rightsField of ['termsChecked', 'commercialUseChecked']) {
    if (typeof image.rights[rightsField] !== 'boolean') {
      errors.push(`${field}.rights.${rightsField} must be a boolean.`);
    }
  }

  if (image.rights.aiAssisted === true && !image.rights.aiTool) {
    errors.push(`${field}.rights.aiTool is required for AI-assisted imagery.`);
  }

  if (image.rights.commercialUseChecked) {
    for (const rightsField of ['creator', 'source', 'license']) {
      if (!image.rights[rightsField]) {
        errors.push(
          `${field}.rights.${rightsField} is required before commercial use can be checked.`,
        );
      }
    }

    if (image.rights.aiAssisted === true && !image.rights.termsChecked) {
      errors.push(`${field}.rights.termsChecked is required for commercial AI-assisted imagery.`);
    }
  }

  if (publicReleaseRequired && !srcIsString) {
    errors.push(`${field}.src is required for release-ready and released tracks.`);
  }

  if (publicReleaseRequired && !image.rights.commercialUseChecked) {
    errors.push(
      `${field}.rights.commercialUseChecked must be true for release-ready and released tracks.`,
    );
  }
}

function validateMetadataShape(metadata, pieceDir, errors) {
  for (const field of requiredFields) {
    if (!Object.hasOwn(metadata, field)) {
      errors.push(`piece.json is missing required field: ${field}.`);
    }
  }

  if (metadata.id !== pieceDir) {
    errors.push(`metadata id must match directory name: expected "${pieceDir}".`);
  }

  if (typeof metadata.id !== 'string' || !idPattern.test(metadata.id)) {
    errors.push('metadata id must be kebab-case and start with a lowercase letter.');
  }

  if (seenIds.has(metadata.id)) {
    errors.push(`duplicate metadata id detected: ${metadata.id}.`);
  } else if (metadata.id) {
    seenIds.add(metadata.id);
  }

  if (typeof metadata.title !== 'string' || metadata.title.trim() === '') {
    errors.push('title must be a non-empty string.');
  }

  if (typeof metadata.artist !== 'string') {
    errors.push('artist must be a string.');
  }

  if (!PIECE_STATUSES.includes(metadata.status)) {
    errors.push(`status must be one of: ${PIECE_STATUSES.join(', ')}.`);
  }

  if (typeof metadata.bpm !== 'number' || metadata.bpm <= 0 || metadata.bpm > 300) {
    errors.push('bpm must be a reasonable positive number.');
  }

  if (typeof metadata.instrumental !== 'boolean') {
    errors.push('instrumental must be a boolean.');
  }

  if (typeof metadata.version !== 'string' || metadata.version.trim() === '') {
    errors.push('version must be a non-empty string.');
  }

  if (!Array.isArray(metadata.tags)) {
    errors.push('tags must be an array.');
  }

  validateRelease(metadata, errors);
  validateRights(metadata, errors);
  validateWorkflow(metadata, errors);

  if (Object.hasOwn(metadata, 'timeline')) {
    validateTimeline(metadata.timeline, errors);
  }
}

function validateTimeline(timeline, errors) {
  if (!isPlainObject(timeline)) {
    errors.push('timeline must be an object when provided.');
    return;
  }

  if (
    typeof timeline.durationSeconds !== 'number' ||
    !Number.isFinite(timeline.durationSeconds) ||
    timeline.durationSeconds <= 0
  ) {
    errors.push('timeline.durationSeconds must be a positive number.');
    return;
  }

  if (!isPlainObject(timeline.layers) || Object.keys(timeline.layers).length === 0) {
    errors.push('timeline.layers must be a non-empty object.');
    return;
  }

  for (const [layerId, layer] of Object.entries(timeline.layers)) {
    if (!idPattern.test(layerId)) {
      errors.push(`timeline layer id must be kebab-case: ${layerId}.`);
    }

    if (!isPlainObject(layer)) {
      errors.push(`timeline.layers.${layerId} must be an object.`);
      continue;
    }

    if (typeof layer.family !== 'string' || layer.family.trim() === '') {
      errors.push(`timeline.layers.${layerId}.family must be a non-empty string.`);
    }

    if (!Array.isArray(layer.segments) || layer.segments.length === 0) {
      errors.push(`timeline.layers.${layerId}.segments must be a non-empty array.`);
      continue;
    }

    let previousEnd = 0;

    layer.segments.forEach((segment, index) => {
      const pathPrefix = `timeline.layers.${layerId}.segments[${index}]`;

      if (!isPlainObject(segment)) {
        errors.push(`${pathPrefix} must be an object.`);
        return;
      }

      if (
        typeof segment.from !== 'number' ||
        !Number.isFinite(segment.from) ||
        typeof segment.to !== 'number' ||
        !Number.isFinite(segment.to) ||
        segment.from < 0 ||
        segment.to <= segment.from ||
        segment.to > timeline.durationSeconds
      ) {
        errors.push(`${pathPrefix} must define a valid range within timeline.durationSeconds.`);
      } else if (segment.from < previousEnd) {
        errors.push(`${pathPrefix} must not overlap the preceding segment.`);
      } else {
        previousEnd = segment.to;
      }

      if (typeof segment.label !== 'string' || segment.label.trim() === '') {
        errors.push(`${pathPrefix}.label must be a non-empty string.`);
      }

      if (Object.hasOwn(segment, 'active') && typeof segment.active !== 'boolean') {
        errors.push(`${pathPrefix}.active must be a boolean when provided.`);
      }
    });
  }
}

function validateRelease(metadata, errors) {
  if (!isPlainObject(metadata.release)) {
    errors.push('release must be an object.');
    return;
  }

  for (const field of releaseFields) {
    if (!Object.hasOwn(metadata.release, field)) {
      errors.push(`release is missing required field: ${field}.`);
    }
  }

  if (typeof metadata.release.enabled !== 'boolean') {
    errors.push('release.enabled must be a boolean.');
  }

  if (!distributionModes.includes(metadata.release.distributionMode)) {
    errors.push(`release.distributionMode must be one of: ${distributionModes.join(', ')}.`);
  }

  if (typeof metadata.release.monetizationEnabled !== 'boolean') {
    errors.push('release.monetizationEnabled must be a boolean.');
  }

  if (typeof metadata.release.youtubeContentIdEnabled !== 'boolean') {
    errors.push('release.youtubeContentIdEnabled must be a boolean.');
  }

  if (typeof metadata.release.explicit !== 'boolean') {
    errors.push('release.explicit must be a boolean.');
  }

  for (const field of ['plannedDate', 'releaseDate', 'label', 'distributor', 'isrc']) {
    const value = metadata.release[field];

    if (value !== null && (typeof value !== 'string' || value.trim() === '')) {
      errors.push(`release.${field} must be a non-empty string or null.`);
    }
  }

  if (metadata.release.distributionMode === 'private-library' && metadata.release.enabled) {
    errors.push('private-library tracks must keep release.enabled set to false.');
  }

  if (metadata.status === 'released' && !metadata.release.releaseDate) {
    errors.push('released tracks must contain release.releaseDate.');
  }

  if (metadata.status === 'released' && !metadata.release.distributor) {
    errors.push('released tracks must contain release.distributor.');
  }

  if (metadata.status === 'released' && !metadata.release.isrc) {
    errors.push('released tracks must contain release.isrc.');
  }
}

function validateRights(metadata, errors) {
  if (!isPlainObject(metadata.rights)) {
    errors.push('rights must be an object.');
    return;
  }

  for (const field of rightsFields) {
    if (!Object.hasOwn(metadata.rights, field)) {
      errors.push(`rights is missing required field: ${field}.`);
    }
  }

  if (typeof metadata.rights.compositionOwner !== 'string') {
    errors.push('rights.compositionOwner must be a string.');
  }

  if (typeof metadata.rights.masterOwner !== 'string') {
    errors.push('rights.masterOwner must be a string.');
  }

  const compositionOwner =
    typeof metadata.rights.compositionOwner === 'string'
      ? metadata.rights.compositionOwner.trim()
      : '';
  const masterOwner =
    typeof metadata.rights.masterOwner === 'string' ? metadata.rights.masterOwner.trim() : '';

  if (typeof metadata.rights.aiAssisted !== 'boolean') {
    errors.push('rights.aiAssisted must be a boolean.');
  }

  if (!Array.isArray(metadata.rights.aiTools)) {
    errors.push('rights.aiTools must be an array.');
  } else {
    metadata.rights.aiTools.forEach((tool, index) => {
      if (!isPlainObject(tool)) {
        errors.push(`rights.aiTools[${index}] must be an object.`);
        return;
      }

      if (typeof tool.name !== 'string' || tool.name.trim() === '') {
        errors.push(`rights.aiTools[${index}].name must be a non-empty string.`);
      }

      if (typeof tool.usage !== 'string' || tool.usage.trim() === '') {
        errors.push(`rights.aiTools[${index}].usage must be a non-empty string.`);
      }
    });

    if (metadata.rights.aiAssisted && metadata.rights.aiTools.length === 0) {
      errors.push('AI-assisted tracks must document at least one tool in rights.aiTools.');
    }
  }

  const samples = Array.isArray(metadata.rights.samples) ? metadata.rights.samples : [];

  if (!Array.isArray(metadata.rights.samples)) {
    errors.push('rights.samples must be an array.');
  } else {
    samples.forEach((sample, index) => {
      if (!isPlainObject(sample)) {
        errors.push(`rights.samples[${index}] must be an object.`);
        return;
      }

      if (typeof sample.name !== 'string' || sample.name.trim() === '') {
        errors.push(`rights.samples[${index}].name must be a non-empty string.`);
      }

      if (typeof sample.source !== 'string' || sample.source.trim() === '') {
        errors.push(`rights.samples[${index}].source must be a non-empty string.`);
      }

      if (typeof sample.license !== 'string' || sample.license.trim() === '') {
        errors.push(`rights.samples[${index}].license must be a non-empty string.`);
      }
    });
  }

  const review = metadata.rights.review;

  if (!isPlainObject(review)) {
    errors.push('rights.review must be an object.');
    return;
  }

  for (const field of rightsReviewFields) {
    if (!Object.hasOwn(review, field)) {
      errors.push(`rights.review is missing required field: ${field}.`);
    }
  }

  if (!compositionStatuses.includes(review.compositionStatus)) {
    errors.push(
      `rights.review.compositionStatus must be one of: ${compositionStatuses.join(', ')}.`,
    );
  }

  if (typeof review.humanContributionDocumented !== 'boolean') {
    errors.push('rights.review.humanContributionDocumented must be a boolean.');
  }

  if (!masterStatuses.includes(review.masterStatus)) {
    errors.push(`rights.review.masterStatus must be one of: ${masterStatuses.join(', ')}.`);
  }

  if (typeof review.aiTermsChecked !== 'boolean') {
    errors.push('rights.review.aiTermsChecked must be a boolean.');
  }

  if (typeof review.sampleUseChecked !== 'boolean') {
    errors.push('rights.review.sampleUseChecked must be a boolean.');
  }

  if (!contentIdStatuses.includes(review.contentIdStatus)) {
    errors.push(`rights.review.contentIdStatus must be one of: ${contentIdStatuses.join(', ')}.`);
  }

  if (!Array.isArray(review.notes)) {
    errors.push('rights.review.notes must be an array.');
  } else {
    review.notes.forEach((note, index) => {
      if (typeof note !== 'string' || note.trim() === '') {
        errors.push(`rights.review.notes[${index}] must be a non-empty string.`);
      }
    });
  }

  if (review.compositionStatus === 'undetermined' && compositionOwner) {
    errors.push('rights.compositionOwner must stay empty while composition status is undetermined.');
  }

  if (review.compositionStatus === 'not-claimed' && compositionOwner) {
    errors.push('rights.compositionOwner must stay empty when composition rights are not claimed.');
  }

  if (
    review.sampleUseChecked &&
    samples.some(
      (sample) =>
        typeof sample?.license === 'string' && sample.license.trim().toLowerCase() === 'unknown',
    )
  ) {
    errors.push('rights.review.sampleUseChecked cannot be true while a sample license is unknown.');
  }

  if (metadata.release.youtubeContentIdEnabled && review.contentIdStatus !== 'eligible') {
    errors.push('YouTube Content ID can only be enabled when rights.review.contentIdStatus is eligible.');
  }

  if (typeof metadata.rights.commercialUseChecked !== 'boolean') {
    errors.push('rights.commercialUseChecked must be a boolean.');
  }

  if (metadata.rights.commercialUseChecked) {
    if (review.compositionStatus === 'undetermined') {
      errors.push('commercial-use review requires a determined composition status.');
    }

    if (review.compositionStatus !== 'not-claimed' && !compositionOwner) {
      errors.push('commercial-use review for a claimed composition requires an owner.');
    }

    if (
      ['human-authored', 'ai-assisted-human-authored'].includes(review.compositionStatus) &&
      !review.humanContributionDocumented
    ) {
      errors.push('commercial-use review for a human-authored composition requires contribution evidence.');
    }

    if (review.masterStatus !== 'final') {
      errors.push('commercial-use review requires a final master.');
    }

    if (!masterOwner) {
      errors.push('commercial-use review requires a master owner.');
    }

    if (metadata.rights.aiAssisted && !review.aiTermsChecked) {
      errors.push('commercial-use review for an AI-assisted track requires checked AI terms.');
    }

    if (!review.sampleUseChecked) {
      errors.push('commercial-use review requires checked sample use.');
    }
  }

  if (RELEASE_PREPARATION_STATUSES.includes(metadata.status)) {
    const artist = typeof metadata.artist === 'string' ? metadata.artist.trim() : '';

    if (!artist) {
      errors.push('release-ready and released tracks must define artist.');
    }

    if (!metadata.release.enabled) {
      errors.push('release-ready and released tracks must set release.enabled to true.');
    }

    if (metadata.release.distributionMode !== 'public-streaming') {
      errors.push('release-ready and released tracks must use public-streaming distribution mode.');
    }

    if (!metadata.rights.commercialUseChecked) {
      errors.push('release-ready and released tracks must set rights.commercialUseChecked to true.');
    }

    if (
      review.compositionStatus !== 'not-claimed' &&
      !compositionOwner
    ) {
      errors.push('release-ready and released tracks must define rights.compositionOwner.');
    }

    if (!masterOwner) {
      errors.push('release-ready and released tracks must define rights.masterOwner.');
    }

    if (
      ['human-authored', 'ai-assisted-human-authored'].includes(review.compositionStatus) &&
      !review.humanContributionDocumented
    ) {
      errors.push('claimed human composition rights require documented human contribution.');
    }
  }
}

function validateWorkflow(metadata, errors) {
  if (!isPlainObject(metadata.workflow)) {
    errors.push('workflow must be an object.');
    return;
  }

  for (const field of workflowFields) {
    if (!Object.hasOwn(metadata.workflow, field)) {
      errors.push(`workflow is missing required field: ${field}.`);
    }
  }

  if (typeof metadata.workflow.nextStep !== 'string') {
    errors.push('workflow.nextStep must be a string.');
  }
}

async function validatePieceModule(pieceJsPath, directoryPath, errors) {
  const source = await readFile(pieceJsPath, 'utf8');
  const sectionImports = [...source.matchAll(/from\s+['"]\.\/([^'"]+\.strudel)\?raw['"]/g)].map(
    (match) => match[1],
  );

  if (!source.includes('export default')) {
    errors.push('piece.js must export a default piece object.');
  }

  if (sectionImports.length === 0) {
    errors.push('piece.js must import at least one .strudel section with ?raw.');
  }

  if (!sectionImports.includes('main.strudel')) {
    errors.push('piece.js must import main.strudel as a section.');
  }

  for (const sectionFile of sectionImports) {
    const sectionPath = path.join(directoryPath, sectionFile);

    if (!(await exists(sectionPath))) {
      errors.push(`piece.js references missing Strudel section: ${sectionFile}.`);
    }
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// License policy for the initial Black Organic Trance sample library.
//
// The policy is deliberately strict: only CC0 1.0 (and canonical explicit
// public-domain dedications) are accepted automatically. Everything that is
// merely permissive goes to the manual-review queue; every NC/ND/SA or
// unclear license is rejected outright. Openverse metadata alone is never
// sufficient evidence — verification must happen at the canonical provider.

const CC0_PATTERNS = [
  /^cc0(\s|-)?1\.0?$/i,
  /^cc0$/i,
  /creativecommons\.org\/publicdomain\/zero\/1\.0/i,
];

const MANUAL_REVIEW_PATTERNS = [
  /^pdm?(\s|-)?1\.0?$/i,
  /^public domain mark/i,
  /creativecommons\.org\/publicdomain\/mark/i,
  /^cc(\s|-)?by(\s|-)?[0-9.]*$/i,
  /creativecommons\.org\/licenses\/by\/[0-9.]+\/?$/i,
];

const REJECT_PATTERNS = [
  /by[-\s]?nc/i,
  /by[-\s]?nd/i,
  /by[-\s]?sa/i,
  /nc[-\s]?sa/i,
  /nc[-\s]?nd/i,
  /sampling/i,
  /gfdl/i,
  /all rights reserved/i,
];

export const VERDICT = {
  accept: 'accept',
  manualReview: 'manual-review',
  reject: 'reject',
};

export function classifyLicense(licenseText, licenseUrl = '') {
  const haystacks = [licenseText ?? '', licenseUrl ?? ''].map((value) => value.trim());

  if (haystacks.every((value) => value === '')) {
    return { verdict: VERDICT.reject, reason: 'missing license information' };
  }

  for (const value of haystacks) {
    if (REJECT_PATTERNS.some((pattern) => pattern.test(value))) {
      return { verdict: VERDICT.reject, reason: `restricted license: ${value}` };
    }
  }

  for (const value of haystacks) {
    if (CC0_PATTERNS.some((pattern) => pattern.test(value))) {
      return { verdict: VERDICT.accept, reason: `CC0 confirmed: ${value}` };
    }
  }

  for (const value of haystacks) {
    if (MANUAL_REVIEW_PATTERNS.some((pattern) => pattern.test(value))) {
      return {
        verdict: VERDICT.manualReview,
        reason: `permissive but not CC0, needs manual review: ${value}`,
      };
    }
  }

  return { verdict: VERDICT.reject, reason: `unrecognized license: ${haystacks.join(' | ')}` };
}

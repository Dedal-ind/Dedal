// policy-documents.js
// The client side of the legal-text registry: the two document kinds, the
// reads against the public policy endpoints and the consent-standing endpoint,
// and the small amount of rendering and validation logic the consent screens
// share.
//
// THE BACKEND IS THE SOURCE OF TRUTH. No screen holds policy text any more;
// each renders whatever the registry serves, with the version label and
// effective date visible, so a reader always knows which text they are
// looking at — and a consent tick can name the exact version it was made
// against.

import apiClient from '../api-client/api-client.js';

export const POLICY_KINDS = {
  TERMS_OF_SERVICE: 'termsOfService',
  PRIVACY_POLICY: 'privacyPolicy',
};

/* The route that shows a specific past version back, verbatim. */
export function policyVersionPath(versionId) {
  return `/policies/versions/${versionId}`;
}

export function fetchEffectivePolicy(kind) {
  return apiClient.get(`/public/policies/${kind}/effective`);
}

export function fetchPolicyVersion(versionId) {
  return apiClient.get(`/public/policies/versions/${versionId}`);
}

export function fetchConsentStanding() {
  return apiClient.get('/users/me/consents');
}

/* The api-client's synthetic code for a request that never reached the server. */
export function isNetworkError(error) {
  return error?.code === 'NETWORK_ERROR';
}

export function formatPolicyDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/*
 * The markdown subset the published documents use — a "# " title, "## "
 * headings, paragraphs separated by blank lines, and single line breaks
 * inside a paragraph (the contact block). Parsed into blocks the screen lays
 * out with its own typography; there is no HTML in the source and none is
 * produced, so nothing here needs sanitising. If a document ever needs more
 * than this, add a real markdown renderer rather than growing this parser.
 */
export function parseMarkdownBlocks(text) {
  if (typeof text !== 'string') {
    return [];
  }
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      if (chunk.startsWith('## ')) {
        return { type: 'heading', text: chunk.slice(3).trim() };
      }
      if (chunk.startsWith('# ')) {
        return { type: 'title', text: chunk.slice(2).trim() };
      }
      return { type: 'paragraph', lines: chunk.split('\n').map((line) => line.trim()) };
    });
}

/*
 * Date of birth, as the form collects it: a "YYYY-MM-DD" string from a date
 * input. Optional — empty is fine and means "not given". A value must be a
 * real calendar date, not in the future, and not implausibly far back. The
 * same three rules the server applies, checked here so the person is told at
 * the field rather than by a 400. Returns { value, error } where value is the
 * string to send (or null for empty) and error is a message or ''.
 */
const DATE_OF_BIRTH_MAX_AGE_YEARS = 130;

export function validateDateOfBirthInput(rawValue, copy, now = new Date()) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (value === '') {
    return { value: null, error: '' };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return { value: null, error: copy.invalid };
  }
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!isRealDate) {
    return { value: null, error: copy.invalid };
  }
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (date.getTime() > today.getTime()) {
    return { value: null, error: copy.future };
  }
  if (now.getUTCFullYear() - year > DATE_OF_BIRTH_MAX_AGE_YEARS) {
    return { value: null, error: copy.tooOld };
  }
  return { value, error: '' };
}

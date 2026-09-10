// professional-email.js
// The client-side half of the institutional-email rule, shared by Edit Profile
// and Profile Completion so the two screens cannot drift apart on what counts.
//
// This mirrors the server's list in validators/user-validator.js and is a
// COURTESY, not the enforcement: the server re-checks every value it stores. It
// exists so somebody who types their gmail is told at the field instead of after
// a round trip that discards the rest of the form.
//
// A DENYLIST of consumer hosts rather than an allowlist of academic suffixes:
// Indian institutions sit on .ac.in, .edu.in, .edu, .org, .com and a long tail
// of vanity domains, so an allowlist would reject far more real college
// addresses than it caught personal ones.

const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'proton.me',
  'aol.com',
  'live.com',
  'rediffmail.com',
  'zoho.com',
]);

/*
 * Returns an error key, or null when the value is acceptable. An EMPTY value is
 * acceptable: the field is optional, and nagging about a box nobody was asked to
 * fill is how people learn to ignore validation.
 */
export function checkProfessionalEmail(rawValue) {
  const trimmed = String(rawValue ?? '').trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return 'invalid';
  }
  const domain = trimmed.slice(trimmed.lastIndexOf('@') + 1);
  return PERSONAL_EMAIL_DOMAINS.has(domain) ? 'personal' : null;
}

export default checkProfessionalEmail;

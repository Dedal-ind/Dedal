// certificate-error-messages.js
// Each backend code the coordinator-facing certificate actions can actually
// return, mapped to a specific message — same pattern as team-error-messages.
// Falls back to the backend's own message, then a caller-supplied generic.

const CERTIFICATE_ERROR_MESSAGES = {
  // The coordinator no longer covers this event (assignment revoked mid-session).
  PERMISSION_DENIED: 'Your assignment does not cover this event any more.',
  CERTIFICATES_ALREADY_RELEASED: "This fest's certificates have already been released.",
  ASSIGNMENT_EXPIRED: 'Your assignment window has ended; certificates can no longer be changed.',
  ASSIGNMENT_REVOKED: 'Your assignment has been revoked; certificates can no longer be changed.',
};

export function formatCertificateErrorMessage(error, fallback) {
  return CERTIFICATE_ERROR_MESSAGES[error?.code] || error?.message || fallback;
}

// google-sign-in-error-messages.js
// Each backend error code the /authentication/google endpoint can actually
// return, mapped to its own message — the same pattern as team-error-messages.
// USER_ALREADY_SIGNED_IN is deliberately absent: the sign-in screen clears the
// stale stored token and retries instead of showing an error for it.

import { AUTH_COPY } from '../brand/brand-copy.js';

const GOOGLE_SIGN_IN_ERROR_MESSAGES = {
  // 503 — the SERVER has no client id. Our misconfiguration, not the user's error.
  GOOGLE_SIGN_IN_NOT_CONFIGURED: AUTH_COPY.googleNotConfigured,
  // 401 — the token failed Google's verification, or the Google email is unverified.
  GOOGLE_TOKEN_INVALID: AUTH_COPY.googleFailed,
  // 401 — a verified token that carries no email claim at all.
  GOOGLE_EMAIL_MISSING: AUTH_COPY.googleEmailMissing,
  // 403 — the account exists and is blocked.
  USER_BLOCKED: AUTH_COPY.googleAccountBlocked,
};

export function formatGoogleSignInErrorMessage(error) {
  return GOOGLE_SIGN_IN_ERROR_MESSAGES[error?.code] || error?.message || AUTH_COPY.googleFailed;
}

// post-sign-in-redirect.js
// A one-slot stash for "where the user was trying to go before we bounced them to
// sign in". The admin gate saves the intended /admin path when it turns away an
// unauthenticated visitor, and the participant register/join entry points save
// their destination the same way (router state does NOT survive the sign-in
// round-trip — see EventDetailScreen.handleRegister). The sign-in flows read it
// back after a successful auth so the user lands where they meant to, not on a
// generic home.
//
// sessionStorage, not a React ref: the sign-in round-trip (OTP screen, Google
// popup) crosses component unmounts and, for OAuth, a full navigation to "/", so
// the intended route has to survive outside React state. It is scoped to the tab
// and cleared the moment it is consumed, so it can never misroute a later sign-in.

const INTENDED_ROUTE_KEY = 'festpass.intendedRoute';

// Only same-origin app paths are ever stored, so a stale or tampered value can
// at worst send the user to another in-app screen — never off-site.
export function saveIntendedRoute(path) {
  if (typeof path === 'string' && path.startsWith('/')) {
    window.sessionStorage.setItem(INTENDED_ROUTE_KEY, path);
  }
}

// Read WITHOUT clearing. ResponsiveShell uses this to decide whether the shared
// sign-in entry ("/") must stay reachable on desktop for an admin about to sign
// in — a decision made on every render, so it must not consume the value the
// sign-in flow still needs afterwards.
export function peekIntendedRoute() {
  const path = window.sessionStorage.getItem(INTENDED_ROUTE_KEY);
  return path && path.startsWith('/') ? path : null;
}

// Read and clear in one call: an intended route is meant to be honoured exactly
// once.
export function takeIntendedRoute() {
  const path = window.sessionStorage.getItem(INTENDED_ROUTE_KEY);
  window.sessionStorage.removeItem(INTENDED_ROUTE_KEY);
  return path && path.startsWith('/') ? path : null;
}

/*
 * Resolve where a just-signed-in user should land.
 *   - An intended route was saved (e.g. a deep link into /admin) → honour it; the
 *     admin gate itself decides authorized vs not-authorized from there.
 *   - Otherwise → "/", the role router.
 *
 * This deliberately does NOT branch on isProfileComplete. Admin authority is
 * derived from staff assignments, which are still in flight at the moment a
 * sign-in resolves — so a check here can only see the profile flag, and would
 * send every administrator to /profile-completion for want of a USN they do not
 * need. RootRoute is the one place that already waits for authority to resolve,
 * so it owns the whole decision: admin → console, incomplete participant →
 * profile completion, everyone else → the feed.
 */
export function resolvePostSignInRoute() {
  return takeIntendedRoute() ?? '/';
}

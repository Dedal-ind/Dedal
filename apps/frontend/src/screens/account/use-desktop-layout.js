// use-desktop-layout.js
// The account layout breakpoint, read from JavaScript. Split out of
// AccountScreen.jsx for the same reason as account-sections.js: AppHeader
// reads it too, and a hook exported beside a component breaks Fast Refresh.

import { useSyncExternalStore } from 'react';

const DESKTOP_QUERY = '(min-width: 1024px)';

/*
 * The layout breakpoint has to be readable from JavaScript because it decides
 * WHERE a row goes, not just how it looks: on a laptop a row swaps the right
 * pane, on a phone it leaves for the section's own screen. CSS cannot express
 * that, so the query is asked directly here and account.css uses the same
 * 1024px — the two are stated once each and must move together.
 *
 * useSyncExternalStore rather than useState plus an effect: a media query IS an
 * external store, and this way React reads the width at render time. The effect
 * version could not — it had to re-read the query after mounting to cover a
 * resize between the initial state and the subscription, which is a setState in
 * an effect body and a cascading render.
 */
function subscribeToDesktopQuery(onChange) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readIsDesktop() {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

export function useIsDesktopLayout() {
  return useSyncExternalStore(subscribeToDesktopQuery, readIsDesktop, () => false);
}

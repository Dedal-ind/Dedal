// view-transition-policy.js
// Which routes get a page transition, which do not, and the low-level plumbing
// that publishes the direction to CSS.
//
// The rules live here rather than in the screens they apply to for two
// reasons. First, two of the excluded screens (the QR pass and the volunteer
// scanner) are owned elsewhere and must not be edited to opt out — a policy
// that only works if every screen remembers to cooperate is a policy that will
// be wrong within a month. Second, an exclusion is about the DESTINATION, and
// the destination is known at the call site, not inside the screen that has
// not mounted yet.

import {
  NAVIGATION_DIRECTIONS,
  compareNavigationDirection,
} from '../../helpers/navigation-depth.js';

/*
 * ROUTES THAT NEVER ANIMATE.
 *
 * · /my-passes/:festId — the gate pass. Somebody is standing at a gate with a
 *   queue behind them and a volunteer waiting to scan. 200ms of poster slide
 *   is 200ms of a QR code that is not yet on screen, and this is the one
 *   screen in the app whose entire job is to appear instantly.
 *
 * · /backstage/scanner — the volunteer scanner, the other half of that same
 *   thirty seconds at the gate. Same reasoning, from the other side of the
 *   phone.
 *
 * Note this matches BOTH directions: leaving the pass screen is also
 * instant. Sliding away from a gate pass while the volunteer is still looking
 * at it is the same problem in reverse.
 */
const NEVER_ANIMATED = [
  /* /my-passes is the LIST and does animate; only /my-passes/:festId is the
     pass itself, hence the two-segment check. */
  (segments) => segments[0] === 'my-passes' && segments.length >= 2,
  (segments) => segments[0] === 'backstage' && segments[1] === 'scanner',
];

function toSegments(pathname) {
  if (typeof pathname !== 'string') {
    return [];
  }
  const [withoutQuery] = pathname.split('?');
  return withoutQuery.split('/').filter(Boolean);
}

/** True when this path must never be part of an animated navigation. */
export function isTransitionExemptPath(pathname) {
  const segments = toSegments(pathname);
  return NEVER_ANIMATED.some((matches) => matches(segments));
}

/**
 * True when the browser can actually do this. Checked at the call site rather
 * than assumed, so Firefox and older Safari take the plain navigation path
 * with no errors and no dead attribute left on <html>.
 *
 * React Router already guards internally, but we also skip our own attribute
 * bookkeeping when there is no transition to attribute.
 */
export function supportsViewTransitions() {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
}

/*
 * Publishing the direction.
 *
 * This MUST happen synchronously before the navigation is handed to the
 * router: the browser matches ::view-transition-* animations at the instant
 * the snapshot is taken, and an attribute written a tick later is an attribute
 * written after the animations have already been chosen.
 */
let clearTimerId = null;

export function setNavigationDirection(direction) {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.navDirection = direction;

  /*
   * Clear it again once no transition can still be running. 600ms is a
   * deliberate over-estimate of the longest animation here (200ms) — clearing
   * the attribute mid-flight would restyle the live pseudo-elements and cancel
   * the animation half way, which looks far worse than a stale attribute.
   *
   * The attribute is also overwritten by the next navigation regardless, so
   * this timer is hygiene, not correctness.
   */
  if (clearTimerId) {
    window.clearTimeout(clearTimerId);
  }
  clearTimerId = window.setTimeout(() => {
    delete document.documentElement.dataset.navDirection;
    clearTimerId = null;
  }, 600);
}

export function clearNavigationDirection() {
  if (typeof document === 'undefined') {
    return;
  }
  if (clearTimerId) {
    window.clearTimeout(clearTimerId);
    clearTimerId = null;
  }
  delete document.documentElement.dataset.navDirection;
}

/**
 * The whole decision for one navigation, in one place.
 *
 * @returns {{ animate: boolean, direction: string }}
 */
export function resolveNavigation({ fromPathname, toPathname, navigationType, forceSkip = false }) {
  const direction = compareNavigationDirection(fromPathname, toPathname, navigationType);

  if (
    forceSkip ||
    !supportsViewTransitions() ||
    isTransitionExemptPath(toPathname) ||
    isTransitionExemptPath(fromPathname)
  ) {
    return { animate: false, direction };
  }
  return { animate: true, direction };
}

export { NAVIGATION_DIRECTIONS };

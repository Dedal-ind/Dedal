// navigation-depth.js
// The direction rule for page transitions: given where you were, where you are
// going, and how the navigation was triggered, decide whether the app should
// animate forward, back, or sideways.
//
// WHY A DEPTH LADDER AND NOT JUST PUSH/POP. The router tells us PUSH or POP,
// and POP is authoritative — a browser Back button is a back gesture no matter
// what the two paths are, and that is the signal a person actually feels in
// their thumb. But PUSH says nothing about direction: tapping a fest from the
// feed and tapping "My fests" from the header are both PUSHes, and animating
// the second one as a forward push into a deeper level is a lie about the
// shape of the app. So PUSH is resolved against a declared hierarchy:
//
//   /                      0   the feed
//   /fests/:slug           1   a fest
//   /events/:slug          2   an event inside it
//   /register/:eventId     3   registering for that event
//   /checkout/:id          4   paying for that registration
//
// Anything not on that ladder — /profile, /settings, /my-fests, /search — is
// depth 0: they are siblings of the feed, reached from the header rather than
// by descending, and they crossfade. That is deliberate, not a gap: a lateral
// move that slides sideways implies a back-stack that is not there.
//
// This module is PURE. No DOM reads, no router imports, no side effects — it
// is the one part of the transition system that can be reasoned about (and
// unit-tested) without a browser.

/*
 * The ladder, most specific first. Each entry is a matcher over the path
 * SEGMENTS rather than a regular expression over the whole string, because
 * slugs and ObjectIds are arbitrary text and a regex over them is a bug
 * waiting for a slug with a slash-escape in it.
 */
const DEPTH_LADDER = [
  { depth: 4, segments: ['checkout', '*'] },
  { depth: 3, segments: ['register', '*'] },
  { depth: 2, segments: ['events', '*'] },
  { depth: 1, segments: ['fests', '*'] },
  { depth: 0, segments: [] },
];

/* Everything off the ladder sits beside the feed. */
export const DEFAULT_DEPTH = 0;

function toSegments(pathname) {
  if (typeof pathname !== 'string') {
    return [];
  }
  return pathname.split('/').filter(Boolean);
}

function matchesSegments(actual, pattern) {
  if (actual.length < pattern.length) {
    return false;
  }
  return pattern.every((part, index) => part === '*' || part === actual[index]);
}

/**
 * The depth of a pathname on the ladder above. Pure; safe to call with
 * anything, including '' and undefined.
 */
export function getNavigationDepth(pathname) {
  const segments = toSegments(pathname);
  if (segments.length === 0) {
    return 0;
  }
  const hit = DEPTH_LADDER.find((rung) => rung.segments.length > 0 && matchesSegments(segments, rung.segments));
  return hit ? hit.depth : DEFAULT_DEPTH;
}

export const NAVIGATION_DIRECTIONS = {
  FORWARD: 'forward',
  BACK: 'back',
  SAME: 'same',
};

/**
 * The comparator.
 *
 * @param {string} fromPathname  where the user is now
 * @param {string} toPathname    where they are going
 * @param {string} [navigationType] 'PUSH' | 'POP' | 'REPLACE' when known
 * @returns {'forward'|'back'|'same'}
 *
 * POP short-circuits everything. A person who pressed the hardware/browser
 * back button has already decided this is a back move; if the depths happen to
 * increase (they went forward into a page, then back into a DEEPER entry via
 * forward-history) the honest animation is still back, because that is the
 * gesture. REPLACE is treated as 'same' — nothing was stacked, so nothing
 * should look like it was.
 */
export function compareNavigationDirection(fromPathname, toPathname, navigationType) {
  if (navigationType === 'POP') {
    return NAVIGATION_DIRECTIONS.BACK;
  }
  if (navigationType === 'REPLACE') {
    return NAVIGATION_DIRECTIONS.SAME;
  }

  const from = getNavigationDepth(fromPathname);
  const to = getNavigationDepth(toPathname);

  if (to > from) {
    return NAVIGATION_DIRECTIONS.FORWARD;
  }
  if (to < from) {
    return NAVIGATION_DIRECTIONS.BACK;
  }
  return NAVIGATION_DIRECTIONS.SAME;
}

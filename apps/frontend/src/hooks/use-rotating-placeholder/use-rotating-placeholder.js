// use-rotating-placeholder.js
// The suggestion that cycles inside the search field, shared by the desktop
// modal, the /search page and the bar on Discover — so all three suggest the
// same things at the same cadence instead of drifting.
//
// IT RETURNS A TERM, NOT A WHOLE SENTENCE, and that is the important part.
//
// The first version rotated entire strings ("Search for tech fests" → "Search
// for music events") and cross-faded them. It read badly: the words "Search
// for" fade out and fade back in unchanged every three seconds, so the eye is
// pulled to a flicker that carries no information, and the part that actually
// changed is the part that moved least. Every search box that does this well —
// Google, Airbnb, Zomato, District — holds the stem still and moves only the
// noun.
//
// So the caller renders `PLACEHOLDER_PREFIX` as fixed text and animates only
// `term`. This hook does nothing but tick the index; the motion belongs to the
// component that owns the element, and lives in RotatingPlaceholder.
//
// REDUCED MOTION STOPS THE ROTATION ENTIRELY rather than merely removing the
// transition. Text that rewrites itself every three seconds is exactly the kind
// of unrequested movement the preference exists to prevent, and a still
// suggestion loses nothing but variety.

import { useEffect, useState } from 'react';

const HOLD_MS = 3000;

export const PLACEHOLDER_PREFIX = 'Search for ';

export const SEARCH_TERMS = [
  'tech fests',
  'music events',
  'cultural nights',
  'hackathons',
  'dance competitions',
  'quiz nights',
];

export function useRotatingPlaceholder(terms = SEARCH_TERMS) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (terms.length <= 1 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return undefined;
    }
    const interval = setInterval(() => {
      setIndex((current) => (current + 1) % terms.length);
    }, HOLD_MS);
    return () => clearInterval(interval);
  }, [terms]);

  return {
    prefix: PLACEHOLDER_PREFIX,
    term: terms[index],
    index,
    /* The whole sentence, for anywhere that needs a plain string — an
       aria-label, or a real placeholder attribute as a fallback. */
    full: `${PLACEHOLDER_PREFIX}${terms[index]}`,
  };
}

export default useRotatingPlaceholder;

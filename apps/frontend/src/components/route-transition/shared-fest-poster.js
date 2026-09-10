// shared-fest-poster.js
// THE ONE SHARED ELEMENT: the poster on a fest card in the feed becomes the
// hero image on the fest page.
//
// One, not a system of them. A morph is a claim that two things on two screens
// are the SAME object; make that claim about five things at once and it stops
// being a claim about anything, it is just five things moving. The poster is
// the one element where it is literally true — same image, same fest, same
// photograph, and it is the thing the thumb was aiming at.
//
// ─────────────────────────────────────────────────────────────────────────────
// UNIQUENESS, WHICH IS THE PART THAT BREAKS
//
// `view-transition-name` must be unique across the document at the moment the
// snapshot is taken. Two elements carrying `fest-poster` at once is not a
// visual glitch — the API throws and SKIPS THE ENTIRE TRANSITION, so the page
// hard-cuts and nothing anywhere animates.
//
// The feed renders dozens of cards. So the name is never written in JSX and
// never written by a component: it is written imperatively, to exactly one DOM
// node, in the click handler of the card that was tapped, through the single
// entry point below. This module holds a module-level reference to whichever
// node currently owns the name and strips it before granting it to another, so
// there is no arrangement of taps — fast double taps, a tap during a
// transition, a tap after a failed navigation — that can produce two.
//
// The destination side is equally guarded: the hero claims the name only if
// there is a PENDING handoff for its own fest slug, and reading that handoff
// consumes it. A direct visit to /fests/whatever, or a browser Back into the
// fest page, finds nothing pending and renders an unnamed hero.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';

export const SHARED_FEST_POSTER_NAME = 'fest-poster';

/* The single node currently holding the name, and the fest the handoff is for. */
let namedElement = null;
let pendingFestSlug = null;
let releaseTimerId = null;

/*
 * How much of the card has to be on screen for the morph to be honest. A
 * poster that is 20% visible at the bottom edge would morph from a sliver,
 * which reads as the hero growing out of the floor rather than out of the card
 * you tapped.
 */
const MIN_VISIBLE_FRACTION = 0.6;

function releaseName() {
  if (releaseTimerId) {
    window.clearTimeout(releaseTimerId);
    releaseTimerId = null;
  }
  if (namedElement) {
    namedElement.style.viewTransitionName = '';
    namedElement = null;
  }
}

/*
 * VISIBILITY: getBoundingClientRect, not IntersectionObserver — and the choice
 * matters.
 *
 * The decision has to be made in the SAME synchronous tick as the navigate()
 * call, because the name must already be on the node when the router takes the
 * outgoing snapshot. IntersectionObserver is asynchronous by construction: it
 * reports through a callback, and its most recent record is a description of
 * some earlier frame. In a feed that is still settling from a fling — which is
 * exactly when somebody taps a card — "where the observer last said it was" and
 * "where it is now" are different rectangles, and morphing from the wrong one
 * is worse than not morphing at all.
 *
 * getBoundingClientRect is a forced layout read, which is the usual reason to
 * avoid it. Here it is one read, on one element, on a tap, immediately before
 * a route change that is going to relayout the whole page anyway. The cost is
 * not measurable and the answer is true.
 */
function isSubstantiallyVisible(element) {
  const rect = element.getBoundingClientRect();
  if (rect.height <= 0 || rect.width <= 0) {
    return false;
  }
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
  return visibleHeight / rect.height >= MIN_VISIBLE_FRACTION;
}

/**
 * Claim the shared name for the poster inside the card that was just tapped.
 *
 * @param {HTMLElement|null} cardElement the card root (or anything containing
 *   the media element)
 * @param {string|null} festSlug the fest being opened
 * @returns {boolean} true if the handoff was armed. False means the caller
 *   gets the ordinary forward slide — which is the correct outcome, not a
 *   failure: no poster, an off-screen card, or no browser support all land
 *   here.
 */
export function markSharedFestPoster(cardElement, festSlug) {
  /* Whatever happened last time, it is over. */
  releaseName();
  pendingFestSlug = null;

  if (
    !cardElement ||
    !festSlug ||
    typeof document === 'undefined' ||
    typeof document.startViewTransition !== 'function'
  ) {
    return false;
  }

  /* The <img> or <video> the feed card paints — not the card, not the frame.
     Morphing the whole card would mean morphing its title and meta text too,
     which stretch horribly. */
  const media = cardElement.querySelector('.dsc-media__el');
  if (!media || !isSubstantiallyVisible(media)) {
    return false;
  }

  media.style.viewTransitionName = SHARED_FEST_POSTER_NAME;
  namedElement = media;
  pendingFestSlug = festSlug;

  /*
   * Hand the name back after the transition can no longer be running. In
   * practice the feed unmounts first and the node goes with it; this timer is
   * for the navigation that never happens (a guard redirects, the fest 404s)
   * and would otherwise leave a live card holding a name that the NEXT tap
   * would then collide with.
   */
  releaseTimerId = window.setTimeout(() => {
    releaseName();
    pendingFestSlug = null;
  }, 600);

  return true;
}

/**
 * The destination side. Returns true exactly once, for the fest that was
 * actually tapped, and only on the render that immediately follows the tap.
 * Consuming clears the handoff so a later re-render, a re-mount, or a Back
 * into this page cannot re-claim the name behind a card that is once again on
 * screen holding it.
 */
export function consumePendingSharedFestPoster(festSlug) {
  if (!festSlug || pendingFestSlug !== festSlug) {
    return false;
  }
  pendingFestSlug = null;
  return true;
}

/**
 * The hook the destination hero uses.
 *
 * Returns a style object for the first render after a tap, and undefined
 * forever after. Two properties of this are load-bearing:
 *
 *  1. It resolves during the INITIAL render (useState initialiser), not in an
 *     effect. React Router commits the new DOM inside the startViewTransition
 *     callback and the browser snapshots immediately afterwards; a name applied
 *     in useEffect would land after the snapshot and morph nothing.
 *
 *  2. It takes the name away again once the transition is over. A hero that
 *     keeps its view-transition-name permanently would be captured as its own
 *     detached snapshot on every SUBSEQUENT navigation away from this page —
 *     which is the exact mechanism that makes fixed and sticky chrome jump
 *     during view transitions. The name exists for one transition and then
 *     stops existing.
 */
export function useSharedFestPosterStyle(festSlug) {
  const [isShared, setIsShared] = useState(() => consumePendingSharedFestPoster(festSlug));

  useEffect(() => {
    if (!isShared) {
      return undefined;
    }
    /* Comfortably past the 200ms forward transition; see the note above. */
    const timerId = window.setTimeout(() => setIsShared(false), 600);
    return () => window.clearTimeout(timerId);
  }, [isShared]);

  return isShared ? { viewTransitionName: SHARED_FEST_POSTER_NAME } : undefined;
}

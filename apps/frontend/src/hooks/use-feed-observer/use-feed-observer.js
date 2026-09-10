// use-feed-observer.js
// Two IntersectionObservers for the whole feed, not two per card.
//
// A feed of forty cards that each construct their own observer builds eighty
// observers, and every one of them is a separate callback the compositor has
// to service on scroll. These two are created once, on first use, and every
// card registers against them; the element-to-callback lookup is a Map, so
// registering and unregistering are both constant time.
//
// WHY TWO AND NOT ONE. They answer different questions and cannot share a root:
//
//   NEAR   — "is this within 200px of the viewport?", which is the cue to start
//            fetching the image or attach the video's real source. Its root is
//            deliberately grown by 200px so the media is already arriving by
//            the time the card is on screen.
//
//   ACTIVE — "is at least half of this actually on screen?", which is the cue
//            to play or pause a video. Its root is the viewport exactly. Asking
//            the NEAR observer for a 0.5 ratio would measure the ratio against
//            its inflated root, and a card sitting 150px below the fold would
//            report itself half-visible while nobody could see it.
//
// Both observers are torn down when their last element unregisters, so a route
// change away from the feed leaves nothing running.

import { useEffect } from 'react';

const NEAR_ROOT_MARGIN = '200px 0px';
const ACTIVE_THRESHOLD = 0.5;

/* element -> callback, one Map per observer. */
const nearCallbacks = new Map();
const activeCallbacks = new Map();

let nearObserver = null;
let activeObserver = null;

function isObserverSupported() {
  return typeof IntersectionObserver !== 'undefined';
}

function ensureNearObserver() {
  if (nearObserver || !isObserverSupported()) {
    return nearObserver;
  }
  nearObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }
        const callback = nearCallbacks.get(entry.target);
        /*
         * NEAR fires ONCE per element. Media that has begun loading does not
         * un-load when the card scrolls away, so a second notification has
         * nothing to say — and unobserving here is what keeps a long scroll
         * from re-running the same work on every pass.
         */
        if (callback) {
          nearCallbacks.delete(entry.target);
          nearObserver.unobserve(entry.target);
          callback();
        }
      });
      if (nearCallbacks.size === 0) {
        nearObserver.disconnect();
        nearObserver = null;
      }
    },
    { rootMargin: NEAR_ROOT_MARGIN, threshold: 0 },
  );
  return nearObserver;
}

function ensureActiveObserver() {
  if (activeObserver || !isObserverSupported()) {
    return activeObserver;
  }
  activeObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const callback = activeCallbacks.get(entry.target);
        if (!callback) {
          return;
        }
        /*
         * The RATIO decides, never entry.isIntersecting. Some engines report
         * the flag true the instant a single pixel crosses the edge, and a
         * video that starts on one pixel is a video that starts off screen.
         */
        callback(entry.intersectionRatio >= ACTIVE_THRESHOLD);
      });
    },
    /* 0 is in the list so the "dropped below half" edge reports too. */
    { threshold: [0, ACTIVE_THRESHOLD] },
  );
  return activeObserver;
}

/*
 * Fires `onNear` once, when the element comes within 200px of the viewport.
 * Disabled by passing a falsy `enabled` — a card whose media has already been
 * requested does not register at all.
 */
export function useNearViewport(elementRef, onNear, enabled = true) {
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !enabled) {
      return undefined;
    }
    if (!isObserverSupported()) {
      /* No observer: load immediately. A browser that cannot tell us when the
         card is near must not be a browser where the media never arrives. */
      onNear();
      return undefined;
    }
    const observer = ensureNearObserver();
    nearCallbacks.set(element, onNear);
    observer.observe(element);
    return () => {
      nearCallbacks.delete(element);
      nearObserver?.unobserve(element);
    };
    /* onNear is a stable useCallback at every call site; re-arming the observer
       on every parent render would restart the load decision mid-scroll. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementRef, enabled]);
}

/*
 * Calls `onActiveChange(isActive)` whenever the element crosses the halfway
 * mark in either direction. Stays registered for the element's whole life:
 * unlike loading, playback is a state that has to be revoked as well as set.
 */
export function useHalfVisible(elementRef, onActiveChange, enabled = true) {
  useEffect(() => {
    const element = elementRef.current;
    if (!element || !enabled || !isObserverSupported()) {
      return undefined;
    }
    const observer = ensureActiveObserver();
    activeCallbacks.set(element, onActiveChange);
    observer.observe(element);
    return () => {
      activeCallbacks.delete(element);
      activeObserver?.unobserve(element);
      if (activeCallbacks.size === 0) {
        activeObserver?.disconnect();
        activeObserver = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementRef, enabled]);
}

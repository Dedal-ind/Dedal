// use-viewability.js
// Measures one element against the viewability standard: at least half its
// pixels in the viewport for one CONTINUOUS second (image) or two (video),
// and reports it once.
//
// Four things make this correct rather than merely plausible:
//
// 1. GATE ON THE RATIO, NOT THE FLAG. Some engines report isIntersecting true
//    while intersectionRatio is below the configured threshold; trusting the
//    flag counts slides that were barely on screen. Only the ratio decides.
//
// 2. CONTINUOUS DWELL. Crossing the threshold starts a timer; only its
//    completion reports. A fast scroll-past never counts.
//
// 3. CANCEL, NEVER ACCUMULATE. Dropping below the threshold before the timer
//    completes cancels it. Re-entering starts a fresh timer only if none is
//    running; while one runs, further observer callbacks leave it alone. An
//    element seen three times for half a second each has never been viewable.
//
// 4. ONCE PER DECISION. After reporting, the element is unobserved and the
//    hook does nothing further for that decision key. A new key (a new
//    decision rendered into the same slot) starts the whole thing over.
//
// A hidden document also cancels the dwell: a tab in the background is not
// showing anything to anyone, whatever the geometry says.

import { useEffect, useRef } from 'react';

const VIEWABLE_RATIO_THRESHOLD = 0.5;
const IMAGE_DWELL_MILLISECONDS = 1000;
const VIDEO_DWELL_MILLISECONDS = 2000;

/*
 * elementRef    — ref to the element to measure.
 * decisionKey   — the decision token (or any per-decision key). null disables.
 * mediaType     — "image" | "video"; picks the dwell.
 * onViewable    — called once, with the decisionKey, when dwell completes.
 */
export function useViewability({ elementRef, decisionKey, mediaType, onViewable }) {
  /* The latest callback, read from inside the observer without re-arming
     the observer (and restarting the dwell) every time the parent renders. */
  const onViewableRef = useRef(onViewable);
  useEffect(() => {
    onViewableRef.current = onViewable;
  }, [onViewable]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !decisionKey || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const dwell = mediaType === 'video' ? VIDEO_DWELL_MILLISECONDS : IMAGE_DWELL_MILLISECONDS;
    let timer = null;
    let reported = false;
    let observer = null;

    function cancelDwell() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function completeDwell() {
      timer = null;
      if (reported) {
        return;
      }
      reported = true;
      observer?.disconnect();
      onViewableRef.current?.(decisionKey);
    }

    function startDwellIfIdle() {
      if (reported || timer) {
        return; // already running — dwell is continuous, never restarted mid-way
      }
      timer = setTimeout(completeDwell, dwell);
    }

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target !== element) {
            continue;
          }
          const meetsThreshold =
            entry.intersectionRatio >= VIEWABLE_RATIO_THRESHOLD && document.visibilityState !== 'hidden';
          if (meetsThreshold) {
            startDwellIfIdle();
          } else {
            cancelDwell();
          }
        }
      },
      /* Both edges are needed: crossing up starts the dwell, crossing down
         cancels it. Root is the viewport; scrollable ancestors clip, so a
         slide scrolled out of its carousel reports ratio 0. */
      { threshold: [0, VIEWABLE_RATIO_THRESHOLD] },
    );
    observer.observe(element);

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        cancelDwell();
        return;
      }
      /*
       * Coming back: nothing about the geometry changed, so the observer
       * would not fire on its own. Re-observing forces an initial callback
       * with the current ratio, which restarts the dwell from zero if the
       * element still meets the threshold — a fresh, continuous dwell, not a
       * resumption of the one the hide cancelled.
       */
      if (!reported && observer) {
        observer.unobserve(element);
        observer.observe(element);
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelDwell();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [elementRef, decisionKey, mediaType]);
}

export default useViewability;

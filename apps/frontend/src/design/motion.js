// motion.js
// The one place motion is decided.
//
// Two rules the rest of the app never has to remember:
//
//   1. TRANSFORM AND OPACITY ONLY. Anything else is a layout or paint job the
//      compositor cannot do on its own thread, and on a mid-range Android
//      that is the difference between a card that presses and one that
//      stutters. The single exception is the scan verdict's background-colour,
//      which is the verdict itself rather than decoration — it is declared
//      here so it stays the only one.
//
//   2. EXIT IS FASTER THAN ENTER. A thing arriving is worth watching; a thing
//      leaving is in the way. 240ms in, 180ms out, everywhere.
//
// Reduced motion is honoured by collapsing durations to ~0 rather than by
// skipping the tween: every onComplete still fires, so nothing that waits on
// an animation to finish can deadlock. The CSS half of this lives in
// dedal-tokens.css, which collapses the same four custom properties, so a
// CSS transition and a GSAP tween agree without either knowing about the other.

import gsap from 'gsap';

/* Milliseconds, matching the --d-* custom properties one for one. */
export const DURATION = {
  instant: 80,
  quick: 150,
  move: 240,
  exit: 180,
};

export const EASE = {
  enter: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
};

/* GSAP wants a cubic-bezier the way its own parser spells it. */
const GSAP_EASE = {
  enter: 'power2.out',
  exit: 'power2.in',
};

const REDUCED_SECONDS = 0.000001;

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/*
 * Seconds for GSAP, from a named duration. Reduced motion returns effectively
 * zero rather than zero exactly: a real GSAP duration of 0 skips the tween's
 * render pass entirely on some versions, and a tween that never renders never
 * writes its end state.
 */
export function seconds(name) {
  if (prefersReducedMotion()) {
    return REDUCED_SECONDS;
  }
  return (DURATION[name] ?? DURATION.quick) / 1000;
}

/*
 * Subscribe to the preference itself. Returns an unsubscribe. Used by anything
 * that has to stop an already-running loop (the video progress bar) rather
 * than merely shorten the next one.
 */
export function onReducedMotionChange(listener) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const handle = (event) => listener(event.matches);
  query.addEventListener('change', handle);
  return () => query.removeEventListener('change', handle);
}

/*
 * Fade a node in. Opacity only — no y-offset, because an entrance that also
 * moves is what makes a feed feel like it is assembling itself every time you
 * scroll back to the top. Used for the mute/unmute glyph and nothing on the
 * feed itself.
 */
export function fadeIn(target, { duration = 'move', onComplete } = {}) {
  return gsap.fromTo(
    target,
    { opacity: 0 },
    {
      opacity: 1,
      duration: seconds(duration),
      ease: GSAP_EASE.enter,
      onComplete,
    },
  );
}

export function fadeOut(target, { duration = 'exit', onComplete } = {}) {
  return gsap.to(target, {
    opacity: 0,
    duration: seconds(duration),
    ease: GSAP_EASE.exit,
    onComplete,
  });
}

/*
 * The mute/unmute acknowledgement: in fast, hold, out. One timeline so a
 * second tap kills the first cleanly instead of the two fighting over opacity.
 */
export function flashGlyph(target, { holdSeconds = 0.5 } = {}) {
  const timeline = gsap.timeline();
  timeline
    .fromTo(
      target,
      { opacity: 0, scale: 0.88 },
      { opacity: 1, scale: 1, duration: seconds('move'), ease: GSAP_EASE.enter },
    )
    .to(target, { opacity: 0, duration: seconds('exit'), ease: GSAP_EASE.exit }, `+=${holdSeconds}`);
  return timeline;
}

/*
 * Kill every tween on a node. Called from effect cleanups so an unmounting
 * card cannot leave a tween writing to a detached element.
 */
export function stopMotion(target) {
  gsap.killTweensOf(target);
}

export default { DURATION, EASE, seconds, fadeIn, fadeOut, flashGlyph, stopMotion };

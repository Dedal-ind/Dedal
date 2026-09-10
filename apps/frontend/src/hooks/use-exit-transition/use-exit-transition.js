// use-exit-transition.js
// The other half of every animation in this app.
//
// THE BUG THIS EXISTS TO DELETE.
//
// A layer written as `{isOpen ? <Panel /> : null}` cannot animate out. React
// removes the node from the DOM on the same tick the close is requested, and a
// node that is not in the document has nothing to transition — so the enter
// plays beautifully and the exit is a hard cut. It is invisible in review,
// because the code that is missing is code nobody wrote. It was found in six
// separate places here: the notifications panel, the confirm dialog, the
// identity menu, both select dropdowns and the avatar picker.
//
// The fix is always the same two flags, so it is written once:
//
//   isMounted  — true from the moment `isOpen` goes true until the exit
//                duration has elapsed AFTER it goes false. This is what you
//                guard `return null` with, never `isOpen`.
//   isVisible  — the open class. It goes on one COMMITTED PAINT after the
//                closed styles, and comes off immediately on close, so the
//                browser always has two end states to interpolate between.
//
// WHY NOT requestAnimationFrame FOR THAT SECOND PAINT. rAF does not fire in a
// backgrounded tab. Open a panel, switch apps, come back, and the callback that
// was going to add the open class never ran: the layer is mounted, at opacity
// 0, with the page behind it scroll-locked by a dialog nobody can see. That was
// reproduced in this codebase on the bottom sheet. useLayoutEffect runs
// synchronously after the DOM is mutated and before paint, and reading
// offsetHeight forces the closed style to be computed at that instant — so the
// transition gets its start value with no dependency on a frame being
// scheduled.
//
// INTERRUPTIBILITY comes free. Because both states are plain CSS classes on a
// permanently-transitioning element, closing something mid-open does not jump:
// the browser retargets from the current computed transform. There is no
// timeline to kill and therefore no way to strand an element at a frozen inline
// value — which is the failure mode GSAP's `tween.kill()` has twice caused
// here.
//
// REDUCED MOTION collapses the hold to zero rather than skipping it, so the
// unmount still happens through the same path and no caller has to special-case
// it.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DURATION, prefersReducedMotion } from '../../design/motion.js';

/**
 * @param {boolean} isOpen        the caller's own open state
 * @param {object}  [options]
 * @param {number}  [options.exitMs] override the exit hold; defaults to the
 *   system exit duration, which is what every stylesheet here transitions on.
 * @returns {{ isMounted: boolean, isVisible: boolean, ref: React.RefObject }}
 *   `ref` is optional — attach it to the animating node and the forced reflow
 *   is taken from that element rather than from the document.
 */
export function useExitTransition(isOpen, { exitMs = DURATION.exit } = {}) {
  const ref = useRef(null);
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect --
         The external system is the exit timer. Mounting is deliberately NOT
         derivable from `isOpen`: the whole point is that the node outlives the
         prop that closed it, for exactly as long as the exit runs. */
      setIsMounted(true);
      return undefined;
    }
    setIsVisible(false);
    const timer = setTimeout(() => setIsMounted(false), prefersReducedMotion() ? 0 : exitMs);
    return () => clearTimeout(timer);
  }, [isOpen, exitMs]);

  useLayoutEffect(() => {
    if (!isMounted || !isOpen) return;
    const node = ref.current;
    if (node) {
      /* The reflow IS the point; the value is discarded. */
      void node.offsetHeight;
    }
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       The external system is the browser's style engine. This state is defined
       as "after the closed state has been painted", which no render can
       compute for itself. */
    setIsVisible(true);
  }, [isMounted, isOpen]);

  return { isMounted, isVisible, ref };
}

export default useExitTransition;

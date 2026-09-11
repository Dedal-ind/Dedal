// RouteTransition.jsx
//
// WHAT THIS USED TO BE. A wrapper keyed on pathname with a `.route-forward` /
// `.route-back` class on it, animated by a CSS opacity fade in index.css. The
// comment on that CSS block is worth reading, because it records exactly why
// it could never do what it wanted to: any transform on a wrapper element
// makes it the containing block for every position:fixed descendant, so the
// directional slide it was named after would have unpinned the bottom tab bar
// and every sticky save bar from the viewport (measured: a tab bar sitting at
// 1148px inside a 932px viewport). It was left as an undirected fade because a
// fade is the only thing a wrapper CAN do safely.
//
// WHAT IT IS NOW. The View Transitions API animates a SNAPSHOT, outside the
// layout tree, so it has none of that problem — and it does not need a wrapper
// element at all. React Router drives it itself. So this component stopped
// being a wrapper that animates and became the one piece of global state the
// transition system needs:
//
//   · it listens for popstate, so the browser Back button — which has no call
//     site to hook — still publishes a direction before the router acts on it;
//   · it clears the direction attribute when the app is not transitioning.
//
// The `.route-forward` / `.route-back` classes are deliberately NOT emitted any
// more, which neutralises the old fade without touching index.css. Two fades
// stacked on one navigation is a 180ms opacity ramp fighting a 200ms slide, and
// the result reads as a stutter. The dead rules in index.css now match nothing.
//
// The `key={pathname}` wrapper IS retained — but it no longer applies to the
// admin console.
//
// The key remounts EVERYTHING below it on a pathname change, and "everything"
// included the console's persistent chrome. The admin sidebar is a tall,
// scrolling rail: scroll down to reach Data Controls, click it, and the rail
// was destroyed and rebuilt at scrollTop 0, throwing the reader back to the top
// of a list they had just scrolled through. Verified in the browser — a
// data-attribute set on the <nav> did not survive a single navigation.
//
// That is not what the key was for. Its purpose is stated above: a SCREEN gets
// a fresh component when the pathname changes, so a fest page moving from one
// slug to another does not have to re-fetch into a stale component. Screens,
// not chrome. The participant app has no persistent chrome below this point, so
// there the two were indistinguishable and the key could stand in for both.
//
// So the admin subtree collapses to one stable key here, and AdminLayout keys
// its own <Outlet /> on the pathname instead — admin screens keep the exact
// remount-per-pathname behaviour they have always had, including when the same
// screen serves a different :promoterId or :campaignId, and only the shell
// survives.

import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import {
  NAVIGATION_DIRECTIONS,
  clearNavigationDirection,
  isTransitionExemptPath,
  setNavigationDirection,
  supportsViewTransitions,
} from './view-transition-policy.js';

function RouteTransition({ children }) {
  const { pathname } = useLocation();
  const previousPathnameRef = useRef(pathname);

  /*
   * THE BACK BUTTON.
   *
   * A tap on a Link runs our code before the router's; the hardware/browser
   * Back button does not — there is no handler of ours in that path at all. But
   * `popstate` fires synchronously when the entry is popped and BEFORE React
   * Router has processed it, which makes it the one hook available early enough
   * to matter. By the time it fires, window.location is already the
   * destination, so the exemption check below is a check on where we are going.
   *
   * A browser Back is always 'back'. Not "back if the depth decreased" — the
   * gesture is the signal, and a person who pressed Back and saw the page slide
   * forwards would rightly conclude the app is broken.
   */
  useEffect(() => {
    if (!supportsViewTransitions()) {
      return undefined;
    }

    function handlePopState() {
      const destination = window.location.pathname;
      if (isTransitionExemptPath(destination) || isTransitionExemptPath(previousPathnameRef.current)) {
        clearNavigationDirection();
        return;
      }
      setNavigationDirection(NAVIGATION_DIRECTIONS.BACK);
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    previousPathnameRef.current = pathname;
  }, [pathname]);

  /* Whatever else happens, the attribute must not survive a full unmount. */
  useEffect(() => () => clearNavigationDirection(), []);

  /*
   * One key for the whole console, so its shell is never remounted by a
   * navigation inside it. Per-screen remounting moved into AdminLayout — see
   * the note at the top of this file.
   */
  const subtreeKey = pathname.startsWith('/admin') ? '/admin' : pathname;

  return <div key={subtreeKey}>{children}</div>;
}

export default RouteTransition;

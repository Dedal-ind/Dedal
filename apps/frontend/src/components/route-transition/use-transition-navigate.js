// use-transition-navigate.js
// A drop-in replacement for react-router's useNavigate() that opts the
// navigation into the View Transitions API and tells the CSS which way the app
// just moved.
//
// WHY A WRAPPED HOOK RATHER THAN A PROP PER LINK.
//
// react-router-dom 7 exposes view transitions two ways: `<Link viewTransition>`
// and `navigate(to, { viewTransition: true })`. Both are per-call-site, and
// this app navigates almost entirely through navigate() — there is no single
// place to turn transitions on. Sprinkling `{ viewTransition: true }` across
// two hundred call sites would also mean sprinkling the direction calculation
// and the gate-pass exclusion across them, and every one of those is a place to
// forget.
//
// So a screen changes ONE line:
//
//     const navigate = useNavigate();            // before
//     const navigate = useTransitionNavigate();  // after
//
// and every navigate() in that screen — including navigate(-1) and
// navigate(x, { replace: true }) — is routed through the policy. The signature
// is identical, so nothing else in the screen changes.
//
// WE DRIVE document.startViewTransition OURSELVES, AND WE HAVE TO.
//
// React Router 7 does own a `viewTransition` option — but the code that reads
// it (`chunk-BV7QT456.mjs`, the `isViewTransitionAvailable` branch) lives
// inside `<RouterProvider>`, the DATA router. This app mounts `<BrowserRouter>`
// (App.jsx), which is the component router: it never looks at the option, and
// passing `{ viewTransition: true }` there is silently a no-op. That was
// measured, not assumed — with the option passed and the API present,
// `document.startViewTransition` was called zero times across a feed → fest
// navigation.
//
// So the hook opens the transition and commits the router update inside the
// callback. `flushSync` is what makes that correct: startViewTransition takes
// its "after" snapshot the moment the callback returns, and React's default
// commit is asynchronous, so without it the browser would snapshot the OLD
// page twice and cross-fade a page into itself.
//
// LIMIT, STATED HERE BECAUSE IT IS INVISIBLE FROM THE CALL SITES: this covers
// navigations to a PATH. `navigate(-1)` and the browser Back button go through
// history, which answers asynchronously via popstate — by the time React has
// the new location, a transition opened around the call has already ended. Those
// stay instant, and RouteTransition's popstate listener still clears the
// direction attribute so nothing stale leaks into the next transition. Animating
// them needs the data router.

import { useCallback, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { NAVIGATION_DIRECTIONS } from '../../helpers/navigation-depth.js';
import {
  clearNavigationDirection,
  isTransitionExemptPath,
  resolveNavigation,
  setNavigationDirection,
  supportsViewTransitions,
} from './view-transition-policy.js';

/*
 * ── THE GUARD, AND WHY IT IS NOT OPTIONAL ───────────────────────────────────
 *
 * Two things go wrong with a bare document.startViewTransition() here, and the
 * second one is severe enough that it looked like the app had crashed.
 *
 * 1. OVERLAPPING TRANSITIONS. Starting a transition while one is still running
 *    aborts the first, and the abort surfaces as an unhandled rejection —
 *    `InvalidStateError: Transition was aborted because of invalid state`. A
 *    second tap during the 200ms slide is not an edge case; it is what people
 *    do when a tap does not seem to have registered.
 *
 * 2. A STUCK TRANSITION FREEZES PAINT, NOT SCRIPT. While a transition is live
 *    the browser is displaying a frozen snapshot of the page, so if `finished`
 *    never settles, JavaScript keeps running and answering — `location.pathname`
 *    is already the new route — while the screen shows the old one forever. The
 *    failure reads as "the click did nothing", which sends you looking at the
 *    click handler, which is fine. It was observed exactly that way: navigation
 *    committed, paint stopped.
 *
 * So: never start a second transition over a live one, always swallow the
 * abort rejection (an aborted animation is not an application error), and hold
 * a hard deadline that calls skipTransition() if the thing has not settled —
 * losing the animation is trivial, losing the screen is not.
 */
let liveTransition = null;

/* Comfortably past the longest transition (forward, 200ms) plus a slow frame,
   and far below the point where somebody decides the app is broken. */
const TRANSITION_DEADLINE_MS = 1000;

function startGuardedViewTransition(commit, commitPlainly) {
  /* A tap landing mid-transition navigates immediately without animating,
     rather than aborting the one in flight. */
  if (liveTransition) {
    commitPlainly();
    return;
  }

  /*
   * A HIDDEN DOCUMENT CANNOT TRANSITION. Chrome aborts the transition outright
   * if the tab is backgrounded or occluded — it has nothing to snapshot — and
   * the abort arrives as `InvalidStateError: Transition was aborted because of
   * invalid state`. Somebody switching tabs mid-navigation is ordinary, so this
   * is checked up front rather than caught after the fact.
   */
  if (document.visibilityState !== 'visible') {
    commitPlainly();
    return;
  }

  let transition;
  try {
    transition = document.startViewTransition(commit);
  } catch {
    /* Some states (a hidden document, most notably) reject the call outright.
       The navigation still has to happen. */
    commitPlainly();
    return;
  }

  liveTransition = transition;

  const deadline = window.setTimeout(() => {
    /* skipTransition() jumps to the end state and settles `finished`. It is
       safe to call on an already-finished transition. */
    transition.skipTransition?.();
  }, TRANSITION_DEADLINE_MS);

  /*
   * ALL THREE PROMISES NEED A CATCH, and the third is the one that is easy to
   * miss. A ViewTransition exposes `ready`, `finished` AND `updateCallbackDone`;
   * every one of them rejects when the transition is skipped or aborted, and any
   * one left unhandled surfaces as a page-level unhandled rejection. Catching
   * only `ready` and `finished` still leaked `InvalidStateError` from
   * `updateCallbackDone` — observed, not theorised.
   *
   * An aborted animation is not an application error. Nothing is logged.
   */
  transition.ready?.catch(() => {});
  transition.updateCallbackDone?.catch(() => {});
  transition.finished
    .catch(() => {})
    .finally(() => {
      window.clearTimeout(deadline);
      if (liveTransition === transition) {
        liveTransition = null;
      }
    });
}

/**
 * @param {object} [config]
 * @param {boolean} [config.skipTransition] force plain navigation from this
 *   screen — used by the bottom sheets, whose own close animation IS the
 *   transition.
 */
export function useTransitionNavigate(config = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const skipTransition = Boolean(config.skipTransition);

  /*
   * The current pathname is read through a ref rather than closed over, so the
   * returned function keeps a stable identity across renders. Screens pass it
   * into useEffect dependency arrays and into memoised children; a navigate
   * that changed on every location change would re-fire those effects.
   */
  const pathnameRef = useRef(location.pathname);
  /* Written in an effect rather than during render: a ref mutated in the render
     body is read-during-render as far as React (and the linter) is concerned,
     and under concurrent rendering a discarded render would still have moved
     it. After commit is early enough — nobody can tap anything before the
     screen they are tapping has been painted. */
  useEffect(() => {
    pathnameRef.current = location.pathname;
  }, [location.pathname]);

  return useCallback(
    (to, options) => {
      const fromPathname = pathnameRef.current;

      /*
       * navigate(-1) / navigate(1). The router takes no options for a delta —
       * it goes straight to history, and the browser answers with a popstate,
       * which RouteTransition is listening for. All we do here is nothing,
       * deliberately: setting the attribute now would be redundant with the
       * popstate handler and would race it.
       */
      if (typeof to === 'number') {
        navigate(to);
        return;
      }

      const toPathname = typeof to === 'string' ? to.split('?')[0] : (to?.pathname ?? fromPathname);
      const navigationType = options?.replace ? 'REPLACE' : 'PUSH';

      const { animate, direction } = resolveNavigation({
        fromPathname,
        toPathname,
        navigationType,
        forceSkip: skipTransition,
      });

      if (!animate) {
        /* Leave no stale attribute behind for the NEXT transition to read. */
        clearNavigationDirection();
        navigate(to, options);
        return;
      }

      /*
       * Synchronously, before the router is told anything: the browser picks
       * the ::view-transition-* animations at snapshot time, and the snapshot
       * happens inside the navigate() call below.
       */
      /*
       * `direction` always comes from the comparator, so it is always one of
       * the three known values — the fallback is belt-and-braces, because an
       * unrecognised value would silently select the neutral crossfade rather
       * than failing, and a silently wrong animation is the hardest kind to
       * notice.
       */
      const known = Object.values(NAVIGATION_DIRECTIONS).includes(direction)
        ? direction
        : NAVIGATION_DIRECTIONS.SAME;
      setNavigationDirection(known);

      startGuardedViewTransition(() => {
        flushSync(() => {
          navigate(to, options);
        });
      }, () => navigate(to, options));
    },
    [navigate, skipTransition],
  );
}

export { isTransitionExemptPath, supportsViewTransitions };

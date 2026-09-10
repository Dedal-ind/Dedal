// screen-title-context.jsx
// One bar, not two.
//
// THE PROBLEM THIS SOLVES.
//
// Every participant screen sits under the app header — the dedal wordmark, the
// search, the bell, the avatar. That is right on a tab root, where the header
// is the app's own chrome and the screen below it is a destination you chose.
//
// It is wrong on a secondary screen. Once a screen has a back control and its
// own name, the page carries two stacked bars: 56px of wordmark you cannot act
// on, and beneath it the bar that actually tells you where you are and how to
// leave. On a phone that is a quarter of the fold spent twice saying "this is
// Dedal" to someone who is already inside it. Every mainstream app replaces the
// app bar with the navigation bar on a pushed screen rather than stacking them.
//
// WHY A CONTEXT AND NOT A ROUTE LIST.
//
// The layout is the thing that renders the app header, and the screen is the
// thing that knows whether it has a title bar of its own. A list of paths in
// the layout would be a third place to remember, and the one that silently goes
// stale: add a screen, forget the list, get two bars. Here the screen cannot
// forget, because passing a title to ScreenHeader IS the registration. Nothing
// else has to be kept in step.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ScreenTitleContext = createContext(null);

export function ScreenTitleProvider({ children }) {
  /*
   * A COUNT, not a boolean. During a route change React can hold the outgoing
   * screen and the incoming one mounted at once, so the new screen registers
   * before the old one unregisters. With a boolean the old screen's cleanup
   * would clear the flag the new screen had just set, and the app header would
   * flicker back for a frame in the middle of every navigation.
   */
  const [titleCount, setTitleCount] = useState(0);

  const registerScreenTitle = useCallback(() => {
    setTitleCount((count) => count + 1);
    return () => setTitleCount((count) => Math.max(0, count - 1));
  }, []);

  const value = useMemo(
    () => ({ hasScreenTitle: titleCount > 0, registerScreenTitle }),
    [titleCount, registerScreenTitle],
  );

  return <ScreenTitleContext.Provider value={value}>{children}</ScreenTitleContext.Provider>;
}

/*
 * Both hooks tolerate being called outside the provider. ScreenHeader is used
 * by backstage and admin screens too, which are not inside ParticipantLayout;
 * there the registration is simply a no-op rather than a crash.
 */
export function useScreenTitleRegistration() {
  return useContext(ScreenTitleContext)?.registerScreenTitle ?? null;
}

export function useHasScreenTitle() {
  return useContext(ScreenTitleContext)?.hasScreenTitle ?? false;
}

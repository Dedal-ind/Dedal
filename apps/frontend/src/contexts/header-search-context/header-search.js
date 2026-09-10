// header-search.js
// One search field in the header, filtering whatever screen you are on.
//
// The field is owned by the header, but only the screen knows what a query
// means: on Discover it filters fests, on My Fests it filters registrations.
// So the header owns the INPUT and the screen owns the MEANING, and this
// context is the seam between them.
//
// A screen opts in by calling useHeaderSearch({ placeholder }). Doing so:
//   · enables the search icon in the header
//   · sets the placeholder, so the field says what it will actually search
//   · returns the live query for the screen to filter with
//   · clears the query and disables the icon again on unmount, so a search
//     typed on Discover is not still filtering My Fests a moment later
//
// A screen that does not call it gets a disabled search icon rather than a
// field that appears to work and does nothing — see the `disabled` note in
// AppHeader.

import { createContext, useCallback, useContext, useEffect } from 'react';

export const HeaderSearchContext = createContext(null);

/* For the header itself. */
export function useHeaderSearchControl() {
  const context = useContext(HeaderSearchContext);
  if (!context) {
    /* The header can render outside the provider in a test or a storybook;
       search is simply unavailable rather than a crash. */
    return { query: '', setQuery: () => {}, config: null, setConfig: () => {} };
  }
  return context;
}

/*
 * For a screen. Registers the placeholder and returns the live query.
 *
 * `placeholder` is the only input, and it is deliberately required: a search
 * field whose placeholder says "Search" tells nobody what it will search, and
 * this is the one component that genuinely cannot know.
 */
export function useHeaderSearch({ placeholder }) {
  const context = useContext(HeaderSearchContext);
  const setConfig = context?.setConfig;
  const setQuery = context?.setQuery;

  useEffect(() => {
    if (!setConfig || !setQuery) return undefined;
    setConfig({ placeholder });
    return () => {
      /* Leaving the screen takes the query with it. A stale query silently
         filtering the next screen is the kind of bug that reads as "the app
         lost my data". */
      setConfig(null);
      setQuery('');
    };
  }, [setConfig, setQuery, placeholder]);

  return context?.query ?? '';
}

/* Exposed so a screen can clear the field from its own empty state. */
export function useClearHeaderSearch() {
  const context = useContext(HeaderSearchContext);
  const setQuery = context?.setQuery;
  return useCallback(() => setQuery?.(''), [setQuery]);
}

export default HeaderSearchContext;

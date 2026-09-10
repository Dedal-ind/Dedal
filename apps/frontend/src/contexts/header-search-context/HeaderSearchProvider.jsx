// HeaderSearchProvider.jsx
// The provider alone, in its own file.
//
// Split from the hooks because a module exporting both a component and plain
// functions opts out of React Fast Refresh — every edit to a hook here would
// full-reload the app instead of hot-swapping. The context object and the three
// hooks live in header-search.js; this file is the component.

import { useMemo, useState } from 'react';
import { HeaderSearchContext } from './header-search.js';

function HeaderSearchProvider({ children }) {
  const [query, setQuery] = useState('');
  /* null === no screen has opted in, so search is unavailable here. */
  const [config, setConfig] = useState(null);

  const value = useMemo(
    () => ({ query, setQuery, config, setConfig }),
    [query, config],
  );

  return <HeaderSearchContext.Provider value={value}>{children}</HeaderSearchContext.Provider>;
}


export default HeaderSearchProvider;
export { HeaderSearchProvider };

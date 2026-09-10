// screen-title-store.js
// The context object itself, apart from the provider that fills it and the
// hooks that read it. Its own module so screen-title-context.jsx exports the
// provider and nothing else — a file that exports a component plus a value is
// not a Fast Refresh boundary.

import { createContext } from 'react';

export const ScreenTitleContext = createContext(null);

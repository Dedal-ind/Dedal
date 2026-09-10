// LinkedInIcon.jsx
//
// Split out of DetailIcons.jsx: it is the only export in that file React Fast
// Refresh recognises as a component, and a refresh boundary that also exports
// a hundred wrapped lucide marks is not one. Same mark, same size table.

import { SIZES } from './icon-sizes.js';

/*
 * THE ONE HAND-DRAWN MARK IN THIS FILE.
 *
 * lucide-react 1.x REMOVED every brand icon, so there is no `Linkedin` export
 * to wrap — importing one is a hard module error, not a missing glyph. Rather
 * than pull in a second icon package for a single mark, it is drawn here.
 *
 * It is a FILLED path, which breaks this file's stroke-1.8 rule on purpose: a
 * company mark is a logo, and an outlined approximation of a logo reads as a
 * bad copy of it rather than as a lighter version. It is drawn on lucide's own
 * 24-unit grid and sized through the same SIZES table, so it still matches its
 * neighbours in box and in colour — it inherits `currentColor` like the rest.
 */
export default function LinkedInIcon({ size = 'md', className = '' }) {
  const pixels = SIZES[size] ?? SIZES.md;
  return (
    <svg
      width={pixels}
      height={pixels}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.5h4v11H3v-11Z" />
      <path d="M9.5 9.5h3.83v1.5h.06a4.2 4.2 0 0 1 3.78-2.08c4.04 0 4.79 2.66 4.79 6.12v6.46h-4v-5.73c0-1.37-.02-3.13-1.9-3.13-1.9 0-2.2 1.49-2.2 3.03v5.83h-4v-11Z" />
    </svg>
  );
}

// brand-spacing.js
// Spacing scale, border widths, corner radii, and shadows for the Heritage
// Institutional system. Heritage is a hairline system: a single 1px outline in
// outline-variant does the work the retired brutalist system did with a 2px
// black border and a hard offset shadow. Depth comes from surface layering; the
// one shadow in the system is a barely-there lift under cards.

// --- Spacing scale (4px base, rem strings) ---
export const SPACING_UNIT_1 = '0.25rem'; // 4px
export const SPACING_UNIT_2 = '0.5rem'; // 8px
export const SPACING_UNIT_3 = '0.75rem'; // 12px
export const SPACING_UNIT_4 = '1rem'; // 16px
export const SPACING_UNIT_5 = '1.25rem'; // 20px
export const SPACING_UNIT_6 = '1.5rem'; // 24px
export const SPACING_UNIT_8 = '2rem'; // 32px
export const SPACING_UNIT_10 = '2.5rem'; // 40px
export const SPACING_UNIT_12 = '3rem'; // 48px
export const SPACING_UNIT_16 = '4rem'; // 64px

// --- Border widths ---
export const BORDER_WIDTH_HAIRLINE = '1px';
export const BORDER_WIDTH_STANDARD = '1px'; // the border used almost everywhere
export const BORDER_WIDTH_THICK = '2px';

// --- Corner radii ---
export const CORNER_RADIUS_STANDARD = '4px';
export const CORNER_RADIUS_LARGE = '8px';
export const CORNER_RADIUS_HERO = '16px'; // cards
export const CORNER_RADIUS_PILL = '9999px'; // inputs and call-to-action buttons

// --- Shadows ---
// The only shadow in the Heritage system: a 1px lift so a white card separates
// from the ivory canvas without announcing itself.
export const SHADOW_SUBTLE = '0 1px 3px rgba(0,10,30,0.08)';

// The retired brutalist system's `shadow-hard` utility survives it in
// src/index.css (two toast surfaces still cast it); `shadow-hard-small` and the
// JS mirrors of both were unreferenced and have been deleted. Nothing else of
// that system remains.

// brand-admin/brand-spacing.js
// A 4px base grid, small radii, and — the load-bearing rule of this system —
// elevation by tone and hairline border rather than by shadow. A card is not
// lifted off the page; it is a white plane on an off-white one, outlined 1px.
// The single shadow token exists for modals, which genuinely float.
//
// ADMIN_-prefixed to keep the console's spacing system isolated from the
// participant app's.

export const ADMIN_SPACING_BASE_PX = 4;

// spacingScale[4] === '16px'. Multiples of the base, named by step.
export const ADMIN_SPACING_SCALE = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
};

export const ADMIN_CORNER_RADII = {
  small: '2px',
  default: '4px',
  medium: '6px',
  large: '8px',
  extraLarge: '12px',
};

/*
 * Elevation. `card` is the default: no shadow at all, just the hairline. Reach
 * for `modal` only when something overlays the page — using it on cards is what
 * turns a precise console into a generic dashboard template.
 */
export const ADMIN_ELEVATION = {
  card: { border: '1px solid #E2E8F0', boxShadow: 'none' },
  modal: { boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.05)' },
};

// Fixed chrome dimensions the layout and its offsets both read from.
export const ADMIN_LAYOUT = {
  sidebarWidth: '260px',
  topbarHeight: '64px',
  cardPadding: '24px',
};

export default {
  ADMIN_SPACING_BASE_PX,
  ADMIN_SPACING_SCALE,
  ADMIN_CORNER_RADII,
  ADMIN_ELEVATION,
  ADMIN_LAYOUT,
};

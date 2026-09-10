// brand-admin/brand-colors.js
// The Executive Precision palette — the admin console's design system, and
// deliberately NOT the participant app's Heritage Institutional one. (It was
// also never the brutalist system that preceded Heritage — hard shadows, 2px
// black borders, orange — which has since been retired outright.) The console is
// quiet: one blue for intent, a slate ramp for structure, and status colour used
// only where a state genuinely needs reading at a glance.
//
// Every export here is ADMIN_-prefixed so it can never be confused with a
// participant brand token, and this whole folder is imported ONLY by admin
// components. index.css mirrors these values into Tailwind's @theme under an
// `admin-` utility namespace (e.g. bg-admin-primary-blue) — change both together.

export const ADMIN_PRIMARY_BLUE = '#2563EB';
export const ADMIN_PRIMARY_BLUE_DARK = '#004AC6';
export const ADMIN_NEUTRAL_INK = '#0F172A';
export const ADMIN_SLATE_600 = '#64748B';
export const ADMIN_SLATE_200 = '#E2E8F0';
export const ADMIN_SURFACE_OFF_WHITE = '#F8FAFC';
export const ADMIN_SURFACE_WHITE = '#FFFFFF';
export const ADMIN_STATUS_SUCCESS_GREEN = '#10B981';
export const ADMIN_STATUS_WARNING_AMBER = '#F59E0B';
export const ADMIN_STATUS_ERROR_RED = '#EF4444';

export const ADMIN_BRAND_COLORS = {
  // Primary — actions, active nav, focus rings. One blue, two weights.
  primaryBlue: ADMIN_PRIMARY_BLUE,
  primaryBlueDark: ADMIN_PRIMARY_BLUE_DARK,

  // Structure — headings and the sidebar field.
  neutralInk: ADMIN_NEUTRAL_INK,
  slate600: ADMIN_SLATE_600,
  slate200: ADMIN_SLATE_200,

  // Surfaces — the page sits a shade below the cards, which is what separates
  // them. Elevation here is tonal, not a drop shadow.
  surfaceOffWhite: ADMIN_SURFACE_OFF_WHITE,
  surfaceWhite: ADMIN_SURFACE_WHITE,

  // Status — reserved for state. Never decorative.
  statusSuccessGreen: ADMIN_STATUS_SUCCESS_GREEN,
  statusWarningAmber: ADMIN_STATUS_WARNING_AMBER,
  statusErrorRed: ADMIN_STATUS_ERROR_RED,
};

export default ADMIN_BRAND_COLORS;

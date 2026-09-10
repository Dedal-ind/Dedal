// brand-colors.js
// The complete Dedal colour palette. Every colour used anywhere in the
// application must be defined here as a named constant; src/index.css mirrors
// these values into the Tailwind v4 @theme block so utility classes resolve to
// the same numbers. Components never hardcode a hex value.
//
// The participant surface is the HERITAGE INSTITUTIONAL system: a warm ivory
// canvas, Oxford navy and deep-olive accents, tweed brown for secondary text,
// and hairline outlines instead of heavy borders. It is a tonal, collegiate
// system — depth comes from surface layering, not from drop shadows.

// ── Heritage Institutional ───────────────────────────────────────────────────

// --- Base canvas ---
export const CANVAS_IVORY = '#fafaeb'; // background / surface — the page canvas
export const CANVAS_CREAM = '#f5f5dc'; // warm cream — list screens (My Registrations)

// --- Discover/home brand accents (premium-ad-carousel Stitch frame) ---
export const BRAND_PRIMARY_GREEN = '#3D6B27'; // forest green — search, chips, dots
export const BRAND_SECONDARY_GREEN = '#C5E4A0'; // light green — chip fills, badges
export const BRAND_NAVY = '#000a1e'; // wordmark + section headings on Discover
export const BRAND_BEIGE = '#fafaeb'; // alias of CANVAS_IVORY, named per the frame
export const BRAND_BROWN = '#725a42'; // alias of TWEED_BROWN, named per the frame
// Pass-card gradient stops (green ticket, not navy).
export const PASS_GRADIENT_FROM = '#4d8632';
export const PASS_GRADIENT_TO = '#2e501d';

// --- Surface layering (lowest sits on top of the canvas, highest sits deepest) ---
export const SURFACE_WHITE = '#ffffff'; // surface-container-lowest — cards
export const SURFACE_CONTAINER_LOW = '#f4f5e6'; // tinted fields (OTP boxes)
export const SURFACE_CONTAINER = '#efefe0'; // inputs, top bars
export const SURFACE_CONTAINER_HIGH = '#e9e9db'; // pressed / raised rows
export const SURFACE_CONTAINER_HIGHEST = '#e3e3d5';
export const SURFACE_VARIANT = '#e3e3d5'; // hairline fills, dividers
export const SURFACE_DIM = '#dbdbcd';

// --- Ink (foreground text) ---
export const INK_PRIMARY = '#1b1c14'; // on-surface — body text
export const INK_VARIANT = '#44474e'; // on-surface-variant — secondary text

// --- Primary: Oxford navy ---
export const NAVY_DEEP = '#000a1e'; // primary — headings, emphasis
export const OXFORD_NAVY = '#002147'; // primary-container
export const ON_PRIMARY_CONTAINER = '#708ab5';
export const PRIMARY_FIXED_DIM = '#aec7f6';

// --- Secondary: tweed brown ---
export const TWEED_BROWN = '#725a42'; // secondary — captions, resend link
export const SECONDARY_CONTAINER = '#fedcbe'; // warm banner fill
export const ON_SECONDARY_CONTAINER = '#796048';

// --- Tertiary: olive ---
// OLIVE_ACCENT is the call-to-action olive (Login with OTP, Verify and Continue).
// OLIVE_MUTED is the lighter tone used for focused field outlines, OLIVE_DEEP the
// darkest tone used as a container fill.
export const OLIVE_ACCENT = '#556B2F';
export const OLIVE_MUTED = '#799151'; // on-tertiary-container
export const OLIVE_DEEP = '#182600'; // tertiary-container
export const TERTIARY_INK = '#060d00'; // tertiary

// --- Outlines ---
export const OUTLINE = '#74777f';
export const OUTLINE_VARIANT = '#c4c6cf'; // the 1px hairline used everywhere

// --- Error ---
export const ERROR_RED = '#ba1a1a';
export const ERROR_CONTAINER = '#ffdad6';
export const ON_ERROR_CONTAINER = '#93000a';

// --- Inverse (the dark hero band and anything sitting on it) ---
export const INVERSE_SURFACE = '#2f3128';
export const INVERSE_ON_SURFACE = '#f1f2e3';

// --- On-colours (text drawn on top of a filled accent) ---
export const ON_ACCENT_WHITE = '#ffffff';

// The dark rails shown on either side of the mobile column on wide viewports, so
// the constrained mobile layout reads as intentional.
export const CANVAS_DESKTOP_RAIL = '#17150F';

// ── Retired: the brutalist system ────────────────────────────────────────────
// The participant app once had a third design system ("brutalist": 2px black
// borders, hard-offset shadows, tracked mono labels). It has been fully removed
// — no screen paints with it. Its constants used to live here; they were all
// provably unreferenced and are gone. The few colour values that outlived it are
// declared directly in src/index.css, each with the live Heritage call site that
// still needs it. Nothing brutalist belongs in this file again.

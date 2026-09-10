// brand-typography.js
// Font families, weights, sizes, line heights, and letter spacing for the
// Heritage Institutional system. Display is a high-contrast serif (Playfair
// Display) used for the DEDAL wordmark, screen titles, and every headline; body
// is Inter for all running text, labels, buttons, and form inputs.

// --- Font families ---
export const FONT_FAMILY_DISPLAY = "'Playfair Display', serif";
export const FONT_FAMILY_BODY = "'Inter', sans-serif";

// --- Font weights ---
export const FONT_WEIGHT_REGULAR = 400;
export const FONT_WEIGHT_MEDIUM = 500;
export const FONT_WEIGHT_SEMI_BOLD = 600;
export const FONT_WEIGHT_BOLD = 700;
export const FONT_WEIGHT_EXTRA_BOLD = 800;

/*
 * --- Type scale ---
 * Heritage names its steps by role rather than by size. Each step below pairs a
 * size with the line height and weight it is always set at, so a headline can
 * never be drawn at the wrong weight by accident.
 *
 *   display-lg   48/56  700  Playfair — the DEDAL hero wordmark
 *   headline-md  32/40  700  Playfair — screen titles
 *   headline-sm  24/32  700  Playfair — card titles ("Verify Your Email")
 *   body-lg      16/26  400  Inter    — primary running text, inputs
 *   body-md      14/22  400  Inter    — secondary text, helper lines
 *   label-caps   12/16  700  Inter    — tracked uppercase micro-labels
 */

export const TYPE_DISPLAY_LARGE = {
  fontSize: '48px',
  lineHeight: '56px',
  fontWeight: FONT_WEIGHT_BOLD,
  letterSpacing: '-0.01em',
};
export const TYPE_HEADLINE_MEDIUM = {
  fontSize: '32px',
  lineHeight: '40px',
  fontWeight: FONT_WEIGHT_BOLD,
};
export const TYPE_HEADLINE_SMALL = {
  fontSize: '24px',
  lineHeight: '32px',
  fontWeight: FONT_WEIGHT_BOLD,
};
export const TYPE_BODY_LARGE = {
  fontSize: '16px',
  lineHeight: '26px',
  fontWeight: FONT_WEIGHT_REGULAR,
};
export const TYPE_BODY_MEDIUM = {
  fontSize: '14px',
  lineHeight: '22px',
  fontWeight: FONT_WEIGHT_REGULAR,
};
export const TYPE_LABEL_CAPS = {
  fontSize: '12px',
  lineHeight: '16px',
  fontWeight: FONT_WEIGHT_BOLD,
  letterSpacing: '0.08em',
};

// --- Line heights ---
export const LINE_HEIGHT_TIGHT = 1.05;
export const LINE_HEIGHT_HEADING = 1.15;
export const LINE_HEIGHT_BODY = 1.55;

// --- Letter spacing ---
// Heritage tracks its uppercase micro-labels at 0.08em. The retired brutalist
// system tracked its mono labels harder at 0.12em; that constant, its
// `tracking-label` utility, and the brutalist font-size scale went with it.
export const LETTER_SPACING_LABEL_CAPS = '0.08em';
export const LETTER_SPACING_HEADING = '-0.02em';
export const LETTER_SPACING_BODY = '0em';

// brand-admin/brand-typography.js
// Three faces, each with one job: Hanken Grotesk for display and headings,
// Inter for reading, JetBrains Mono for anything a person compares column to
// column — ids, counts, money, timestamps. Numeric data in a proportional face
// misaligns down a table, which is why the mono role exists at all.
//
// ADMIN_-prefixed so these never collide with the participant faces (Space
// Grotesk / Satoshi). The fonts themselves are loaded in index.html.

export const ADMIN_FONT_FAMILY_DISPLAY = '"Hanken Grotesk", sans-serif';
export const ADMIN_FONT_FAMILY_BODY = '"Inter", sans-serif';
export const ADMIN_FONT_FAMILY_MONO = '"JetBrains Mono", monospace';

export const ADMIN_FONT_FAMILIES = {
  display: ADMIN_FONT_FAMILY_DISPLAY,
  body: ADMIN_FONT_FAMILY_BODY,
  mono: ADMIN_FONT_FAMILY_MONO,
};

/*
 * The type scale. Sizes are px-exact against the Executive Precision spec;
 * `labelCaps` carries the tracking that makes 12px uppercase legible, and
 * `dataMono` is the table/number role.
 */
export const ADMIN_TYPE_SCALE = {
  displayLarge: { fontSize: '36px', lineHeight: '40px', fontWeight: 700, family: ADMIN_FONT_FAMILY_DISPLAY },
  headlineMedium: { fontSize: '24px', lineHeight: '32px', fontWeight: 600, family: ADMIN_FONT_FAMILY_DISPLAY },
  headlineSmall: { fontSize: '20px', lineHeight: '28px', fontWeight: 600, family: ADMIN_FONT_FAMILY_DISPLAY },
  bodyLarge: { fontSize: '16px', lineHeight: '24px', fontWeight: 400, family: ADMIN_FONT_FAMILY_BODY },
  bodyMedium: { fontSize: '14px', lineHeight: '20px', fontWeight: 400, family: ADMIN_FONT_FAMILY_BODY },
  bodySmall: { fontSize: '13px', lineHeight: '18px', fontWeight: 400, family: ADMIN_FONT_FAMILY_BODY },
  labelCaps: {
    fontSize: '12px',
    lineHeight: '16px',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    family: ADMIN_FONT_FAMILY_BODY,
  },
  dataMono: { fontSize: '13px', lineHeight: '18px', fontWeight: 500, family: ADMIN_FONT_FAMILY_MONO },
};

export default { ADMIN_FONT_FAMILIES, ADMIN_TYPE_SCALE };

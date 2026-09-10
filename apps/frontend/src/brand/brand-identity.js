// brand-identity.js
// The main brand file — everything that identifies Dedal as a brand. This is
// the single place any screen reads the app name, tagline, contact details, and
// document-level metadata from.

export const BRAND_IDENTITY = {
  appName: 'dedal',
  tagline: 'One Fest. One Pass. Zero Chaos.',

  // A short description of the primary logo mark for use as alt text and by the
  // desktop coming-soon overlay. The mark itself is a stamped monospace "D"
  // inside a hard-bordered square, in keeping with the zine system.
  logoMarkDescription: 'Dedal stamped monogram — the letter D set in mono inside a hard black border',

  contactEmailAddress: 'hello@dedal.in',

  // The canonical public URL — the desktop overlay's QR encodes it.
  siteUrl: 'https://dedal.in',

  // Legal pages (placeholder URLs until the pages ship).
  termsUrl: 'https://dedal.in/terms',
  privacyUrl: 'https://dedal.in/privacy',

  socialHandles: {
    instagram: '@dedal',
    twitter: '@dedal',
  },

  footerText: '© Dedal — Your pass to every fest',

  metaDescription:
    'Dedal — discover college fests, register for events, carry your pass, and collect your certificates. Your pass to every fest.',

  faviconPath: '/favicon.svg',
};

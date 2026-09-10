// brand-admin/brand-identity.js
// Who the console says it is. It is a surface of the Dedal app, not a separate
// product: same sign-in, same backend, different audience. Now that the console
// lives inside the participant app, "go to the participant app" is an internal
// route ("/"), not another origin.

export const ADMIN_BRAND_IDENTITY = {
  appName: 'Dedal Admin',
  productName: 'Dedal',
  tagline: 'Run the fest from one console.',
  description:
    'Fest, event, staff, and certificate administration for the colleges running on Dedal.',
  contactEmail: 'support@dedal.in',
  // Where a non-admin gets sent when they land here by mistake — an internal
  // participant route now that both surfaces share one app.
  participantHomeRoute: '/',
};

export default ADMIN_BRAND_IDENTITY;

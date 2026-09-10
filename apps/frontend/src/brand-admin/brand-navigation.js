// brand-admin/brand-navigation.js
// The sidebar's contents as data, not markup. Each item names a lucide icon by
// string; AdminSidebarNavigation resolves the name to a component through one
// map, so this module stays free of imports and can be read as a table of
// contents for the whole console.
//
// `route` must match a path in App.jsx. Every console route lives under the
// /admin/* namespace now that the console shares the participant app.
//
// NOTE: the participant bottom-tab list is NOT here — it lives in
// brand/brand-navigation.js. This module is the admin rail alone.

export const ADMIN_SIDEBAR_SECTIONS = [
  {
    id: 'overview',
    label: 'Overview',
    items: [
      { id: 'admin-overview', label: 'Dashboard', iconName: 'LayoutDashboard', route: '/admin/overview' },
    ],
  },
  {
    id: 'events',
    label: 'Events',
    /*
     * ORDER IS THE CLIENT'S, not alphabetical and not chronological-by-build:
     * it follows the order an admin actually does the work — make the fest,
     * make its events, shape the tree, decide who may see it, staff it, place
     * it in time, tell people, then read the results and hand out certificates.
     * Broadcast lives here as data rather than being spliced in by the rail, so
     * this list is the single, readable statement of the order.
     */
    items: [
      { id: 'create-fest', label: 'Create fest', iconName: 'Flag', route: '/admin/fests/create' },
      { id: 'create-event', label: 'Create event', iconName: 'CalendarPlus', route: '/admin/events/create' },
      { id: 'event-structure', label: 'Event structure', iconName: 'Network', route: '/admin/events/structure' },
      { id: 'event-access', label: 'Event access', iconName: 'ShieldCheck', route: '/admin/events/access' },
      /*
       * Staff assignments is the ONE staff surface: assigning a volunteer
       * auto-creates their shift (3 hours before the event), and the timing is
       * editable inline on the assignment row. The separate "Volunteer shifts"
       * item was removed deliberately — its screen still exists but is no longer
       * routed, so nothing here may point at /admin/events/shifts.
       */
      { id: 'event-assignments', label: 'Staff assignments', iconName: 'UserCog', route: '/admin/events/assignments' },
      { id: 'event-timeline', label: 'Timeline', iconName: 'CalendarRange', route: '/admin/events/timeline' },
      { id: 'event-broadcast', label: 'Broadcast', iconName: 'Megaphone', route: '/admin/broadcast' },
      { id: 'results-board', label: 'Result board', iconName: 'Medal', route: '/admin/events/results-board' },
      // Offer utilisation: booked vs claimed vs still owed, per add-on.
      { id: 'offers-dashboard', label: 'Offers', iconName: 'Tag', route: '/admin/offers-dashboard' },
      // Renamed per the client: the screen's centre of gravity is the
      // certificate push, not the scoring table. The route is unchanged so
      // every existing deep link and cross-link still resolves.
      { id: 'event-scoring', label: 'Certificates', iconName: 'Trophy', route: '/admin/events/scoring' },
    ],
  },
  {
    id: 'people',
    label: 'People',
    items: [{ id: 'user-management', label: 'User directory', iconName: 'Users', route: '/admin/users' }],
  },
  // Certificates live inside Scoring & results now (template import, preview,
  // generate & release) — the standalone section was removed deliberately.
  {
    id: 'system',
    label: 'System',
    items: [
      // platformAdminOnly: the sidebar renders this only when the signed-in user
      // holds a platformAdmin staff assignment (AuthenticationContext.isPlatformAdmin).
      {
        id: 'college-applications',
        label: 'College applications',
        iconName: 'Inbox',
        route: '/admin/college-applications',
        platformAdminOnly: true,
        // AdminSidebarNavigation renders a pending-count chip next to this item.
        showsPendingApplicationCount: true,
      },
      {
        id: 'college-verification',
        label: 'Colleges',
        iconName: 'Landmark',
        route: '/admin/system/colleges',
        platformAdminOnly: true,
      },
      { id: 'data-controls', label: 'Data controls', iconName: 'Database', route: '/admin/system/data-controls' },
      { id: 'system-configuration', label: 'Configuration', iconName: 'Settings', route: '/admin/system/configuration' },
      // Home-screen banners: platform-wide, so platform admins only.
      {
        id: 'promotions',
        label: 'Promotions',
        iconName: 'Megaphone',
        route: '/admin/system/promotions',
        platformAdminOnly: true,
      },
      // Promotions phase 5: promoters and their creative libraries. The old
      // promotions screen above stays live until the participant surfaces
      // switch to campaigns.
      {
        id: 'promoters',
        label: 'Promoters',
        iconName: 'Building2',
        route: '/admin/system/promoters',
        platformAdminOnly: true,
      },
      {
        id: 'campaigns',
        label: 'Campaigns',
        iconName: 'BarChart3',
        route: '/admin/system/campaigns',
        platformAdminOnly: true,
      },
      {
        id: 'delivery-reporting',
        label: 'Reporting',
        iconName: 'TrendingUp',
        route: '/admin/system/reporting',
        platformAdminOnly: true,
      },
    ],
  },
];

export default ADMIN_SIDEBAR_SECTIONS;

// brand-admin/brand-copy.js
// Every user-visible string in the console, grouped by domain and ADMIN_-prefixed
// so the admin voice stays isolated from participant copy. Screens import from
// here rather than inlining text, so a wording change is one edit in one file.

export const ADMIN_AUTH_COPY = {
  signOut: 'Sign out',
  accountMenu: 'Account menu',
  viewProfile: 'View Profile',
  settings: 'Settings',
};

export const ADMIN_PROFILE_COPY = {
  pageTitle: 'Your profile',
  breadcrumb: 'Account',
  identityHeading: 'Identity',
  roleHeading: 'Role & scope',
  scopeHeading: 'What you administer',
  consentHeading: 'Consent record',
  emailLabel: 'Email address',
  nameLabel: 'Full name',
  noName: 'No name set',
  collegesLabel: 'Colleges',
  festsLabel: 'Fests',
  noScope: 'No colleges or fests are linked to your assignments yet.',
  termsAcceptedLabel: 'Terms of Service',
  privacyAcceptedLabel: 'Privacy Policy',
  notRecorded: 'No acceptance recorded',
  consentAcceptedOn: (versionLabel, date) => `Accepted version ${versionLabel} on ${date}`,
  consentWithdrawnOn: (date) => `Withdrawn on ${date}`,
  consentCurrent: 'Current version',
  consentSuperseded: 'A newer version has since been published',
  consentViewVersion: 'View accepted text',
  consentLoadFailed: 'Your consent record could not be loaded.',
  consentOffline: 'You are offline, so your consent record could not be loaded.',
  consentRetry: 'Retry',
  readOnlyNote: 'Profile details are managed by the platform. Contact support to change them.',
};

export const ADMIN_SETTINGS_COPY = {
  pageTitle: 'Settings',
  breadcrumb: 'Account',
  accountHeading: 'Account',
  legalHeading: 'Legal',
  sessionHeading: 'Session',
  emailLabel: 'Email address',
  roleLabel: 'Role',
  termsOfService: 'Terms of Service',
  privacyPolicy: 'Privacy Policy',
  legalComingSoon: 'Documents will open here once the legal pages are wired.',
  signOut: 'Sign out',
};

export const ADMIN_NOTIFICATIONS_COPY = {
  panelTitle: 'Recent activity',
  panelAriaLabel: 'Notifications panel',
  viewAll: 'View all activity',
  emptyTitle: 'Nothing yet',
  emptyBody: 'Activity across your fest will show up here.',
  noFestTitle: 'No fest yet',
  noFestBody: 'Activity appears here once a fest is linked to your account.',
  loadError: 'Could not load activity.',
  retry: 'Retry',
};

// Shared image uploader (fest banner + event poster). Neutral on purpose — the
// caller supplies the field label; these are the uploader's own strings.
export const ADMIN_UPLOAD_COPY = {
  cta: 'Upload image',
  hint: 'JPG or PNG, up to 5 MB',
  previewAlt: 'Uploaded image preview',
  remove: 'Remove image',
  typeError: 'Image must be a JPG or PNG.',
  sizeError: 'Image must be 5 MB or smaller.',
  uploadError: 'Could not upload the image. Try again.',
};

export const ADMIN_AUTHORIZATION_COPY = {
  deniedTitle: 'This is the admin panel',
  deniedBody: "You don't have access.",
  deniedHint:
    'This account has no administrator assignment. If you are here to browse fests or manage your registrations, head back to the app.',
  goToParticipantApp: 'Back to Discover',
  signOutAndSwitch: 'Sign out and use a different account',
};

export const ADMIN_DASHBOARD_COPY = {
  title: 'Overview',
  breadcrumb: 'Overview',
  searchPlaceholder: 'Search fests, events, people',
  notifications: 'Notifications',
};

export const ADMIN_EVENTS_COPY = {
  structureTitle: 'Event structure',
  createTitle: 'Create event',
  createWithFeesTitle: 'Create event — pricing',
  createWithPosterTitle: 'Create event — poster',
  assignmentsTitle: 'Assign staff',
  subEventTitle: 'Add sub-event',
  accessTitle: 'Event access',
};

export const ADMIN_USERS_COPY = {
  title: 'People',
  directoryTitle: 'User directory',
  pageTitle: 'User Directory',

  // KPI cards (Pending Invites / Disabled sourced from what the backend actually
  // has: there is no invite system, so that card is hidden; isBlocked exists, so
  // Disabled is real).
  kpiTotal: 'Total Participants',
  kpiTotalSubtitle: 'Unique people with a registration',
  kpiActiveNow: 'Active Now',
  kpiActiveNowSubtitle: 'Confirmed for an event in the next 24h',
  kpiDisabled: 'Disabled',
  kpiDisabledSubtitle: 'Blocked accounts',

  searchPlaceholder: 'Search name, email, or USN',
  filterAllEvents: 'All events',
  filterAllStatuses: 'All statuses',
  filterAllFests: 'All fests',
  exportCsv: 'Export CSV',
  csvFilename: 'participants.csv',

  columnUser: 'User',
  columnUsn: 'USN',
  columnEvents: 'Events',
  columnStatus: 'Status',
  columnActions: '',

  eventsCount: (count) => `${count} event${count === 1 ? '' : 's'}`,
  actionEmail: 'Send message (email)',
  actionsLabel: 'Participant actions',

  emptyTitle: 'No participants yet',
  emptyBody: "Once people register for events, they'll appear here.",
  loadError: 'Could not load participants. Try again.',
  showingRange: (from, to, total) => `${from}–${to} of ${total}`,
  prev: 'Previous',
  next: 'Next',
};

// The fest offers editor, shared by create-fest and edit-fest.
export const ADMIN_SPONSORS_COPY = {
  heading: 'Sponsors',
  intro:
    'Sponsor logos shown at the bottom of the participant-facing fest page. Up to 20; a logo can carry a name and a link, or just be a logo.',
  sponsorNameLabel: 'Sponsor name (optional)',
  sponsorNamePlaceholder: 'e.g. Red Bull',
  linkUrlLabel: 'Link (optional)',
  linkUrlPlaceholder: 'https://…',
  addSponsor: '+ Add sponsor',
  removeSponsor: 'Remove',
  limitReached: 'A fest can have at most 20 sponsors.',
  missingImage: 'Upload a logo, or remove this slot.',
  removeModalTitle: 'Remove this sponsor?',
  removeModalBody:
    'This sponsor logo will be removed from the participant-facing pages. Are you sure?',
  removeConfirm: 'Remove sponsor',
  removeCancel: 'Keep sponsor',
};

export const ADMIN_FEST_OFFERS_COPY = {
  heading: 'Offers',
  intro:
    'What this fest provides to participants — food, accommodation, merch, anything. Each offer becomes a scan point volunteers can be scheduled at, which is how claims get checked at the counter.',
  nameLabel: 'Offer name',
  namePlaceholder: 'e.g. Food',
  keyLabel: 'System key',
  // Quick-picks PRE-FILL the name only; the data is still just offerName, and
  // reserved behaviour (food/accommodation) is derived from it server-side.
  quickPicks: ['Food', 'Accommodation', 'Travel', 'DJ passes', 'Games'],
  isPaidLabel: 'Paid offer',
  isPaidDescription: 'Off = free. A free offer never charges, whatever quantities are chosen.',
  collectsNumberOfPeopleLabel: 'Ask number of people',
  collectsNumberOfPeopleDescription: 'Registrants choose how many people this covers.',
  collectsNumberOfDaysLabel: 'Ask number of days',
  collectsNumberOfDaysDescription: 'Registrants choose how many days this covers.',
  minimumLabel: 'Minimum',
  maximumLabel: 'Maximum',
  maximumPlaceholder: 'No cap',
  rateLabel: 'Rate per selected unit (₹)',
  ratePlaceholder: 'e.g. 500',
  // The live suffix that disambiguates the rate input — all four permutations.
  rateSuffixPrefix: 'Charged as:',
  rateSuffixPerPersonPerDay: '₹rate per person per day',
  rateSuffixPerPerson: '₹rate per person',
  rateSuffixPerDay: '₹rate per day',
  rateSuffixTotal: '₹rate total (one flat charge)',
  descriptionLabel: 'Description',
  descriptionPlaceholder: 'What the offer covers — e.g. dinner and lunch, day 2 only',
  eventScopeIntro:
    'Add-ons for THIS event only. They appear alongside the fest-wide offers on the registration form, labelled so participants can tell them apart.',

  // Checkpoints per offer (edit screen only — counters exist once materialised).
  checkpointsHeading: 'Checkpoints',
  checkpointsIntro:
    'Each checkpoint is a physical scanning location; a volunteer at that checkpoint can only serve claims of this offer at this location.',
  checkpointAddPlaceholder: 'New checkpoint name — e.g. Food Counter B',
  checkpointAdd: 'Add checkpoint',
  checkpointActive: 'Active',
  checkpointInactive: 'Inactive',
  checkpointDeactivate: 'Deactivate',
  checkpointReactivate: 'Reactivate',
  checkpointDeactivateModalTitle: 'Deactivate this checkpoint?',
  checkpointDeactivateModalBody: (checkpointName) =>
    `“${checkpointName}” stops accepting scans. Scans already logged against it are preserved — the scan trail is append-only, and no historical data is lost. You can reactivate it any time.`,
  checkpointConfirm: 'Deactivate',
  checkpointCancel: 'Keep active',
  checkpointsLoadFailed: 'Could not load the checkpoints. Try again.',
  checkpointActionFailed: 'That checkpoint change did not go through. Try again.',
  checkpointsEmptyNote: 'Counters appear after the fest is published (one per offer, automatically).',
  addOffer: 'Add offer',
  removeOffer: 'Remove',
  limitReached: 'At most 12 offers.',
  duplicateKey: 'Two offers cannot share the same system key.',
  emptyName: 'Give the offer a name.',
  removeModalTitle: 'Remove this offer?',
  removeModalBody: (offerName) =>
    `Removing “${offerName}” is destructive to participant answers already collected against it. Its scan counter will be deactivated — not deleted — and existing claims are preserved.`,
  removeConfirm: 'Remove offer',
  removeCancel: 'Keep offer',
};

export const ADMIN_EVENT_TIMELINE_COPY = {
  pageTitle: 'Timeline',
  intro:
    'Every scheduled event on one time axis, one row per venue. Read-only: fix what you find on the event edit screen.',
  chooseFest: 'Choose a fest to see its timeline.',
  noScheduled: 'No events with a start time yet.',
  loadFailed: 'Could not load the events. Try again.',
  chartLabel: 'Event timeline by venue',
  noVenueLane: 'No venue set',
  readOnlyNote:
    'Read-only. Events cannot be moved here — open the event to change its schedule.',
  tooManyEvents: (eventCount, maximum) =>
    `${eventCount} events is too many to read on a timeline (limit ${maximum}). Use the event list instead.`,
  conflictsHeading: (conflictCount) =>
    `${conflictCount} venue ${conflictCount === 1 ? 'conflict' : 'conflicts'}`,
  conflictLine: (venueName, firstEventName, secondEventName, atLabel) =>
    `VENUE CONFLICT: ${venueName} has ${firstEventName} and ${secondEventName} at the same time (from ${atLabel}).`,
  gapsHeading: (gapCount) => `${gapCount} long ${gapCount === 1 ? 'gap' : 'gaps'}`,
  gapLine: (gapHours, venueName, fromLabel, toLabel) =>
    `${gapHours}h gap at ${venueName} between ${fromLabel} and ${toLabel}.`,
};

export const ADMIN_FEST_STRUCTURE_COPY = {
  pageTitle: 'Fest structure',
  intro: 'The full event hierarchy of this fest, read-only.',
  groupingMarker: 'Grouping',
  leafDescendantsSuffix: 'events',
  feedbackResponses: (responseCount) =>
    `${responseCount} participant ${responseCount === 1 ? 'rating' : 'ratings'}`,
  registeredOf: (registeredCount, capacity) =>
    capacity === null || capacity === undefined
      ? `${registeredCount} registered`
      : `${registeredCount}/${capacity} registered`,
  emptyTitle: 'No events yet',
  emptyBody: 'Events created under this fest will appear here as a tree.',
  // Events whose parentEventId points at an event that is not in this fest's
  // list — surfaced rather than silently dropped.
  unattachedHeading: 'Unattached events',
  unattachedNote: 'These events reference a parent that no longer exists in this fest.',
  loadError: 'Could not load the fest structure. Try again.',
  retry: 'Retry',
  viewStructure: 'Generate QR',
  expandLabel: (eventName) => `Expand ${eventName}`,
  collapseLabel: (eventName) => `Collapse ${eventName}`,

  // Structure editor (drag-and-drop rearrangement).
  subtitle: 'Event structure',
  // Only the sidebar route (/admin/events/structure) shows a fest picker.
  festSelectorLabel: 'Fest',
  festSelectorPlaceholder: 'Select a fest',
  selectFestPrompt: 'Select a fest to view its event structure.',
  chooseAnotherFest: 'Choose another fest',
  totalEvents: (eventCount) => `${eventCount} ${eventCount === 1 ? 'event' : 'events'}`,
  subEventCount: (childCount) => `${childCount} ${childCount === 1 ? 'sub-event' : 'sub-events'}`,
  topLevelEventCount: (eventCount) =>
    `${eventCount} top-level ${eventCount === 1 ? 'event' : 'events'}`,
  contingentEligible: 'Contingent eligible',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  saveOrder: 'Save order',
  saving: 'Saving…',
  rowActionsLabel: (eventName) => `Actions for ${eventName}`,
  viewEventDetails: 'View event details',
  configureContingent: 'Configure contingent',
  publishFest: 'Publish fest',
  publishFestTitle: 'This fest is not live yet',
  publishFestBody:
    'Publishing makes the fest and its events visible to participants, and generates the shareable link and QR code.',
  publishConfirmTitle: 'Publish this fest?',
  publishConfirmBody:
    'Publishing this fest will also publish every draft event under it. Cancelled events are left as they are.',
  publishFailed: 'The fest could not be published.',
  editEvent: 'Edit event',
  deleteEvent: 'Delete event',
  deleteConfirmTitle: 'Delete this event?',
  deleteConfirmBody: (eventName) =>
    `${eventName} will stop appearing to participants. Existing registrations are kept.`,
  deleteConfirmAction: 'Delete event',
  cancel: 'Cancel',
  moveFailed: 'That move could not be saved. The tree has been put back.',
  circularMoveFailed: 'An event cannot be moved under one of its own sub-events.',
  orderSaved: 'Order saved.',
  readOnlyNote: 'You can view this structure but not rearrange it.',
  // Chart / editor mode toggle. The chart is the default and stays read-only;
  // the editor is the indented drag-and-drop tree.
  modeLabel: 'Mode',
  modeChart: 'Chart',
  modeEditor: 'Rearrange',
  editorHint: 'Drag a row by its handle, or focus the handle and use the keyboard.',
  // A named neighbour moved or vanished between the admin's last load and their
  // drop: somebody else rearranged this fest. The move was NOT applied.
  structureChanged:
    'This fest was rearranged by someone else. Your move was not applied — the tree has been refreshed so you can try again.',
  offlineEditor: 'You are offline. Changes cannot be saved until the connection is back.',
  dragHandleLabel: (eventName) => `Move ${eventName}`,
  keyboardInstructions:
    'Press space to pick up the event. Use up and down arrows to move it between rows, right arrow to nest it under the row above, left arrow to move it out to the parent level. Press space again to drop, or escape to cancel.',
  announcePickedUp: (eventName) =>
    `Picked up ${eventName}. Up and down move it, right nests it, left un-nests it, space drops, escape cancels.`,
  announceOver: (eventName, overName) => `${eventName} is over ${overName}.`,
  announceDropped: (eventName) => `${eventName} dropped. Saving.`,
  announceCancelled: (eventName) => `Move cancelled. ${eventName} stays where it was.`,
  announceSaved: (eventName, parentName, previousName) => {
    const under = parentName ? ` under ${parentName}` : ' at the top level';
    const after = previousName ? `, after ${previousName}` : ', first';
    return `${eventName} moved${under}${after}. Saved.`;
  },
  announceFailed: (eventName) => `${eventName} could not be moved. The tree has been put back.`,
  emptyAction: 'Create event',
  emptyStructureBody: 'No events created yet. Create your first event to get started.',
  viewInEventAccess: 'View in Event Access',
};

export const ADMIN_EVENT_ACCESS_COPY = {
  pageTitle: 'Event Access',

  festLabel: 'Fest',
  festPlaceholder: 'Choose a fest',
  targetLabel: 'Manage',
  wholeFestOption: 'Whole fest (visibility)',
  eventOptionGroup: 'Events',
  noFests: 'You have no fests yet.',

  // Identity card
  dateVenueSeparator: ' · ',
  waitlistedCount: (count) =>
    count + ' ' + (count === 1 ? 'person is' : 'people are') + ' on the waitlist for this event.',
  noVenue: 'No venue set',

  // Publish / lifecycle — events have publish + cancel only (no unpublish); the
  // fest has publish + archive/unarchive.
  publishEvent: 'Publish Event',
  cancelEvent: 'Cancel Event',
  closeEventRegistration: 'Close Registration',
  closeEventRegistrationModalTitle: 'Close registration for this event?',
  closeEventRegistrationModalBody:
    'New sign-ups will be refused immediately. Everyone already registered keeps their place, their pass and their team — nothing is cancelled or deleted. You can reopen registration at any time.',
  reopenEventRegistration: 'Reopen Registration',
  reopenEventRegistrationModalTitle: 'Reopen registration for this event?',
  reopenEventRegistrationModalBody:
    'Participants will be able to register again, subject to the usual capacity and schedule rules.',
  editEvent: 'Edit Event',
  reopenEvent: 'Reopen Event',
  reopenEventModalTitle: 'Reopen this cancelled event?',
  reopenEventModalBody: (name) =>
    `${name || 'This event'} comes back as a DRAFT on the new schedule below, with everything restored: participants' registrations and passes work again, coordinators and volunteers get their access back, and everyone is notified in-app. One caveat — refunds already marked on paid seats stay marked; settle those with finance separately. Review it, then publish when ready.`,
  reopenStartsAtLabel: 'New start',
  reopenEndsAtLabel: 'New end',
  reopenRegOpensLabel: 'Registration opens',
  reopenRegClosesLabel: 'Registration closes',
  cancelledEventsTab: 'Cancelled Events',
  cancelledEventsEmpty: 'No cancelled events in this fest.',
  cancelledOnLabel: 'Cancelled',
  editEventModalTitle: 'Edit event',
  editEventModalBody: 'Changes apply immediately. Rescheduling re-syncs the registration window; participants are not notified automatically, so tell them if the time moves.',
  editEventNameLabel: 'Event name',
  editVenueLabel: 'Venue',
  editDescriptionLabel: 'Description',
  editStartsAtLabel: 'Starts',
  editEndsAtLabel: 'Ends',
  editCapacityLabel: 'Capacity',
  editCapacityPlaceholder: 'Leave empty for unlimited',
  deleteEvent: 'Delete Event',
  deleteEventModalTitle: 'Delete this event permanently?',
  deleteEventModalBody: (name) =>
    `${name || 'This event'} and its rounds, scores and checkpoints will be removed permanently. This only works for events nobody ever registered for — anything with registrations must be cancelled instead, and the server will refuse it.`,
  deleteFestAction: 'Delete fest',
  deleteFestConfirm: 'Delete this fest permanently? Only works if nobody ever registered for any of its events — otherwise cancel or archive it.',
  publishFest: 'Publish Fest',
  archiveFest: 'Archive Fest',
  unarchiveFest: 'Unarchive Fest',

  publishEventModalTitle: 'Publish this event?',
  publishEventModalBody: 'Publishing makes this event visible to participants and opens its registration window.',
  cancelEventModalTitle: 'Cancel this event?',
  /*
   * States what the cascade ACTUALLY does. The previous wording promised that
   * registrations survive a cancellation, which stopped being true the moment
   * cancelEvent began cascading - a modal that misdescribes a destructive action
   * is worse than no modal.
   */
  cancelEventModalBody: (eventName) =>
    `You are cancelling “${eventName}”. It is hidden from participants and stops accepting registrations.`,
  cancelEventModalImpact: (counts) =>
    `${counts.activeRegistrationCount} participant${counts.activeRegistrationCount === 1 ? '' : 's'} will be notified, their event entry entitlement will be revoked, and any payments made will be marked refund-pending for manual processing via Razorpay. This action is not reversible from the console.`,
  cancelEventModalScans:
    'Someone has already scanned in at this event. Cancelling now is a different conversation with those attendees — check before you confirm.',
  cancelEventModalContingent: (count) =>
    `${count} contingent claim${count === 1 ? '' : 's'} also point at this event. Cancel the contingent first if this event is bundled.`,
  previewLoading: 'Counting what this affects…',
  previewFailed: 'Could not count what this affects. Refresh before cancelling.',
  publishFestModalTitle: 'Publish this fest?',
  publishFestModalBody: 'Publishing makes the fest visible to participants.',
  archiveFestModalTitle: 'Archive this fest?',
  archiveFestModalBody:
    'The fest is hidden from participants. Existing registrations, passes, scans, and audit history are preserved and remain readable in Data Controls. This action is reversible via Unarchive.',
  unarchiveFestModalTitle: 'Unarchive this fest?',
  unarchiveFestModalBody: 'The fest returns to a draft state you can edit and publish again.',

  /*
   * Cancelling a fest is not archiving it. Archive hides; cancel calls the whole
   * thing off, emails every participant of every event, and marks captured money
   * refund-pending. Irreversible, so the dialog demands a reason AND a typed
   * confirmation - deliberately more friction than any other action here.
   */
  cancelFest: 'Cancel Fest',
  cancelFestModalTitle: 'Cancel this entire fest?',
  cancelFestModalBody:
    'This calls the fest off. Every event under it is cancelled, every registration ends, every participant is emailed once, and captured payments are marked refund-pending for manual processing via Razorpay. Archiving only hides a fest — this does not. It is IRREVERSIBLE: there is no un-cancel.',
  cancelFestImpactHeading: 'What this affects',
  cancelFestReasonLabel: 'Reason (emailed to every participant, kept in the audit trail)',
  cancelFestReasonPlaceholder: 'e.g. Venue withdrawn; the fest cannot go ahead this year.',
  cancelFestReasonTooShort: 'Give a reason of at least 10 characters.',
  cancelFestTypedConfirmLabel: 'Type CANCEL to confirm',
  cancelFestTypedConfirmWord: 'CANCEL',
  cancelFestConfirm: 'Cancel the fest',
  cancelFestKeep: 'Keep the fest',
  impactEvents: 'Events cancelled',
  impactParticipants: 'Participants notified',
  impactRegistrations: 'Registrations ended',
  impactPaidRegistrations: 'Paid registrations',
  impactContingents: 'Contingents cancelled',
  impactContingentClaims: 'Contingent claims ended',
  impactRefundPending: 'Marked refund-pending',
  impactEntitlements: 'Entitlements revoked',
  impactScansWarning: 'Attendees have already scanned in',

  // Secondary path to staff management, so an admin thinking about one fest does
  // not have to know to navigate to a separate global screen. Same destination.
  manageStaffLink: (staffCount) =>
    `${staffCount} staff — manage assignments`,

  /*
   * PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL.
   * Strong ceremony on purpose: the button is destructive and easy to hit, and the
   * ceremony is what stops an accidental purge during a demo.
   */
  purgeFest: 'DEV ONLY — PURGE (test only)',
  purgeModalTitle: 'Purge this test fest permanently?',
  purgeModalBody:
    'This DELETES the fest and every row under it — events, registrations, passes, entitlements, scans, checkpoints, payment orders, staff assignments, contingents, certificates and shifts. It is not a cancellation and nothing is recoverable. Consent records are preserved. Available in development and staging only; this endpoint returns 403 in production.',
  purgeTypedConfirmLabel: (festName) => `Type “PURGE ${festName}” to confirm`,
  purgeTypedConfirmWord: (festName) => `PURGE ${festName}`,
  purgeConfirm: 'Purge permanently',
  purgeKeep: 'Keep the fest',
  purgeCountsHeading: 'Rows about to be deleted',
  purgeConsentNote: 'Consent records are NOT deleted.',
  confirm: 'Confirm',
  keepEditing: 'Keep editing',

  // Access & permissions
  accessHeading: 'Access & permissions',
  visibilityLabel: 'Fest visibility',
  visibilityHelp: 'Who can discover and register for this fest.',
  visibilityOptions: [
    { value: 'public', label: 'Public', description: 'Anyone can find and register.' },
    { value: 'intraCollege', label: 'Intra-college', description: 'Only the host college’s students.' },
    { value: 'interCollege', label: 'Inter-college', description: 'A named list of colleges.' },
  ],
  // interCollege needs an allowed-colleges list the model requires; that picker is
  // future work, so the option is shown but not switchable to from here.
  interCollegeLocked: 'Selecting inter-college needs an allowed-colleges list — coming soon.',
  visibilityEventNote: 'Visibility is set at the fest level. Switch “Manage” to Whole fest to change it.',

  coordinatorsHeading: 'Assigned coordinators',
  coordinatorsEmpty: 'No coordinators assigned to this event.',
  coordinatorRole: 'Coordinator',
  addCoordinator: 'Add coordinator',

  // Recent changes
  recentHeading: 'Recent changes',
  recentEmpty: 'No recorded changes yet.',

  // Safety actions
  safetyHeading: 'Safety actions',
  viewRegistrations: 'View registrations',

  loadError: 'Could not load event access. Try again.',
  selectPrompt: 'Select a fest and target to manage access.',
  actionFailed: 'That action could not be completed. Try again.',
  visibilityFailed: 'Visibility could not be changed. Try again.',
};

// Staff assignments. Role `value`s mirror the backend's ASSIGNABLE_ROLES exactly
// (staff-assignment-validator.js): administrators are granted at the college
// level, never invited into a single fest, so the form offers only these two.
export const ADMIN_STAFF_ASSIGNMENTS_COPY = {
  offersHelp:
    'Optional: narrow this assignment to specific offers. Leave empty to cover all checkpoints allowed by the role and event scope.',
  pageTitle: 'Staff Assignments',

  festLabel: 'Fest',
  festPlaceholder: 'Choose a fest',
  noFests: 'You have no fests yet.',
  selectPrompt: 'Select a fest to manage its staff.',

  // Roster table
  rosterHeading: 'Team',
  rosterEmpty: 'No staff assigned to this fest yet.',
  columnName: 'Name',
  columnEmail: 'Email',
  columnHours: 'Total hours',
  columnRole: 'Role',
  columnEvents: 'Events',
  columnStatus: 'Status',
  columnActions: '',
  wholeFestScope: 'Whole fest',
  pendingName: 'Invitation pending',

  // Add-staff form
  addHeading: 'Add staff',
  addDescription:
    'The person is invited by email. If they have no account yet, one is created for them and the assignment activates when they sign in.',
  emailLabel: 'Email addresses',
  emailPlaceholder: 'one@college.edu, two@college.edu\nthree@college.edu',
  emailHelper: 'One or many — separate with commas or new lines.',
  roleLabel: 'Role',
  rolePlaceholder: 'Choose a role',
  roleOptions: [
    { value: 'coordinator', label: 'Coordinator' },
    { value: 'volunteer', label: 'Volunteer' },
  ],

  // Bulk results, one line per address.
  bulkHeading: 'Results',
  bulkSucceeded: 'Added',
  bulkFailed: 'Failed',
  noValidEmails: 'No valid email addresses found in that list.',
  accessNote:
    'Coordinators get console access from 2 days before the event. Volunteers are scheduled automatically — their scanner opens 3 hours before the event starts and closes when it ends.',

  // Inline shift retiming, which replaces the standalone Volunteer Shifts page.
  editTimingAction: 'Edit timing',
  editTimingClose: 'Close',
  editTimingHeading: 'Shift timing',
  editTimingEmpty: 'No shift scheduled yet. A shift is created when the volunteer covers a scheduled event.',
  editTimingStartLabel: 'Starts at',
  editTimingEndLabel: 'Ends at',
  editTimingSave: 'Save timing',
  editTimingSaved: 'Shift timing updated.',
  editTimingFailed: 'The shift timing could not be saved. Try again.',
  editTimingLoadFailed: 'Could not load this volunteer’s shifts.',
  contactPhoneLabel: 'Contact phone (optional)',
  contactPhonePlaceholder: 'Leave blank to use their personal number.',
  eventsLabel: 'Limit to events (optional)',
  eventsHelp: 'Leave every event unchecked to grant the whole fest.',
  noEvents: 'This fest has no events yet — the assignment will cover the whole fest.',
  submitAdd: 'Add staff member',
  addSucceeded: 'Staff member added.',
  addSucceededEmailFailed:
    'Staff member added, but the invitation email could not be delivered — tell them directly.',
  /*
   * The old nudge pointed at a separate Volunteer Shifts screen, which no longer
   * exists: assigning a volunteer now creates their shift automatically. What is
   * left to say is what that shift is, and where to change it.
   */
  volunteerAutoShiftNotice: (staffName) =>
    `${staffName} is scheduled automatically — their scanner opens 3 hours before the event and closes when it ends. Use “Edit timing” on their row to change it.`,

  // Revoke
  revokeAction: 'Revoke',
  revokeModalTitle: 'Revoke this assignment?',
  revokeModalBody:
    'The person immediately loses this role. The assignment stays on record as revoked — it is never deleted.',
  revokeReasonLabel: 'Reason (optional)',
  revokeReasonPlaceholder: 'Shared with the person in the revocation email',
  revokeConfirm: 'Revoke access',
  revokeCancel: 'Keep access',
  revokeSucceededEmailFailed:
    'Assignment revoked, but the notification email could not be delivered.',

  // Filtered CSV export
  exportButton: 'Download CSV',
  exportModalTitle: 'Download staff list',
  exportRolesLegend: 'Roles',
  exportStatusesLegend: 'Statuses',
  exportEventsLegend: 'Events',
  exportAllEvents: 'All events',
  exportCounting: 'Counting…',
  exportRowPreview: (rowCount) => `Will export ${rowCount} row${rowCount === 1 ? '' : 's'}.`,
  exportNoMatches: 'No staff match these filters.',
  exportDownload: 'Download',
  exportCancel: 'Cancel',
  exportFailed: 'The export could not be downloaded. Try again.',

  loadError: 'Could not load staff assignments. Try again.',
  emailRequired: 'Enter an email address.',
  roleRequired: 'Choose a role.',
};

// Volunteer shifts. Status `value`s mirror SHIFT_STATUSES ('scheduled' |
// 'cancelled'); 'all' is the backend's special filter value that omits the
// status filter entirely.
// The shared Fest -> Event -> Sub-event cascade.
// Home-screen promotions, owned by the platform admin.
export const ADMIN_PROMOTIONS_COPY = {
  pageTitle: 'Promotions',
  intro:
    'Banners on every participant’s home screen. Platform-wide — not tied to any fest. Each type is its own carousel in the app, with its own order and its own limit of 20 published.',
  createButton: 'Create promotion',
  loadFailed: 'Could not load promotions. Try again.',

  // The two types, as two tabs. Each tab is a self-contained list: its own
  // ordering, its own publish cap, its own create button.
  tabCommercial: 'Commercial',
  tabCollegeEvents: 'College Events',
  tabsLabel: 'Promotion type',
  emptyCommercial: 'No commercial promotions yet. Create one to put a sponsor banner on the home screen.',
  emptyCollegeEvents:
    'No college events yet. Create one when a college asks to promote its fest.',

  orderLabel: (position) => `#${position} in the carousel`,
  noLink: 'No link',
  moveUp: 'Move up',
  moveDown: 'Move down',

  editAction: 'Edit',
  publishAction: 'Publish',
  archiveAction: 'Archive',
  deleteAction: 'Delete',

  createModalTitle: 'New promotion',
  editModalTitle: 'Edit promotion',
  titleLabel: 'Title',
  titleRequired: 'Give the promotion a title.',
  imageLabel: 'Banner image',
  imageHelp: 'JPEG or PNG. Shown at 16:9 — the preview below is exactly what participants see.',
  imageRequired: 'Upload a banner image.',
  // A promotion plays EITHER a still or a video; the form swaps between them.
  mediaTypeLabel: 'Media',
  mediaTypeImage: 'Image',
  mediaTypeVideo: 'Video',
  videoUrlLabel: 'Video URL',
  videoUrlHelp: 'A YouTube link or a direct MP4 URL.',
  videoPosterLabel: 'Poster image (recommended)',
  videoPosterHelp: 'Shown while the video loads. Without one the slide starts black.',
  videoRequired: 'Add a video URL, or switch this promotion back to an image.',
  linkLabel: 'Link (optional)',
  // Deliberate non-feature: remote URLs are never health-checked. A check would
  // slow every save and could not keep a link alive after publishing anyway.
  linkHelp:
    'Where tapping the banner goes. Leave blank for a display-only banner. The platform does not verify that linked URLs are accessible — test your link before publishing.',
  linkInvalid: 'Enter a full URL starting with http:// or https://',
  descriptionLabel: 'Description (optional)',
  descriptionHelp: 'A one-line subtitle shown beneath the image on the participant app.',
  /*
   * Free text, deliberately not a picker of registered colleges: a college that
   * writes in asking to promote its fest often has no account here yet, and the
   * super admin should type the name exactly as it was given.
   */
  collegeNameLabel: 'College name',
  collegeNameHelp:
    'The college promoting this event, as they gave it. Free text — they do not need an account on the platform.',
  collegeNameRequired: 'Name the college promoting this event.',
  collegeColumnLabel: 'College',
  noCollege: 'No college',
  saveDraft: 'Save as draft',
  saveAndPublish: 'Save and publish',
  cancel: 'Cancel',

  savedNotice: 'Promotion saved as a draft.',
  publishedNotice: 'Promotion published — it is live on the home screen.',
  archivedNotice: 'Promotion archived and removed from the home screen.',
  deletedNotice: 'Draft promotion deleted.',
  saveFailed: 'Could not save the promotion. Try again.',
  actionFailed: 'That action did not complete. Try again.',

  archiveModalTitle: 'Archive this promotion?',
  archiveModalBody:
    'This promotion will be hidden from the participant app immediately. It can be re-published later.',
  deleteModalTitle: 'Delete this draft?',
  deleteModalBody: 'This promotion will be permanently deleted. This action cannot be undone.',
};

export const ADMIN_HIERARCHY_FILTER_COPY = {
  festLabel: 'Fest',
  festPlaceholder: 'Choose a fest',
  noFests: 'You have no fests yet.',
  eventLabel: 'Event',
  subEventLabel: 'Sub-event',
  allEvents: 'All events',
  allSubEvents: 'All sub-events',
  noEvents: 'This fest has no events yet.',
  independentTag: 'INDEPENDENT',
};

export const ADMIN_RESULTS_BOARD_COPY = {
  pageTitle: 'Results Board',
  festLabel: 'Fest',
  festPlaceholder: 'Choose a fest',
  selectPrompt: 'Select a fest to see its results.',
  emptyEvents: 'No events match.',
  viewResults: 'View results',
  hideResults: 'Hide results',
  confirmedSuffix: 'confirmed',
  finalizedChip: 'Finalized',
  provisionalChip: 'Provisional',
  emptyLeaderboard: 'No scores entered yet. Initialize and enter scores on Scoring & results.',
  bracketWinnerLine: (winnerName) => `Winner (bracket final): ${winnerName}`,
  bracketNoWinnerYet: 'Bracket not decided yet — no final winner recorded.',
  pushWinnersButton: 'PUSH WINNER CERTIFICATES',
  pushParticipationButton: 'PUSH PARTICIPATION CERTIFICATES',
  editScoresLink: 'Edit scores',
  pushWinnersModalTitle: 'Push winner certificates?',
  pushParticipationModalTitle: 'Push participation certificates?',
  pushModalBody: (kind, count) =>
    `Push ${kind === 'winners' ? 'winner' : 'participation'} certificates to ${count} participant${count === 1 ? '' : 's'}. They become visible to their holders immediately. This is not reversible from this screen.`,
  pushConfirm: 'Push',
  pushCancel: 'Cancel',
  pushSucceeded: (kind, eventName, generatedCount, releasedCount) =>
    `${kind === 'winners' ? 'Winner' : 'Participation'} certificates pushed for ${eventName}: ${generatedCount} generated, ${releasedCount} released.`,
  pushFailed: 'The push did not complete. Try again.',
  loadFailed: 'Could not load the results board. Try again.',

  /*
   * The hierarchical board. THREE LEVELS, and the copy names the level rather
   * than the query: an admin reading "Winners · Chaturanga" knows what the
   * table is without decoding a URL.
   */
  eventLabel: 'Event',
  wholeFestOption: 'All events — whole fest',
  eventPlaceholder: 'Choose an event (optional)',
  noFests: 'You have no fests yet.',
  selectFestPrompt: 'Choose a fest to see its results.',

  winnersHeading: (scopeName) => `Winners · ${scopeName}`,
  winnersSubtitleFest: 'Every event of this fest with its podium. Choose an event above to narrow.',
  winnersSubtitleEvent: 'The verticals under this event. Choose one to see its full scoreboard.',
  scoreboardHeading: (eventName) => `Scoreboard · ${eventName}`,
  scoreboardSubtitle: 'Every competitor, every round. Click any mark to correct it.',

  eventColumn: 'Event',
  firstPlaceColumn: '1st place',
  secondPlaceColumn: '2nd place',
  thirdPlaceColumn: '3rd place',
  pendingWinner: 'Pending',
  provisionalNote:
    'Places shown for events whose results are not finalised yet are the current standing, not a verdict.',
  provisionalChipShort: 'Provisional',
  noEventsInScope: 'There are no events in this scope yet.',

  downloadWinnersFest: (eventCount) =>
    `Download all winners (${eventCount} ${eventCount === 1 ? 'event' : 'events'})`,
  downloadWinnersEvent: (eventCount) =>
    `Download winners (${eventCount} ${eventCount === 1 ? 'vertical' : 'verticals'})`,
  downloadScoreboard: (participantCount) =>
    `Download scoreboard (${participantCount} ${participantCount === 1 ? 'participant' : 'participants'})`,
  downloading: 'Preparing…',
  downloadFailed: 'The download could not be prepared. Try again.',

  // The editable grid, moved here from the screen so every string this page
  // renders has one home.
  intro:
    'Marks appear here as each coordinator saves them. Click any mark to correct it — corrections are recorded against your name.',
  noRounds:
    'This event has no rounds yet. The coordinator creates rounds on their panel; marks appear here once they do.',
  noCompetitors:
    'Nobody is on the sheet yet. Competitors appear once they scan in at the event entry.',
  totalHeader: 'Total',
  competitorHeader: 'Competitor',
  roundLabel: (round) => round.roundName || `Round ${round.roundNumber}`,
  notInRound: 'Did not compete in this round',
  unranked: 'Unscored',
  adminEdited: 'Corrected by an administrator',
  saveFailed: 'That mark could not be saved.',
  searchLabel: 'Find a competitor',
  searchPlaceholder: 'Name or team…',
  podiumHeading: 'Standing',
  finalisedNote: 'Results are finalised. Corrections made here still apply and are audited.',
};

export const ADMIN_SHIFTS_COPY = {
  // The main gate: every participant can already scan there (gate access rides
  // with the pass), so it leads the list and says so.
  mainGateDefaultTag: 'MAIN GATE — DEFAULT (all participants have gate access)',
  noGateVolunteerBanner:
    'No volunteer is scheduled at the main gate. Assign one so QR scanning is ready when the fest opens.',
  noGateVolunteerLink: 'Go to staff assignments',
  shiftLiveNow: 'LIVE NOW',
  alertVolunteersHeading: 'Alert volunteers',
  alertVolunteersBody:
    'Emails everyone on duty at a checkpoint that scanning has started. Only checkpoints with a scheduled volunteer appear here.',
  alertVolunteersSent: (notifiedCount, checkpointName) =>
    `Alerted ${notifiedCount} volunteer${notifiedCount === 1 ? '' : 's'} at ${checkpointName}.`,
  alertVolunteersFailed: 'Could not send the alert. Try again.',
  pageTitle: 'Volunteer Shifts',

  festLabel: 'Fest',
  festPlaceholder: 'Choose a fest',
  noFests: 'You have no fests yet.',
  selectPrompt: 'Select a fest to manage its shifts.',

  // Unscheduled-volunteers summary: volunteers with an active assignment but no
  // scheduled shift in this fest. Their scanner never opens until one exists.
  unscheduledSummary: (unscheduledCount) =>
    `${unscheduledCount} volunteer${unscheduledCount === 1 ? '' : 's'} not yet scheduled`,
  unscheduledDetail:
    'These volunteers have no scheduled shift, so their scanner never opens. Schedule them below.',

  // Shifts table
  shiftsHeading: 'Shifts',
  shiftsEmpty: 'No shifts match this filter.',
  statusFilterLabel: 'Show',
  statusFilterOptions: [
    { value: 'all', label: 'All shifts' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
  columnVolunteer: 'Volunteer',
  columnCheckpoint: 'Checkpoint',
  columnStarts: 'Starts',
  columnEnds: 'Ends',
  columnStatus: 'Status',
  columnActions: '',
  editAction: 'Edit',
  cancelAction: 'Cancel',

  // Create / edit form
  createHeading: 'Schedule a shift',
  editHeading: 'Edit shift',
  createDescription: 'Put an active volunteer on a checkpoint for a time window.',
  editDescription: 'The volunteer cannot be changed — cancel the shift and schedule a new one instead.',
  volunteerLabel: 'Volunteer',
  volunteerPlaceholder: 'Choose a volunteer',
  noVolunteers: 'This fest has no active volunteers yet — add them under Staff assignments first.',
  checkpointLabel: 'Checkpoint',
  checkpointPlaceholder: 'Choose a checkpoint',
  noCheckpoints: 'This fest has no checkpoints yet.',
  startsAtLabel: 'Starts at',
  endsAtLabel: 'Ends at',
  windowHelp: 'The shift must end after it starts. Overlapping shifts are allowed.',
  submitCreate: 'Schedule shift',
  submitEdit: 'Save changes',
  discardEdit: 'Discard changes',
  createSucceeded: 'Shift scheduled.',
  editSucceeded: 'Shift updated.',

  // Cancel
  cancelModalTitle: 'Cancel this shift?',
  cancelModalBody:
    'The volunteer will no longer be authorized to scan at this checkpoint during the window. This cannot be undone.',
  cancelReasonLabel: 'Reason (optional)',
  cancelReasonPlaceholder: 'Why this shift is being cancelled',
  cancelConfirm: 'Cancel shift',
  cancelKeep: 'Keep shift',

  // Volunteers roster
  volunteersHeading: 'Active volunteers',
  volunteersEmpty: 'No active volunteers in this fest.',
  volunteerColumnName: 'Name',
  volunteerColumnEmail: 'Email',
  volunteerColumnCollege: 'College',

  loadError: 'Could not load shifts. Try again.',
  volunteerRequired: 'Choose a volunteer.',
  checkpointRequired: 'Choose a checkpoint.',
  windowRequired: 'Set both the start and end time.',
};

// Create Fest. Every field here is one POST /fests accepts; visibility `value`s
// mirror FEST_VISIBILITIES exactly.
export const ADMIN_CREATE_FEST_COPY = {
  pageTitle: 'Create Fest',
  intro: 'A fest is created as a draft. Publish it once its events are ready.',

  collegeLabel: 'Host college',
  collegePlaceholder: 'Choose a college',
  collegeHelper: 'Only the colleges you administer can host a fest.',
  noColleges: 'You do not administer any college yet.',

  nameLabel: 'Fest name',
  namePlaceholder: 'e.g. Alliance ONE 2026',
  descriptionLabel: 'Description',
  bannerLabel: 'Banner image',
  descriptionPlaceholder: 'What the fest is about (optional).',
  contactEmailLabel: 'Contact email',
  contactEmailPlaceholder: 'fest@college.edu',
  contactPhoneLabel: 'Contact number',
  contactPhonePlaceholder: '10-digit mobile number',

  startsOnLabel: 'Starts on',
  endsOnLabel: 'Ends on',

  visibilityLabel: 'Visibility',
  visibilityHelper: 'Who can discover and register for this fest.',
  visibilityOptions: [
    { value: 'public', label: 'Public — anyone can find and register' },
    { value: 'intraCollege', label: 'Intra-college — only the host college’s students' },
  ],
  // interCollege is omitted on purpose: the model requires a non-empty
  // allowed-colleges list, and that picker does not exist yet.
  interCollegeNote: 'Inter-college fests need an allowed-colleges list — coming soon.',

  offersFoodLabel: 'Offers food',
  offersFoodDescription: 'Registration will collect a food preference.',
  offersAccommodationLabel: 'Offers accommodation',
  offersAccommodationDescription: 'Registration will collect an accommodation preference.',

  cancel: 'Cancel',
  submit: 'Create Fest',

  errors: {
    collegeRequired: 'Choose the host college.',
    nameRequired: 'Fest name is required.',
    datesRequired: 'Start and end dates are required.',
    endBeforeStart: 'The end date must be on or after the start date.',
    contactPhoneInvalid: 'Enter a 10-digit mobile number.',
    visibilityRequired: 'Choose a visibility.',
    submitFailed: 'Could not create the fest. Check the fields and try again.',
    collegesLoadFailed: 'Could not load your colleges. Try again.',
  },
};

export const ADMIN_EDIT_FEST_COPY = {
  pageTitle: 'Edit Fest',
  // Independent-event wrapper (solo container) surface.
  soloContainerNote:
    'This fest is the invisible wrapper of an independent event. Participants never see it as a fest. Convert it to a full fest to rename it and add more events — this cannot be undone.',
  convertToFullFest: 'Convert to full fest',
  convertFailed: 'Could not convert this fest. Try again.',
  intro: 'Only the changed fields are saved. Lifecycle (publish / archive) lives in Event Access.',

  nameLabel: 'Fest name',
  descriptionLabel: 'Description',
  bannerLabel: 'Banner image',
  descriptionPlaceholder: 'What the fest is about (optional).',
  contactEmailLabel: 'Contact email',
  contactEmailPlaceholder: 'fest@college.edu',
  contactPhoneLabel: 'Contact number',
  contactPhonePlaceholder: '10-digit mobile number',

  startsOnLabel: 'Starts on',
  endsOnLabel: 'Ends on',

  visibilityLabel: 'Visibility',
  visibilityOptions: [
    { value: 'public', label: 'Public — anyone can find and register' },
    { value: 'intraCollege', label: 'Intra-college — only the host college’s students' },
  ],
  // Shown only while the fest already IS interCollege — picking the allowed
  // colleges is future work, so the option exists to keep, not to enter.
  interCollegeOption: { value: 'interCollege', label: 'Inter-college — allowed colleges only (current)' },
  interCollegeNote:
    'Switching away from inter-college clears the allowed-colleges list. The allowed-colleges picker is coming soon.',

  offersFoodLabel: 'Offers food',
  offersFoodDescription: 'Registration will collect a food preference.',
  offersAccommodationLabel: 'Offers accommodation',
  offersAccommodationDescription: 'Registration will collect an accommodation preference.',

  cancel: 'Cancel',
  submit: 'Save changes',
  noChanges: 'Nothing has changed yet.',

  errors: {
    nameRequired: 'Fest name is required.',
    datesRequired: 'Start and end dates are required.',
    endBeforeStart: 'The end date must be on or after the start date.',
    loadFailed: 'Could not load this fest. It may not exist or you may not administer it.',
    submitFailed: 'Could not save the changes. Check the fields and try again.',
  },
};

export const ADMIN_COLLEGE_VERIFICATION_COPY = {
  columnAddress: 'Address',
  addressMissing: 'No address on file',
  downloadCsv: 'Download CSV',
  pageTitle: 'College verification',
  intro: 'Every registered college, pending first. Verifying a college makes it selectable by participants.',

  columnCollege: 'College',
  columnCity: 'City',
  columnStatus: 'Status',
  columnRegisteredBy: 'Registered by',
  columnActions: 'Actions',

  verifiedBadge: 'VERIFIED',
  pendingBadge: 'PENDING',
  verifyAction: 'Verify',
  unverifyAction: 'Un-verify',

  empty: 'No colleges registered yet.',
  loadFailed: 'Could not load the colleges. Try again.',
  actionFailed: 'Could not update the verification state. Try again.',
  unknownUser: '—',
};

// /admin/college-applications — the platform owner's queue of colleges applying
// to join the platform. Approve creates the college, an administrator account,
// and emails the applicant; reject requires a written reason (min 10 chars).
export const ADMIN_COLLEGE_APPLICATIONS_COPY = {
  pageTitle: 'College applications',
  intro: 'Colleges applying to run their fests on the platform, newest first.',

  filterPending: 'Pending',
  filterUnderReview: 'Under review',
  filterApproved: 'Approved',
  filterRejected: 'Rejected',
  filterAll: 'All',

  columnCollege: 'College',
  columnApplicant: 'Applicant',
  columnSubmitted: 'Submitted',
  columnStatus: 'Status',
  columnActions: 'Actions',
  reviewAction: 'Review',
  copyEmailAction: 'Copy email',
  copyEmailCopied: 'Copied',

  statusLabels: {
    pending: 'PENDING',
    underReview: 'UNDER REVIEW',
    approved: 'APPROVED',
    rejected: 'REJECTED',
  },

  directoryEntryTag: 'Directory entry',
  directoryMatchNote:
    'Matches an existing directory college — approval activates it instead of creating a new record.',

  empty: 'No applications yet.',
  loadFailed: 'Could not load the applications. Try again.',

  // Detail screen
  backToQueue: 'Back to applications',
  detailLoadFailed: 'Could not load this application. It may not exist.',
  collegeHeading: 'College',
  applicantHeading: 'Applicant',
  notesHeading: 'Notes from applicant',
  noNotes: 'No notes provided.',
  documentsHeading: 'Documents',
  noDocuments: 'No documents provided.',
  documentLinkLabel: (index) => `Document ${index}`,

  fieldCollegeName: 'Name',
  fieldCollegeAddress: 'Address',
  fieldCollegeCity: 'City',
  fieldCollegeState: 'State',
  fieldCollegeWebsite: 'Website',
  fieldExpectedFestSize: 'Expected fest size',
  fieldApplicantName: 'Full name',
  fieldApplicantEmail: 'Email',
  fieldApplicantPhone: 'Phone',
  fieldApplicantRole: 'Role at college',
  notProvided: '—',

  timelineHeading: 'Status',
  timelineSubmitted: 'Submitted',
  timelineUnderReview: 'Under review',
  timelineApproved: 'Approved',
  timelineRejected: 'Rejected',
  reviewedByLabel: 'Reviewed by',
  rejectionReasonLabel: 'Rejection reason',

  approveAction: 'Approve application',
  approveModalTitle: 'Approve this application?',
  approveModalBody:
    'Approving creates the college, an administrator account for the applicant, and emails them their access. This cannot be undone from here.',
  approveConfirm: 'Approve',

  rejectAction: 'Reject application',
  rejectModalTitle: 'Reject this application?',
  rejectModalBody: 'The applicant will be notified. Explain why so they know what to fix.',
  rejectReasonLabel: 'Reason',
  rejectReasonPlaceholder: 'e.g. We could not verify the college against official records.',
  rejectReasonHelp: 'At least 10 characters. This is shared with the applicant.',
  rejectConfirm: 'Reject',

  cancel: 'Cancel',
  actionFailed: 'Could not update this application. Try again.',
};

export const ADMIN_CERTIFICATES_COPY = {
  title: 'Certificates',
  templatesTitle: 'Certificate templates',
  issueTitle: 'Issue certificates',
};

// /admin/system/certificates — fest-wide certificate generation and release.
// Wording mirrors the backend exactly: generate is idempotent (skips existing),
// release is one-shot per fest (409 CERTIFICATES_ALREADY_RELEASED afterwards).
export const ADMIN_CERTIFICATE_OPERATIONS_COPY = {
  pageTitle: 'Certificates',
  festLabel: 'Fest',
  festPlaceholder: 'Choose a fest',
  noFests: 'You have no fests yet.',
  selectPrompt: 'Choose a fest to manage its certificates.',
  loadError: 'Could not load your fests. Refresh to try again.',

  explainerHeading: 'How certificates work',
  generateExplainer:
    'Generate creates every certificate the fest owes — participation, winners, and staff — as pending records. It is safe to run again: anyone who already has their certificate is skipped.',
  releaseExplainer:
    'Release is the closing-ceremony action: it flips every pending certificate to released so holders can see and download them. A fest’s certificates can be released only once.',

  generateHeading: 'Generate certificates',
  generateButton: 'Generate certificates',
  generateModalTitle: 'Generate certificates for this fest?',
  generateModalBody:
    'This creates pending certificates for every participant, winner, and staff member who does not have one yet. Running it again later only adds the missing ones.',
  generateResult: (generatedCount, skippedCount) =>
    `Generated ${generatedCount} new certificate${generatedCount === 1 ? '' : 's'}; ${skippedCount} already existed and were skipped.`,

  releaseHeading: 'Release certificates',
  releaseButton: 'Release certificates',
  releaseModalTitle: 'Release this fest’s certificates?',
  releaseModalBody:
    'Every pending certificate becomes visible and downloadable to its holder. This can only be done once per fest and cannot be undone.',
  releaseResult: (releasedCount) =>
    `Released ${releasedCount} certificate${releasedCount === 1 ? '' : 's'}.`,
  alreadyReleasedNote: (formattedDate) =>
    `This fest’s certificates were released on ${formattedDate}. Generate can still add missing certificates, but they will need a released fest state to appear — contact support if new certificates stay pending.`,

  confirm: 'Confirm',
  cancel: 'Cancel',
  actionFailed: 'The action failed. Try again.',
};

// /admin/events/scoring — initialize, edit, finalize, and award scores for
// non-bracket events. Bracket events score through the match system and are
// deliberately excluded here.
// The Certificates section on Scoring & Results (replaces the standalone module).
export const ADMIN_SCORING_CERTIFICATES_COPY = {
  heading: 'Certificates',
  intro: 'Import your certificate document, choose the participants, and push.',

  templateHeading: 'Certificate template',
  /*
   * Simplified spec: the uploaded document IS the certificate — signatures and
   * decoration baked into the artwork. The system overlays only the holder
   * name, event, date, verification code and QR. Still PNG/JPEG only (pdfkit's
   * constraint) — deliberately not a PDF, DOCX or PPTX import; the copy says so
   * because that is the first thing an organiser will try.
   */
  templateIntro:
    'One full-page image (PNG or JPEG — not a PDF, DOCX or PPTX) that IS the certificate, signatures included. The system overlays only the holder’s name, event, date, verification code (bottom-left) and QR (bottom-right) at fixed positions. A4 landscape: at least 1754 × 1240 px.',
  documentLabel: 'Certificate template',
  templateSaved: 'Template saved.',
  templateSaveFailed: 'Could not save the template. Try again.',
  previewButton: 'Preview certificate',
  previewFailed: 'Could not build the preview. Try again.',

  // Recipient-type filter: participants, or the fest's staff.
  recipientTypeLabel: 'Send to',
  recipientTypeOptions: [
    { value: 'participant', label: 'Participants' },
    { value: 'coordinator', label: 'Coordinators' },
    { value: 'volunteer', label: 'Volunteers' },
  ],
  pendingStaffName: 'Invitation pending',
  /*
   * The recipient list's heading and empty state follow the "Send to" selector,
   * so switching to Coordinators no longer leaves the list labelled
   * "Participants". Keyed by the same values the selector uses.
   */
  recipientHeadingByType: {
    participant: 'Participants',
    coordinator: 'Coordinators',
    volunteer: 'Volunteers',
  },
  recipientEmptyByType: {
    participant: 'No confirmed participants in this scope yet.',
    coordinator: 'No active coordinators on this fest yet.',
    volunteer: 'No active volunteers on this fest yet.',
  },
  participantsHeading: 'Participants',
  participantsEmpty: 'No confirmed participants in this scope yet.',
  selectAll: 'Select all',
  selectedCount: (selectedCount, totalCount) => `${selectedCount} of ${totalCount} selected`,
  pushButton: 'Push certificates',
  pushModalTitle: 'Push certificates?',
  pushModalBody: (selectedCount) =>
    `Certificates go to the ${selectedCount} selected participant${selectedCount === 1 ? '' : 's'} and become visible to them immediately. This is not reversible from the console, and changing the template afterwards does NOT re-render certificates already issued.`,
  confirm: 'Confirm',
  cancel: 'Cancel',
  pushResult: (generatedCount, releasedCount) =>
    `Pushed: ${generatedCount} generated, ${releasedCount} released and visible to their holders.`,
  actionFailed: 'The push did not complete. Try again.',
  loadFailed: 'Could not load the certificate settings. Try again.',
};

export const ADMIN_SCORING_COPY = {
  pageTitle: 'Scoring & Results',
  viewResultsBoardLink: 'View in Results Board',
  festLabel: 'Fest',
  festPlaceholder: 'Choose a fest',
  noFests: 'You have no fests yet.',
  eventLabel: 'Event',
  eventPlaceholder: 'Choose an event',
  noScorableEvents:
    'This fest has no score-based events. Bracket events are scored through the match system, not here.',
  selectPrompt: 'Choose a fest and an event to manage its scores.',
  loadError: 'Could not load your fests. Refresh to try again.',
  bracketNote:
    'Bracket (single-elimination) events are excluded: they are scored per match, and their results are awarded from the finalized bracket final.',

  initializeHeading: 'Score rows',
  initializeExplainer:
    'Initialize creates one score row at zero for every confirmed registration. It is safe to re-run: existing rows are skipped, never reset.',
  initializeButton: 'Initialize scores',
  initializeModalTitle: 'Initialize scores for this event?',
  initializeModalBody:
    'One score row is created at zero for each confirmed registration that does not have one yet. Existing rows are left untouched.',
  initializeResult: (createdCount, skippedCount) =>
    `Created ${createdCount} score row${createdCount === 1 ? '' : 's'}; ${skippedCount} already existed.`,

  tableHeading: 'Scores',
  columnParticipant: 'Participant / team',
  columnIdentifier: 'ID',
  columnScore: 'Score',
  columnState: 'State',
  columnAction: '',
  saveButton: 'Save',
  savedFlash: 'Saved',
  notInitialized: 'Not initialized',
  finalizedPill: 'Finalized',
  openPill: 'Open',
  noParticipants: 'No confirmed registrations for this event yet.',
  invalidScore: 'Enter a number.',
  conflictHint:
    'Someone else updated this score while you were editing. The latest value has been reloaded — check it and save again.',

  finalizeHeading: 'Finalize',
  finalizeExplainer:
    'Finalizing locks every score for the event. After this, only an administrator can correct a score.',
  finalizeButton: 'Finalize scores',
  finalizeModalTitle: 'Finalize all scores for this event?',
  finalizeModalBody:
    'Every score row is locked. Coordinators can no longer edit them; administrators can still make corrections.',
  finalizeResult: (finalizedCount) =>
    `Finalized ${finalizedCount} score row${finalizedCount === 1 ? '' : 's'}.`,

  awardHeading: 'Award results',
  awardExplainer:
    'Awards 1st, 2nd, and 3rd place achievements from the finalized leaderboard to the top three. Safe to re-run: already-awarded placements are skipped. Requires finalized scores.',
  awardButton: 'Award results',
  awardModalTitle: 'Award results for this event?',
  awardModalBody:
    'The top three of the finalized leaderboard receive placement achievements on their profiles. Re-running never duplicates an award.',
  awardResult: (awardedCount) =>
    awardedCount === 0
      ? 'No new achievements — all placements were already awarded.'
      : `Awarded ${awardedCount} placement achievement${awardedCount === 1 ? '' : 's'}.`,

  leaderboardHeading: 'Leaderboard',
  leaderboardEmpty:
    'The leaderboard is empty — either no scores exist yet or the leaderboard is hidden for this event.',
  columnRank: 'Rank',
  columnName: 'Name',

  confirm: 'Confirm',
  cancel: 'Cancel',
  actionFailed: 'The action failed. Try again.',
};

// /admin/system/data-controls — analytics, exports, hygiene, configuration.
export const ADMIN_DATA_CONTROLS_COPY = {
  pageTitle: 'Data Control & Configuration',
  festLabel: 'Fest',
  festPlaceholder: 'Choose a fest',
  noFestsTitle: 'Data Control needs a fest',
  noFestsBody: 'Create one from Overview, then come back here for its analytics and exports.',
  loadError: 'Could not load this section. Try again.',
  retry: 'Retry',

  tabAnalytics: 'Analytics',
  tabExports: 'Exports',
  tabHygiene: 'Hygiene',
  tabConfiguration: 'Configuration',
  tabPlatform: 'Platform',

  // Analytics
  analyticsEventFilterLabel: 'Event',
  analyticsEventFilterAll: 'All events',
  kpiConfirmed: 'Confirmed registrations',
  kpiRevenue: 'Gross revenue',
  kpiAttendance: 'Attendance rate',
  kpiOffersClaimed: 'Offers claimed',
  pairOf: (numerator, denominator, noun) => `${numerator} of ${denominator} ${noun}`,
  registrationsPerDayHeading: 'Registrations per day (last 90 days + fest window)',
  revenuePerDayHeading: 'Revenue per day',
  chartEmpty: 'Nothing in this window yet.',
  perEventHeading: 'Per-event breakdown',
  columnEvent: 'Event',
  columnConfirmed: 'Confirmed',
  columnCapacity: 'Capacity',
  columnFillRate: 'Fill rate',
  columnGrossRevenue: 'Gross revenue',
  demographicsHeading: 'Demographics',
  demographicsTotalPrefix: 'Of',
  demographicsTotalSuffix: 'distinct confirmed participants:',
  demographicByCollege: 'By college',
  demographicByDepartment: 'By department (top 10)',
  demographicByYear: 'By year of study',
  demographicByGender: 'By gender (registration category)',
  unspecifiedBucket: 'Unspecified',
  offersHeading: 'Offer redemption',
  columnOffer: 'Offer',
  columnSelected: 'Selected',
  columnClaimed: 'Claimed',
  columnRedemption: 'Redemption',
  teamsHeading: 'Teams',
  teamsForming: 'Forming',
  teamsLocked: 'Locked',
  teamsCancelled: 'Disqualified',
  teamsAverageSize: 'Avg size (locked)',
  teamsAtMinimum: 'Locked exactly at minimum',

  // Exports
  exportsNotice: 'Every export is logged. You are responsible for the data you download.',
  exportGroupParticipant: 'Participant data',
  exportGroupFinancial: 'Financial',
  exportGroupOperations: 'Operations',
  exportGroupCompliance: 'Compliance',
  exportRegistrations: 'Registrations CSV',
  exportPayments: 'Payments CSV',
  exportScans: 'Scans CSV',
  exportStaff: 'All staff (CSV)',
  exportStaffFiltered: 'Filtered staff (CSV) — choose roles, statuses and events on the Staff Assignments screen.',
  exportCertificates: 'Certificates CSV',
  exportFeedback: 'Feedback CSV',
  exportAuditLog: 'Audit log CSV',
  exportRowCount: (count) => `${count.toLocaleString('en-IN')} row${count === 1 ? '' : 's'}`,
  exportEmpty: 'Nothing to export',
  exportFailed: 'The export could not be downloaded. Try again.',

  // Hygiene
  hygieneIntro: 'Data-integrity checks — how problems the numbers hide get found.',
  hygieneClean: 'CLEAN',
  hygieneIssues: (count) => `${count}`,
  hygieneViewSample: 'View sample ids',
  hygieneHideSample: 'Hide sample ids',
  hygieneNoActionsNote:
    'No fix buttons on purpose: every finding here is a symptom, and the correct fix is an operator decision.',

  // Configuration
  snapshotHeading: 'Fest data snapshot',
  snapshotBody:
    'Downloads every export for this fest, one file at a time, plus the fest metadata as JSON. (A single .zip needs an archive library the project deliberately does not carry yet.)',
  snapshotButton: 'Download complete fest snapshot',
  snapshotMetadataName: 'fest-metadata',
  retentionHeading: 'Retention',
  retentionBody:
    'Registrations retained indefinitely. Consent records retained indefinitely. Sign-in logs retained indefinitely. Retention deletion is not implemented — it pairs with the DPDP work that is blocked on the legal documents.',

  // Platform (platform admin only)
  platformKpiColleges: 'Colleges',
  platformKpiFests: 'Fests',
  platformKpiEvents: 'Published events',
  platformKpiConfirmed: 'Confirmed registrations (all time)',
  platformKpiRevenue: 'Gross revenue (all time)',
  platformRegistrationsHeading: 'Registrations per day (all fests, 90 days)',
  platformSignInsHeading: 'Sign-ins per day (30 days)',
  platformTopFests: 'Top fests by confirmed registrations',
  platformTopColleges: 'Top colleges by fests hosted',
  columnFest: 'Fest',
  columnCollege: 'College',
  columnFests: 'Fests',
};

export const ADMIN_SYSTEM_COPY = {
  dataControlsTitle: 'Data controls',
  configurationTitle: 'System configuration',
};

export const ADMIN_DRILL_DOWN_COPY = {
  cardYetToCheckIn: 'Yet to check in',
  cardYetToCheckInSubtitle: 'Registered, not yet scanned in',
  titleByKind: {
    registrations: 'Registrations',
    checkIns: 'Check-ins',
    checkOuts: 'Check-outs',
  },
  cardRegistrations: 'Total Registrations',
  cardCheckIns: 'Total Check-ins',
  cardCheckOuts: 'Total Check-outs',
  cardTapLabel: (kind) => `Open the ${kind} drill-down`,
  // Honest zero: event doors are configured in-only by default, so a bare "0"
  // would read as "everyone is still inside" rather than "not measured".
  checkOutsNotObserved: 'No check-out scanning at this fest (doors are in-only)',
  searchPlaceholder: 'Search events…',
  eventCountSuffix: {
    registrations: 'registered',
    checkIns: 'checked in',
    checkOuts: 'checked out',
  },
  backToEvents: 'All events',
  downloadCsv: 'Download CSV',
  emptyEvents: 'No events match that search.',
  emptyParticipants: 'Nobody in this list yet.',
  loadFailed: 'Could not load the drill-down. Try again.',
  firstScanColumn: 'First scan',
  participantColumn: 'Participant',
  collegeColumn: 'College',
  contactColumn: 'Contact',
};

export const ADMIN_OVERVIEW_COPY = {
  /*
   * Campus access. Three figures that are NOT the same number and are routinely
   * confused: people who arrived today, people still inside, and total crossings
   * (which counts the same person every time they come and go). Each subtitle
   * says which one it is, because "entries" on its own reads as all three.
   */
  campusEntriesLabel: 'Campus entries today',
  campusEntriesSubtitle: 'distinct people who checked in at the Main Gate',
  onCampusLabel: 'On campus now',
  onCampusSubtitle: 'checked in and not yet checked out',
  gateScansLabel: 'Gate scans today',
  gateScansSubtitle: 'every crossing, in and out',
  // KPI cards
  // Names its SCOPE so it cannot be read as a repeat of the per-fest table
  // column below it.
  registrationsLabel: 'Confirmed registrations (all fests)',
  // Shown under the zeroed KPI row before any fest is chosen.
  selectFestForStats: 'Select a fest to view statistics.',
  registrationsSubtitle: (festCount) =>
    `Across ${festCount} fest${festCount === 1 ? '' : 's'}`,
  registrationsEmpty: '—',
  activeFestsLabel: 'Active Fests',
  activeFestsSubtitle: 'Currently published',

  // Registration Trends chart
  trendsTitle: 'Registration Trends',
  trends7Day: '7D',
  trends30Day: '30D',
  // Per-day registration history needs a backend time-series the API does not yet
  // expose, so the chart shows this rather than inventing bars.
  trendsUnavailableTitle: 'Registration trends coming soon',
  trendsUnavailableBody:
    'Per-day registration history will appear here once the reporting endpoint lands.',
  trendsEmpty: 'No registrations yet',

  // Fests table
  festsTitle: 'Your Fests',
  createFestButton: '+ Create Fest',
  festsEmptyTitle: 'No fests yet',
  festsEmptyBody: 'Create your first fest to get started.',
  columnFestName: 'Fest',
  columnDates: 'Dates',
  columnEvents: 'Events',
  columnRegistrations: 'Registered / Capacity',
  columnOfferClaims: 'Offer claims',
  offerClaimsTitle: 'Claimed at the counter / booked at registration',
  offerClaimSummary: (offerName, claimedCount, bookedCount) =>
    `${offerName} ${claimedCount}/${bookedCount}`,
  columnActions: '',
  registrationsOfCapacity: (registered, capacity) =>
    capacity > 0 ? `${registered} / ${capacity}` : `${registered}`,

  // Row actions
  actionEdit: 'Edit',
  actionPublish: 'Publish',
  actionArchive: 'Archive',
  actionUnarchive: 'Unarchive',
  actionsLabel: 'Fest actions',
  /*
   * The SAME explanation the Event access modal gives. Two surfaces offer archive
   * (this row menu and the Event access lifecycle buttons), and an organiser must
   * not read two different accounts of what archiving does depending on where
   * they clicked it.
   */
  confirmArchive:
    'Archive this fest? The fest is hidden from participants. Existing registrations, passes, scans, and audit history are preserved and remain readable in Data Controls. This action is reversible via Unarchive.',
  deleteFestAction: 'Delete fest',
  deleteFestConfirm:
    'Delete this fest permanently? Only works if nobody ever registered for any of its events — otherwise cancel or archive it.',

  // Fest status pill labels
  statusDraft: 'DRAFT',
  statusPublished: 'PUBLISHED',
  statusArchived: 'ARCHIVED',

  loadError: 'Could not load the dashboard. Try again.',
  transitionFailed: 'That action could not be completed. Try again.',
};

export const ADMIN_ACTIVITY_COPY = {
  title: 'Recent Activity',
  viewAll: 'View All →',
  emptyTitle: 'No activity yet',
  emptyBody: 'Actions taken across your fests will show up here.',
  unknownActor: 'System',
  // Human labels for the audit actions the seed and the app actually produce.
  // An unlisted action falls back to a humanised form of its own string.
  actionLabels: {
    'fest.created': 'Fest created',
    'fest.updated': 'Fest updated',
    'fest.published': 'Fest published',
    'fest.archived': 'Fest archived',
    'fest.unarchived': 'Fest unarchived',
    'event.created': 'Event created',
    'event.updated': 'Event updated',
    'event.published': 'Event published',
    'event.cancelled': 'Event cancelled',
    'staff.assigned': 'Staff assigned',
    'staff.revoked': 'Staff revoked',
    'score.initialized': 'Scores initialized',
    'score.updated': 'Score updated',
    'score.finalized': 'Scores finalized',
    'achievement.eventResultAwarded': 'Event result awarded',
    'achievement.badgeAwarded': 'Badge awarded',
    'certificates.generated': 'Certificates generated',
    'certificates.released': 'Certificates released',
  },
};

// Create Event wizard. Option `value`s mirror the backend enums exactly
// (EVENT_CATEGORIES / EVENT_TYPES / EVENT_SCORING_FORMATS / FEE_TYPES /
// QUESTION_TYPES); only the labels are presentation.
export const ADMIN_CREATE_EVENT_COPY = {
  /*
   * Offers are configured at ONE level. An event under a fest inherits the
   * fest's; only an independent event configures its own. The notice names the
   * inherited offers rather than just saying "inherited" — an admin deciding
   * whether they need a Travel add-on has to be able to see there already is one.
   */
  inheritedOffersHeading: 'Add-ons',
  inheritedOffersIntro: (festName, offerNames) =>
    `This event inherits its add-ons from ${festName}: ${offerNames}. Participants see them on this event's registration form.`,
  inheritedOffersEmpty: (festName) =>
    `${festName} has no add-ons configured, so this event offers none. Add them on the fest to offer them here.`,
  pageTitle: 'Create Event',
  // Step 0 mode chooser.
  modeFestTitle: 'Under an existing fest',
  modeFestBody: 'The event belongs to one of your fests and appears on its page.',
  modeIndependentTitle: 'Independent event (no fest)',
  modeIndependentBody:
    'A standalone event — a one-day conference, a guest lecture. No fest needed.',
  independentBanner:
    'This event will be published on its own, not under a fest. Add-ons, staff, and scanning still work the same way.',
  cancel: 'Cancel',
  back: 'Back to Edit',
  next: 'Next Step',
  skipForNow: 'Skip for now',
  saveDraft: 'Save as Draft',
  publish: 'Publish Event',
  creating: 'Creating…',

  steps: [
    { id: 'setup', label: 'Event Setup' },
    { id: 'assignments', label: 'Staff' },
    { id: 'review', label: 'Review' },
  ],

  // Staff step — assigns via POST /fests/:festId/staff/assign after the event
  // is created. Wording makes the pending-invite behaviour explicit: an unknown
  // email does not fail, it creates a pending user who inherits the role.
  staffHeading: 'Staff',
  staffIntro: 'Add coordinators and volunteers for this event. You can also do this later from Assign staff.',
  staffPendingInviteNote:
    'An email address without a Dedal account gets a pending invite — the assignment activates when they sign in. It does not fail.',
  staffEmailLabel: 'Email address',
  staffEmailPlaceholder: 'person@college.edu',
  staffRoleLabel: 'Role',
  staffRoleOptions: [
    { value: 'coordinator', label: 'Coordinator' },
    { value: 'volunteer', label: 'Volunteer' },
  ],
  addStaffRow: 'Add another person',
  removeStaffRow: 'Remove',

  // Bulk add — one textarea, commas or newlines, any number of addresses.
  staffBulkLabel: 'Email addresses',
  staffBulkPlaceholder: 'one@college.edu, two@college.edu\nthree@college.edu',
  staffBulkHelper: 'Separate addresses with commas or new lines. Paste as many as you like.',
  staffContactLabel: 'Contact number (optional)',
  staffContactPlaceholder: 'Used for this role only — blank uses their own number',
  staffAddButton: 'ADD STAFF',
  staffQueuedHeading: 'Staff to add',
  staffQueuedEmpty: 'No staff added yet. This step is optional.',
  staffQueuedPending: 'Pending',
  staffAccessNote:
    'Coordinators get console access from 2 days before the event. Volunteers are put on a shift automatically, opening 3 hours before the event starts and closing when it ends.',
  staffNoValidEmails: 'No valid email addresses found in that list.',

  // Publish / draft, offered from the staff step as well as the review step.
  publishNow: 'Publish Now',
  publishingNow: 'Publishing…',
  successPublishedHeading: 'Event published',
  successPublishedBody: 'The event is live and open to participants.',
  successDraftHeading: 'Event saved as draft',
  successDraftBody:
    'Event saved as draft. You can publish it later from the event access page.',
  goToEventAccess: 'Go to event access',
  createAnother: 'Create another event',

  // Duration — the model has no durationDays field.
  durationLabel: 'Duration',
  durationHelper: 'Calculated from the start and end times above.',
  durationUnset: 'Set a date, start time and end time to see the duration.',
  soloTeamSizeNote: 'A solo event has no team sizes — each participant registers alone.',
  staffSelfError: 'You cannot assign yourself — you already administer this fest.',
  staffInvalidEmailError: 'Enter a valid email address.',
  staffDuplicateError: 'This email is already listed above.',

  // Post-create assignment report. The event is NEVER rolled back on a failed
  // assignment — the report says what happened per row.
  assignmentReportHeading: 'Event created — staff assignment results',
  assignmentReportBody:
    'The event was created and saved. Some staff assignments did not go through — fix or retry them below. Nothing you created has been lost.',
  assignmentRowSucceeded: 'Assigned',
  assignmentRowFailed: 'Failed',
  retryFailedAssignments: 'Retry failed assignments',
  finishWithoutRetry: 'Finish without these assignments',
  assignmentErrors: {
    CANNOT_ASSIGN_SELF: 'You cannot assign yourself.',
    ASSIGNMENT_ALREADY_EXISTS: 'This person already holds this role here.',
    PERMISSION_DENIED: 'You do not have authority to assign staff on this fest.',
    fallback: 'The assignment could not be created. Try again.',
  },

  // Fest selector
  festLabel: 'Fest',
  festPlaceholder: 'Choose a fest',
  festHelper: 'The event is created under this fest.',
  noFests: 'You have no fests yet. Create a fest before adding events.',

  // Section headers
  identityHeading: 'Event identity',
  scheduleHeading: 'Schedule',
  locationHeading: 'Location',
  capacityHeading: 'Capacity & pricing',
  additionalHeading: 'Additional details',
  parentHeading: 'Parent event',
  questionsHeading: 'Custom questions',
  // FAQs replace participant-answered custom questions: the organiser writes
  // both halves and the participant only reads them.
  faqsHeading: 'Frequently asked questions',
  faqsIntro: 'Add common questions and answers to help participants before they register.',
  noFaqs: 'No FAQs yet.',
  addFaq: 'Add FAQ',
  removeFaq: 'Remove this FAQ',
  faqEntryLabel: (position) => `FAQ ${position}`,
  faqQuestionLabel: 'Question',
  faqQuestionPlaceholder: 'e.g. Can we use a laptop during the competition?',
  faqAnswerLabel: 'Answer',
  faqAnswerPlaceholder: 'e.g. Yes, with prior permission from the coordinator.',

  // Identity
  nameLabel: 'Event name',
  namePlaceholder: 'e.g. Moot Court Competition',
  descriptionLabel: 'Description',
  descriptionPlaceholder: 'What is this event about?',
  categoryLabel: 'Category',
  categoryPlaceholder: 'Type or pick a category',
  typeLabel: 'Event type',
  minTeamLabel: 'Min team size',
  maxTeamLabel: 'Max team size',
  scoringLabel: 'Scoring format',

  /*
   * categoryOptions is gone. It was a hand-maintained copy of the backend enum
   * that had already drifted (it was missing management/arts/commerce), and the
   * field it fed is no longer a dropdown at all: AdminCategorySelect reads the
   * shared suggestion list in brand/brand-copy.js and accepts anything typed.
   * One list, one source, nothing to drift.
   */
  categoryHelperText: 'Pick a suggestion or type your own — anything up to 50 characters.',
  categoryUsingTyped: 'USING WHAT YOU TYPED',
  typeOptions: [
    { value: 'solo', label: 'Solo' },
    { value: 'team', label: 'Team' },
  ],
  scoringOptions: [
    { value: 'none', label: 'None' },
    { value: 'bracketSingleElimination', label: 'Knockout bracket' },
    { value: 'scoreBased', label: 'Score based' },
    { value: 'timeTrial', label: 'Time trial' },
    { value: 'judged', label: 'Judged' },
  ],

  // Schedule
  eventDateLabel: 'Event date',
  startTimeLabel: 'Start time',
  endTimeLabel: 'End time',
  regOpensLabel: 'Registration opens',
  regClosesLabel: 'Registration closes',
  // Registration has no closing clock — Event Access owns that decision.
  regStaysOpenNote: 'Registration will remain open until you close it from Event Access.',
  regStaysOpenReview: 'Open until closed manually',

  // Location
  locationTypeLabel: 'Location type',
  locationTypeOptions: [
    { value: 'physical', label: 'Physical' },
    { value: 'virtual', label: 'Virtual' },
  ],
  venueLabel: 'Venue',
  venuePlaceholder: 'e.g. Block B, Lab 7',
  meetingLinkLabel: 'Meeting link',
  meetingLinkPlaceholder: 'e.g. https://meet.example.com/moot-court',
  // The backend stores one `venue` field; a virtual link is saved into it.
  virtualNote: 'The link is saved to the event’s venue field.',

  // Capacity & pricing
  capacityLabel: 'Capacity',
  capacityPlaceholder: 'Leave empty for unlimited',
  capacityHelper: 'Maximum registrations. Empty means unlimited.',
  waitlistLabel: 'Waitlist when full',
  waitlistOptions: [
    { value: 'off', label: 'Off' },
    { value: 'on', label: 'On' },
  ],
  feeTypeLabel: 'Fee',
  feeOptions: [
    { value: 'free', label: 'Free' },
    { value: 'paid', label: 'Paid' },
  ],
  feeAmountLabel: 'Fee amount (₹)',
  feeAmountPlaceholder: 'e.g. 250',
  feeStructureLabel: 'Fee structure',
  feeStructureOptions: [
    { value: 'perTeam', label: 'Per team' },
    { value: 'perPerson', label: 'Per person' },
  ],

  // The uploader's own strings live in ADMIN_UPLOAD_COPY (it is shared with the
  // fest banner); only the field label stays here.
  posterLabel: 'Poster image',
  rulesLabel: 'Rules',
  rulesPlaceholder: 'Rules and eligibility (optional)',
  prizeLabel: 'Prize pool description',
  prizePlaceholder: 'e.g. ₹50,000 prize pool',
  medicalLabel: 'Requires medical declaration',
  medicalDescription: 'Participants must accept a liability declaration before registering.',
  weightLabel: 'Weight categories',
  genderLabel: 'Gender categories',
  ageLabel: 'Age categories',
  commaSeparatedHint: 'Comma-separated (optional)',

  // Parent event (collapsible)
  nestLabel: 'Nest under another event',
  nestDescription: 'Group this event beneath a parent event in the fest.',
  parentSelectLabel: 'Parent event',
  parentPlaceholder: 'Choose a parent event',
  parentHelper: 'Any event in the fest can be a parent — the backend does not restrict by depth.',
  parentPreviewLabel: 'Nesting under',

  // Custom questions (collapsible)
  addQuestion: '+ Add custom question',
  questionTextLabel: 'Question',
  questionTextPlaceholder: 'e.g. What is your t-shirt size?',
  questionTypeLabel: 'Answer type',
  questionRequiredLabel: 'Required',
  /*
   * Labels say what the PARTICIPANT gets to type, not what the field is called
   * in the schema — "Long answer" is the free-hand box, and it is the default a
   * new question starts on. The values are the backend QUESTION_TYPES verbatim;
   * there is no freeText type and none is needed, longText already is one.
   */
  questionTypeOptions: [
    { value: 'longText', label: 'Long answer (free text)' },
    { value: 'shortText', label: 'Short answer (free text)' },
    { value: 'singleChoice', label: 'Multiple choice' },
    { value: 'yesNo', label: 'Yes / No' },
  ],
  questionTypeHelper:
    'Long answer and Short answer let the participant write anything. Multiple choice and Yes / No restrict them to the options you set.',
  optionLabel: 'Option',
  addOption: '+ Add option',
  removeOption: 'Remove option',
  removeQuestion: 'Remove question',
  saveQuestion: 'Add question',
  cancelQuestion: 'Cancel',
  noQuestions: 'No custom questions yet.',
  questionsSummary: (count) => `${count} custom question${count === 1 ? '' : 's'}`,

  // Assignments step
  assignmentsHeading: 'Assign coordinators',
  assignmentsBody:
    'Assign coordinators after creating the event. Staff assignments happen on the Event Access screen — this step is a placeholder for now.',

  // Review step
  reviewHeading: 'Review',
  reviewIntro: 'Check the details below, then save a draft or publish.',
  reviewEmpty: '—',
  reviewYes: 'Yes',
  reviewNo: 'No',
  reviewUnlimited: 'Unlimited',
  reviewFreeLabel: 'Free',

  // Validation messages (client-side, mirroring the backend field parsers/model)
  errors: {
    nameRequired: 'Event name is required.',
    descriptionRequired: 'Description is required.',
    festRequired: 'Choose a fest first.',
    venueRequired: 'Venue is required.',
    meetingLinkRequired: 'A meeting link is required for a virtual event.',
    datesRequired: 'Event date, start and end time are required.',
    endAfterStart: 'End time must be after the start time.',
    regRequired: 'Registration open and close times are required.',
    regOrder: 'Registration must close after it opens.',
    /* The ceiling moved from the event's start to its END when late (walk-up)
     * registration became allowed — the message must say what the rule now is. */
    regBeforeStart: 'Registration must close before the event ends.',
    teamSizes: 'For a team event, min must be at least 2 and max at least min.',
    feeAmount: 'A paid event needs a fee greater than ₹0.',
    capacityInvalid: 'Capacity must be a whole number of at least 1.',
    faqIncomplete: 'Fill in both the question and the answer, or remove the FAQ.',
    questionTextRequired: 'Every question needs text.',
    questionOptionsRequired: 'A single-choice question needs at least one option.',
    submitFailed: 'Could not create the event. Check the fields and try again.',
    publishFestFirst:
      'The event was saved as a draft. Publish the fest from Event Access, then press Publish again — this will not create a second event.',
  },

  successCreated: 'Event created.',
};

export const ADMIN_GLOBAL_COPY = {
  comingSoon: 'Coming soon',
  comingSoonBody: 'This screen is scaffolded and will be built in a later batch.',
  loading: 'Loading',
  retry: 'Retry',
  errorGeneric: 'Something went wrong. Try again.',
  mobileComingSoonHeadline: 'Admin works best on desktop',
  mobileComingSoonBody: 'Admin panel works best on desktop. Please open on a larger screen.',
};


/* Contingent bundles — admin console. */
export const ADMIN_CONTINGENT_COPY = {
  sectionHeading: 'Contingents',
  sectionHelp:
    'Bundle two or more published solo sub-events of this event at one price. Buyers name an attendee per sub-event; each attendee confirms on their own account.',
  addContingent: 'New contingent',
  editContingent: 'Edit',
  publishContingent: 'Publish',
  cancelContingent: 'Cancel contingent',
  listEmpty: 'No contingents yet for this event.',
  needTwoSubEvents: 'A contingent needs at least two published solo sub-events under this event.',
  statusLabels: { draft: 'Draft', published: 'Published', cancelled: 'Cancelled' },
  claimsSuffix: 'claims',

  editorTitleCreate: 'New contingent',
  editorTitleEdit: 'Edit contingent',
  nameLabel: 'Contingent name',
  namePlaceholder: 'e.g. Management Contingent',
  descriptionLabel: 'Description (optional)',
  parentLabel: 'Parent event',
  subEventsLabel: 'Included sub-events',
  subEventsHelp:
    'Published solo sub-events only. A sub-event already inside another published contingent of this parent cannot be added.',
  priceLabel: 'Bundle price (₹)',
  maximumBundleClaimsLabel: 'Maximum bundles sold (blank = limited by seat capacity)',
  individualTotalPrefix: 'Individually these cost',
  savingsPrefix: 'Buyers save',
  negativeDiscountWarning:
    'This price is HIGHER than the individual total. Tick to confirm it is intentional.',
  allowNegativeDiscountLabel: 'I intend to charge more than the individual total',
  frozenNotice:
    'This contingent has purchases: the included events and price are frozen. Only the name and description can change.',
  saveDraft: 'Save draft',
  saveChanges: 'Save changes',
  publishModalTitle: 'Publish contingent?',
  publishModalBody: (name) =>
    `"${name}" becomes visible and buyable on the parent event page. The included events and price freeze on first purchase.`,
  cancelModalTitle: 'Cancel contingent?',
  cancelModalBody: (name) =>
    `Every purchase of "${name}" is unwound: seats are released, buyers are emailed, and captured payments are marked refund-pending. Refunds are processed manually from the Razorpay dashboard. This cannot be undone.`,
  confirm: 'Confirm',
  keepEditing: 'Keep editing',
  saveFailed: 'The contingent could not be saved.',
  loadFailed: 'Contingents could not be loaded.',
  actionFailed: 'The action failed.',
  claimCountsHeading: 'Claims by status',
};

export default {
  ADMIN_AUTH_COPY,
  ADMIN_AUTHORIZATION_COPY,
  ADMIN_DASHBOARD_COPY,
  ADMIN_OVERVIEW_COPY,
  ADMIN_ACTIVITY_COPY,
  ADMIN_CREATE_EVENT_COPY,
  ADMIN_EVENTS_COPY,
  ADMIN_USERS_COPY,
  ADMIN_EVENT_ACCESS_COPY,
  ADMIN_CREATE_FEST_COPY,
  ADMIN_EDIT_FEST_COPY,
  ADMIN_COLLEGE_VERIFICATION_COPY,
  ADMIN_COLLEGE_APPLICATIONS_COPY,
  ADMIN_CERTIFICATES_COPY,
  ADMIN_CERTIFICATE_OPERATIONS_COPY,
  ADMIN_SCORING_COPY,
  ADMIN_SYSTEM_COPY,
  ADMIN_GLOBAL_COPY,
  ADMIN_CONTINGENT_COPY,
  ADMIN_SPONSORS_COPY,
};

/* Per-vertical contingent join codes (Phase 2). */
export const ADMIN_CONTINGENT_CODES_COPY = {
  tableTitle: 'Per-vertical join codes',
  columnVertical: 'Vertical',
  columnCode: 'Code',
  columnClaimed: 'Claimed',
  columnCapacity: 'Capacity',
  columnStatus: 'Status',
  statusActive: 'Active',
  statusFull: 'Full',
  copy: 'Copy',
  copied: 'Copied',
  copyCodeFor: (eventName) => `Copy the join code for ${eventName}`,
};

/* The contingent editor opened from a Main Event in the Event Structure tree. */
export const ADMIN_CONTINGENT_CONFIG_COPY = {
  title: (eventName) => `Contingent configuration — ${eventName}`,
  nameLabel: 'Contingent name',
  descriptionLabel: 'Contingent description',
  descriptionHelp: 'What the bundle offers. Separate from the main event\u2019s own description.',
  priceLabel: 'Contingent price (\u20b9)',
  priceHelp: 'The whole-bundle price. Independent of what each vertical charges individually.',
  verticalsLabel: 'Included verticals',
  verticalsHelp: 'Pick the sub-events this bundle covers. At least two.',
  noVerticals: 'This event has no sub-events to bundle yet.',

  // Fest-level bundle: a two-layer fest (fest → events) has no main event to
  // hang a contingent off, so the fest itself is the scope.
  festTitle: (festName) => `Contingent configuration — ${festName}`,
  festEventsLabel: 'Included events',
  festEventsHelp: 'Pick the top-level events this bundle covers. At least two.',
  noFestEvents: 'This fest has no top-level events to bundle yet.',
  teamEventNote: 'Team event — a contingent bundles solo events only.',
  needTwoEvents: 'A contingent bundles at least two events.',
  save: 'Save contingent',
  cancel: 'Cancel',
  nameRequired: 'Give the contingent a name.',
  priceInvalid: 'Enter a price of zero or more.',
  needTwoVerticals: 'A contingent bundles at least two verticals.',
  saveFailed: 'The contingent could not be saved.',
};

/*
 * The inline event editor on the Event Structure canvas. Essential fields only —
 * the full editor is one link away, and this exists so a rename does not cost a
 * page navigation and a fest re-pick.
 */
export const ADMIN_EVENT_EDIT_MODAL_COPY = {
  title: (eventName) => `Edit ${eventName}`,
  loading: 'Loading event details…',
  loadFailed: 'Could not load the full event details. The fields shown are still editable.',
  nameLabel: 'Event name',
  descriptionLabel: 'Description',
  categoryLabel: 'Category',
  categoryPlaceholder: 'Search or type a category',
  typeLabel: 'Event type',
  typeSolo: 'Solo',
  typeTeam: 'Team',
  typeLocked: 'The type is fixed once participants have registered.',
  minimumTeamSizeLabel: 'Minimum team size',
  maximumTeamSizeLabel: 'Maximum team size',
  venueLabel: 'Venue',
  capacityLabel: 'Capacity',
  capacityHelp: 'Leave blank for unlimited.',
  feeLabel: 'Fee (₹)',
  feeHelp: 'Zero makes the event free.',
  startsAtLabel: 'Starts at',
  endsAtLabel: 'Ends at',
  save: 'Save changes',
  cancel: 'Cancel',
  openFullEditor: 'Open full editor',
  nameRequired: 'Give the event a name.',
  feeInvalid: 'Enter a fee of zero or more.',
  saveFailed: 'The event could not be saved.',
};

/* Promotions phase 5 — promoters (who is being promoted). Platform admin only. */
export const ADMIN_PROMOTERS_COPY = {
  pageTitle: 'Promoters',
  intro:
    'Who is being promoted: a college, a fest organiser, or a sponsor. A promoter owns creatives (the artwork) and campaigns (when and where it runs).',
  createButton: 'Create promoter',
  loading: 'Loading promoters…',
  loadFailed: 'Could not load promoters. Try again.',
  offline: 'You are offline. Promoters could not be loaded.',
  retry: 'Retry',
  actionFailed: 'That could not be saved.',
  searchLabel: 'Search',
  searchPlaceholder: 'Name…',
  kindLabel: 'Kind',
  anyKind: 'Any kind',
  statusLabel: 'Status',
  anyStatus: 'Any status',
  columnName: 'Name',
  columnKind: 'Kind',
  columnStatus: 'Status',
  columnCreatives: 'Creatives',
  columnCampaigns: 'Campaigns',
  columnFlight: 'Flight',
  statusActive: 'Active',
  statusArchived: 'Archived',
  publishedSuffix: 'published',
  noMatches: 'No promoters match these filters.',
  emptyHeadline: 'No promoters yet',
  emptyBody:
    'A promoter is whoever a promotion is for — a sponsor, a college, or a fest organiser. Create one, then add its artwork as creatives and run campaigns against them.',
  showingRange: (start, end, total) => `Showing ${start}–${end} of ${total}`,
  prev: 'Previous',
  next: 'Next',
  rowActionsLabel: (name) => `Actions for ${name}`,
  openAction: 'Open',
  editAction: 'Edit',
  archiveAction: 'Archive',
  restoreAction: 'Restore',
  cancel: 'Cancel',
  createAction: 'Create promoter',
  saveAction: 'Save changes',
  createModalTitle: 'New promoter',
  editModalTitle: 'Edit promoter',
  nameLabel: 'Display name',
  nameRequired: 'Give the promoter a name.',
  contactNameLabel: 'Contact name',
  contactEmailLabel: 'Contact email',
  contactPhoneLabel: 'Contact phone',
  saveFailed: 'The promoter could not be saved.',
  // The duplicate-name refusal names the existing promoter and links to it.
  nameTakenBody: (name) => `A promoter called “${name}” already exists.`,
  nameTakenLink: 'Open the existing promoter',
  nameTakenArchivedNote: 'It is archived — restore it to use it.',
  archiveModalTitle: 'Archive this promoter?',
  archiveModalBody: (name) =>
    `${name} will be hidden from new campaigns. Its history stays. You can restore it later.`,
  // The published-campaigns refusal names each campaign to pause first.
  archiveRefusedBody:
    'This promoter has published campaigns. Pause or archive each of these first — archiving a promoter is not a way to stop delivery:',
  savedNotice: (name) => `${name} saved.`,
  archivedNotice: (name) => `${name} archived.`,
  restoredNotice: (name) => `${name} restored.`,
  backToList: 'Promoters',
  detailsHeading: 'Details',
  creativesHeading: 'Creatives',
  openLibrary: 'Open library',
  noCreativesYet: 'No creatives yet. Open the library to add artwork.',
  campaignsHeading: 'Campaigns',
  campaignsNote: 'Managed from the campaign console. Click a campaign name to open it.',
  noCampaignsYet: 'No campaigns yet.',
  flightState: { live: 'Live', upcoming: 'Upcoming', ended: 'Ended' },
};

/* Promotions phase 5 — creatives (the artwork), scoped to a promoter. */
export const ADMIN_CREATIVES_COPY = {
  pageTitle: 'Creative library',
  intro:
    'The artwork this promoter can run. A creative belongs to the promoter, not to a campaign, so the same artwork can run in more than one campaign. Attaching to a campaign happens in the campaign console.',
  createButton: 'Add creative',
  loading: 'Loading creatives…',
  loadFailed: 'Could not load creatives. Try again.',
  offline: 'You are offline. Creatives could not be loaded.',
  retry: 'Retry',
  actionFailed: 'That could not be saved.',
  backToPromoter: 'Promoter',
  mediaTypeLabel: 'Media',
  anyMedia: 'Any media',
  statusLabel: 'Status',
  anyStatus: 'Any status',
  inUseLabel: 'In use',
  anyUse: 'Used or not',
  statusArchived: 'Archived',
  videoBadge: 'Video',
  noArtwork: 'No artwork',
  usedIn: (count) => (count === 0 ? 'Not in any campaign' : `In ${count} ${count === 1 ? 'campaign' : 'campaigns'}`),
  noMatches: 'No creatives match these filters.',
  emptyHeadline: 'No creatives yet',
  emptyBody: 'Add the artwork this promoter will run: an image, or a video with a poster frame.',
  promoterArchivedNote: 'This promoter is archived. Restore it before adding creatives.',
  showingRange: (start, end, total) => `Showing ${start}–${end} of ${total}`,
  prev: 'Previous',
  next: 'Next',
  rowActionsLabel: (title) => `Actions for ${title}`,
  editAction: 'Edit',
  archiveAction: 'Archive',
  restoreAction: 'Restore',
  cancel: 'Cancel',
  createAction: 'Add creative',
  saveAction: 'Save changes',
  createModalTitle: 'New creative',
  editModalTitle: 'Edit creative',
  imageLabel: 'Artwork',
  imageHelp: 'JPG or PNG, up to 5 MB, at the carousel’s 16:9 ratio.',
  posterLabel: 'Poster frame',
  posterHelp: 'Shown before the video plays. JPG or PNG, up to 5 MB.',
  videoUrlLabel: 'Video URL',
  videoUrlHelp: 'A direct MP4 link, or a YouTube watch URL.',
  titleLabel: 'Title',
  titleRequired: 'Give the creative a title.',
  imageRequired: 'Upload the artwork first.',
  videoRequired: 'Enter the video URL.',
  linkUrlLabel: 'Link',
  linkUrlHelp: 'Optional. Where a tap goes. Leave empty for a display-only banner.',
  descriptionLabel: 'Description',
  saveFailed: 'The creative could not be saved.',
  archiveModalTitle: 'Archive this creative?',
  archiveModalBody: (title) => `${title} will no longer be available to campaigns. Its history stays. You can restore it later.`,
  archiveRefusedBody:
    'This creative is running in a published campaign. Detach it or pause each of these first:',
  savedNotice: (title) => `${title} saved.`,
  archivedNotice: (title) => `${title} archived.`,
  restoredNotice: (title) => `${title} restored.`,
  // Editing what a published campaign is serving.
  liveEditTitle: 'This creative is live right now',
  liveEditBody: (count) =>
    `Saving changes what participants see immediately in ${count} published ${count === 1 ? 'campaign' : 'campaigns'}, with no review step:`,
  liveEditConfirm: 'Save and change it live',
  liveEditBack: 'Back to editing',
  liveEditNote: 'The previous artwork is kept in the audit record, so a bad swap can be traced and put back.',
};

/* Promotions phase 5 — campaigns. The full lifecycle from draft to delivery. */
export const ADMIN_CAMPAIGNS_COPY = {
  pageTitle: 'Campaigns',
  intro:
    'A campaign runs a promoter’s creatives in one or more placements over a flight window. Draft it, attach artwork, then publish when ready.',
  createButton: 'Create campaign',
  loading: 'Loading campaigns…',
  loadFailed: 'Could not load campaigns. Try again.',
  offline: 'You are offline. Campaigns could not be loaded.',
  retry: 'Retry',
  actionFailed: 'That action could not be completed.',
  promoterLabel: 'Promoter',
  anyPromoter: 'Any promoter',
  statusLabel: 'Status',
  anyStatus: 'Any status',
  placementLabel: 'Placement',
  anyPlacement: 'Any placement',
  flightLabel: 'Flight',
  anyFlight: 'Any flight state',
  columnName: 'Name',
  columnPromoter: 'Promoter',
  columnStatus: 'Status',
  columnFlight: 'Flight',
  columnPlacements: 'Placements',
  columnDelivery: 'Delivery',
  noMatches: 'No campaigns match these filters.',
  emptyHeadline: 'No campaigns yet',
  emptyBody:
    'A campaign puts a promoter’s artwork in front of participants. Create one by choosing a promoter, setting a flight window, and attaching creatives.',
  showingRange: (start, end, total) => `Showing ${start}–${end} of ${total}`,
  prev: 'Previous',
  next: 'Next',
  rowActionsLabel: (name) => `Actions for ${name}`,
  openAction: 'Open',
  publishAction: 'Publish',
  pauseAction: 'Pause',
  resumeAction: 'Resume',
  archiveAction: 'Archive',
  deleteAction: 'Delete',
  cancel: 'Cancel',
  publishedNotice: (name) => `${name} is now live.`,
  pausedNotice: (name) => `${name} paused.`,
  resumedNotice: (name) => `${name} resumed.`,
  archivedNotice: (name) => `${name} archived.`,
  deletedNotice: (name) => `${name} deleted.`,
  deleteModalTitle: 'Delete this draft?',
  deleteModalBody: (name) => `${name} and its creative associations will be deleted permanently.`,
  flightState: { live: 'Live', upcoming: 'Upcoming', ended: 'Ended' },
  backToList: 'Campaigns',
  createTitle: 'New campaign',
  editTitle: 'Edit campaign',
  stepPromoter: 'Promoter & name',
  stepFlight: 'Flight',
  stepPlacements: 'Placements',
  stepDelivery: 'Delivery',
  stepCreatives: 'Creatives',
  stepTargeting: 'Targeting',
  nextStep: 'Continue',
  previousStep: 'Back',
  saveDraft: 'Save draft',
  saving: 'Saving…',
  saved: 'Draft saved.',
  promoterRequired: 'Choose a promoter.',
  campaignNameLabel: 'Campaign name',
  campaignNameRequired: 'Give the campaign a name.',
  campaignNamePlaceholder: 'e.g. Spring 2026 home page',
  flightStartLabel: 'Flight starts',
  flightEndLabel: 'Flight ends',
  flightStartRequired: 'Set a start date.',
  flightEndRequired: 'Set an end date.',
  flightEndBeforeStart: 'End must be after start.',
  placementsHeading: 'Where should this campaign appear?',
  placementsRequired: 'Choose at least one placement before publishing.',
  placementsNote: 'Each placement has a cap on how many published campaigns it holds.',
  tierLabel: 'Priority tier',
  tierNote: 'Premium campaigns are considered first, then standard, then house.',
  weightLabel: 'Weight',
  weightNote: 'Higher weight means more impressions relative to same-tier campaigns.',
  pacingLabel: 'Impression target',
  pacingPlaceholder: 'No cap',
  pacingNote: 'Leave empty for unlimited. The engine paces delivery evenly across the flight.',
  maxPerDayLabel: 'Max per person per day',
  maxPerDayPlaceholder: 'No daily cap',
  maxPerFlightLabel: 'Max per person per flight',
  maxPerFlightPlaceholder: 'No flight cap',
  capNote: 'Per-flight cap must be at least per-day cap.',
  capError: 'Per-flight cap is less than the per-day cap.',
  creativesHeading: 'Creative rotation',
  noCreativesAttached: 'No creatives attached yet.',
  creativesRequired: 'Attach at least one creative before publishing.',
  attachCreative: 'Attach creative',
  attachModalTitle: 'Attach a creative',
  noCreativesAvailable: 'This promoter has no active creatives. Add artwork in the promoter’s creative library first.',
  rotationWeightLabel: 'Weight',
  rotationShareLabel: 'Share',
  pauseAssociation: 'Pause',
  resumeAssociation: 'Resume',
  detachAction: 'Detach',
  lastActiveWarning: 'This is the only active creative on a published campaign.',
  creativePausedChip: 'Paused',
  targetingPlaceholder: 'Targeting is configured in the next phase. This campaign will run untargeted.',
  publishHeading: 'Ready to publish?',
  publishSummaryPromoter: 'Promoter',
  publishSummaryFlight: 'Flight',
  publishSummaryPlacements: 'Placements',
  publishSummaryCreatives: 'Creatives',
  publishSummaryTier: 'Priority',
  publishButton: 'Publish campaign',
  publishing: 'Publishing…',
  publishBlockedHeading: 'Cannot publish yet',
  publishBlockedNoPlacement: 'Add at least one placement.',
  publishBlockedNoCreative: 'Attach and activate at least one creative.',
  liveEditFieldRefused: (reason) => reason,
  liveEditFieldAudited: 'Changes to this field on a live campaign are recorded in the audit log.',
  liveEditFlightEndRefused: 'Cannot move earlier than now on a live campaign.',
  liveEditFlightStartRefused: 'Cannot change after the flight has started.',
  liveEditPromoterRefused: 'Cannot change once published.',
  saveFailed: 'The campaign could not be saved.',
  notPublishableBody: 'This campaign is not ready to publish:',
};

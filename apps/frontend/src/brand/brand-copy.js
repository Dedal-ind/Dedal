// brand-copy.js
// Every user-facing string that is not dynamic data lives here, grouped by
// domain. If it appears in the UI as literal text and is not user-generated,
// it belongs in this file so copy can be reviewed and changed in one place.

export const GLOBAL_COPY = {
  appName: 'dedal',
  tagline: 'Your pass to every fest',
  comingSoon: 'This screen is coming soon',
  loading: 'Loading…',
  retry: 'Try again',
  somethingWentWrong: 'Something went wrong. Please try again.',
};

// The account dropdown behind the top-right avatar, and the sign-out escape
// hatches that let someone leave an account they are stuck in.
export const IDENTITY_MENU_COPY = {
  openLabel: 'Account menu',
  viewProfile: 'View Profile',
  settings: 'Settings',
  signOut: 'Sign out',
  notYou: 'Not you? Sign out',
  signedOutHeadline: 'Signed Out',
  signedOutBody: 'You have been signed out successfully. Redirecting…',
};

export const INLINE_ERROR_COPY = {
  retry: 'RETRY',
};

export const SECTION_HEADERS = {
  quickAccess: 'QUICK ACCESS',
  operativeFile: 'OPERATIVE FILE',
  backstage: 'BACKSTAGE',
  happeningNow: 'HAPPENING NOW',
  savedByYou: 'SAVED BY YOU',
};

export const AUTH_COPY = {
  // Sign-in
  tagline: 'One Fest. One Pass. Zero Chaos.',
  // The lowercase Playfair wordmark drawn in the Heritage top bar. Kept separate
  // from BRAND_IDENTITY.appName ("Dedal") because the mark is set lowercase and
  // the hero mark is set in capitals — they are three different renderings of
  // the same name, not one string reused.
  wordmark: 'dedal',
  wordmarkHero: 'dedal',
  // Shown only when the visitor was sent here from an /admin route, so an
  // administrator knows this one sign-in serves the console too.
  adminBoundHint: 'ADMIN? SIGN IN HERE — YOU’LL LAND IN THE CONSOLE',
  // Screen-reader label for the chevron that hints at content below the fold.
  scrollHint: 'More below',
  // Shown when the 401 handler bounced someone out of the payment flow: the
  // saved route returns them to their checkout the moment they sign in.
  paymentBoundHint: 'YOUR SESSION EXPIRED. SIGN IN TO PICK UP YOUR PAYMENT WHERE YOU LEFT OFF.',
  signInHeading: 'Sign in to Dedal',
  signInSubtext: 'Students, staff, and college administrators sign in here.',
  newToDedalPrefix: 'Are you a college?',
  registerCollegeLink: 'Register your college',
  emailFieldLabel: 'EMAIL ADDRESS',
  emailFieldPlaceholder: 'Enter your email address',
  sendOtpButton: 'Login with OTP',
  orLabel: 'OR',
  googleLoading: 'Loading Google sign-in…',
  googleButton: 'Continue with Google',
  googleSigningIn: 'Signing in with Google…',
  googleSuccess: 'Signed in with Google',
  googleFailed: 'Google sign-in failed. Please try again or use email.',
  googleUnavailable: 'Google sign-in unavailable — use email instead',
  googleNotConfigured: 'Google sign-in is unavailable right now — please sign in with email.',
  googleEmailMissing: 'Google returned no email for this account. Please sign in with email instead.',
  googleAccountBlocked: 'This account is blocked.',
  termsPrefix: 'By continuing, you agree to our',
  termsOfService: 'Terms of service',
  and: 'and',
  privacyPolicy: 'Privacy policy',
  invalidEmail: 'Enter a valid email address.',
  requestOtpFailed: 'Could not send the code. Try again.',

  // OTP verification
  verifyHeadline: 'Verify Your Email',
  verifySubtextPrefix: 'We have sent a 6-digit verification code to',
  // The spam-folder nudge under the address, so nobody waits on a mail that
  // already arrived somewhere they are not looking.
  checkSpamHint: "Didn't receive it? Check your spam folder.",
  otpDigitLabel: (position) => `Digit ${position}`,
  resendPrefix: 'Resend code in',
  resendReady: 'Resend Code',
  useDifferentEmail: 'Use a different email',
  goBack: 'Go back',
  verifyButton: 'Verify and Continue',
  invalidCode: 'Invalid code. Try again.',
  missingEmailRedirect: 'Please enter your email first.',
  // The footer reassurance inside the verification card.
  encryptionNote: 'Secured with end-to-end encryption',
};

export const PROFILE_COPY = {
  completionHeader: 'Complete Your Profile',
  completionStep: 'STEP 3 OF 3',
  completionIntro: 'Before you can register for events, we need a few details.',

  sectionIdentity: 'Personal Info',
  sectionAcademic: 'Academic Details',
  sectionConsent: 'Consent',

  fullNameLabel: 'FULL NAME',
  fullNamePlaceholder: 'Your full name',
  phoneLabel: 'PHONE NUMBER',
  phonePlaceholder: 'Your phone number',
  phoneHelper: 'Used for pass verification.',

  collegeLabel: 'COLLEGE',
  collegePlaceholder: 'Select your college',
  usnLabel: 'USN / ROLL NUMBER',
  usnPlaceholder: 'e.g. 1RV21CS001',
  departmentLabel: 'COURSE',
  departmentOptional: '(Optional)',
  departmentPlaceholder: 'Search or type your course',
  yearOfStudyLabel: 'YEAR OF STUDY',

  consentTermsPrefix: 'I agree to the',
  consentTerms: 'Terms of Service',
  consentPrivacyPrefix: 'I agree to the',
  consentPrivacy: 'Privacy Policy',
  consentNote: 'Your consent is recorded against the exact version of each document, with a timestamp, for your protection.',
  // The version each checkbox is ticked against, shown beside it.
  consentVersion: (versionLabel) => `version ${versionLabel}`,
  consentLoading: 'Loading the current documents…',
  consentLoadFailed: 'The Terms of Service and Privacy Policy could not be loaded, so consent cannot be given yet.',
  consentLoadFailedOffline: 'You are offline. The documents must load before you can agree to them.',
  consentRetry: 'Retry',
  consentUnavailableField: 'Terms and Privacy documents (could not load)',
  // The policy changed while the form was open. An ordinary outcome, not an
  // error: the person is asked to read the current text and tick again.
  consentStaleTitle: (documentName) => `The ${documentName} was updated while you were filling this in.`,
  consentStaleBody:
    'Please read the current version and tick both boxes again. Everything else you entered has been kept.',
  consentStaleDismiss: 'OK',

  dateOfBirthLabel: 'Date of birth',
  dateOfBirthHelper: 'Optional. Used only to apply age-appropriate protections to your account.',
  dateOfBirthInvalid: 'Enter a real date.',
  dateOfBirthFuture: 'A date of birth cannot be in the future.',
  dateOfBirthTooOld: 'That date is too far in the past.',

  submitReady: 'COMPLETE PROFILE',
  submitIncomplete: 'COMPLETE ALL FIELDS',
  submitFailed: 'Could not save your profile. Try again.',

  editTitle: 'Edit profile',
  profileTitle: 'Profile',
  signOut: 'Sign out',
};

// Suggestion list ONLY for the searchable department field — NOT an enum.
// Department is stored as free text; any value the participant types is valid.
// This list just makes the common answers one tap away, spanning every college
// type the platform onboards (engineering, medical, arts, commerce, law,
// business, other). Alphabetically sorted, "Other" last.
export const DEPARTMENT_OPTIONS = [
  'Accounting & Finance',
  'Aeronautical Engineering',
  'Aerospace Engineering',
  'Agricultural Engineering',
  'Agriculture',
  'Allied Health Sciences',
  'Animation & Multimedia',
  'Architecture',
  'Artificial Intelligence & Data Science',
  'Artificial Intelligence & Machine Learning',
  'Automobile Engineering',
  'Ayurveda',
  'Biochemistry',
  'Biology',
  'Biomedical Engineering',
  'Biotechnology',
  'Business Administration (BBA)',
  'Business Administration (MBA)',
  'Chemical Engineering',
  'Chemistry',
  'Civil Engineering',
  'Commerce',
  'Computer Applications (BCA)',
  'Computer Applications (MCA)',
  'Computer Science & Business Systems',
  'Computer Science & Engineering',
  'Cyber Security',
  'Data Science',
  'Dentistry',
  'Design',
  'Economics',
  'Education',
  'Electrical & Electronics Engineering',
  'Electronics & Communication Engineering',
  'Electronics & Instrumentation Engineering',
  'English',
  'Environmental Engineering',
  'Environmental Science',
  'Fashion Design',
  'Fine Arts',
  'Genetics',
  'History',
  'Hotel Management',
  'Industrial Engineering',
  'Information Science & Engineering',
  'Information Technology',
  'Journalism & Mass Communication',
  'Languages',
  'Law',
  'MBBS',
  'Marine Engineering',
  'Mathematics',
  'Mechanical Engineering',
  'Mechatronics Engineering',
  'Metallurgical Engineering',
  'Microbiology',
  'Mining Engineering',
  'Nursing',
  'Performing Arts',
  'Pharmacy',
  'Philosophy',
  'Physics',
  'Physiotherapy',
  'Planning',
  'Political Science',
  'Polymer Science & Engineering',
  'Psychology',
  'Robotics & Automation Engineering',
  'Sociology',
  'Statistics',
  'Textile Engineering',
  'Tourism',
  'Veterinary Science',
  'Other',
];

// Year-of-study choices shown as the 1–6 square toggle row.
export const YEAR_OF_STUDY_OPTIONS = [1, 2, 3, 4, 5, 6];

export const REGISTRATION_COPY = {
  registerButton: 'Register',
  registeredBadge: 'REGISTERED',
  emptyTitle: 'No registrations yet',
  emptySubtext: 'Events you register for will show up here.',
  successHeadline: 'YOU ARE IN',
  successSubtext: 'Your registration is confirmed. Your pass is ready.',
};

export const PASSES_COPY = {
  title: 'My passes',
  emptyTitle: 'No passes yet',
  emptySubtext: 'Register for a fest and your pass appears here.',
  showAtGate: 'SHOW THIS AT THE GATE',
};

export const CERTIFICATES_COPY = {
  title: 'My certificates',
  emptyTitle: 'No certificates yet',
  emptySubtext: 'Certificates you earn will be collected here.',
  verifyTitle: 'Verify certificate',
};

export const DISCOVERY_COPY = {
  /*
   * Promotion carousels (they replaced the featured-fest hero). Two sections,
   * two types: paid/sponsor banners, and fests that colleges asked the platform
   * to promote. Each has its own heading so a participant can tell an advert
   * from an event they might actually attend.
   */
  promotionsSectionTitle: 'PROMOTIONS',
  promotionsRegionLabel: 'Promotions',
  collegeEventsSectionTitle: 'UPCOMING COLLEGE EVENTS',
  collegeEventsRegionLabel: 'Upcoming college events',
  promotionSlideLabel: (slideNumber, slideCount) => `Slide ${slideNumber} of ${slideCount}`,
  // The previous/next controls: the single-pointer, keyboard-reachable
  // alternative to swiping that WCAG 2.5.7 requires.
  promotionPrevious: 'Previous promotion',
  promotionNext: 'Next promotion',
  // Prefixes the badge for a screen reader, which has no bottom-left corner to
  // read the context from.
  promotionLearnMore: 'Learn more',
  promotionCollegePrefix: 'Promoted by',
  brandName: 'dedal',
  searchPlaceholder: 'Search fests, events, colleges...',
  notificationsLabel: 'Notifications',
  categoryAll: 'All',
  featuredBadge: 'FEATURED',
  publicBadge: 'PUBLIC',
  grabPass: 'GRAB PASS',
  seeAll: 'VIEW ALL',
  sectionMyPasses: 'My Passes',
  passStatusLive: 'LIVE',
  passStatusUpcoming: 'UPCOMING',
  passQrHint: 'Pass QR code',
  sectionUpcoming: 'Upcoming Fests',
  sectionThisWeek: 'This Week',
  sectionCategories: 'CATEGORIES',
  categoryBrowseAll: 'ALL CATEGORIES →',
  sectionOpenFests: 'OPEN FESTS',
  emptyTitle: 'No fests yet',
  emptySubtext: 'Published fests will show up here. Check back soon.',
  errorMessage: 'Could not load fests.',
};

/*
 * SUGGESTION LIST ONLY. Mirrors constants/event-constants.js EVENT_CATEGORIES,
 * which is no longer a backend enum: `category` is free text, so an event may
 * carry any string and this list constrains nothing. It exists to populate the
 * admin autocomplete and the participant category search.
 *
 * Sorted alphabetically to match the backend, because a 30-entry list is
 * scanned by eye — the browse-order exception below is what the chips are for.
 */
export const EVENT_CATEGORIES = [
  { label: 'Arts', value: 'arts' },
  { label: 'Coding', value: 'coding' },
  { label: 'Commerce', value: 'commerce' },
  { label: 'Culinary', value: 'culinary' },
  { label: 'Cultural', value: 'cultural' },
  { label: 'Dance', value: 'dance' },
  { label: 'Debate', value: 'debate' },
  { label: 'Design', value: 'design' },
  { label: 'Drama', value: 'drama' },
  { label: 'Entrepreneurship', value: 'entrepreneurship' },
  { label: 'Environment', value: 'environment' },
  { label: 'Esports', value: 'esports' },
  { label: 'Fashion', value: 'fashion' },
  { label: 'Film', value: 'film' },
  { label: 'Finance', value: 'finance' },
  { label: 'Gaming', value: 'gaming' },
  { label: 'Hackathon', value: 'hackathon' },
  { label: 'Literary', value: 'literary' },
  { label: 'Management', value: 'management' },
  { label: 'Marketing', value: 'marketing' },
  { label: 'Music', value: 'music' },
  { label: 'Other', value: 'other' },
  { label: 'Photography', value: 'photography' },
  { label: 'Quiz', value: 'quiz' },
  { label: 'Robotics', value: 'robotics' },
  { label: 'Social Impact', value: 'socialImpact' },
  { label: 'Sports', value: 'sports' },
  { label: 'Technical', value: 'technical' },
  { label: 'Wellness', value: 'wellness' },
  { label: 'Workshop', value: 'workshop' },
];

/*
 * The chips. Thirty chips is not a filter row, it is a wall — so the quick
 * filters stay the handful participants actually browse by, ordered by how they
 * browse (the big three first) rather than alphabetically. Everything outside
 * this subset, including categories an organiser invented, is reachable through
 * the category search beside the chips. "All" is not in this list: it is the
 * reset chip each screen renders ahead of it.
 */
export const COMMON_EVENT_CATEGORIES = [
  { label: 'Technical', value: 'technical' },
  { label: 'Cultural', value: 'cultural' },
  { label: 'Sports', value: 'sports' },
  { label: 'Management', value: 'management' },
  { label: 'Arts', value: 'arts' },
  { label: 'Commerce', value: 'commerce' },
  { label: 'Workshop', value: 'workshop' },
  { label: 'Gaming', value: 'gaming' },
  { label: 'Literary', value: 'literary' },
  { label: 'Other', value: 'other' },
];

// scoringFormat enum -> the human label shown in the event detail format tile.
export const SCORING_FORMAT_LABELS = {
  bracketSingleElimination: 'Bracket',
  scoreBased: 'Scored',
  timeTrial: 'Time trial',
  judged: 'Judged',
  none: 'Standard',
};

export const CATEGORY_EVENTS_COPY = {
  browseByCategory: 'Browse by Category',
  allFestsHeading: 'All Fests',
  allTitle: 'ALL FESTS',
  categoryAll: 'All',
  // The escape hatch from the chip row: any category, including ones an
  // organiser invented that no chip will ever show.
  categorySearchPlaceholder: 'Search categories...',
  categorySearchLabel: 'Search event categories',
  categorySearchHint: 'PRESS ENTER TO FILTER BY WHAT YOU TYPED',
  categoryClear: 'CLEAR CATEGORY',
  eventCountSuffix: 'EVENTS',
  // The /search grid lists fests; the card shows how many events each holds.
  festCountSuffix: 'FESTS',
  festEventsSuffix: 'EVENTS',
  sortLabel: 'SORT',
  sortByDate: 'By date',
  sortByName: 'By name',
  fillingFast: 'FILLING FAST',
  full: 'FULL',
  free: 'FREE',
  loadingMore: 'Loading more fests',
  emptyTitle: 'No fests found',
  emptySubtext: 'Try a different category or search.',
  errorMessage: 'Could not load fests.',
};

export const SEARCH_COPY = {
  placeholder: 'Search fests and events',
  festTag: 'FEST',
  eventTag: 'EVENT',
  emptyTitle: 'Nothing matches',
  emptySubtext: 'Try a different fest, event, or college.',
  errorMessage: 'Could not run the search.',
};

// The shared rectangular event card (fest detail tree + event detail group view).
export const EVENT_CARD_COPY = {
  groupTag: 'GROUP',
  eventsSuffix: 'EVENTS',
  openLabel: (eventName) => `Open ${eventName}`,
  expandLabel: (eventName) => `Expand ${eventName}`,
  collapseLabel: (eventName) => `Collapse ${eventName}`,
};

export const FEST_DETAIL_COPY = {
  // Group (contingent) registration, offered above the event list.
  groupRegistrationTitle: 'Group Registration Available',
  groupRegistrationBody: (eventName) =>
    `Register your entire group for ${eventName} and get a join code for each sub-event.`,
  groupRegistrationAction: 'Register as group',

  crewDirectory: 'CREW DIRECTORY',
  shareFest: 'SHARE FEST',
  foodAvailable: 'FOOD AVAILABLE',
  accommodationAvailable: 'STAY AVAILABLE',
  eventsSuffix: 'EVENTS',
  contactPrefix: 'CONTACT:',
  errorMessage: 'Could not load this fest.',
  emptyEvents: 'No events published yet.',
  festivalBadge: 'FESTIVAL',
  highlightsTitle: 'Fest Highlights',
  highlightEvents: 'EVENTS',
  highlightDays: 'DAYS',
  highlightCategories: 'CATEGORIES',
  featuredTitle: 'Featured Events',
  viewAll: 'VIEW ALL',
  filterAll: 'All',
  organizedByTitle: 'Organized By',
  organizerRole: 'Host college',
  entryFeeLabel: 'Entry fee',
  freeEntry: 'Free Entry',
  registerCta: 'REGISTER FOR FEST',
  registrationsClosed: 'Closed',
};

export const EVENT_DETAIL_COPY = {
  faqsTitle: 'FAQs',
  labelSchedule: 'SCHEDULE',
  labelVenue: 'Venue',
  labelFormat: 'Format',
  labelCapacity: 'Capacity',
  capacityUnlimited: 'UNLIMITED',
  slotsSuffix: 'slots',
  registrationPrefix: 'Registration',
  registrationClosed: 'Registration closed',
  missionBrief: 'About this event',
  readFullRules: 'READ FULL RULES',
  hideRules: 'HIDE RULES',
  labelPrizePool: 'PRIZE POOL',
  labelRegistrationQuestions: 'Registration',
  questionsSuffix: 'questions during registration',
  labelMedical: 'MEDICAL',
  medicalRequired: 'Medical declaration required',
  // The CONTACT block — who to call about this event.
  contactHeading: 'Contact',
  contactEmpty: 'No contact listed yet. Check back closer to the event.',
  contactRoleCoordinator: 'COORDINATOR',
  contactRoleVolunteer: 'VOLUNTEER',
  registerNow: 'Register',
  createTeamButton: 'CREATE TEAM →',
  joinWithCodeButton: 'JOIN WITH CODE',
  joinPanelTitle: 'ENTER YOUR TEAM CODE',
  registrationClosedButton: 'Registration closed',
  eventFull: 'EVENT FULL',
  // Shown instead of EVENT FULL when the organiser opened a queue. A full event
  // with a waitlist is not a dead end, and the button must not say it is.
  joinWaitlist: 'JOIN WAITLIST',
  waitlistFull: 'WAITLIST FULL',
  errorMessage: 'Could not load this event.',
  groupNotice: 'This is a group. Choose a specific event below.',
  groupTag: 'GROUP',
};

// Food preference options (fest offers food). Values match the backend enum.
export const FOOD_PREFERENCE_OPTIONS = [
  { value: 'veg', label: 'VEG' },
  { value: 'nonVeg', label: 'NON-VEG' },
  { value: 'noMealNeeded', label: 'NO MEAL NEEDED' },
];

export const REGISTRATION_FORM_COPY = {
  headerPrefix: 'REGISTRATION',
  sectionFaqs: 'FAQs',
  sectionCustomQuestions: '01. CUSTOM QUESTIONS',
  sectionSquad: '02. SQUAD CONFIGURATION',
  sectionCategory: '03. CATEGORY SELECTION',
  sectionAdditional: '03. ADDITIONAL INFO',
  contactPhoneLabel: 'Contact phone for this event (optional)',
  contactPhonePlaceholder: "We'll use your account phone by default.",
  sectionPayment: '04. PAYMENT SUMMARY',
  teamNameLabel: 'SQUAD NAME',
  teamNamePlaceholder: 'Name your squad',
  memberEmailsLabel: 'MEMBER EMAILS',
  memberEmailPlaceholder: 'teammate@college.edu',
  addMember: '+ ADD MEMBER',
  teamCodeHint: 'You get a team code to share after this step',
  foodPreferenceLabel: 'FOOD PREFERENCE',
  // Shown when the food add-on is ticked but no preference is chosen: names the
  // actual rule instead of leaving a disabled button unexplained.
  foodPreferenceHint: 'PICK ONE — VEG, NON-VEG, OR NO MEAL NEEDED',
  foodOrderCountLabel: 'MEALS FOR YOUR TEAM',
  foodOrderCountHelper: 'How many meals are you booking for the team?',
  // Add-ons: every active fest offer (food and accommodation included) rendered
  // as one selectable row with its price.
  sectionAddOns: '03. ADD-ONS',
  scopeBadgeFest: 'FEST-WIDE',
  scopeBadgeEvent: 'THIS EVENT',
  // The four permutations of the two axis toggles; the wording is derived at
  // render time by helpers/fee-math.js formatOfferRateLabel.
  ratePerPersonPerDay: (rupees) => `₹${rupees} per person per day`,
  ratePerPerson: (rupees) => `₹${rupees} per person`,
  ratePerDay: (rupees) => `₹${rupees} per day`,
  rateTotal: (rupees) => `₹${rupees} total`,
  numberOfPeopleLabel: 'HOW MANY PEOPLE',
  numberOfDaysLabel: 'HOW MANY DAYS',
  offerQuantityLabel: (offerName) => `HOW MANY — ${offerName}`,
  offerPricePerUnit: (rupees) => `₹${rupees} each`,
  offerFree: 'FREE',
  runningTotalLabel: 'TOTAL',
  accommodationLabel: 'NEEDS ACCOMMODATION',
  yes: 'YES',
  no: 'NO',
  medicalLabel: 'I have read the Medical Declaration and accept all associated risks.',
  responsePlaceholder: 'Type your response…',
  registrationFeeLabel: 'REGISTRATION',
  netTotalLabel: 'NET TOTAL',
  submitFree: 'REGISTER →',
  submitPaid: 'PAY & REGISTER →',
  // The pending-payment conflict (PENDING_PAYMENT_EXISTS): resume or restart.
  pendingConflictBody:
    'You already have a pending registration for this event. Resume it to finish paying, or cancel it and start over.',
  resumePendingButton: 'Resume',
  cancelPendingButton: 'Cancel & retry',
  errorMessage: 'Could not load this event.',
  submitFailed: 'Could not complete registration. Check your answers and try again.',
};

export const CHECKOUT_COPY = {
  title: 'CHECKOUT',
  registeringFor: 'REGISTERING FOR',
  captain: 'CAPTAIN',
  membersSuffix: 'MEMBERS',
  registrationFee: 'REGISTRATION FEE',
  platformFee: 'PLATFORM FEE',
  gst: 'GST',
  total: 'TOTAL',
  expiresPrefix: 'PAYMENT WINDOW EXPIRES IN',
  poweredBy: 'POWERED BY RAZORPAY',
  payPrefix: 'PAY',
  disclaimer: 'By paying, you confirm your registration. No cancellations for paid events.',
  expiredTitle: 'PAYMENT WINDOW CLOSED',
  expiredSubtext: 'This payment window has expired. Please register again.',
  expiredButton: 'GO BACK AND REGISTER AGAIN',
  errorMessage: 'Could not load your payment.',
  payFailed: 'Payment could not be verified. Please try again.',
  razorpayUnavailable: 'Payment could not be started. Please try again.',
};

// The two explicit payment-outcome screens: the post-payment confirmation poll
// and the failure report. No payment path may end on a silent redirect home.
export const PAYMENT_STATUS_COPY = {
  processingTitle: 'Confirming your payment',
  processingBody:
    'We are confirming your payment with the bank. This can take a few seconds.',
  processingHint: 'Do not close this screen, and do not pay again.',
  stillPendingTitle: 'Still confirming',
  stillPendingBody:
    'Your payment is taking longer than usual to confirm. You will not be charged again, and once the bank confirms, your registration completes on its own.',
  checkAgain: 'Check again',
  viewRegistrations: 'My registrations',
  processingError: 'Could not check your payment status.',
  secureNote: 'Payments are processed securely',
  transactionTitle: 'Transaction',
  eventLabel: 'Event',
  totalAmountLabel: 'Total',

  failedTitle: 'PAYMENT FAILED',
  failedFallbackDescription: 'The payment did not go through. You have not been charged.',
  amountLabel: 'AMOUNT',
  supportReferenceLabel: 'SUPPORT REFERENCE',
  retryPayment: 'RETRY PAYMENT →',
  cancelHold: 'CANCEL & RETURN TO EVENT',
  cancelFailed: 'Could not cancel the pending hold. Try again.',
  failedError: 'Could not load this payment.',
};

export const REGISTRATION_SUCCESS_COPY = {
  // The pass is emailed automatically on first issue.
  passEmailedTo: (maskedEmailAddress) => `PASS EMAILED TO ${maskedEmailAddress}`,
  headline: 'REGISTRATION CONFIRMED',
  subPrefix: "You're cleared for",
  registrationIdLabel: 'REGISTRATION ID',
  copyRegistrationId: 'Copy registration ID',
  copiedLabel: 'COPIED',
  addOnsLabel: 'ADD-ONS',
  addOnsNone: 'NONE',
  amountFree: 'FREE',
  amountPaidLabel: 'AMOUNT PAID',
  // The mental model, stated plainly — the participant cannot infer
  // one-pass-covers-everything from a QR image alone.
  onePassNote: (festName) =>
    `One pass covers everything you've registered for at ${festName} — this event, your other events, and any add-ons you booked.`,
  teamLabel: 'TEAM',
  inviteCodeLabel: 'INVITE CODE',
  membersSuffix: 'MEMBERS',
  soloLabel: 'SOLO',
  totalPaidLabel: 'TOTAL PAID',
  paymentRefLabel: 'REF',
  passIssuedTitle: 'Your Dedal pass has been issued',
  passPendingTitle: 'Your pass is ready on the pass screen',
  viewPass: 'VIEW MY PASS',
  backToExplore: 'BACK TO EXPLORE',
  passPreviewTitle: 'Entry Pass',
  scanNote: 'SCAN AT ENTRY',
  errorMessage: 'Could not load your registration.',
};

/*
 * Post-event feedback. The prompt is shown only to people who actually attended
 * (the API answers that), and only once — after submitting, the card becomes a
 * read-only record of what they said.
 */
export const EVENT_FEEDBACK_COPY = {
  promptTitle: 'Rate this event',
  promptSubtext: 'You attended. How was it?',
  rateAction: 'Rate it',
  sheetTitle: 'Rate this event',
  sheetClose: 'Close',
  starLabel: (starCount) => `${starCount} star${starCount === 1 ? '' : 's'}`,
  ratingLegend: 'Your rating',
  commentLabel: 'Anything to add? (optional)',
  commentPlaceholder: 'What worked, what did not.',
  commentCounter: (used, limit) => `${used}/${limit}`,
  submit: 'Submit rating',
  submitting: 'Sending…',
  ratingRequired: 'Pick a rating first.',
  submitFailed: 'Could not send your rating. Try again.',
  // One shot, so the confirmation is a statement of record, not a receipt.
  submittedTitle: (starCount) => `You rated this ${starCount} out of 5`,
  submittedNote: 'Ratings cannot be changed.',
  alreadySubmitted: 'You have already rated this event.',
  notAttended: 'Only people who attended can rate this event.',
};

export const ERROR_BOUNDARY_COPY = {
  title: 'SOMETHING WENT WRONG',
  subtext:
    'This screen hit an error and could not finish loading. Reloading usually fixes it.',
  reload: 'RELOAD',
  // Said plainly so nobody feels obliged to write in about it.
  reportedNote: 'The problem has been reported automatically.',
};

export const MY_REGISTRATIONS_COPY = {
  title: 'My Registrations',
  subtitle: 'All events you have registered for',
  waitlistPosition: (position) => `POSITION ${position}`,
  tabActive: 'ACTIVE',
  tabPast: 'PAST',
  activeCountSuffix: 'ACTIVE REGISTRATIONS',
  pastCountSuffix: 'PAST REGISTRATIONS',
  soloLabel: 'SOLO',
  paidSuffix: 'PAID',
  pendingSuffix: 'PENDING',
  freeLabel: 'FREE',
  emptyTitle: 'No registrations yet',
  emptySubtext: 'Events you register for will show up here.',
  exploreEvents: 'Explore events',
  errorMessage: 'Could not load your registrations.',
  cancelledByPrefix: 'CANCELLED BY',
  keepIt: 'KEEP IT',
  // Chronology sections — the client's "all past and upcoming" split.
  sectionUpcoming: 'UPCOMING',
  sectionToday: 'HAPPENING NOW',
  sectionPast: 'PAST',
  viaContingentPrefix: 'VIA',
  emptyUpcomingTitle: 'NOTHING COMING UP',
  emptyUpcomingSubtext: 'You have no upcoming events. Your past registrations are still below.',
  discoverEvents: 'DISCOVER EVENTS →',
};

// Registration status -> short chip label + which tab it belongs to.
export const REGISTRATION_STATUS_LABELS = {
  confirmed: 'CONFIRMED',
  waitlisted: 'WAITLISTED',
  pendingPayment: 'PENDING PAYMENT',
  cancelled: 'CANCELLED',
  attended: 'ATTENDED',
  noShow: 'NO SHOW',
  winner1st: '1ST PLACE',
  winner2nd: '2ND PLACE',
  winner3rd: '3RD PLACE',
  advancedToR2: 'ADVANCED',
  advancedToR3: 'ADVANCED',
  advancedToQuarterFinal: 'QUARTER FINAL',
  advancedToSemiFinal: 'SEMI FINAL',
  advancedToFinal: 'FINAL',
  eliminated: 'ELIMINATED',
  disqualified: 'DISQUALIFIED',
  paymentExpired: 'PAYMENT EXPIRED',
};

// Statuses shown under the ACTIVE tab; everything else falls under PAST.
export const ACTIVE_REGISTRATION_STATUSES = ['confirmed', 'waitlisted', 'pendingPayment'];

export const MY_CERTIFICATES_COPY = {
  title: 'My Certificates',
  subtitle: 'Certificates received from coordinators and admins.',
  tabAll: 'ALL',
  tabByFest: 'BY FEST',
  countSuffix: 'certificates',
  issuedPrefix: 'Issued:',
  issuedByPrefix: 'Issued by',
  previewPlaceholder: 'Certificate Preview',
  downloadLabel: 'Download certificate',
  verifiedPrefix: 'VERIFIED ✓ · CODE:',
  emptyTitle: 'No certificates yet',
  emptySubtext: 'Certificates you earn will be collected here after each fest.',
  exploreEvents: 'Explore events',
  errorMessage: 'Could not load your certificates.',
};

// certificateType -> chip label, chip style, and whether it carries a mark.
export const CERTIFICATE_TYPE_META = {
  participation: { label: 'PARTICIPATION', style: 'outlined', title: 'PARTICIPATION' },
  winner1st: { label: '1ST PLACE', style: 'firstPlace', icon: 'trophy', title: 'FIRST PLACE' },
  winner2nd: { label: '2ND PLACE', style: 'secondPlace', icon: 'trophy', title: 'SECOND PLACE' },
  winner3rd: { label: '3RD PLACE', style: 'thirdPlace', icon: 'trophy', title: 'THIRD PLACE' },
  coordinator: { label: 'COORDINATOR', style: 'filled', title: 'COORDINATOR' },
  volunteer: { label: 'VOLUNTEER', style: 'accentOutline', title: 'VOLUNTEER SERVICE' },
  administrator: { label: 'ADMINISTRATOR', style: 'filled', title: 'ADMINISTRATION' },
  specialMention: { label: 'SPECIAL MENTION', style: 'accentFill', icon: 'star', title: 'SPECIAL MENTION' },
};

export const CERTIFICATE_DETAIL_COPY = {
  title: 'CERTIFICATE',
  certificateOf: 'CERTIFICATE OF',
  awardedTo: 'Awarded to',
  forLabel: 'For',
  hostedByPrefix: 'Hosted by',
  verificationCodeLabel: 'VERIFICATION CODE',
  verifyAtPrefix: 'Verify at',
  verifyPath: '/verify-certificate',
  issuedPrefix: 'Issued',
  downloadPdf: 'DOWNLOAD PDF',
  downloading: 'DOWNLOADING…',
  downloadFailed: 'DOWNLOAD FAILED — TRY AGAIN',
  share: 'SHARE',
  verifyHeader: 'VERIFY THIS CERTIFICATE',
  verifyPlaceholder: 'ENTER VERIFICATION CODE',
  verifyButton: 'VERIFY →',
  verifyHelper: 'This verification is public. Anyone with the code can confirm authenticity.',
  verifiedTitle: 'VERIFIED — This certificate is authentic',
  notFoundTitle: 'NOT FOUND — No certificate matches this code',
  poweredBy: 'Powered by Dedal',
  publicTryAnother: 'This code does not match any certificate. Try another code.',
  errorMessage: 'Could not load this certificate.',
  detailsHeader: 'Certificate Details',
  labelRecipient: 'Recipient',
  labelEvent: 'Event',
  labelFest: 'Fest',
  labelCollege: 'Issuing College',
  labelDate: 'Date',
  labelCertificateId: 'Certificate ID',
  verifyAuthTitle: 'Verify Authenticity',
  verifyAuthBody: 'Scan to verify this certificate on the dedal registry.',
  publicTitle: 'Verify Certificate',
  publicSubtitle: 'Enter a certificate ID or scan a QR code to verify authenticity.',
  codeLabel: 'Certificate ID',
  verifiedHeading: 'Certificate Verified',
};

export const TEAMS_COPY = {
  title: 'My Team',
  subtitle: 'Select an event, then create or join a team to collaborate and compete.',
  stepSelectEvent: 'Select Event',
  stepYourTeam: 'Your Team',
  selectEventFirst: 'Select an event first',
  createTeam: 'Create Team',
  joinTeam: 'Join Team',
  yourTeams: 'Your Teams',
  createEventLabel: 'EVENT',
  createEventPlaceholder: 'Pick a team event',
  createNameLabel: 'SQUAD NAME',
  createNamePlaceholder: 'Name your squad',
  createSubmit: 'CREATE →',
  // Sentence case at source: the only consumer is components/team-code-entry,
  // which is on the design system.
  joinSubmit: 'Join team',
  inviteCodeLabel: 'INVITE CODE',
  copyCode: 'COPY',
  copied: 'COPIED',
  membersSuffix: 'MEMBERS',
  youAreLeader: 'YOU ARE LEADER',
  statusForming: 'FORMING',
  statusLocked: 'LOCKED',
  statusDisqualified: 'DISQUALIFIED',
  noEventsToCreate: 'Register for a team event first to create a team.',
  allEventsHaveTeams: 'You already have a team for every team event you have registered for.',
  lockTeam: 'LOCK TEAM',
  lockFailed: 'Could not lock the team. Try again.',
  // TEAM_BELOW_MINIMUM_SIZE carries the sizes; this names how many are missing.
  needMoreMembers: (missingCount) =>
    `Need ${missingCount} more member${missingCount === 1 ? '' : 's'} before you can lock.`,
  joinSuccessTitle: 'YOU JOINED THE TEAM',
  joinSuccessBody: 'Your registration is in. Your pass and event details are ready below.',
  codeNoLongerJoinable: 'JOINING CLOSED',
  emptyTitle: 'No teams yet',
  emptySubtext: 'Create a team for a team event, or join one with an invite code.',
  createFailed: 'Could not create the team. Try again.',
  joinFailed: 'Could not join. Check the code and try again.',
  errorMessage: 'Could not load your teams.',
};

export const EDIT_PROFILE_COPY = {
  title: 'Edit Profile',
  save: 'SAVE',
  /*
   * The avatar is never editable here — there is no photo upload. Both captions
   * say where the picture came from rather than inviting a tap that does nothing.
   */
  avatarFromGoogle: 'PHOTO FROM GOOGLE ACCOUNT',
  avatarFromName: 'AUTO-GENERATED FROM YOUR NAME',
  // Decorative for now — there is no photo-upload API; the caption matches the
  // Stitch design while the avatar remains display-only.
  changePhoto: 'Change Photo',
  sectionPersonal: 'Personal Info',
  sectionAcademic: 'Academic Details',
  fullNameLabel: 'FULL NAME',
  fullNamePlaceholder: 'Your full name',
  emailLabel: 'EMAIL',
  emailHelper: 'Linked to your sign-in. Cannot be changed.',
  professionalEmailLabel: 'PROFESSIONAL EMAIL (OPTIONAL)',
  professionalEmailPlaceholder: 'your.name@institution.edu.in',
  professionalEmailHelper: 'Institutional or professional address. Personal email providers are not accepted.',
  professionalEmailInvalid: 'Enter a valid email address.',
  professionalEmailPersonal: 'Please use your institutional email address.',
  phoneLabel: 'CONTACT NUMBER',
  phonePlaceholder: 'Your phone number',
  collegeLabel: 'COLLEGE NAME',
  usnLabel: 'REGISTER NUMBER',
  usnPlaceholder: 'e.g. 1RV21CS001',
  departmentLabel: 'COURSE',
  departmentOptional: '(Optional)',
  departmentPlaceholder: 'Search or type your course',
  yearOfStudyLabel: 'YEAR OF STUDY',
  saveChanges: 'SAVE CHANGES',
  discardChanges: 'DISCARD CHANGES',
  savedToast: 'PROFILE UPDATED',
  saveFailed: 'Could not save your profile. Try again.',
  invalidName: 'Enter your full name.',
  invalidPhone: 'Enter a valid phone number.',
  invalidUsn: 'Enter your USN.',
  countryLabel: 'COUNTRY',
  countryValue: 'India',
  collegeCityLabel: 'CITY',
  collegeStateLabel: 'STATE',
  collegePinLabel: 'PIN CODE',
  collegeAddressNote: 'From your college record',
  studentIdLabel: 'STUDENT ID',
  uploadStudentId: 'Upload Student ID',
  uploadStudentIdHint: 'JPEG or PNG, up to 5MB',
  uploadStudentIdReplace: 'Tap to replace',
  uploadTooLarge: 'That file is over 5MB. Choose a smaller image.',
  uploadWrongType: 'Only JPEG or PNG images are accepted.',
  uploadFailed: 'Upload failed. Try again.',
  uploading: 'Uploading…',
};

export const SAVED_COPY = {
  title: 'SAVED',
  pageTitle: 'Saved Events',
  pageSubtitle: 'Events you have saved for later',
  registerCta: 'Register',
  emptyTitle: 'No saved events',
  emptySubtext: "Bookmark events you're interested in to find them here.",
  exploreEvents: 'Explore events',
  removedToast: 'REMOVED FROM SAVED',
  errorMessage: 'Could not load your saved events.',
};

export const REGISTRATION_DETAIL_COPY = {
  title: 'REGISTRATION',
  teamLabel: 'TEAM',
  inviteCodeLabel: 'INVITE CODE',
  membersLabel: 'MEMBERS',
  copyCode: 'COPY',
  copied: 'COPIED',
  answersHeader: 'YOUR ANSWERS',
  foodLabel: 'FOOD PREFERENCE',
  accommodationLabel: 'ACCOMMODATION',
  accommodationYes: 'REQUESTED',
  accommodationNo: 'NOT REQUESTED',
  paymentHeader: 'PAYMENT',
  paymentAmount: 'AMOUNT',
  paymentStatus: 'STATUS',
  paymentRef: 'REFERENCE',
  labelWhen: 'WHEN',
  labelVenue: 'VENUE',
  labelFee: 'Fee',
  labelRegistered: 'REGISTERED',
  participantHeader: 'Participant Details',
  labelName: 'NAME',
  labelRegNumber: 'REG NUMBER',
  labelEmail: 'EMAIL',
  labelCollege: 'COLLEGE',
  teamHeader: 'Team Details',
  roleLeader: 'Leader',
  roleMember: 'Member',
  passHeader: 'Entry Pass',
  passHint: 'Present this QR code at the registration desk for seamless entry.',
  downloadPass: 'Download Pass',
  cancelModalTitle: 'Cancel Registration?',
  cancelModalBody: 'This action cannot be undone.',
  keepButton: 'KEEP REGISTRATION',
  cancelReasonLabel: 'REASON FOR CANCELLATION',
  cancelReasonPlaceholder: 'Tell us why you are cancelling (min 10 characters)…',
  cancelButton: 'CANCEL REGISTRATION',
  cancelWindowClosed: 'CANCELLATION WINDOW CLOSED',
  cancelWindowHint: 'Cancellation closes 2 hours before the event. Contact the organiser for help.',
  cancelledHeader: 'CANCELLED',
  cancelledByPrefix: 'BY',
  cancelFailed: 'Could not cancel. Please try again.',
  errorMessage: 'Could not load this registration.',
};

export const PASSES_LIST_COPY = {
  title: 'My Passes',
  subtitle: 'QR passes generated for your registered events',
  tabActive: 'Active',
  tabArchived: 'Archived',
  statusValid: 'Active',
  statusSuspended: 'Suspended',
  statusRevoked: 'Revoked',
  labelDate: 'Date',
  labelTime: 'Time',
  labelVenue: 'Venue',
  labelStatus: 'Status',
  idPrefix: 'ID:',
  qrAltPrefix: 'QR pass for',
  emptyTitle: 'No passes yet',
  emptySubtext: 'Register for a fest and your pass appears here.',
  exploreFests: 'Explore fests',
  errorMessage: 'Could not load your passes.',
};

export const QR_PASS_COPY = {
  // Pass-by-email (the pass is mailed once, on first issue, to the holder).
  passEmailedTo: (maskedEmailAddress) => `PASS EMAILED TO ${maskedEmailAddress}`,
  passNotEmailedYet: 'PASS NOT EMAILED YET',
  resendPassEmail: 'SEND ME MY PASS AGAIN',
  resendSucceeded: 'SENT — CHECK YOUR INBOX (AND SPAM).',
  resendFailed: 'Could not send the email right now. Your pass still works in the app.',
  title: 'MY PASS',
  // The one-line explanation of the model: one card for the whole fest, with
  // every event and add-on hanging off it.
  onePassNote: (festName) => `This pass covers everything you've registered for at ${festName}.`,
  entitlementsIntro:
    'Everything below is backed by the one QR above — each door and counter finds its own entry.',
  remainingSuffix: 'remaining',
  offerFallbackLabel: 'Add-on',
  participantBadge: 'PARTICIPANT',
  backupCodeLabel: 'BACKUP CODE',
  addToWallet: 'ADD TO WALLET',
  sharePass: 'SHARE PASS',
  entitlementsHeader: 'ENTITLEMENTS',
  usedSuffix: 'USED',
  errorMessage: 'Could not load your pass.',
};

// entitlementType -> display label. Event-entry uses the populated event name.
export const ENTITLEMENT_TYPE_LABELS = {
  gateAccess: 'Gate Access',
  eventEntry: 'Event Entry',
  // offerClaim resolves to the offer's own name (the pass endpoint attaches it);
  // this is the fallback when an offer was deleted out from under the claim.
  offerClaim: 'Add-on',
  meal: 'Meal Pass',
  accommodationNight: 'Accommodation',
};

export const BACKSTAGE_COPY = {
  title: 'Backstage',
  // The access header: role-specific title + the one-line explainer.
  accessTitleVolunteer: 'Crew Access',
  accessTitleCoordinator: 'Crew Access',
  accessTitleStaff: 'Crew Access',
  accessSubtitle: 'The fests and events you are assigned to work.',
  statTotalAssigned: 'Total Assigned',
  statUpcoming: 'Upcoming',
  statActiveNow: 'Active Now',
  // The role picker, shown only when someone holds BOTH roles.
  rolePickerTitle: 'View assignments as',
  rolePickerCoordinator: 'Coordinator',
  rolePickerVolunteer: 'Volunteer',
  liveOnDuty: 'LIVE · ON DUTY',
  leftSuffix: 'LEFT',
  openScanner: 'OPEN SCANNER →',
  roleCoordinator: 'COORDINATOR',
  roleVolunteer: 'VOLUNTEER',
  festWide: 'FEST-WIDE',
  coversAllSubEvents: 'COVERS ALL SUB-EVENTS',
  roster: 'ROSTER',
  scan: 'SCAN →',
  allCheckpoints: 'ALL CHECKPOINTS',
  // Volunteer-card explicit states: assigned-but-never-scheduled, scheduled-but-
  // not-now, and all-done. Assignment ≠ shift — the admin can (and does) forget
  // step 2, so the card must say exactly what is missing and where to fix it.
  dashboardCardTitle: 'DASHBOARD',
  dashboardCardSubtext: 'YOUR CHECKPOINTS, COUNTS AND DOWNLOADS',
  noShiftsTitle: 'NO SHIFTS SCHEDULED',
  noShiftsBody: 'Your admin needs to schedule you at a checkpoint before you can scan.',
  noShiftsAsk: (checkpointScope) =>
    `Ask them to open Volunteer Shifts and add you at: ${checkpointScope}.`,
  anyCheckpointScope: 'any checkpoint of the fest',
  noShiftsEventScope: (eventNames) => `Your access covers: ${eventNames}.`,
  nextShiftAt: (timeLabel) => `NEXT SHIFT AT ${timeLabel}. Scanner opens when your shift starts.`,
  allShiftsFinished: "ALL SHIFTS FINISHED. Ask the admin to add more if you're covering another slot.",
  shiftUpcoming: 'UPCOMING',
  shiftToday: 'TODAY',
  shiftCompleted: 'COMPLETED',
  shiftLive: 'LIVE',
  emptyTitle: 'No staff assignments',
  emptySubtext:
    'You have no staff assignments. Contact your fest organizer to get assigned as a volunteer or coordinator.',
  errorMessage: 'Could not load your backstage access.',
};

/*
 * Proof of service. A volunteer takes this to their college, so the wording is
 * plain and the numbers are the system's own — nothing here is typed in by hand.
 */
/*
 * Consumed by components/volunteer-hours-panel only, so this block was
 * corrected in place: sentence case throughout, and the empty title/subtext
 * pair collapsed into the one sentence the shared EmptyState takes.
 */
export const VOLUNTEER_HOURS_COPY = {
  sectionTitle: 'My hours',
  totalLabel: 'Total hours worked',
  hoursUnit: 'hours',
  shiftsSuffix: 'shifts',
  columnWhen: 'When',
  columnWhere: 'Where',
  columnHours: 'Hours',
  columnScans: 'Scans',
  downloadReport: 'Download my service report',
  downloadFailed: 'Could not build the report. Try again.',
  emptyLine: 'Your hours appear here once your first shift has started.',
  // The in-progress caveat, so a volunteer mid-shift is not confused by a
  // number smaller than their rostered window.
  inProgressNote: 'A shift in progress counts only the time worked so far.',
};

/*
 * The volunteer's own dashboard. Consumed by screens/volunteer-dashboard only,
 * so this block was corrected in place rather than overridden locally.
 *
 * Every label was stamped uppercase and several said their state in a word the
 * old design then coloured green or amber. There is no green or amber in the
 * design system, so the words now carry the whole meaning: "not checked in yet"
 * rather than "PENDING" in amber, "checked in" and "expected" spelled out
 * rather than a percentage under an olive arc. `postLabel` replaces
 * `activeShiftLabel`: the summary returns every shift-covered checkpoint, not
 * only the one running right now, so "active shift" was asserting something the
 * payload does not say.
 */
export const VOLUNTEER_DASHBOARD_COPY = {
  title: 'My dashboard',
  refresh: 'Reload',
  postLabel: 'My post',
  openScanner: 'Open the scanner',
  checkedInOf: (checkedIn, expected) => `${checkedIn} checked in of ${expected} expected`,
  contactCoordinator: 'Find my coordinator',
  statPending: 'Not checked in yet',
  statCheckedIn: 'Checked in',
  statCheckedOut: 'Checked out',
  statMyScans: 'My scans today',
  downloadFullList: 'Download the full list',
  downloadCheckedIn: 'Download the checked in list',
  downloadFailed: 'Could not build that file. Try again.',
  // Mirrors the crew-access empty state: an assignment without shifts.
  emptyLine:
    'No shift covered checkpoints yet. Your fest admin schedules you at one, and it appears here.',
  errorMessage: 'Could not load your dashboard.',
  retry: 'Try again',
  offline:
    'You are offline, so these counts are the last ones loaded and downloads are unavailable until you are back on a network.',
};

export const CALENDAR_COPY = {
  sectionLabel: 'Add to calendar',
  googleCalendar: 'Google Calendar',
  downloadIcs: 'Download .ics',
};

export const SCANNER_COPY = {
  checkInButton: 'Check In',
  checkOutButton: 'Check Out',
  cancelScan: 'Cancel',
  currentlyInside: 'Currently checked in',
  unknownParticipant: 'Participant',
  // Scan feedback toggle. Labelled by the ACTION the tap performs, not the
  // current state, so a screen reader announces what will happen.
  muteAudio: 'Mute scan sound',
  unmuteAudio: 'Unmute scan sound',
  qrScan: 'Scan QR',
  backupCode: 'Backup code',
  backupCodeInstruction: "Enter the 6-digit code on the participant's pass",
  backupClear: 'Clear',
  directionInOnly: 'IN ONLY',
  directionInAndOut: 'IN & OUT',
  directionInLabel: 'IN',
  directionOutLabel: 'OUT',
  alignHint: 'Align QR code within the frame',
  autoDetectHint: 'The scanner will detect automatically',
  flashlightOn: 'Turn flashlight on',
  flashlightOff: 'Turn flashlight off',
  scanSuccessSub: 'Participant verified and checked in',
  checkedInBanner: 'CHECKED IN SUCCESSFULLY',
  checkedOutBanner: 'CHECKED OUT SUCCESSFULLY',
  // Balance line for a multi-use offer claim, shown AFTER this scan consumed one.
  offerRemaining: (remainingUses, maximumUses) => `${remainingUses} OF ${maximumUses} REMAINING`,
  verify: 'Verify code',
  accessGranted: 'Scan Successful',
  accessDenied: 'Access Denied',
  scanNext: 'SCAN NEXT',
  noActiveShiftTitle: 'NO ACTIVE SHIFT',
  noActiveShiftSubtext: 'You have no shift active at this checkpoint right now.',
  checkMyShifts: 'CHECK MY SHIFTS',
  cameraDenied: 'Camera access is required to scan. Enable it or use the backup code.',
  errorMessage: 'Scan failed. Try again.',
};

// scan result -> denial instruction line shown on rejection.
export const SCAN_REJECTION_MESSAGES = {
  rejectedPassNotFound: 'NO PASS FOUND — CHECK ID MANUALLY',
  rejectedPassInactive: 'PASS DEACTIVATED — CONTACT ADMIN',
  rejectedNoEntitlement: 'NOT AUTHORIZED FOR THIS CHECKPOINT',
  rejectedAlreadyUsed: 'ALREADY CHECKED IN — DUPLICATE SCAN',
  rejectedExpired: 'ENTITLEMENT EXPIRED',
  rejectedWrongCheckpoint: 'WRONG ENTRY POINT — REDIRECT',
  rejectedFestNotOngoing: 'FEST NOT ACTIVE YET',
  rejectedNoActiveShift: 'YOUR SHIFT IS NOT ACTIVE',
  /*
   * Not a problem with the pass — a problem with where its holder is. The line
   * says what to DO about it, because the volunteer reading it has to redirect
   * a person, not diagnose a pass.
   */
  rejectedMainGateRequired: 'MAIN GATE CHECK-IN REQUIRED FIRST',
};

/*
 * The Main Gate's own accept states. The gate is the one checkpoint where
 * "accepted" is two different facts: first entry of the day, or someone coming
 * back in. A volunteer holding an entrance queue needs to tell them apart at a
 * glance — a re-entry means the scanner is working and this person has already
 * been counted, not that they are being admitted twice.
 */
export const CAMPUS_ACCESS_COPY = {
  entryConfirmed: 'CAMPUS ENTRY CONFIRMED',
  reEntry: 'RE-ENTRY',
  reEntrySince: (timeLabel) => `Already checked in today at ${timeLabel}`,
  mainGateHint: 'Send them to the Main Gate first.',

  // The participant's own pass.
  passHeading: 'CAMPUS ACCESS',
  checkedInToday: (timeLabel) => `Checked in at ${timeLabel}`,
  notCheckedInToday: 'Campus entry required',
  notCheckedInHint: 'Scan this pass at the Main Gate to enter.',
  historyHeading: 'Earlier days',

  // The gate volunteer's dashboard.
  entriesTodayLabel: 'Campus entries today',
  recentEntriesHeading: 'Recent entries',
  noEntriesYet: 'No one has entered yet today.',
};

export const SPONSORS_COPY = {
  heading: 'SPONSORS',
  logoAlt: (sponsorName) => (sponsorName ? `${sponsorName} logo` : 'Sponsor logo'),
};

/*
 * The day-by-day "what's on right now" view. A participant standing in a fest
 * with fifteen events needs two answers — what is happening now, and what is
 * next — and the schedule is the screen that answers both.
 */
export const SCHEDULE_COPY = {
  title: 'Schedule',
  subtitle: 'The full running order',
  viewSchedule: 'View schedule',
  dayTabsLabel: 'Fest days',
  dayTabPrefix: 'Day',
  statTotal: 'events',
  statLive: 'live now',
  statUpcoming: 'still to come',
  bookedSuffix: '% booked',
  fillingFast: 'Filling fast',
  // Announced when a day tab is selected, so a screen-reader user learns how
  // much is on that day without walking the whole list.
  dayPanelLabel: (dayLabel, eventCount) =>
    `${dayLabel}, ${eventCount} ${eventCount === 1 ? 'event' : 'events'}`,
  statusLive: 'Live',
  statusUpcoming: 'Upcoming',
  statusEnded: 'Ended',
  liveNowLabel: 'Happening now',
  emptyDayTitle: 'Nothing scheduled',
  emptyDaySubtext: 'No events run on this day.',
  emptyFestTitle: 'No events yet',
  emptyFestSubtext: 'This fest has not published its schedule.',
  errorMessage: 'Could not load the schedule.',
  noVenue: 'Venue to be announced',
};

/*
 * The coordinator's bulk message to confirmed participants. Every string here
 * leans on the same idea: this reaches real inboxes, it cannot be recalled, and
 * there are only three a day.
 */
export const NOTIFY_PARTICIPANTS_COPY = {
  openButton: 'Notify participants',
  modalTitle: 'Message participants',
  subjectLabel: 'Subject',
  messageLabel: 'Message',
  messagePlaceholder: 'Venue moved to Room 204. Please come to the second floor.',
  recipientCount: (count) =>
    `This will be sent to ${count} confirmed participant${count === 1 ? '' : 's'}.`,
  noRecipients: 'This event has no confirmed participants yet.',
  budgetRemaining: (used, limit) => `${used} of ${limit} sent today`,
  budgetExhausted: 'Daily limit reached. You can send again tomorrow.',
  reviewTitle: 'Send this message?',
  reviewBody: (count) => `This goes to ${count} participants and cannot be undone.`,
  send: 'Review and send',
  sending: 'Sending…',
  confirmSend: 'Yes, send it',
  cancel: 'Cancel',
  subjectRequired: 'Give the message a subject.',
  messageRequired: 'Write the message.',
  sendFailed: 'Could not send. Try again.',
  sentBanner: (count) => `Sent to ${count} participants.`,
  partialBanner: (sent, failed) => `Sent to ${sent}. ${failed} could not be delivered.`,
};

export const COORDINATOR_COPY = {
  title: 'Control panel',
  // Single-page dashboard layout.
  statusLive: 'Live now',
  statusUpcoming: 'Not started',
  statusCompleted: 'Finished',
  statRegistered: 'Registered',
  statTeams: 'Teams',
  statRounds: 'Rounds',
  commandCenterTitle: 'Actions',
  actionOpenScanner: 'Open scanner',
  actionAdvanceRound: 'Enter match results',
  actionPushCertificates: 'Certificates',
  actionPostAnnouncement: 'Message participants',
  roundManagementTitle: 'Rounds',
  roundStatusCompleted: 'Done',
  roundStatusInProgress: 'In progress',
  roundStatusUpcoming: 'Not started',
  roundMatchesDecided: (decided, total) => `${decided} of ${total} matches decided`,
  participantsTitle: 'Participants',
  detailsSectionTitle: 'Event details',
  matchesSectionTitle: 'Matches',
  certificatesSectionTitle: 'Certificates',
  sectionFeedback: 'What participants said',
  feedbackAverageLabel: 'Average rating',
  feedbackResponsesLabel: 'Responses',
  feedbackCommentsLabel: 'Recent comments',
  feedbackOutOfFive: 'out of 5',
  tabDetails: 'Details',
  tabRoster: 'Roster',
  tabMatches: 'Matches',
  tabCertificates: 'Certificates',
  // Admin-only link out to the console's Staff assignments screen (same screen,
  // pre-filtered to this fest) — never a second revoke UI.
  manageStaffForEvent: 'Manage staff',
  contingentTag: 'Contingent',
  contingentViaPrefix: 'Via',
  contingentBuyerPrefix: 'Bought by',
  pendingInvitesHeading: 'Seat reserved, not yet confirmed',
  pendingInviteLine: (emailAddress) => `Invite sent to ${emailAddress}`,
  sectionTiming: 'Timing',
  sectionVenueCapacity: 'Venue and capacity',
  sectionContent: 'Description and rules',
  labelStartsAt: 'Starts at',
  labelEndsAt: 'Ends at',
  labelRegOpens: 'Registration opens',
  labelRegCloses: 'Registration closes',
  labelVenue: 'Venue',
  labelCapacity: 'Capacity',
  labelFee: 'Entry fee',
  feeHelper: 'Amount in rupees',
  labelLeaderboard: 'Leaderboard visible',
  labelDescription: 'Description',
  labelRules: 'Rules',
  filledSuffix: 'filled',
  saveChanges: 'Save changes',
  discard: 'Discard',
  saveFailed: 'Could not save. Try again.',
  // Inline non-bracket score entry on the roster tab.
  scoresNotInitialized: 'No score sheet yet.',
  initializeScoresButton: 'Create score sheet',
  scoreInputLabel: 'Score',
  scoreConflictReloaded: 'Someone else saved first. The row now shows their value.',
  registeredSuffix: 'registered',
  rosterSearchPlaceholder: 'Search by name or USN',
  mealsSuffix: 'meals',
  leaderPrefix: 'Leader',
  noBracketTitle: 'No bracket yet',
  noBracketSubtext: 'Ask your admin to generate the bracket.',
  roundPrefix: 'Round',
  versusLabel: 'versus',
  winnerPrefix: 'Winner',
  saveResult: 'Save result',
  updateResult: 'Update result',
  matchConflict: 'This match was updated elsewhere.',
  matchTie: 'Scores cannot be equal. A knockout match needs a winner.',
  reload: 'Reload',
  toggleOn: 'On',
  toggleOff: 'Off',

  // Certificates tab — event-scoped generate/release only. The certificate
  // TEMPLATE is fest-wide branding and stays administrator-only.
  certScopeLine: (eventName) => `These actions apply to ${eventName} only.`,
  certGenerate: 'Generate certificates',
  certRelease: 'Release certificates',
  certGenerateConfirmBody:
    'Generate certificates for everyone this event owes them to? Running it again later only adds newcomers, and nothing is duplicated.',
  certReleaseConfirmBody:
    'Release this event\u2019s certificates to their holders? This cannot be undone from this screen.',
  certConfirm: 'Confirm',
  certCancel: 'Cancel',
  certGenerateResult: (generatedCount, skippedCount) =>
    `Generated ${generatedCount}. ${skippedCount} already existed.`,
  certReleaseResult: (releasedCount) => `Released ${releasedCount}.`,
  certNoCandidates: 'No eligible participants yet, so nothing was generated.',
  certActionFailed: 'That action could not be completed. Try again.',

  errorMessage: 'Could not load this event.',
};

export const CREW_DIRECTORY_COPY = {
  notRegisteredMessage:
    'Register for an event under this fest to view its crew directory.',
  title: 'CREW DIRECTORY',
  pageTitle: 'Crew Directory',
  searchPlaceholder: 'Search crew members...',
  statCoordinators: 'COORDINATORS',
  statVolunteers: 'VOLUNTEERS',
  sectionCoordinators: 'Coordinators',
  sectionVolunteers: 'Volunteers',
  badgeCoordinators: 'Core Team',
  badgeVolunteers: 'On-Ground',
  crewCountSuffix: 'CREW MEMBERS',
  roleCoordinator: 'COORDINATOR',
  roleVolunteer: 'VOLUNTEER',
  viaPrefix: 'VIA',
  call: 'CALL',
  message: 'MESSAGE',
  email: 'EMAIL',
  emptyTitle: 'No crew members assigned yet',
  emptySubtext: 'When staff are assigned to this fest, they appear here.',
  noMatchesPrefix: 'NO MATCHES FOR',
  errorMessage: 'Could not load the crew directory.',
};

/*
 * The crew-directory fest picker. Consumed by screens/crew-select only, so this
 * block was corrected in place rather than overridden locally: sentence case
 * instead of stamped uppercase, "My fests" for the ones the signed-in user
 * staffs, and the empty state collapsed from a title/subtext pair to the single
 * sentence EmptyState takes.
 */
export const CREW_SELECT_COPY = {
  title: 'Crew directory',
  subtitle: 'Pick a fest to see its crew.',
  searchPlaceholder: 'Search fests',
  clearSearch: 'Clear the search',
  yourFests: 'My fests',
  allFests: 'All fests',
  emptyLine: 'Fests with a crew directory will show up here.',
  noMatches: (query) => `No fests match "${query}".`,
  errorMessage: 'Could not load fests.',
  retry: 'Try again',
  offline:
    'You are offline, so this is the last version loaded. It will refresh when you are back on a network.',
};

export const PROFILE_HUB_COPY = {
  title: 'Profile',
  edit: 'Edit profile',
  idPrefix: 'ID:',
  labelCollege: 'COLLEGE',
  labelDepartment: 'DEPARTMENT',
  labelYear: 'YEAR',
  labelPhone: 'PHONE',
  labelStatus: 'STATUS',
  verified: 'VERIFIED',
  // The status pill parts: "Active · 3rd Year · CSE". The ordinal is composed
  // in the screen; this is the word that follows it.
  statusActive: 'Active',
  yearSuffix: 'Year',
  statFestsAttended: 'Fests',
  statEventsEntered: 'Events',
  statCertificates: 'Certificates',
  quickAccess: 'Quick Access',
  rowRegistrations: 'Registrations',
  rowPasses: 'Passes',
  rowCertificates: 'My Certificates',
  rowTeams: 'My Team',
  rowSaved: 'Saved Events',
  rowBackstage: 'Backstage',
  createTeam: 'Create Team',
  joinTeam: 'Join Team',
  notificationsLabel: 'Notifications',
  logOut: 'Log Out',
  deleteAccount: 'Delete Account',
  deleteConfirm: 'Delete your account? This cannot be undone.',
};

export const SETTINGS_COPY = {
  title: 'SETTINGS',
  sectionAccount: 'Account',
  sectionNotifications: 'Notifications',
  sectionPreferences: 'Preferences',
  sectionLegal: 'Legal',
  sectionSupport: 'Support',
  sectionAbout: 'About',
  editProfile: 'Edit profile',
  pushNotifications: 'Push notifications',
  emailUpdates: 'Email updates',
  eventReminders: 'Event reminders',
  liveScores: 'Live scores',
  language: 'Language',
  languageValue: 'English',
  darkMode: 'Dark mode',
  wifiOnly: 'Download over Wi-Fi only',
  helpCenter: 'Help centre',
  contactUs: 'Contact us',
  emailAddress: 'Email address',
  phoneNumber: 'Phone number',
  participantId: 'Participant ID',
  notifications: 'Notifications',
  termsOfService: 'Terms of service',
  privacyPolicy: 'Privacy policy',
  consentRecord: 'Consent record',
  termsAcceptedPrefix: 'Terms accepted:',
  privacyAcceptedPrefix: 'Privacy accepted:',
  notRecorded: 'Not recorded',
  // Consent standing, per document, from the consent records.
  consentTermsName: 'Terms of Service',
  consentPrivacyName: 'Privacy Policy',
  consentAcceptedOn: (versionLabel, date) => `Accepted version ${versionLabel} on ${date}`,
  consentWithdrawnOn: (date) => `Withdrawn on ${date}`,
  consentNone: 'No acceptance recorded',
  consentCurrent: 'This is the current version.',
  consentSuperseded: 'A newer version has since been published.',
  consentViewVersion: 'View the text you accepted',
  consentLoadFailed: 'Your consent record could not be loaded.',
  consentOffline: 'You are offline, so your consent record could not be loaded.',
  version: 'Version',
  versionValue: '1.0.0',
  builtBy: 'Built by',
  builtByValue: 'Dedal',
  logOut: 'Log out',
  deleteAccount: 'Delete account',
  deleteConfirm: 'Delete your account? This cannot be undone.',
  toggleOn: 'ON',
  toggleOff: 'OFF',
};

export const NOTIFICATIONS_COPY = {
  markAllRead: 'Mark all read',
  emptyTitle: "You're all caught up",
  emptySubtext: 'Updates about your fests, passes and results will appear here.',
  errorMessage: 'Could not load notifications.',
};

// Public college onboarding surface: /for-colleges marketing page, the
// /register-college application form, its success page, and the public
// application-status page. No authentication anywhere on this flow.
export const COLLEGE_ONBOARDING_COPY = {
  statusSubtitle: 'Track your registration progress.',
  timelineHeading: 'STATUS TIMELINE',
  timelineSubmittedTitle: 'Application Submitted',
  timelineSubmittedBody: 'Your application has been received.',
  timelineReviewTitle: 'Under Review',
  timelineReviewBody: 'Our team is reviewing your application and documents.',
  timelineDecisionTitle: 'Decision Finalized',
  timelineDecisionApproved: 'Approved',
  timelineDecisionDeclined: 'Application Declined',
  assistTitle: 'Need Assistance?',
  assistBody: 'Contact our admissions support desk.',
  assistButton: 'SUPPORT',
  // Structured postal address. Lines 3/4, town/locality and country are
  // overflow — only line 1, city, district, state and PIN are mandatory.
  addressLine1Label: 'ADDRESS LINE 1',
  addressLine1Placeholder: 'Building, street',
  addressLine2Label: 'ADDRESS LINE 2 (OPTIONAL)',
  addressLine2Placeholder: 'Area, landmark',
  addressLine3Label: 'ADDRESS LINE 3 (OPTIONAL)',
  addressLine4Label: 'ADDRESS LINE 4 (OPTIONAL)',
  townOrLocalityLabel: 'TOWN / LOCALITY (OPTIONAL)',
  townOrLocalityPlaceholder: 'Locality',
  districtLabel: 'DISTRICT',
  districtPlaceholder: 'District',
  pinCodeLabel: 'PIN CODE',
  pinCodePlaceholder: '560001',
  pinCodeInvalid: 'Enter a valid 6-digit Indian PIN code (first digit 1–8).',
  // /for-colleges landing
  heroKicker: 'FOR COLLEGES',
  heroHeadline: 'Bring Your College Fest to dedal',
  heroSubtext:
    'One platform for registrations, passes, staff, and certificates — built for Indian college fests.',
  heroCta: 'REGISTER YOUR COLLEGE →',
  featuresHeader: 'Engineered for Excellence',
  statsHeader: 'TRUSTED BY NUMBERS',
  statCollegesValue: '50+',
  statCollegesLabel: 'COLLEGES',
  statStudentsValue: '100k',
  statStudentsLabel: 'STUDENTS',
  statEventsValue: '1.2k',
  statEventsLabel: 'EVENTS',
  howHeader: 'How It Works',
  howStep1Title: 'Apply for Access',
  howStep1Body: 'Submit your college details and documents through the application form.',
  howStep2Title: 'Configure Festival',
  howStep2Body: 'Set up your fest, events, staff roles, and passes from the admin console.',
  howStep3Title: 'Go Live',
  howStep3Body: 'Publish your fest and open registrations to students everywhere.',
  ctaFooterHeadline: 'Ready to Transform Your College Fest?',
  ctaFooterBody: 'Join the colleges already running their fests on Dedal.',
  ctaFooterButton: 'Get Started Today',
  featureRegistrationsTitle: 'REGISTRATIONS',
  featureRegistrationsBody:
    'Solo and team sign-ups, custom questions, payment collection, and live rosters for every event in your fest.',
  featurePassesTitle: 'PASSES + QR SCANNING',
  featurePassesBody:
    'Every participant carries a QR pass. Volunteers scan at the gate and at events — no paper lists, no duplicates.',
  featureStaffTitle: 'STAFF & VOLUNTEERS',
  featureStaffBody:
    'Assign coordinators and volunteers, plan shifts, and give each crew member exactly the access they need.',
  featureCertificatesTitle: 'CERTIFICATES',
  featureCertificatesBody:
    'Issue participation and winner certificates in bulk, each with a public verification code recruiters can check.',
  pricingHeader: 'PRICING',
  pricingTitle: 'FREE DURING BETA',
  pricingBody:
    'Dedal is free for colleges while we are in beta. Register now and run your next fest at no cost.',
  bottomCtaHeadline: 'READY TO RUN YOUR FEST?',
  bottomCta: 'REGISTER YOUR COLLEGE →',

  // /register-college form
  formTitle: 'Register Your College',
  stepLabelPrefix: 'STEP',
  stepOf: 'OF',
  // The 4-step Heritage flow + review. Long titles head each card; short labels
  // sit under the stepper circles.
  stepCollegeTitle: 'College Information',
  stepAddressTitle: 'Address Details',
  stepContactTitle: 'Point of Contact',
  stepDocumentsTitle: 'Documents & Notes',
  stepReviewTitle: 'Review & Submit',
  stepLabelCollege: 'College Info',
  stepLabelAddress: 'Address',
  stepLabelContact: 'Contact',
  stepLabelDocuments: 'Document',
  stepCollegeSubtitle: 'Tell us about the institution applying.',
  stepAddressSubtitle: 'The campus postal address, as India Post knows it.',
  stepContactSubtitle: 'Who should we talk to about this application?',
  stepDocumentsSubtitle: 'Anything that helps us verify faster.',
  stepReviewSubtitle: 'Check everything before you submit.',
  // New Step-1 fields from the Heritage design. NOTE: the backend whitelist
  // currently drops these keys, so their values are ALSO folded into
  // notesFromApplicant at submit time — that is how they reach the reviewer.
  collegeEmailLabel: 'COLLEGE EMAIL ID',
  collegeEmailPlaceholder: 'office@yourcollege.edu',
  collegeTypeLabel: 'INSTITUTION TYPE',
  collegeTypePlaceholder: 'Select Institution Type',
  collegeTypeOtherLabel: 'ENTER INSTITUTION TYPE',
  collegeTypeOtherPlaceholder: 'e.g. Autonomous Management Institute',
  collegeTypeOtherRequired: 'Enter your institution type.',
  usnFormatLabel: 'STUDENT REGISTRATION NUMBER FORMAT',
  usnFormatPlaceholder: '2512XXXXXXXXX',
  usnFormatHelper: 'Use X for variable digits, other characters are fixed.',
  editSection: 'Edit',
  uploadZoneText: 'Drag & drop files here or click to browse',
  uploadHint: 'PDF, JPG or PNG. Up to 5 MB each.',
  uploadInProgress: 'Uploading...',
  uploadWrongType: 'Only PDF, JPG or PNG files are accepted.',
  uploadTooLarge: (fileName) => `${fileName} is larger than 5 MB.`,
  uploadFailed: 'That file could not be uploaded. Try again.',
  removeDocument: (fileName) => `Remove ${fileName}`,
  uploadDeferredNote: 'Documents can be submitted after initial review.',

  collegeNameLabel: 'COLLEGE NAME',
  collegeNamePlaceholder: 'Full official college name',
  collegeAddressLabel: 'ADDRESS',
  collegeAddressPlaceholder: 'Street address / campus',
  collegeCityLabel: 'CITY',
  collegeCityPlaceholder: 'e.g. Bengaluru',
  collegeStateLabel: 'STATE',
  collegeWebsiteLabel: 'WEBSITE',
  collegeWebsiteOptional: '(Optional)',
  collegeWebsitePlaceholder: 'https://yourcollege.edu',
  expectedFestSizeLabel: 'EXPECTED FEST SIZE',

  applicantFullNameLabel: 'YOUR FULL NAME',
  applicantFullNamePlaceholder: 'Who is applying?',
  applicantEmailLabel: 'EMAIL ADDRESS',
  applicantEmailPlaceholder: 'you@college.edu',
  applicantEmailHelper: 'We will send the decision to this address.',
  applicantPhoneLabel: 'PHONE NUMBER',
  applicantPhonePlaceholder: '10-digit phone number',
  applicantRoleLabel: 'YOUR ROLE AT THE COLLEGE',
  applicantRolePlaceholder: 'e.g. Student council head, Faculty coordinator',

  notesLabel: 'ANYTHING WE SHOULD KNOW?',
  notesOptional: '(Optional)',
  notesPlaceholder: 'Upcoming fest dates, past fests, questions…',
  documentsNote: 'Document upload will be requested during review if needed.',
  directoryMatchNote:
    "This college is in our directory — you'll be registered as its first administrator.",
  reviewHeader: 'REVIEW YOUR APPLICATION',

  back: 'Back',
  next: 'Next',
  submit: 'Submit Application',
  requiredField: 'This field is required.',
  invalidEmail: 'Enter a valid email address.',
  invalidPhone: 'Enter a valid 10-digit phone number.',
  submitFailed: 'Could not submit your application. Please try again.',
  rateLimited: 'Too many applications from here. Please try again later.',

  // The one-line pointer at the foot of Discover home.
  discoverPrompt: 'Are you a college?',
  discoverLink: 'Register here',

  // /register-college/success
  successHeadline: 'Application Submitted',
  copyApplicationId: 'Copy application ID',
  copiedApplicationId: 'Copied',
  successSubtext: "We'll email you within 24 hours with the decision.",
  applicationIdLabel: 'APPLICATION ID',
  successKeepId: 'Save this ID — you can check your status with it any time.',
  checkStatus: 'CHECK APPLICATION STATUS',
  backToLanding: 'Back to dedal for colleges',
  missingIdTitle: 'NO APPLICATION FOUND',
  missingIdSubtext: 'We could not find an application id. Start a new application below.',
  startApplication: 'START AN APPLICATION →',

  // /register-college/status/:applicationId
  statusTitle: 'APPLICATION STATUS',
  statusCollegeLabel: 'COLLEGE',
  statusSubmittedLabel: 'SUBMITTED',
  statusReviewedLabel: 'REVIEWED',
  statusPendingTitle: 'PENDING',
  statusPendingBody: 'Your application is in the queue. We review every application within 24 hours.',
  statusUnderReviewTitle: 'UNDER REVIEW',
  statusUnderReviewBody: 'Our team is reviewing your application right now. You will hear from us by email.',
  statusApprovedTitle: 'APPROVED',
  statusApprovedBody:
    'Your college is registered on Dedal. Check your email for the next steps to set up your first fest.',
  statusRejectedTitle: 'NOT APPROVED',
  statusRejectedBody: 'This application was not approved.',
  statusRejectionReasonLabel: 'REASON',
  statusNotFoundTitle: 'APPLICATION NOT FOUND',
  statusNotFoundBody: 'No application matches this id. Check the id from your confirmation email.',
  statusErrorMessage: 'Could not load the application status.',
  applyAgain: 'APPLY AGAIN →',

  /*
   * ── THE dedal REDESIGN OF THE PUBLIC COLLEGE SURFACE ──────────────────────
   *
   * The form, its confirmation and its status page, restyled onto the dedal
   * design system. These keys are APPENDED rather than edited in place: the
   * Title Case and ALL CAPS strings above are still read by the /for-colleges
   * landing, which is a separate piece of work, and rewriting them here would
   * silently change a screen this change does not own.
   *
   * Everything below is sentence case, which is the design system's rule. The
   * `dco` prefix matches the stylesheet (design/college-onboarding.css) so it
   * is obvious at a glance which surface a string belongs to.
   */
  dcoFormTitle: 'Register your college',
  dcoProgressLabel: 'Application progress',
  dcoStepCollegeTitle: 'About your college',
  dcoStepAddressTitle: 'Campus address',
  dcoStepContactTitle: 'Point of contact',
  dcoStepDocumentsTitle: 'Documents and notes',
  dcoStepReviewTitle: 'Review and submit',
  dcoStepCollegeSubtitle: 'Tell us about the institution applying.',
  dcoStepAddressSubtitle: 'The campus postal address, as India Post knows it.',
  dcoStepContactSubtitle: 'Who should we talk to about this application?',
  dcoStepDocumentsSubtitle: 'Anything that helps us verify faster.',
  dcoStepReviewSubtitle: 'Check everything before you submit.',
  dcoBack: 'Back',
  dcoContinue: 'Continue',
  dcoSubmit: 'Submit application',
  dcoEdit: 'Edit',
  // The reason an inert Continue is inert. A dead control that does not say why
  // is the commonest dead end in a form.
  dcoIncompleteReason: 'Fill in the required fields to continue.',
  dcoConflictLink: 'Check your application status',
  dcoOptional: 'Optional',

  // Field labels, sentence case.
  dcoCollegeNameLabel: 'College name',
  dcoCollegeEmailLabel: 'College email',
  dcoCollegeTypeLabel: 'Institution type',
  dcoCollegeTypeOtherLabel: 'Describe your institution type',
  dcoUsnFormatLabel: 'Registration number format',
  dcoCollegeWebsiteLabel: 'Website',
  dcoExpectedFestSizeLabel: 'Expected fest size',
  dcoAddressLine1Label: 'Address line 1',
  dcoAddressLine2Label: 'Address line 2',
  dcoTownOrLocalityLabel: 'Town or locality',
  dcoCityLabel: 'City',
  dcoStateLabel: 'State',
  dcoPinCodeLabel: 'PIN code',
  dcoApplicantNameLabel: 'Your full name',
  dcoApplicantEmailLabel: 'Email address',
  dcoApplicantPhoneLabel: 'Phone number',
  dcoApplicantRoleLabel: 'Your role at the college',
  dcoNotesLabel: 'Anything we should know?',
  dcoAddressSummaryLabel: 'Address',
  dcoDocumentsSummaryLabel: 'Documents',
  dcoNotesSummaryLabel: 'Notes',
  dcoDocumentCount: (count) => (count === 1 ? '1 file attached' : `${count} files attached`),
  dcoUploadZoneTitle: 'Add supporting documents',

  // /register-college/success
  dcoSuccessHeadline: 'Application submitted',
  // Exactly one sentence of prose. The timeline underneath reuses
  // `successSubtext` above rather than adding a second promise about timing.
  dcoSuccessProse: "We'll review your application and get back to you.",
  dcoApplicationIdLabel: 'Application ID',
  dcoCopyId: 'Copy application ID',
  dcoCopiedId: 'Application ID copied',
  dcoTrackStatus: 'Track your application status',
  dcoReturnHome: 'Return to Dedal',
  dcoMissingIdTitle: 'No application found',
  dcoMissingIdBody: 'We could not find an application ID. Start a new application below.',
  dcoStartApplication: 'Start an application',

  // /register-college/status/:applicationId
  dcoStatusPendingTitle: 'Application received',
  dcoStatusPendingBody: "We're reviewing your application.",
  dcoStatusUnderReviewTitle: 'Under review',
  dcoStatusUnderReviewBody: 'Your application is being reviewed by our team.',
  dcoStatusApprovedTitle: 'Welcome to Dedal',
  dcoStatusApprovedBody: 'Your college is registered. Check your email for the next steps.',
  dcoStatusApprovedCta: 'Sign in to get started',
  dcoStatusRejectedTitle: 'Application not approved',
  dcoStatusRejectedBody: 'This application was not approved.',
  dcoStatusRejectedCta: 'Apply again',
  dcoDetailsHeading: 'Application details',
  dcoStatusLabel: 'Status',
  dcoCollegeLabel: 'College',
  dcoSubmittedLabel: 'Submitted',
  dcoNotFoundTitle: 'Application not found',
  dcoNotFoundBody: 'No application matches this ID. Check the ID from your confirmation email.',
  // The four status enums, sentence case, for the details row.
  dcoStatusValues: {
    pending: 'Application received',
    underReview: 'Under review',
    approved: 'Approved',
    rejected: 'Not approved',
  },
};

// expectedFestSize enum -> radio labels shown on the form.
// Institution types for the college application's Step 1 dropdown. Display
// only — the value travels to the reviewer via the notes fold-in (see
// RegisterCollegeScreen) until the backend learns the field.
/*
 * "Other" is deliberately LAST and is the only entry that opens a free-text box
 * — see collegeTypeOther in the register-college screen. Everything above it is
 * a name a reviewer will see verbatim on the application.
 */
export const COLLEGE_TYPE_OPTIONS = [
  'Engineering',
  'Medical',
  'Arts & Science',
  'Law',
  'Commerce',
  'Management / MBA',
  'Science',
  'Universities',
  'Deemed-to-be Universities',
  'Pharmacy',
  'Education / B.Ed',
  'Architecture',
  'Agriculture',
  'Other',
];

export const COLLEGE_TYPE_OTHER = 'Other';

export const EXPECTED_FEST_SIZE_OPTIONS = [
  // Sentence case, like every other label on the redesigned form. The VALUES
  // are the wire format and are untouched.
  { value: 'under-500', label: 'Under 500' },
  { value: '500-1500', label: '500 – 1,500' },
  { value: '1500-5000', label: '1,500 – 5,000' },
  { value: '5000+', label: '5,000+' },
];

// Deliberately short state list: Karnataka first (our launch state), its
// neighbours, then "Other" as the catch-all.
export const COLLEGE_STATE_OPTIONS = [
  'Karnataka',
  'Tamil Nadu',
  'Kerala',
  'Andhra Pradesh',
  'Telangana',
  'Goa',
  'Maharashtra',
  'Other',
];

export const DESKTOP_COMING_SOON_COPY = {
  headline: 'Coming Soon to Desktop',
  subhead: 'dedal is currently mobile-only. We are working on the desktop experience.',
  phonePrompt: 'For now, please open Dedal on your phone.',
  // Aspirational store buttons — visual only, no native apps exist yet.
  appStoreButton: 'Download on the App Store',
  playStoreButton: 'GET IT ON Google Play',
  qrTitle: 'Scan to get quick mobile access',
  taglineCaps: 'ONE PASS. EVERY FEST. ZERO CHAOS.',
};

/*
 * Contingent registration — participant-facing. All contingent copy routes
 * through this block; no inline text.
 */
export const PARTICIPANT_CONTINGENT_COPY = {
  // Per-vertical contingent codes (Phase 2).
  verticalCodesTitle: 'Join codes',
  verticalCodesHelp:
    'One code per vertical. Each code fills a seat you have already paid for — share it with the person competing in that vertical.',
  copy: 'Copy',
  copied: 'Copied',
  copyAllCodes: 'Copy all',
  copyFailed: 'Could not copy to the clipboard. Select the code and copy it manually.',
  copyCodeFor: (eventName) => `Copy the join code for ${eventName}`,
  shareCodeWith: (eventName) => `Share this code with participants joining ${eventName}.`,
  slotsRemaining: (remainingSlots, maxClaims) =>
    remainingSlots === 0 ? 'Fully claimed' : `${remainingSlots} of ${maxClaims} left`,
  codeInvalid: 'Invalid code.',
  codeAvailable: (eventName, remainingSlots) =>
    `${eventName} — ${remainingSlots} ${remainingSlots === 1 ? 'slot' : 'slots'} remaining`,
  codeExhausted: 'This code has been fully claimed.',
  codeAlreadyJoined: 'You have already joined this event.',
  underParent: (parentEventName) => `under ${parentEventName}`,
  joinedVertical: (eventName, parentEventName) =>
    parentEventName
      ? `You've joined ${eventName} under ${parentEventName}.`
      : `You've joined ${eventName}.`,
  bundleTag: 'BUNDLE',
  purchaseSubtitle: 'Contingent Registration',
  groupAccessTitle: 'Group Access',
  groupAccessBody: (eventCount) =>
    `One bundle covering ${eventCount} sub-event${eventCount === 1 ? '' : 's'} — name one attendee for each below. Each attendee receives an email invite to claim their seat.`,
  orderSummaryTitle: 'ORDER SUMMARY',
  bundleLine: (eventCount) => `Bundle (${eventCount} event${eventCount === 1 ? '' : 's'})`,
  totalLabel: 'Total',
  proceedToPayment: 'PROCEED TO PAYMENT',
  includesPrefix: 'INCLUDES',
  individualTotalLabel: 'INDIVIDUALLY',
  bundlePriceLabel: 'BUNDLE PRICE',
  saveLine: (rupees) => `SAVE ₹${rupees}`,
  viewBundle: 'VIEW BUNDLE',

  purchaseTitle: 'CONTINGENT',
  // TODO(client approval): this DPDP notice wording must be reviewed with the
  // client before launch. It is a plain-language notice, not a checkbox.
  dpdpNotice:
    'You are sharing contact details of other people. We will invite each attendee to sign in and confirm their own registration; they’ll accept our terms themselves before their pass is issued.',
  attendeeHeadingPrefix: 'ATTENDEE FOR',
  fullNameLabel: 'FULL NAME',
  emailLabel: 'EMAIL ADDRESS',
  phoneLabel: 'PHONE NUMBER',
  selfSlotNote: 'THIS IS YOU — NO INVITE EMAIL NEEDED',
  duplicateEmailNote:
    'Same person on multiple events: they’ll get ONE invite covering all of them. Overlapping schedules are your responsibility.',
  buyerTermsNote: 'By paying you accept the terms yourself, as the purchasing user.',
  purchaseButton: 'CONTINUE TO PAYMENT',
  purchaseFailed: 'THE PURCHASE COULD NOT BE COMPLETED.',
  seatUnavailablePrefix: 'NO SEAT LEFT IN',
  errorMessage: 'THIS CONTINGENT COULD NOT BE LOADED.',

  invitedPanelTitle: 'YOU’VE BEEN ADDED TO A CONTINGENT',
  invitedByPrefix: 'BOUGHT BY',
  acceptButton: 'ACCEPT',
  declineButton: 'DECLINE',
  acceptFailed: 'THE INVITATION COULD NOT BE ACCEPTED.',
  declineFailed: 'THE INVITATION COULD NOT BE DECLINED.',
  profileCompletionFirst: 'COMPLETE YOUR PROFILE TO ACCEPT',
  declineWarning: 'Declining returns the seat. The buyer is not refunded.',
  purchaseConfirmedBanner: 'PAYMENT CONFIRMED — INVITES ARE ON THEIR WAY.',

  purchasesPanelTitle: 'MY CONTINGENT PURCHASES',
  purchaseCancelButton: 'CANCEL CONTINGENT',
  purchaseCancelConfirm:
    'Cancel this whole contingent purchase? Every seat is released and the refund is processed by the organisers.',
  purchaseCancelFailed: 'THE PURCHASE COULD NOT BE CANCELLED.',
  refundPendingLabel: 'REFUND PENDING',
  claimStatusLabels: {
    invited: 'INVITED',
    accepted: 'ACCEPTED',
    declined: 'DECLINED',
    cancelled: 'CANCELLED',
    expired: 'EXPIRED',
  },
};

/* The add-on step shown after joining by invite code (Phase 3). */
export const POST_JOIN_ADDONS_COPY = {
  heading: 'Add-ons',
  subheading: 'Your place is confirmed. Add food, stay or extras if you need them.',
  yourRegistration: 'Your registration',
  availableAddOns: 'Available add-ons',
  summary: 'Summary',
  total: 'Total',
  free: 'Free',
  people: 'People',
  days: 'Days',
  continue: 'Continue',
  working: 'Please wait…',
  skip: 'Skip for now',
  freeNote: 'No payment needed. These are added straight away.',
  paidNote: 'You will be taken to payment next.',
  noneAvailable: 'There are no add-ons available for this event.',
  loadFailed: 'Could not load add-ons. Your registration is unaffected.',
  submitFailed: 'Could not save your add-ons. Nothing has been charged.',
};

/* Team captain (Phase 3). */
export const TEAM_CAPTAIN_COPY = {
  becomeCaptain: 'Become captain',
  claimOnJoin: 'I’ll be the team captain — the coordinator’s point of contact on the day.',
  autoAssignedNotice:
    'You have been automatically assigned as Team Captain, because the team is now full and nobody else claimed it.',
  youAreCaptain: 'You are the captain',
  captainIs: (fullName) => `Captain: ${fullName}`,
  resign: 'Resign',
  claimFailed: 'Could not claim the captaincy.',
  captainLabel: 'Captain',
};

/*
 * Shared connection copy. A failed request and a missing connection are
 * different problems with different fixes, so they get different words — the
 * screens used to render "Could not load your certificates" for both, which
 * sends someone hunting for a problem with their certificates when their phone
 * is simply offline.
 */
/* The legal-document screens: Terms, Privacy, and a past version by id. */
export const POLICY_DOCUMENT_COPY = {
  termsTitle: 'Terms of Service',
  privacyTitle: 'Privacy Policy',
  versionTitle: 'Policy version',
  loading: 'Loading document',
  versionLabel: (label) => `Version ${label}`,
  effectiveFrom: (date) => (date ? `in effect from ${date}` : 'effective date unknown'),
  supersededNote: 'This version has been superseded by a newer one. It is shown here exactly as it was published.',
  errorTitle: 'The document could not be loaded',
  errorMessage: 'Nothing is shown rather than an incomplete document. Try again in a moment.',
};

export const CONNECTION_COPY = {
  offlineTitle: "You're offline",
  offlineMessage: 'Check your connection and try again. Nothing has been lost.',
  offlineRetry: 'Try again',
  errorTitle: "That didn't load",
  errorRetry: 'Try again',
};

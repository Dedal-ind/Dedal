/*
 * Contingent registration: an admin bundles several SOLO sub-events under one
 * parent ("management event") at one bundle price. A buyer purchases the bundle
 * and names one attendee per sub-event; each attendee materialises their own
 * registration by signing in and accepting the terms themselves (the DPDP-clean
 * shape — the buyer never consents on someone else's behalf).
 */
const CONTINGENT_STATUSES = {
  DRAFT: "draft",
  PUBLISHED: "published",
  CANCELLED: "cancelled",
};

/*
 * WHICH OF THE TWO PURCHASE MODELS A CONTINGENT SELLS UNDER.
 *
 *   claimBased       — the original flow: the buyer names one attendee per
 *                      sub-event at checkout, seats are held at purchase, and
 *                      each attendee accepts or declines their claim.
 *   codeDistribution — the buyer pays for ACCESS, receives codes, and hands
 *                      them out. Nobody is registered until a code is redeemed,
 *                      and the redeemer registers themselves.
 *
 * Every contingent created from now on is codeDistribution. A document that
 * predates the field carries no value at all and is claim-based — that is what
 * resolveContingentFlowType encodes, so no read ever has to guess.
 */
const CONTINGENT_FLOW_TYPES = {
  CLAIM_BASED: "claimBased",
  CODE_DISTRIBUTION: "codeDistribution",
};

function resolveContingentFlowType(contingent) {
  return contingent?.flowType === CONTINGENT_FLOW_TYPES.CODE_DISTRIBUTION
    ? CONTINGENT_FLOW_TYPES.CODE_DISTRIBUTION
    : CONTINGENT_FLOW_TYPES.CLAIM_BASED;
}

/*
 * A code-distribution purchase.
 *   pending   — a paid purchase whose Razorpay capture has not landed. No codes.
 *   completed — paid (or free); codes minted and redeemable.
 *   cancelled — unwound by an organiser; every UNREDEEMED code is dead.
 *   expired   — the payment hold lapsed before capture. Never had codes.
 */
const CONTINGENT_PURCHASE_STATUSES = {
  PENDING: "pending",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

/*
 * One claim per (purchase × included sub-event).
 *   invited   — created at purchase; the attendee has not accepted yet.
 *   accepted  — attendee signed in, accepted the terms, Registration row exists.
 *   declined  — attendee explicitly declined; the seat went back.
 *   cancelled — the buyer (or an admin) cancelled the whole purchase pre-scan.
 *   expired   — never accepted by fest start + 24h; the sweep freed the seat.
 */
const CONTINGENT_CLAIM_STATUSES = {
  INVITED: "invited",
  ACCEPTED: "accepted",
  DECLINED: "declined",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};

/* Claim statuses that still hold (or will hold) a seat in the sub-event. */
const SEAT_HOLDING_CLAIM_STATUSES = [
  CONTINGENT_CLAIM_STATUSES.INVITED,
  CONTINGENT_CLAIM_STATUSES.ACCEPTED,
];

const CONTINGENT_NAME_MAX_LENGTH = 80;
/*
 * A contingent of one sub-event is just that event's registration with extra
 * steps; more than twelve is a data-entry mistake, not a bundle.
 */
const CONTINGENT_EVENTS_MINIMUM = 2;
const CONTINGENT_EVENTS_MAXIMUM = 12;

/*
 * How long after the fest opens an unaccepted invite may keep holding its seat.
 * Past this, the sweep flips it to EXPIRED and the seat goes back on sale — a
 * dead claim must not hold a seat a walk-up participant could take.
 */
const CONTINGENT_CLAIM_EXPIRY_HOURS_AFTER_FEST_START = 24;

module.exports = {
  CONTINGENT_STATUSES,
  CONTINGENT_FLOW_TYPES,
  CONTINGENT_PURCHASE_STATUSES,
  resolveContingentFlowType,
  CONTINGENT_CLAIM_STATUSES,
  SEAT_HOLDING_CLAIM_STATUSES,
  CONTINGENT_NAME_MAX_LENGTH,
  CONTINGENT_EVENTS_MINIMUM,
  CONTINGENT_EVENTS_MAXIMUM,
  CONTINGENT_CLAIM_EXPIRY_HOURS_AFTER_FEST_START,
};

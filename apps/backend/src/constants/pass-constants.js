const PASS_STATUSES = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  REVOKED: "revoked",
};

/*
 * The MVP issues gateAccess and eventEntry only; the remaining types are
 * enumerated here so the model's enum already accepts them when meals,
 * accommodation, merch and prize claims arrive.
 */
/*
 * OFFER_CLAIM's referenceId holds the fest.offers subdocument _id that an OFFER
 * checkpoint's offerId points at (referenceId declares no ref — the target
 * model varies by type).
 *
 * MEAL / ACCOMMODATION_NIGHT / MERCH / PRIZE_CLAIM are declared-but-unused;
 * offerClaim supersedes them for the offers feature. They are kept, not
 * removed, in case other data one day carries them.
 */
const ENTITLEMENT_TYPES = {
  GATE_ACCESS: "gateAccess",
  EVENT_ENTRY: "eventEntry",
  OFFER_CLAIM: "offerClaim",
  MEAL: "meal",
  ACCOMMODATION_NIGHT: "accommodationNight",
  MERCH: "merch",
  PRIZE_CLAIM: "prizeClaim",
};

const ENTITLEMENT_STATUSES = {
  ACTIVE: "active",
  CONSUMED: "consumed",
  REVOKED: "revoked",
};

const ENTITLEMENT_SOURCES = {
  REGISTRATION: "registration",
  MANUAL_GRANT: "manualGrant",
};

const QR_TOKEN_LENGTH = 32;

// A 6-digit numeric code drawn from [100000, 999999], so leading zeros never arise.
const BACKUP_CODE_PATTERN = /^[0-9]{6}$/;

module.exports = {
  PASS_STATUSES,
  ENTITLEMENT_TYPES,
  ENTITLEMENT_STATUSES,
  ENTITLEMENT_SOURCES,
  QR_TOKEN_LENGTH,
  BACKUP_CODE_PATTERN,
};

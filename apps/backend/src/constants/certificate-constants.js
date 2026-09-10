/*
 * The certificate vocabulary. The model, the service, and the frontend all read
 * these from here rather than re-declaring the strings.
 */
const CERTIFICATE_TYPES = {
  PARTICIPATION: "participation",
  WINNER_1ST: "winner1st",
  WINNER_2ND: "winner2nd",
  WINNER_3RD: "winner3rd",
  COORDINATOR: "coordinator",
  VOLUNTEER: "volunteer",
  ADMINISTRATOR: "administrator",
  SPECIAL_MENTION: "specialMention",
};

const CERTIFICATE_STATUSES = {
  GENERATED_PENDING_RELEASE: "generatedPendingRelease",
  RELEASED: "released",
  REVOKED: "revoked",
};

/* 16 characters, drawn from an alphabet with no confusable glyphs (see helper). */
const VERIFICATION_CODE_LENGTH = 16;

module.exports = {
  CERTIFICATE_TYPES,
  CERTIFICATE_STATUSES,
  VERIFICATION_CODE_LENGTH,
};

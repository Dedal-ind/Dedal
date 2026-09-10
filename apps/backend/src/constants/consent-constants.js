/*
 * Vocabulary of the consent record and the policy document registry.
 *
 * A DOCUMENT KIND is a legal text we ask people to accept. A POLICY VERSION is
 * one published revision of that text, identified by the hash of its exact
 * content. A CONSENT RECORD is one person's act — acceptance or withdrawal —
 * against one version, written once and never changed.
 */
const POLICY_DOCUMENT_KINDS = {
  TERMS_OF_SERVICE: "termsOfService",
  PRIVACY_POLICY: "privacyPolicy",
};

const CONSENT_ACTIONS = {
  ACCEPTED: "accepted",
  WITHDRAWN: "withdrawn",
};

/* How the record came to exist. Withdrawal is both an action and a source:
   the person asked to withdraw, and that is the whole provenance. */
const CONSENT_SOURCES = {
  // The first time the participant completed their profile.
  PROFILE_COMPLETION: "profileCompletion",
  // Accepted again after a newer version took effect.
  REPROMPT: "reprompt",
  WITHDRAWAL: "withdrawal",
  // Minted by the migration from the pre-versioning timestamp fields.
  LEGACY_BACKFILL: "legacyBackfill",
};

/* The label the backfill gives the pre-versioning text of each document. */
const LEGACY_POLICY_VERSION_LABEL = "legacy";

/*
 * India's DPDP Act, 2023 treats anyone under eighteen as a child. See
 * age-helpers.js for what that switches off.
 */
const ADULT_AGE_YEARS = 18;

module.exports = {
  POLICY_DOCUMENT_KINDS,
  CONSENT_ACTIONS,
  CONSENT_SOURCES,
  LEGACY_POLICY_VERSION_LABEL,
  ADULT_AGE_YEARS,
};

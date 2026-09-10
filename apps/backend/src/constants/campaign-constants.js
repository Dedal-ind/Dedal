/*
 * Vocabulary of the promotions phase-2 model: promoter, placement, campaign,
 * creative, and the campaign-creative association.
 *
 * EVERYTHING HERE IS FIRST-PARTY AND CONTEXTUAL. There is no third-party ad
 * network, no behavioural profiling, and nothing that infers anything about a
 * person. A campaign says which SURFACES it may occupy (placements) and,
 * optionally, which DECLARED attributes a participant must or must not have.
 * That is the whole of targeting. See TARGETING_DIMENSIONS.
 */

const {
  PROMOTER_KINDS,
  PLACEMENT_KEYS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_PRIORITY_TIERS,
  CREATIVE_MEDIA_TYPES,
} = require("@dedal/shared");

const PROMOTER_STATUSES = {
  ACTIVE: "active",
  INACTIVE: "inactive",
};

/*
 * The surfaces a promotion can occupy. Seeded, never user-created: a new
 * surface is a code change in the client that renders it, so it is declared
 * here beside that client's contract and written to the database by the
 * migration/seed. maxPublishedCampaigns is the per-placement publish cap the
 * publish transition enforces (campaign-service), replacing the old per-type
 * cap of 20 — the home carousel must not silently grow to forty slides.
 */
const PLACEMENT_SEED = [
  {
    key: PLACEMENT_KEYS.HOME_CAROUSEL,
    label: "Home carousel",
    description: "The banner carousel at the top of every participant's home / discover screen.",
    maxPublishedCampaigns: 20,
    isActive: true,
  },
  {
    key: PLACEMENT_KEYS.FEST_DETAIL,
    label: "Fest detail page",
    description: "A single slot beneath the fest header on a fest's public detail page.",
    maxPublishedCampaigns: 10,
    isActive: true,
  },
  {
    key: PLACEMENT_KEYS.POST_REGISTRATION,
    label: "Post-registration screen",
    description: "Shown once, on the confirmation screen after a participant registers for an event.",
    maxPublishedCampaigns: 10,
    isActive: true,
  },
  {
    key: PLACEMENT_KEYS.PASS_SCREEN,
    label: "Pass screen",
    description: "A slot beneath the QR pass a participant shows at the gate.",
    maxPublishedCampaigns: 5,
    isActive: true,
  },
];

/*
 * THE ONLY DIMENSIONS A TARGETING PREDICATE MAY NAME.
 *
 * Every one of these is a fact the participant DECLARED on their own profile
 * or an action they took in the open (registering for a fest). None is
 * inferred, none is behavioural, none is a history of what they looked at.
 *
 * This list is closed on purpose and the schema is strict about it. India's
 * Digital Personal Data Protection Act, 2023 prohibits tracking, behavioural
 * monitoring and targeted advertising directed at anyone under eighteen, with
 * no consent workaround; this system is built to have nothing of that kind to
 * suppress. Do not add "interests", "viewed", "clicked", "segment" or anything
 * derived from behaviour here — there must be nowhere in the data model for
 * such a thing to be stored.
 */
const TARGETING_DIMENSIONS = ["collegeIds", "cities", "departments", "yearsOfStudy", "festIds"];

/* A creative is archived, never deleted: artwork that ran is history. */
const CREATIVE_STATUSES = {
  ACTIVE: "active",
  ARCHIVED: "archived",
};

module.exports = {
  PROMOTER_KINDS,
  PROMOTER_STATUSES,
  PLACEMENT_KEYS,
  PLACEMENT_SEED,
  CAMPAIGN_STATUSES,
  CAMPAIGN_PRIORITY_TIERS,
  TARGETING_DIMENSIONS,
  CREATIVE_MEDIA_TYPES,
  CREATIVE_STATUSES,
};

/*
 * The achievements vocabulary. The two models, the service, and the frontend all
 * read these strings from here rather than re-declaring them.
 *
 * There are two shapes of achievement in the system. The Achievement collection
 * holds the platform's own record — event results, badges, and the mirror of a
 * released certificate — and every row there carries a machine source (system or
 * certificate) and is treated as verified. The SelfDeclaredAchievement collection
 * holds whatever a participant types about themselves; it is never verified and
 * always answers with the selfDeclared source below, which is deliberately NOT a
 * value the Achievement model may store.
 */
const ACHIEVEMENT_TYPES = {
  EVENT_RESULT: "eventResult",
  BADGE: "badge",
  CERTIFICATE: "certificate",
};

/* The Achievement model's source column. Self-declared rows live in their own
 * collection and never take one of these — their source is added at read time. */
const ACHIEVEMENT_SOURCES = {
  SYSTEM: "system",
  CERTIFICATE: "certificate",
};

/*
 * The read-time source label the API attaches to every item, unifying both
 * collections into one shape. SELF_DECLARED is the extra value the model layer
 * never persists; it is stamped onto SelfDeclaredAchievement rows as they are
 * merged into the response.
 */
const ACHIEVEMENT_RESPONSE_SOURCES = {
  SYSTEM: "system",
  CERTIFICATE: "certificate",
  SELF_DECLARED: "selfDeclared",
};

/* Self-declared input caps, shared by the model's maxlength and the service's guard. */
const SELF_DECLARED_TITLE_MAX_LENGTH = 200;
const SELF_DECLARED_DESCRIPTION_MAX_LENGTH = 1000;

/*
 * The badge catalog. These are the definitions only — the award logic lives in
 * the service, which iterates this object and runs one criteria checker per id.
 * A new badge is added here (and given a checker in the service's criteria map)
 * without touching the award function itself.
 *
 * Frozen so a badge definition cannot be mutated at runtime; the criteria string
 * is human copy for the profile, not the rule the service evaluates.
 */
const BADGE_CATALOG = Object.freeze({
  firstFest: Object.freeze({
    id: "firstFest",
    title: "First Fest",
    description: "Registered for your first fest.",
    criteria: "A confirmed registration in any fest.",
  }),
  fiveEvents: Object.freeze({
    id: "fiveEvents",
    title: "Five Events",
    description: "Confirmed registrations across five or more distinct events.",
    criteria: "Confirmed registrations in 5 or more distinct events across any fests.",
  }),
  allRounder: Object.freeze({
    id: "allRounder",
    title: "All-Rounder",
    description: "Competed across three or more different event categories.",
    criteria: "Confirmed registrations in events spanning 3 or more distinct categories.",
  }),
  teamCaptain: Object.freeze({
    id: "teamCaptain",
    title: "Team Captain",
    description: "Led a team into an event.",
    criteria: "Created at least one team as its leader.",
  }),
});

module.exports = {
  ACHIEVEMENT_TYPES,
  ACHIEVEMENT_SOURCES,
  ACHIEVEMENT_RESPONSE_SOURCES,
  SELF_DECLARED_TITLE_MAX_LENGTH,
  SELF_DECLARED_DESCRIPTION_MAX_LENGTH,
  BADGE_CATALOG,
};

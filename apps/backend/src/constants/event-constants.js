/*
 * The single source of truth for the event enums. The model, the validator, and
 * later the UI all read them from here.
 *
 * Declared as objects rather than the bare arrays the spec sketched, to match
 * FEST_STATUSES and friends: the service needs named access (EVENT_STATUSES.DRAFT)
 * and the model needs the value list (Object.values), and an object gives both.
 */
/*
 * SUGGESTION LIST ONLY — the event model accepts any string. Do not use this as
 * a validation enum.
 *
 * It used to be one: `category` carried `enum: [...Object.values(EVENT_CATEGORIES)]`,
 * which meant an organiser running "Robotics" or "Culinary Arts" simply could not
 * save the event. The enum is gone; a category is now free text capped at
 * EVENT_CATEGORY_MAX_LENGTH, and this list survives only to populate the admin
 * autocomplete and the participant quick-filter chips.
 *
 * Because it no longer constrains anything, it is safe to sort alphabetically —
 * removing a key can no longer orphan the rows that store its value. Stored
 * values are whatever the organiser typed, so anything reading them back must
 * match case-insensitively (see listPublicFests) and title-case for display (see
 * the frontend's category-format helper).
 */
const EVENT_CATEGORIES = {
  ARTS: "arts",
  CODING: "coding",
  COMMERCE: "commerce",
  CULINARY: "culinary",
  CULTURAL: "cultural",
  DANCE: "dance",
  DEBATE: "debate",
  DESIGN: "design",
  DRAMA: "drama",
  ENTREPRENEURSHIP: "entrepreneurship",
  ENVIRONMENT: "environment",
  ESPORTS: "esports",
  FASHION: "fashion",
  FILM: "film",
  FINANCE: "finance",
  GAMING: "gaming",
  HACKATHON: "hackathon",
  LITERARY: "literary",
  MANAGEMENT: "management",
  MARKETING: "marketing",
  MUSIC: "music",
  OTHER: "other",
  PHOTOGRAPHY: "photography",
  QUIZ: "quiz",
  ROBOTICS: "robotics",
  // The one multi-word value, camelCase to match every other stored enum value
  // in this repo (perPerson, bracketSingleElimination). Displayed "Social Impact".
  SOCIAL_IMPACT: "socialImpact",
  SPORTS: "sports",
  TECHNICAL: "technical",
  WELLNESS: "wellness",
  WORKSHOP: "workshop",
};

// Free text needs a ceiling, not an enum: long enough for "Culinary Arts" or
// "Entrepreneurship & Innovation", short enough to render in a card chip.
const EVENT_CATEGORY_MAX_LENGTH = 50;

// The spec's `format`, renamed: `format` collided with `scoringFormat`.
const EVENT_TYPES = {
  SOLO: "solo",
  TEAM: "team",
};

/*
 * How the fee is charged. free carries no amount; perPerson multiplies the amount
 * by the team size; perTeam is a flat amount however many are on the roster.
 */
const FEE_TYPES = {
  FREE: "free",
  PER_PERSON: "perPerson",
  PER_TEAM: "perTeam",
};

const EVENT_SCORING_FORMATS = {
  BRACKET_SINGLE_ELIMINATION: "bracketSingleElimination",
  SCORE_BASED: "scoreBased",
  TIME_TRIAL: "timeTrial",
  JUDGED: "judged",
  NONE: "none",
};

// A fest is archived; an event is cancelled. There is no event archive.
const EVENT_STATUSES = {
  DRAFT: "draft",
  PUBLISHED: "published",
  ONGOING: "ongoing",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  /*
   * SOFT DELETE. The row stays in the collection forever; only this status
   * changes.
   *
   * A hard delete is not available to an event anyone ever registered for, and
   * for a reason that outlives the admin's intent: registrations, payments,
   * teams, entitlements, passes and every append-only scan row point at this
   * eventId. Removing the document does not remove them — it orphans them, and
   * a participant's pass then references an event that cannot be named. So
   * "delete" means "withdraw from circulation", which is what an organiser
   * actually wants when they say it.
   *
   * DISTINCT FROM CANCELLED. Cancelled says the event was called off and the
   * people who signed up need to know and be refunded; the event still happened
   * in the record and still shows on the participant's history. Deleted says the
   * event should never have been listed — it disappears from the participant app
   * entirely. Two different messages to two different audiences, so two statuses.
   */
  DELETED: "deleted",
};

/*
 * The statuses a participant may see.
 *
 * CANCELLED is included: an event called off after people registered must still
 * render, carrying its cancelled badge, or the participant who signed up for it
 * finds a dead link and no explanation. Registration is blocked separately by
 * REGISTERABLE_EVENT_STATUSES (registration-guards), so being visible here does
 * not make a cancelled event registerable.
 *
 * DELETED is absent, and that is the whole point of the status: an allow-list
 * means a deleted event drops out of every public read at once — fest pages,
 * search, the independent-event feed — without each of them having to remember
 * to exclude it.
 */
const PUBLICLY_VISIBLE_EVENT_STATUSES = [
  EVENT_STATUSES.PUBLISHED,
  EVENT_STATUSES.ONGOING,
  EVENT_STATUSES.COMPLETED,
  EVENT_STATUSES.CANCELLED,
];

const EVENT_SLUG_MAXIMUM_ATTEMPTS = 20;

/*
 * The per-event registration questions an organiser writes themselves. Distinct
 * from weightCategories and friends: those partition a bracket, these just
 * collect an answer. Four types for the MVP; the enum is the model's, the
 * validator's and the answer checker's shared vocabulary.
 */
const QUESTION_TYPES = {
  SHORT_TEXT: "shortText",
  LONG_TEXT: "longText",
  SINGLE_CHOICE: "singleChoice",
  YES_NO: "yesNo",
};

/*
 * A choice question stores the chosen option string, and a yesNo question stores
 * one of these — so both read out of answerChoice and neither needs answerText.
 */
const YES_NO_ANSWERS = ["yes", "no"];

/*
 * The length cap per question type, so the answer checker maps type to limit
 * rather than re-deriving it. Only the free-text types have one: a choice answer
 * is bounded by the option it must match.
 */
const ANSWER_MAX_LENGTH_BY_TYPE = {
  [QUESTION_TYPES.SHORT_TEXT]: 300,
  [QUESTION_TYPES.LONG_TEXT]: 2000,
};

const QUESTION_ID_LENGTH = 8;
const QUESTION_TEXT_MAX_LENGTH = 300;
const QUESTION_OPTIONS_MAX = 10;
const QUESTION_OPTION_MAX_LENGTH = 100;

module.exports = {
  EVENT_CATEGORIES,
  EVENT_CATEGORY_MAX_LENGTH,
  EVENT_TYPES,
  FEE_TYPES,
  EVENT_SCORING_FORMATS,
  EVENT_STATUSES,
  PUBLICLY_VISIBLE_EVENT_STATUSES,
  EVENT_SLUG_MAXIMUM_ATTEMPTS,
  QUESTION_TYPES,
  YES_NO_ANSWERS,
  ANSWER_MAX_LENGTH_BY_TYPE,
  QUESTION_ID_LENGTH,
  QUESTION_TEXT_MAX_LENGTH,
  QUESTION_OPTIONS_MAX,
  QUESTION_OPTION_MAX_LENGTH,
};

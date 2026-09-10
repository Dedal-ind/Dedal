const mongoose = require("mongoose");
const { buildOfferSchema } = require("../helpers/offer-schema-helpers");
const { buildSponsorSchema } = require("../helpers/sponsor-schema-helpers");
const { normaliseRank, rankAfter } = require("../helpers/sibling-rank-helpers");
const { FEST_OFFERS_MAX, EVENT_SPONSORS_MAX } = require("../constants/fest-constants");
const {
  EVENT_CATEGORY_MAX_LENGTH,
  EVENT_TYPES,
  FEE_TYPES,
  EVENT_SCORING_FORMATS,
  EVENT_STATUSES,
  QUESTION_TYPES,
  QUESTION_TEXT_MAX_LENGTH,
  QUESTION_OPTIONS_MAX,
  QUESTION_OPTION_MAX_LENGTH,
} = require("../constants/event-constants");

/*
 * _id is off: questionId is the identity, and a parallel ObjectId would be a
 * second one that registrations do not reference and admins never see.
 */
const customQuestionSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true, trim: true },
    questionText: {
      type: String,
      required: true,
      trim: true,
      maxlength: QUESTION_TEXT_MAX_LENGTH,
    },
    questionType: { type: String, required: true, enum: Object.values(QUESTION_TYPES) },
    isRequired: { type: Boolean, default: true },
    options: {
      type: [{ type: String, trim: true, maxlength: QUESTION_OPTION_MAX_LENGTH }],
      default: [],
    },
    displayOrder: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

/*
 * options belongs to singleChoice and nowhere else. Carrying options on a yesNo
 * question is rejected rather than ignored: it means the caller believes the
 * question offers choices it does not, and silently dropping them would leave
 * that belief intact until a participant saw the wrong form.
 */
customQuestionSchema.pre("validate", function validateQuestionOptions(next) {
  const isSingleChoice = this.questionType === QUESTION_TYPES.SINGLE_CHOICE;
  const optionCount = this.options ? this.options.length : 0;

  if (isSingleChoice) {
    if (optionCount === 0) {
      this.invalidate("options", "A singleChoice question needs at least one option.");
    }
    if (optionCount > QUESTION_OPTIONS_MAX) {
      this.invalidate("options", `A question may not have more than ${QUESTION_OPTIONS_MAX} options.`);
    }
    if (this.options.some((option) => option.trim().length === 0)) {
      this.invalidate("options", "An option must not be empty.");
    }
  } else if (optionCount > 0) {
    this.invalidate("options", `Only a ${QUESTION_TYPES.SINGLE_CHOICE} question may carry options.`);
  }

  return next();
});

/*
 * Event-scoped offers: the same subdocument shape fest.offers embeds (built by
 * the shared factory, so the two can never drift), scoped to this event alone.
 * Additive, not a replacement — a participant registering for this event is
 * offered fest.offers UNION event.offers, each labelled with its scope.
 */
const offerSchema = buildOfferSchema();

/*
 * Event-scoped sponsors: the same subdocument shape fest.sponsors embeds (built
 * by the shared factory, so the two can never drift), scoped to this event
 * alone. Additive, not a replacement — the participant app renders the fest
 * strip and the event strip with ONE code path, which is only possible while the
 * two shapes stay structurally identical.
 */
const sponsorSchema = buildSponsorSchema();

const eventSchema = new mongoose.Schema(
  {
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", required: true },
    /*
     * Self-reference for the vertical hierarchy: a null parent is a top-level event
     * directly under the fest (the original, unchanged behaviour). A non-null parent
     * makes this a child — a leaf under a grouping container, or a container itself,
     * as deep as the admin nests. Participants register on leaves only.
     */
    parentEventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
    /*
     * Position among SIBLINGS — events sharing this one's festId and
     * parentEventId — as a lexicographic base-62 rank string (see
     * sibling-rank-helpers). Ordinary string comparison IS the order, and a
     * level sorts by (siblingRank, _id). Not a global rank: two events under
     * different parents may hold the same string, which is why the index below
     * is (festId, parentEventId, siblingRank) rather than on this field alone.
     *
     * Assigned at creation by the pre-save hook below (after the current last
     * sibling), so no event is born unranked. A move writes ONLY the moved
     * row's rank, minted strictly between its two new neighbours; nothing else
     * on the level is touched.
     */
    siblingRank: { type: String, default: null },
    /*
     * DEPRECATED — the integer ordering siblingRank replaced. Kept for one
     * release as a read-only remnant so a rollback still has the old order to
     * fall back on; nothing writes it any more and no reader sorts by it.
     * Backfilled into siblingRank by migrate:event-sibling-ranks. Delete the
     * field, and this comment, next release.
     */
    displayOrder: { type: Number, default: 0 },
    eventName: { type: String, required: true, trim: true },
    // Derived from eventName by the service; never accepted from a client.
    eventSlug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, required: true, trim: true },
    rules: { type: String, trim: true, default: null },
    posterImageUrl: { type: String, trim: true, default: null },
    // Optional: a container (grouping) event holds mixed-category leaves, so it has
    // no category of its own. A leaf needs one before registration — see the
    // registration guard.
    //
    // FREE TEXT, deliberately no enum. Colleges run categories nobody can enumerate
    // in advance ("Robotics", "Fintech", "Culinary Arts"), and the old enum rejected
    // every one of them. EVENT_CATEGORIES is now a suggestion list the UI offers,
    // not a constraint the model enforces; the only rule is the length cap.
    category: {
      type: String,
      trim: true,
      maxlength: EVENT_CATEGORY_MAX_LENGTH,
      default: null,
    },
    eventType: { type: String, required: true, enum: Object.values(EVENT_TYPES) },
    minimumTeamSize: { type: Number, required: true, min: 1, default: 1 },
    maximumTeamSize: { type: Number, required: true, min: 1, default: 1 },
    scoringFormat: {
      type: String,
      required: true,
      enum: Object.values(EVENT_SCORING_FORMATS),
      default: EVENT_SCORING_FORMATS.NONE,
    },
    // Free text for the MVP; a venue collection arrives later.

    /* Set once the coordinator finalises results. Locks every score for the
     * event and is what tells the Admin the outcome is settled. */
    resultsFinalisedAt: { type: Date, default: null },

    venue: { type: String, required: true, trim: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    registrationOpensAt: { type: Date, required: true },
    registrationClosesAt: { type: Date, required: true },
    /*
     * An ADMIN's explicit "close registration now", distinct from
     * registrationClosesAt — which is deliberately NOT enforced, because walk-ups
     * register at the venue after the start time (see assertRegistrationWindowOpen).
     * This field is the manual override that genuinely shuts the door.
     *
     * null = never manually closed, which is every existing event, so adding this
     * changes nothing for anything already running. Set it to close, clear it to
     * reopen; the stamp doubles as the audit record of when it happened.
     */
    registrationManuallyClosedAt: { type: Date, default: null },
    // null means unlimited.
    capacity: { type: Number, min: 1, default: null },
    // Denormalised. Only the registration service writes it.
    registeredCount: { type: Number, min: 0, default: 0 },
    waitlistEnabled: { type: Boolean, default: false },
    // How the fee is charged; feeAmountPaise carries the amount. The cross-field
    // rule (free ⇒ zero, paid ⇒ positive) is enforced in the pre-validate hook.
    feeType: { type: String, enum: Object.values(FEE_TYPES), default: FEE_TYPES.FREE },
    feeAmountPaise: { type: Number, min: 0, default: 0 },
    prizePoolDescription: { type: String, trim: true, default: null },

    /*
     * Optional per-event certificate template (image/PDF URL uploaded through
     * POST /uploads). When set, certificate rendering uses this artwork as the
     * full-page base and overlays only the participant's name — the coded
     * layout is the fallback for events (and fests) with no template.
     */
    certificateTemplateUrl: { type: String, trim: true, default: null },
    weightCategories: { type: [String], default: [] },
    genderCategories: { type: [String], default: [] },
    ageCategories: { type: [String], default: [] },
    /*
     * Organiser-defined registration questions. See customQuestionSchema above.
     *
     * KEPT for the events that already carry them — a live fest's registration
     * form must not lose the questions it was collecting. New events use `faqs`
     * below instead, which answers rather than asks.
     */
    customQuestions: { type: [customQuestionSchema], default: [] },
    /*
     * Questions the ORGANISER answers, not the participant.
     *
     * The opposite direction of travel from customQuestions, which is why it is
     * a separate field rather than a new questionType: a custom question creates
     * a form input and a stored answer per registration, while an FAQ is static
     * copy shown before anyone registers. Folding them together would make every
     * reader of customQuestions decide which kind it was holding.
     */
    faqs: {
      type: [
        new mongoose.Schema(
          {
            question: { type: String, required: true, trim: true },
            answer: { type: String, required: true, trim: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    offers: { type: [offerSchema], default: [] },
    // Sponsor logos shown on this event's public page. Empty renders nothing.
    // Bounded by the validate hook below, exactly as offers are.
    sponsors: { type: [sponsorSchema], default: [] },

    /*
     * Physical events (running, contact sports) demand the participant accept a
     * liability declaration before they hold a seat. Default false, so every
     * event that existed before this field reads as not requiring one rather
     * than as undefined.
     */
    requiresMedicalDeclaration: { type: Boolean, default: false },
    /*
     * When false, the public leaderboard endpoint returns an empty array even
     * though scores exist — deliberation mode. Flipped to true to reveal the
     * standings. Toggled by a coordinator/admin on the event edit path.
     */
    isLeaderboardVisible: { type: Boolean, default: false },
    status: {
      type: String,
      required: true,
      enum: Object.values(EVENT_STATUSES),
      default: EVENT_STATUSES.DRAFT,
    },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    /*
     * Bulk-email throttle. A coordinator mailing every confirmed registrant is
     * a legitimate need ("venue moved to Room 204") and a spam cannon pointed
     * at a few hundred inboxes; three a day is enough for the former and not
     * enough to be the latter.
     *
     * The count is NOT reset by a scheduled job. lastBulkEmailSentAt records
     * when the current day's tally began, and the send path treats a stamp from
     * an earlier calendar day as a tally of zero — so the reset happens by
     * being read, and a server that was asleep at midnight cannot miss it.
     */
    lastBulkEmailSentAt: { type: Date, default: null },
    dailyBulkEmailCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/* A solo event is a team of exactly one; a team event needs room for at least two. */
function validateTeamSizes(eventDocument) {
  const { eventType, minimumTeamSize, maximumTeamSize } = eventDocument;

  if (eventType === EVENT_TYPES.SOLO) {
    if (minimumTeamSize !== 1) {
      eventDocument.invalidate("minimumTeamSize", "A solo event must have minimumTeamSize 1.");
    }
    if (maximumTeamSize !== 1) {
      eventDocument.invalidate("maximumTeamSize", "A solo event must have maximumTeamSize 1.");
    }
    return;
  }

  if (minimumTeamSize < 2) {
    eventDocument.invalidate("minimumTeamSize", "A team event must have minimumTeamSize of at least 2.");
  }
  if (maximumTeamSize < minimumTeamSize) {
    eventDocument.invalidate("maximumTeamSize", "maximumTeamSize must be at least minimumTeamSize.");
  }
}

/*
 * Uniqueness is the parent's to check: a subdocument cannot see its siblings. A
 * duplicate id would make a registration's answer ambiguous about which question
 * it answers, so it is rejected at the schema rather than left to the service.
 */
function validateQuestionIdsAreUnique(eventDocument) {
  const questionIds = (eventDocument.customQuestions || []).map((question) => question.questionId);
  const uniqueIds = new Set(questionIds);

  if (uniqueIds.size !== questionIds.length) {
    eventDocument.invalidate("customQuestions", "Every questionId must be unique within an event.");
  }
}

/*
 * The same bound the fest model puts on its own sponsors, at the event's tighter
 * cap. Enforced by a validate hook rather than in the parser alone so a write
 * that bypasses the HTTP layer cannot grow an unbounded embedded array.
 */
function validateSponsorCount(eventDocument) {
  if ((eventDocument.sponsors || []).length > EVENT_SPONSORS_MAX) {
    eventDocument.invalidate(
      "sponsors",
      `An event cannot have more than ${EVENT_SPONSORS_MAX} sponsors.`
    );
  }
}

/*
 * Same rule the fest model applies to its own offers: a duplicate offerKey would
 * make a claim ambiguous about which offer it claims, and the array must stay
 * bounded.
 */
function validateOfferKeysAreUnique(eventDocument) {
  const offerKeys = (eventDocument.offers || []).map((offer) => offer.offerKey);
  if (new Set(offerKeys).size !== offerKeys.length) {
    eventDocument.invalidate("offers", "Every offerKey must be unique within an event.");
  }
  if (offerKeys.length > FEST_OFFERS_MAX) {
    eventDocument.invalidate("offers", `An event cannot have more than ${FEST_OFFERS_MAX} offers.`);
  }
}

/*
 * A free event carries no amount; a paid one (perPerson or perTeam) must carry a
 * positive one. Same cross-field shape as the scope validator on staff-assignment.
 */
function validateFee(eventDocument) {
  const { feeType, feeAmountPaise } = eventDocument;
  if (feeType === FEE_TYPES.FREE) {
    if (feeAmountPaise !== 0) {
      eventDocument.invalidate("feeAmountPaise", "A free event must have feeAmountPaise 0.");
    }
    return;
  }
  if (!(feeAmountPaise > 0)) {
    eventDocument.invalidate("feeAmountPaise", "A paid event must have a feeAmountPaise greater than 0.");
  }
}

/*
 * invalidate() attaches each complaint to the offending field, so Mongoose
 * raises one ValidationError whose `errors` map names every problem at once.
 */
eventSchema.pre("validate", function validateEventCrossFields(next) {
  if (this.startsAt && this.endsAt && this.endsAt.getTime() < this.startsAt.getTime()) {
    this.invalidate("endsAt", "endsAt must be on or after startsAt.");
  }

  if (
    this.registrationOpensAt &&
    this.registrationClosesAt &&
    this.registrationClosesAt.getTime() <= this.registrationOpensAt.getTime()
  ) {
    this.invalidate(
      "registrationClosesAt",
      "registrationClosesAt must be after registrationOpensAt."
    );
  }

  /*
   * The ceiling is the event's END, not its start. Late (walk-up) registration
   * is allowed by design — the runtime window guard closes on endsAt — so the
   * model must accept a close time anywhere up to the end. The old startsAt cap
   * rejected exactly the schedules the runtime supports.
   */
  if (
    this.registrationClosesAt &&
    this.endsAt &&
    this.registrationClosesAt.getTime() > this.endsAt.getTime()
  ) {
    this.invalidate("registrationClosesAt", "Registration must close before the event ends.");
  }

  validateTeamSizes(this);
  validateQuestionIdsAreUnique(this);
  validateFee(this);
  validateOfferKeysAreUnique(this);
  validateSponsorCount(this);

  return next();
});

eventSchema.index(
  { festId: 1, eventSlug: 1 },
  { name: "index_events_festId_eventSlug", unique: true }
);
eventSchema.index({ festId: 1 }, { name: "index_events_festId" });
eventSchema.index({ festId: 1, category: 1 }, { name: "index_events_festId_category" });
eventSchema.index({ festId: 1, status: 1 }, { name: "index_events_festId_status" });
eventSchema.index({ parentEventId: 1 }, { name: "index_events_parentEventId" });
/* Serves the structure tree's read: one level of one fest, already in order. */
eventSchema.index(
  { festId: 1, parentEventId: 1, siblingRank: 1 },
  { name: "index_events_festId_parentEventId_siblingRank" }
);
eventSchema.index({ startsAt: 1 }, { name: "index_events_startsAt" });

/*
 * registrationStatus — 'open' | 'closed'. The field every client reads.
 *
 * A VIRTUAL, DERIVED FROM registrationManuallyClosedAt, NOT A SECOND STORED
 * COLUMN. The spec for this feature asked for a stored enum, and that would have
 * been a real bug: this model already carries the same fact as a timestamp, and
 * two writable fields meaning "is registration open" drift the first time any
 * path updates one and not the other — a cancel that sets status but forgets the
 * enum, a migration that backfills one, a direct Mongo edit. The failure is
 * silent and lands on a participant being refused at a registration form the
 * admin console is showing as open.
 *
 * The timestamp is kept as the stored truth because it answers strictly more:
 * "closed" AND "closed at 14:32 on the 24th", which the audit trail and the
 * participant-facing message both use. The enum answers less, so it is computed
 * from the timestamp rather than stored beside it.
 *
 * Clients get exactly the contract they were promised — event.registrationStatus
 * is 'open' or 'closed' — and cannot desynchronise it, because there is nothing
 * to desynchronise.
 *
 * CANCELLED AND DELETED READ AS CLOSED. Neither can take a registration, and a
 * screen that had to remember "closed OR cancelled OR deleted" everywhere would
 * eventually forget one; folding it in here means every reader asks one question.
 */
eventSchema.virtual("registrationStatus").get(function resolveRegistrationStatus() {
  if (this.status === EVENT_STATUSES.CANCELLED || this.status === EVENT_STATUSES.DELETED) {
    return "closed";
  }
  return this.registrationManuallyClosedAt ? "closed" : "open";
});

/*
 * Every new event gets a rank after the current last sibling of its level, so
 * a freshly created event lands at the bottom of where it was created and a
 * reader never meets a null rank. On the model rather than in one service
 * because events are also created by seeds, migrations and fixtures, and each
 * of those would otherwise be a way to mint an unranked row. An explicitly
 * supplied valid rank is kept as given (the backfill and tests rely on this).
 */
eventSchema.pre("save", async function assignSiblingRankOnCreate() {
  if (!this.isNew || normaliseRank(this.siblingRank) !== null) {
    return;
  }
  const lastSibling = await this.constructor
    .findOne({
      festId: this.festId,
      parentEventId: this.parentEventId ?? null,
      siblingRank: { $type: "string" },
    })
    .sort({ siblingRank: -1, _id: -1 })
    .select("siblingRank")
    .lean();
  this.siblingRank = rankAfter(lastSibling ? lastSibling.siblingRank : null);
});

eventSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const EventModel = mongoose.model("Event", eventSchema, "events");

module.exports = { EventModel };

const mongoose = require("mongoose");
const { OFFER_SCOPES } = require("../constants/fest-constants");
const {
  REGISTRATION_STATUSES,
  ACTIVE_REGISTRATION_STATUSES,
  CANCELLED_BY_ROLES,
  FOOD_PREFERENCES,
  PAYMENT_STATUSES,
} = require("../constants/registration-constants");

/*
 * One answer to one question on the event. Exactly one of answerText and
 * answerChoice carries the answer — free text in the first, a chosen option or
 * yes/no in the second — and which one is decided by the question's type.
 *
 * That pairing is not enforced here: the schema cannot see the event, so it does
 * not know which type a questionId refers to. The registration service checks it
 * against the event's customQuestions before this is ever written.
 *
 * questionId is not a ref: a question that is later deleted from the event leaves
 * this row untouched and orphaned, which is the intended history-preserving
 * behaviour rather than an integrity failure.
 */
const customResponseSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true, trim: true },
    answerText: { type: String, trim: true, default: null },
    answerChoice: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const registrationSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },
    status: {
      type: String,
      required: true,
      enum: Object.values(REGISTRATION_STATUSES),
      default: REGISTRATION_STATUSES.CONFIRMED,
    },

    /*
     * Queue order for a WAITLISTED row, 1-based. Null on every other status.
     *
     * Stored rather than derived at read time, because it is the promise made to
     * the participant: "you are third". A position computed from createdAt on
     * each read would silently renumber everyone whenever someone ahead cancels,
     * and a participant who was told 3 would see 2 without anything having been
     * offered to them. The stored number is never rewritten — promotion clears
     * it, and the remaining rows keep the positions they were given, so the
     * sequence has gaps and that is correct.
     */
    waitlistPosition: { type: Number, default: null },

    /* Stamped when a waitlisted row was promoted, so the history survives the
     * status change. Null on a registration that never sat in a queue. */
    promotedFromWaitlistAt: { type: Date, default: null },

    /*
     * Optional per-registration contact — used only when the participant wants
     * to give a different number for this specific event (e.g. attending on
     * behalf of someone). Coordinator's roster shows
     * contactPhoneOverride || user.phoneNumber, exposed as one resolved
     * contactPhone field — never both. Null (the norm) means "use the account
     * phone"; the client does not persist a value identical to it.
     */
    contactPhoneOverride: { type: String, trim: true, default: null },

    weightCategory: { type: String, default: null },
    genderCategory: { type: String, default: null },
    ageCategory: { type: String, default: null },

    /* Snapshot of the event fee at registration time. Never rewritten by a later fee change. */
    feeAmountSnapshotPaise: { type: Number, min: 0, required: true },
    /*
     * Was Mixed defaulting to null, and nothing ever wrote it: both validators
     * dropped the field before it reached the service. Every existing row is
     * therefore null, which Mongoose reads back as [] — so tightening the type
     * migrates the old rows by reading them, with no answers to lose.
     */
    customResponses: { type: [customResponseSchema], default: [] },

    registeredAt: { type: Date, required: true, default: Date.now },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: null },
    /*
     * Which policy ended this registration. The participant needs it to tell a
     * reason they wrote themselves from one an organiser wrote about them — only
     * the latter is worth surfacing back to them. Null until cancelled.
     */
    cancelledByRole: {
      type: String,
      enum: [...Object.values(CANCELLED_BY_ROLES), null],
      default: null,
    },
    cancelledByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    /*
     * When the ORGANISER closed the event this row belonged to. Separate from
     * cancelledAt: that answers "when did this registration end", this answers
     * "when did the event end", and a dispute months later needs to tell the two
     * apart. Null on every row whose event still exists.
     */
    eventCancelledAt: { type: Date, default: null },
    medicalDeclarationAcceptedAt: { type: Date, default: null },

    /*
     * Fest-level food/accommodation answers, collected only when the fest offers
     * the service. Null when it does not — the answer is irrelevant then.
     */
    foodPreference: {
      type: String,
      enum: [...Object.values(FOOD_PREFERENCES), null],
      default: null,
    },
    needsAccommodation: { type: Boolean, default: null },
    /*
     * How many meals the REGISTERING participant booked. Null when the fest
     * offers no food, or on a joined member's row (the leader booked for the
     * team). Zero when the participant explicitly wants no meal.
     */
    foodOrderCount: { type: Number, min: 0, default: null },

    /*
     * The participant's answers for NON-RESERVED fest offers. Food and
     * accommodation are NOT represented here — they keep their dedicated fields
     * above (foodPreference/foodOrderCount, needsAccommodation). offerId points
     * at the fest.offers subdocument _id; offerKey is a readable snapshot.
     */
    offerSelections: {
      type: [
        new mongoose.Schema(
          {
            offerId: { type: mongoose.Schema.Types.ObjectId, required: true },
            offerKey: { type: String, required: true, trim: true },
            /*
             * WHICH level's offer this is. A fest-wide "Food" and an event-only
             * "Food" share a key but are different offers at different rates, so
             * the key alone cannot identify what was bought — the scan path and
             * the fee snapshot both disambiguate on this.
             */
            scope: {
              type: String,
              enum: Object.values(OFFER_SCOPES),
              required: true,
              default: OFFER_SCOPES.FEST,
            },
            // The two generic axes. An axis the offer does not collect is stored
            // as 1, so the row always multiplies out through the one formula.
            numberOfPeople: { type: Number, min: 0, required: true, default: 1 },
            numberOfDays: { type: Number, min: 0, required: true, default: 1 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    /*
     * Present only on a row a contingent claim materialised. Presence-or-absence
     * IS the "registration type" — deliberately no registrationType enum, which
     * would be a second source of truth free to drift from this reference.
     */
    contingentClaimId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContingentClaim",
      default: null,
    },

    /*
     * Payment fields, live only for paid events. notRequired on free ones. Every
     * row in a payment group carries the same paymentGroupId (the shared id the
     * confirmation endpoint keys on) and the same totalFeePaise (the whole group's
     * total, stored on each row so one row answers it without a join).
     */
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUSES),
      default: PAYMENT_STATUSES.NOT_REQUIRED,
    },
    /*
     * Idempotency stamp for the "what you registered for" email — the companion
     * to the pass's passEmailSentAt. Claimed with a findOneAndUpdate filtered on
     * this being null, so the several registration paths that all funnel through
     * ensurePassAndEventEntitlement cannot each send a copy.
     */
    registrationConfirmationEmailSentAt: { type: Date, default: null },

    paymentGroupId: { type: String, default: null },
    paymentReference: { type: String, default: null },
    totalFeePaise: { type: Number, min: 0, default: 0 },
    /*
     * The line-by-line snapshot behind totalFeePaise (event fee + each offer ×
     * quantity), taken at registration time so a later price edit never rewrites
     * what someone was actually charged. The line items sum to totalFeePaise
     * exactly; disputes read this, not the bare total.
     */
    feeBreakdown: {
      type: [
        new mongoose.Schema(
          {
            label: { type: String, required: true, trim: true },
            quantity: { type: Number, min: 0, required: true },
            unitPaise: { type: Number, min: 0, required: true },
            subtotalPaise: { type: Number, min: 0, required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true }
);

/*
 * The partial filter narrows uniqueness to seats that are actually held. A
 * cancelled row is history and must not block the same person re-registering, so
 * only confirmed and waitlisted rows collide.
 */
registrationSchema.index(
  { eventId: 1, userId: 1 },
  {
    name: "index_registrations_eventId_userId",
    unique: true,
    partialFilterExpression: { status: { $in: ACTIVE_REGISTRATION_STATUSES } },
  }
);
registrationSchema.index({ userId: 1, status: 1 }, { name: "index_registrations_userId_status" });
registrationSchema.index({ eventId: 1, status: 1 }, { name: "index_registrations_eventId_status" });
registrationSchema.index({ teamId: 1 }, { name: "index_registrations_teamId" });
registrationSchema.index({ paymentGroupId: 1 }, { name: "index_registrations_paymentGroupId" });
registrationSchema.index(
  { contingentClaimId: 1 },
  { name: "index_registrations_contingentClaimId", sparse: true }
);

registrationSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const RegistrationModel = mongoose.model("Registration", registrationSchema, "registrations");

module.exports = { RegistrationModel };

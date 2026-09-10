const mongoose = require("mongoose");
const { DECISION_TYPES, NEXT_MATCH_SLOTS, MATCH_STATUSES } = require("../constants/match-constants");

/*
 * One node of a single-elimination bracket per PRODUCT-SPEC 5.13. A match holds
 * two competitors — each is either a solo user or a team, never both — and, once
 * a coordinator enters a result, a winner and the slot of the next-round match
 * that winner feeds into. A bye is a match with only one competitor; the bracket
 * service finalises it on creation and advances that competitor immediately.
 */
const matchSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },

    roundNumber: { type: Number, required: true, min: 1 },
    matchNumberInRound: { type: Number, required: true, min: 1 },

    /*
     * Exactly one identifier per side is set: a solo event fills the *UserId
     * fields, a team event the *TeamId fields. A null on both sides of slot B is
     * a bye. The bracket service, not a client, decides which pair is used.
     */
    participantAUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    participantBUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    participantATeamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },
    participantBTeamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },

    winnerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    winnerTeamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },

    participantAScore: { type: Number, default: null },
    participantBScore: { type: Number, default: null },
    decisionType: { type: String, enum: [...Object.values(DECISION_TYPES), null], default: null },
    scoresheetImageUrl: { type: String, trim: true, default: null },

    /*
     * Who judged it. Free text, because a judge is a person at a desk and not a
     * user of this app — most are guests, and demanding an account to be credited
     * would mean nobody is credited. Unbounded on purpose: a bout has three, a
     * hackathon final might have six, and the model has no business guessing.
     */
    judgeNames: { type: [{ type: String, trim: true }], default: [] },

    isBye: { type: Boolean, default: false },
    isFinalized: { type: Boolean, default: false },

    /*
     * Where this match's winner goes. Null on the final, which feeds nowhere.
     * nextMatchNumberInRound names the match one round up; nextMatchSlot says
     * whether the winner lands in that match's A or B side.
     */
    nextMatchNumberInRound: { type: Number, default: null },
    nextMatchSlot: { type: String, enum: [...Object.values(NEXT_MATCH_SLOTS), null], default: null },

    // The coordinator sets a match time later; null at generation.
    scheduledAt: { type: Date, default: null },

    /*
     * Optimistic concurrency. A client must echo back the version it last read;
     * a mismatch means someone else wrote in between and the write is refused
     * rather than silently overwriting them. Deliberately not Mongoose's __v:
     * that key is stripped from toJSON and is incremented only on array
     * operations, whereas this must be exposed to clients and must move on
     * every persisted change — including the ones the system makes itself when
     * it advances a winner into the next round.
     */
    version: { type: Number, default: 0, min: 0 },

    /* Who wrote last, so a conflicted coordinator knows who to go and talk to. */
    lastUpdatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    /*
     * Superseded matches stay in the collection and drop out of reads. Nothing
     * in this codebase deletes a match: the row is the only record that a
     * result ever existed, and a certificate or a dispute may need it later.
     */
    status: {
      type: String,
      enum: Object.values(MATCH_STATUSES),
      default: MATCH_STATUSES.ACTIVE,
    },
    supersededAt: { type: Date, default: null },
    supersededByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/*
 * Only one live match may hold a given slot — but a superseded bracket keeps its
 * old round and match numbers, and the replacement bracket reuses exactly those
 * numbers. A plain unique index would therefore make force-regeneration
 * impossible, so uniqueness is scoped to the matches that are actually in play.
 */
matchSchema.index(
  { eventId: 1, roundNumber: 1, matchNumberInRound: 1 },
  {
    name: "index_matches_eventId_roundNumber_matchNumberInRound",
    unique: true,
    partialFilterExpression: { status: MATCH_STATUSES.ACTIVE },
  }
);
matchSchema.index({ eventId: 1 }, { name: "index_matches_eventId" });

matchSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const MatchModel = mongoose.model("Match", matchSchema, "matches");

module.exports = { MatchModel };

const mongoose = require("mongoose");

const ROUND_STATUSES = { DRAFT: "draft", ACTIVE: "active", COMPLETED: "completed" };

/*
 * A judging round of a non-bracket event.
 *
 * WHY A SEPARATE COLLECTION, not a subdocument array on Event:
 * Rounds carry per-participant scores and file attachments. As a subdocument
 * array on Event, a 50-round event with 200 participants would approach
 * MongoDB's 16MB document limit. A separate collection also allows round-level
 * optimistic concurrency (version field) without locking the entire event
 * document.
 *
 * This coexists with EventScore (the flat, single-score-per-registration
 * system). The two are deliberately NOT merged: EventScore backs the admin's
 * leaderboard and award flow; rounds back the coordinator's multi-stage
 * shortlisting.
 */
const roundSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", required: true },

    roundNumber: { type: Number, required: true, min: 1 },
    roundName: { type: String, trim: true, maxlength: 80, default: null },

    /*
     * What this round is and how it is judged. The Create Rounds form has
     * always collected both; without fields to land in they were accepted by
     * the API and silently discarded, so a coordinator's rules vanished on
     * save with no error to explain it.
     */
    /*
     * Round 1's roster is refreshed from the door on every read so a round
     * created before the event fills as people scan in. Once anyone has been
     * eliminated out of it, that must stop — an eliminated participant is still
     * checked in, and would otherwise be re-added and reappear after being cut.
     *
     * Separate from `status` on purpose: marking the round COMPLETED would also
     * block correcting a mistyped score, which is a different decision.
     */
    rosterFinalised: { type: Boolean, default: false },

    /* When the coordinator pressed Start. Distinct from createdAt: rounds are
     * set up days ahead, and the brief is emailed at this moment, not that one. */
    startedAt: { type: Date, default: null },

    description: { type: String, trim: true, maxlength: 2000, default: null },
    rules: { type: String, trim: true, maxlength: 5000, default: null },
    status: {
      type: String,
      enum: Object.values(ROUND_STATUSES),
      default: ROUND_STATUSES.DRAFT,
    },

    // The coordinator's brief/deck for this round. Documents only — validated
    // against the document MIME whitelist in upload-storage-service.
    documentUrl: { type: String, trim: true, default: null },
    documentFileName: { type: String, trim: true, default: null },
    documentMimeType: { type: String, trim: true, default: null },

    /*
     * The working roster for THIS round. Round 1 is seeded from participants
     * who actually turned up (an accepted IN scan at the event's door);
     * every later round holds only those advanced from the one before.
     */
    participantIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    /*
     * Optimistic concurrency. Two coordinators editing the same round
     * simultaneously: without this, the last write wins silently and the first
     * coordinator's work is lost. Every update sends expectedVersion and the
     * update filter includes { version: expectedVersion }; a mismatch is a 409
     * telling the second coordinator to reload.
     */
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
);

roundSchema.index({ eventId: 1, roundNumber: 1 }, { name: "index_rounds_eventId_roundNumber", unique: true });
roundSchema.index({ eventId: 1, status: 1 }, { name: "index_rounds_eventId_status" });

roundSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const RoundModel = mongoose.model("Round", roundSchema, "rounds");

module.exports = { RoundModel, ROUND_STATUSES };

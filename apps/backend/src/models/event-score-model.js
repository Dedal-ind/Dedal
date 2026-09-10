const mongoose = require("mongoose");

/*
 * One accumulated score per registration, for non-bracket events (scoreBased,
 * judged, timeTrial, none). Bracket events keep their match-by-match model — this
 * is the parallel collection for formats where a participant carries a single
 * running score. History is the append-only audit log, not a field here.
 */
const eventScoreSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    registrationId: { type: mongoose.Schema.Types.ObjectId, ref: "Registration", required: true },

    // Solo events set userId; team events set teamId. The leaderboard populates whichever is present.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },

    /*
     * No minimum, no maximum: cricket runs into the hundreds, a quiz can be
     * unbounded or negative (deductions), a judged score is a decimal like 8.5.
     * The coordinator types whatever the event's scoring produces.
     */
    score: { type: Number, default: 0 },

    /*
     * Optimistic concurrency, the same contract as the match model: a client
     * echoes the version it read, a mismatch is refused rather than overwriting a
     * concurrent edit. Not Mongoose's __v — this must be exposed and must move on
     * every write.
     */
    version: { type: Number, default: 0, min: 0 },
    lastUpdatedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Locks the score after event completion; only an admin edits a finalized row.
    isFinalized: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One score row per registration per event.
eventScoreSchema.index(
  { eventId: 1, registrationId: 1 },
  { name: "index_eventScores_eventId_registrationId", unique: true }
);
// Leaderboard read: highest score first within an event.
eventScoreSchema.index({ eventId: 1, score: -1 }, { name: "index_eventScores_eventId_score" });

eventScoreSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const EventScoreModel = mongoose.model("EventScore", eventScoreSchema, "eventScores");

module.exports = { EventScoreModel };

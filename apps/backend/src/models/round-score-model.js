const mongoose = require("mongoose");

/*
 * One participant's score in one round.
 *
 * A SINGLE number per participant per round, deliberately. Multi-criteria
 * scoring (weighted rubrics, per-judge sheets) is what ScoreJudge and
 * HackerEarth do and is where this would grow if asked — but the client has not
 * asked, so the extra dimension is not built. Adding it later means a
 * `criteria: [{ name, weight, score }]` array here, not a schema rewrite.
 */
const roundScoreSchema = new mongoose.Schema(
  {
    roundId: { type: mongoose.Schema.Types.ObjectId, ref: "Round", required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    participantUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Null until the coordinator actually enters something — an unscored
    // participant is distinguishable from one scored zero.
    score: { type: Number, default: null },
    notes: { type: String, trim: true, maxlength: 500, default: null },

    /*
     * The group/lot this participant competes in FOR THIS ROUND, when the
     * coordinator splits a large field ("Group A", "Group B").
     *
     * On the score row rather than the registration because a lot is a
     * per-round arrangement: someone in Group A for the heats may be in Group C
     * for the semi-final, and a single field on the registration would only ever
     * remember the last one. Null when the round is not split, which is most of
     * them.
     */
    roundLot: { type: String, trim: true, maxlength: 40, default: null },

    scoredByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    scoredAt: { type: Date, default: null },

    /*
     * Set only when an ADMINISTRATOR overwrote the coordinator's mark from the
     * result board, and never cleared by a later coordinator save (that save
     * stamps scoredAt/scoredByUserId, which is the newer of the two facts).
     *
     * Separate from scoredByUserId because the question the board asks is not
     * "who typed this" but "has this been changed above the coordinator's head" —
     * the coordinator who entered the original mark needs to see that it moved.
     */
    adminEditedAt: { type: Date, default: null },
    adminEditedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// One row per participant per round: the upsert key, and the guard against a
// double-scoring race between two coordinators.
roundScoreSchema.index(
  { roundId: 1, participantUserId: 1 },
  { name: "index_roundScores_roundId_participantUserId", unique: true }
);

roundScoreSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const RoundScoreModel = mongoose.model("RoundScore", roundScoreSchema, "roundScores");

module.exports = { RoundScoreModel };

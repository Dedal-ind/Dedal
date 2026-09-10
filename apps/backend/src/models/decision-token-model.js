const mongoose = require("mongoose");
const { PLACEMENT_KEYS } = require("../constants/campaign-constants");

/*
 * A DECISION TOKEN: the single-use proof that the engine decided to show this
 * creative, of this campaign, on this placement, to this subject.
 *
 * The delivery phase will require a token to record an impression or a
 * click. That is what makes counting idempotent (a token is consumed once)
 * and forged impressions impossible (nobody can report an impression for a
 * creative that was never decided).
 *
 * STORED, NOT SIGNED. A stored single-use row with a unique index and a short
 * TTL is simpler to reason about than a signature and gives the same
 * guarantee here: a token is valid exactly while its row exists unconsumed
 * and unexpired.
 */
const DECISION_TOKEN_TTL_SECONDS = 15 * 60;

const decisionTokenSchema = new mongoose.Schema(
  {
    token: { type: String, required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", required: true },
    creativeId: { type: mongoose.Schema.Types.ObjectId, ref: "Creative", required: true },
    placementKey: { type: String, required: true, enum: Object.values(PLACEMENT_KEYS) },
    subjectKey: { type: String, required: true },
    subjectKind: { type: String, required: true, enum: ["participant", "session"] },
    /* The moment the engine decided — the reference point for the delivery
       tiers. Explicit rather than createdAt so it follows the engine's clock. */
    decidedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

decisionTokenSchema.index({ token: 1 }, { name: "index_decisionTokens_token", unique: true });
decisionTokenSchema.index(
  { expiresAt: 1 },
  { name: "index_decisionTokens_expiresAt_ttl", expireAfterSeconds: 0 }
);

const DecisionTokenModel = mongoose.model("DecisionToken", decisionTokenSchema, "decisionTokens");

module.exports = { DecisionTokenModel, DECISION_TOKEN_TTL_SECONDS };

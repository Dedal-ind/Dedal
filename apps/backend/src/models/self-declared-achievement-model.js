const mongoose = require("mongoose");
const {
  SELF_DECLARED_TITLE_MAX_LENGTH,
  SELF_DECLARED_DESCRIPTION_MAX_LENGTH,
} = require("../constants/achievement-constants");

/*
 * A participant's own claim about themselves — "captained the state team", "spoke
 * at a conference". The platform never verifies these, so there is deliberately no
 * verification field: every row here carries the selfDeclared source label at read
 * time and is reported unverified. Kept in its own collection, apart from the
 * machine-written Achievement collection, so the two can never be confused.
 */
const selfDeclaredAchievementSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    title: { type: String, required: true, trim: true, maxlength: SELF_DECLARED_TITLE_MAX_LENGTH },
    description: { type: String, default: null, maxlength: SELF_DECLARED_DESCRIPTION_MAX_LENGTH },

    // When the participant says it happened, not when they entered it (createdAt via timestamps).
    achievedAt: { type: Date, default: null },

    // The participant can hide a row from their public profile; the owner always sees it.
    isVisible: { type: Boolean, default: true },
  },
  { timestamps: true }
);

selfDeclaredAchievementSchema.index(
  { userId: 1 },
  { name: "index_selfDeclaredAchievements_userId" }
);

selfDeclaredAchievementSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const SelfDeclaredAchievementModel = mongoose.model(
  "SelfDeclaredAchievement",
  selfDeclaredAchievementSchema,
  "selfDeclaredAchievements"
);

module.exports = { SelfDeclaredAchievementModel };

const mongoose = require("mongoose");
const { ACHIEVEMENT_TYPES, ACHIEVEMENT_SOURCES } = require("../constants/achievement-constants");

/*
 * The platform's own record of what a participant has achieved: a placement in an
 * event, an earned badge, or the mirror of a released certificate. Everything here
 * is machine-written and treated as verified — a participant's own claims live in
 * the separate SelfDeclaredAchievement collection, never here.
 *
 * metadata is Mixed on purpose: a placement number, a score, or a badge's criteria
 * snapshot ride along without a schema change, and the partial unique index below
 * reads metadata.placement to stop the same event placement being awarded twice.
 */
const achievementSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    achievementType: {
      type: String,
      required: true,
      enum: Object.values(ACHIEVEMENT_TYPES),
    },

    title: { type: String, required: true, trim: true },
    description: { type: String, default: null },

    // Which fest / event / certificate this achievement is drawn from. All nullable:
    // a badge spans no single fest, and only an eventResult carries an eventId.
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", default: null },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
    certificateId: { type: mongoose.Schema.Types.ObjectId, ref: "Certificate", default: null },

    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    awardedAt: { type: Date, default: Date.now },

    source: {
      type: String,
      required: true,
      enum: Object.values(ACHIEVEMENT_SOURCES),
    },
  },
  { timestamps: true }
);

// The profile read: a user's achievements, narrowed by type.
achievementSchema.index(
  { userId: 1, achievementType: 1 },
  { name: "index_achievements_userId_achievementType" }
);

/*
 * A certificate is mirrored into an achievement at most once. Scoped to rows that
 * actually link a certificate, so the many rows with a null certificateId (badges,
 * event results) are not forced unique against each other.
 */
achievementSchema.index(
  { userId: 1, certificateId: 1 },
  {
    name: "index_achievements_userId_certificateId",
    unique: true,
    partialFilterExpression: { certificateId: { $type: "objectId" } },
  }
);

/*
 * The same placement in the same event is awarded to a user at most once. Scoped
 * to eventResult rows, which are the only ones that carry both an eventId and a
 * metadata.placement, so a re-run of award-results finds the existing row rather
 * than inserting a duplicate 1st place.
 */
achievementSchema.index(
  { userId: 1, eventId: 1, "metadata.placement": 1 },
  {
    name: "index_achievements_userId_eventId_placement",
    unique: true,
    partialFilterExpression: { achievementType: ACHIEVEMENT_TYPES.EVENT_RESULT },
  }
);

/*
 * A given badge is held at most once per user. Scoped to badge rows, which are the
 * only ones carrying a metadata.badgeId, so a concurrent double-award (badges are
 * granted fire-and-forget from every registration confirmation) collides on the
 * index rather than inserting a duplicate.
 */
achievementSchema.index(
  { userId: 1, "metadata.badgeId": 1 },
  {
    name: "index_achievements_userId_badgeId",
    unique: true,
    partialFilterExpression: { achievementType: ACHIEVEMENT_TYPES.BADGE },
  }
);

achievementSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const AchievementModel = mongoose.model("Achievement", achievementSchema, "achievements");

module.exports = { AchievementModel };

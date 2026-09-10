const mongoose = require("mongoose");
const { PROMOTER_KINDS, PROMOTER_STATUSES } = require("../constants/campaign-constants");

/*
 * WHO is being promoted: a college, a fest organiser, or a sponsor.
 *
 * collegeId is NULLABLE for the same reason the old promotion row kept its
 * college as free text: a sponsor has no college, and a college that asks the
 * platform owner to promote its fest may have no account here at all.
 * Refusing the promoter until it registers would be the tail wagging the dog.
 *
 * displayNameKey is the case- and whitespace-insensitive form of displayName,
 * unique — so "Alliance University" and "alliance university" are one
 * promoter, which is what lets the migration reuse a promoter per distinct
 * college name instead of minting duplicates.
 */
function toDisplayNameKey(displayName) {
  return String(displayName ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const promoterSchema = new mongoose.Schema(
  {
    displayName: { type: String, required: true, trim: true, maxlength: 120 },
    displayNameKey: { type: String, required: true },
    kind: { type: String, required: true, enum: Object.values(PROMOTER_KINDS) },
    contactName: { type: String, trim: true, maxlength: 120, default: null },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: null },
    contactPhone: { type: String, trim: true, maxlength: 32, default: null },
    status: {
      type: String,
      required: true,
      enum: Object.values(PROMOTER_STATUSES),
      default: PROMOTER_STATUSES.ACTIVE,
    },
    collegeId: { type: mongoose.Schema.Types.ObjectId, ref: "College", default: null },
    /* Set when status flips to inactive; a promoter is archived, never deleted. */
    archivedAt: { type: Date, default: null },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

promoterSchema.pre("validate", function deriveDisplayNameKey(next) {
  this.displayNameKey = toDisplayNameKey(this.displayName);
  if (this.displayNameKey.length === 0) {
    this.invalidate("displayName", "A promoter needs a display name.");
  }
  return next();
});

promoterSchema.index({ displayNameKey: 1 }, { name: "index_promoters_displayNameKey", unique: true });
promoterSchema.index({ collegeId: 1 }, { name: "index_promoters_collegeId" });

promoterSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    delete plainObject.displayNameKey;
    return plainObject;
  },
});

const PromoterModel = mongoose.model("Promoter", promoterSchema, "promoters");

module.exports = { PromoterModel, toDisplayNameKey };

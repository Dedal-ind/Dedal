const mongoose = require("mongoose");
const validator = require("validator");
const {
  FEST_VISIBILITIES,
  FEST_STATUSES,
  FEST_OFFERS_MAX,
  FEST_SPONSORS_MAX,
} = require("../constants/fest-constants");
const { buildOfferSchema } = require("../helpers/offer-schema-helpers");
const { buildSponsorSchema } = require("../helpers/sponsor-schema-helpers");

/*
 * One admin-defined offer (Food, Accommodation, Travel, DJ passes, …). Each
 * active offer materialises a scannable checkpoint on publish/update, which is
 * what lets a volunteer be scheduled at it.
 *
 * The SHAPE lives in helpers/offer-schema-helpers.js because event.offers embeds
 * exactly the same thing (an offer scoped to one event rather than the whole
 * fest); the price formula is documented there and implemented once.
 *
 * The default subdocument _id is KEPT deliberately: it is the stable identity
 * checkpoints reference (checkpoint.offerId) and per-offer entitlements
 * reference (entitlement.referenceId). Never set { _id: false } here.
 */
const offerSchema = buildOfferSchema();

/*
 * One sponsor logo on the participant-facing fest page. Bounded by the fest's
 * validate hook, exactly as the offers array is.
 *
 * The SHAPE lives in helpers/sponsor-schema-helpers.js because event.sponsors
 * embeds exactly the same thing (a sponsor of one event rather than of the whole
 * fest); the tier enum and the schema-versus-parser requiredness split are
 * documented there.
 */
const sponsorSchema = buildSponsorSchema();

const festSchema = new mongoose.Schema(
  {
    festName: { type: String, required: true, trim: true },
    festSlug: { type: String, required: true, trim: true, lowercase: true },
    hostCollegeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "College",
      required: true,
    },
    description: { type: String, trim: true, default: null },
    startsOn: { type: Date, required: true },
    endsOn: { type: Date, required: true },
    visibility: {
      type: String,
      required: true,
      enum: Object.values(FEST_VISIBILITIES),
    },
    // Meaningful only for interCollege fests; enforced by the hook below.
    allowedCollegeIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "College" }],
      default: [],
    },
    contactEmail: { type: String, trim: true, lowercase: true, default: null },
    /*
     * The organising desk's phone number. Stored as the bare 10 digits, never
     * formatted: the display side decides how to present it, and a stored "+91 "
     * or a hyphen is what makes two records of the same number fail to match.
     */
    contactPhone: { type: String, trim: true, default: null },
    // A cover/banner image URL (stored via the upload service — local in dev, S3 in prod).
    bannerImageUrl: { type: String, trim: true, default: null },
    status: {
      type: String,
      required: true,
      enum: Object.values(FEST_STATUSES),
      default: FEST_STATUSES.DRAFT,
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /*
     * True when this fest exists only to wrap a single standalone event created
     * via the independent-event flow. Hidden from participant fest lists and
     * the admin fest picker. Its lifecycle is bound to its one event:
     * publishing the event publishes the fest; cancelling the event cancels the
     * fest; deleting/purging the event purges the fest. "Convert to full fest"
     * flips this to false, one-way.
     */
    isSoloContainer: { type: Boolean, default: false },

    archivedAt: { type: Date, default: null },
    // Stamped once, when an administrator releases the fest's certificates at the
    // closing ceremony. Null until then; every certificate stays invisible before it.
    certificatesReleasedAt: { type: Date, default: null },

    /*
     * Set only when the fest is CANCELLED (called off), never when archived. The
     * reason is emailed to every participant and kept for the audit trail, so it
     * is stored rather than only logged.
     */
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true, default: null },
    // Admin-defined offers; replaced the old offersFood/offersAccommodation
    // booleans (migrated by helpers/migrate-fest-offers.js).
    offers: { type: [offerSchema], default: [] },
    // Sponsor logos shown on the participant fest page. Empty renders nothing.
    sponsors: { type: [sponsorSchema], default: [] },

    /*
     * The organiser's certificate design: a full-page background image the fixed
     * text/QR layout is drawn over, plus an optional signature block. Deliberately
     * NOT a DOCX/PPTX/PDF import with field mapping — pdfkit renders images only
     * (JPEG/PNG), and the text coordinates never move; artwork aligns to them.
     */
    /*
     * SIMPLIFIED on the client's instruction: the uploaded document IS the
     * certificate artwork — signatures, signatories, decorations all baked in.
     * The system only overlays the verification data (holder name, event, date,
     * code, QR). The old background/signature/signatory split is gone; the
     * migration (migrate-certificate-template-simplify.js) folds old
     * backgroundImageUrl values into documentTemplateUrl.
     */
    certificateTemplate: {
      type: new mongoose.Schema(
        {
          documentTemplateUrl: { type: String, trim: true, default: null },
        },
        { _id: false }
      ),
      default: null,
    },
  },
  { timestamps: true }
);

/*
 * invalidate() attaches each complaint to the offending field, so Mongoose
 * raises one ValidationError whose `errors` map names every problem at once.
 */
festSchema.pre("validate", function validateFestCrossFields(next) {
  if (this.startsOn && this.endsOn && this.endsOn.getTime() < this.startsOn.getTime()) {
    this.invalidate("endsOn", "endsOn must be on or after startsOn.");
  }

  const allowedCollegeCount = this.allowedCollegeIds ? this.allowedCollegeIds.length : 0;

  if (this.visibility === FEST_VISIBILITIES.INTER_COLLEGE && allowedCollegeCount === 0) {
    this.invalidate(
      "allowedCollegeIds",
      "An interCollege fest requires at least one allowed college."
    );
  }
  if (this.visibility !== FEST_VISIBILITIES.INTER_COLLEGE && allowedCollegeCount > 0) {
    this.invalidate(
      "allowedCollegeIds",
      `A ${this.visibility} fest must not list allowed colleges.`
    );
  }

  if (this.contactEmail && !validator.isEmail(this.contactEmail)) {
    this.invalidate("contactEmail", "contactEmail is not a valid email address.");
  }

  // Exactly ten digits, matching the participant phone rule — one shape of
  // phone number across the system rather than a looser one for organisers.
  if (this.contactPhone && !/^\d{10}$/.test(this.contactPhone)) {
    this.invalidate("contactPhone", "contactPhone must be a 10-digit mobile number.");
  }

  // Same style as event-model's validateQuestionIdsAreUnique: a duplicate
  // offerKey would make a claim ambiguous about which offer it claims.
  const offerKeys = (this.offers || []).map((offer) => offer.offerKey);
  if (new Set(offerKeys).size !== offerKeys.length) {
    this.invalidate("offers", "Every offerKey must be unique within a fest.");
  }
  if (offerKeys.length > FEST_OFFERS_MAX) {
    this.invalidate("offers", `A fest cannot have more than ${FEST_OFFERS_MAX} offers.`);
  }
  // Same bounding rule as offers: an embedded array must never grow unbounded.
  if ((this.sponsors || []).length > FEST_SPONSORS_MAX) {
    this.invalidate("sponsors", `A fest cannot have more than ${FEST_SPONSORS_MAX} sponsors.`);
  }

  return next();
});

festSchema.index({ festSlug: 1 }, { name: "index_fests_festSlug", unique: true });
festSchema.index(
  { hostCollegeId: 1, status: 1 },
  { name: "index_fests_hostCollegeId_status" }
);
festSchema.index({ startsOn: 1 }, { name: "index_fests_startsOn" });

festSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const FestModel = mongoose.model("Fest", festSchema, "fests");

module.exports = { FestModel };

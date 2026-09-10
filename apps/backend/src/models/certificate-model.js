const mongoose = require("mongoose");
const {
  CERTIFICATE_TYPES,
  CERTIFICATE_STATUSES,
} = require("../constants/certificate-constants");

/*
 * A certificate per PRODUCT-SPEC 5.14. It is generated invisibly and only becomes
 * visible when an administrator releases the fest's certificates at the closing
 * ceremony. eventId is null for the fest-level staff certificates.
 *
 * metadata is a snapshot taken at generation time — the holder's name, college,
 * USN, the event, the fest and its dates, and any winning position — and is never
 * rewritten. A later profile edit must not change what a printed certificate says.
 */
const certificateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },

    certificateType: {
      type: String,
      required: true,
      enum: Object.values(CERTIFICATE_TYPES),
    },

    verificationCode: { type: String, required: true, uppercase: true, trim: true },

    // A relative path to the rendered PDF, filled the first time it is downloaded.
    // Real cloud storage is deferred; the download endpoint streams this file.
    pdfUrl: { type: String, trim: true, default: null },

    status: {
      type: String,
      required: true,
      enum: Object.values(CERTIFICATE_STATUSES),
      default: CERTIFICATE_STATUSES.GENERATED_PENDING_RELEASE,
    },

    generatedAt: { type: Date, required: true, default: Date.now },
    releasedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },

    metadata: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

/*
 * One certificate per (user, fest, event). Mongo treats null eventId as a value,
 * so a fest-level staff certificate (eventId null) is deduped too, and a second
 * generate run finds the existing row rather than inserting a duplicate.
 */
certificateSchema.index(
  { userId: 1, festId: 1, eventId: 1 },
  { name: "index_certificates_userId_festId_eventId", unique: true }
);
certificateSchema.index(
  { verificationCode: 1 },
  { name: "index_certificates_verificationCode", unique: true }
);
certificateSchema.index({ status: 1 }, { name: "index_certificates_status" });
certificateSchema.index({ festId: 1 }, { name: "index_certificates_festId" });

certificateSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const CertificateModel = mongoose.model("Certificate", certificateSchema, "certificates");

module.exports = { CertificateModel };

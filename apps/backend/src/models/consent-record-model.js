const mongoose = require("mongoose");
const {
  POLICY_DOCUMENT_KINDS,
  CONSENT_ACTIONS,
  CONSENT_SOURCES,
} = require("../constants/consent-constants");

/*
 * One person's act against one legal text: accepted, or withdrawn.
 *
 * APPEND-ONLY. A record is written once and is never updated or deleted, at
 * the data layer, not by convention. A withdrawal is a NEW record, because the
 * fact that someone once accepted is history and erasing it destroys the
 * proof that the processing between acceptance and withdrawal was lawful.
 * "What does this person currently stand on" is answered by the LATEST record
 * per document kind (consent-service.getConsentStanding), never by mutating
 * an earlier one.
 *
 * contentHash is COPIED from the policy version at the moment of acceptance
 * rather than joined at read time, so the record proves what was accepted even
 * if the registry were ever repaired. null only on legacy backfill rows, where
 * the hash is honestly unknown.
 *
 * ipAddress and userAgent are the request context at the moment of the act —
 * the same two facts the audit log keeps. Null on backfilled rows.
 *
 * These rows are never purged with a fest (fest-purge-service) and survive
 * account deletion (user-service.deleteMyAccount): they are compliance
 * evidence about a person, not data about a fest or a feature.
 */
const consentRecordSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    documentKind: { type: String, required: true, enum: Object.values(POLICY_DOCUMENT_KINDS) },
    policyVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PolicyDocumentVersion",
      required: true,
    },
    contentHash: { type: String, default: null },
    action: { type: String, required: true, enum: Object.values(CONSENT_ACTIONS) },
    source: { type: String, required: true, enum: Object.values(CONSENT_SOURCES) },
    consentedAt: { type: Date, required: true, default: Date.now },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    isLegacy: { type: Boolean, required: true, default: false },
  },
  /* createdAt only: there is no update, so there is no updatedAt to keep. */
  { timestamps: { createdAt: true, updatedAt: false } }
);

consentRecordSchema.pre("save", function blockMutation(next) {
  if (!this.isNew) {
    return next(new Error("Consent records are append-only; record a new consent instead."));
  }
  return next();
});

function blockQueryMutation() {
  throw new Error("Consent records are append-only and cannot be updated.");
}
function blockDeletion() {
  throw new Error("Consent records are never deleted.");
}
consentRecordSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne"],
  { query: true },
  blockQueryMutation
);
consentRecordSchema.pre(
  ["deleteOne", "deleteMany", "findOneAndDelete", "findOneAndRemove"],
  { query: true },
  blockDeletion
);
consentRecordSchema.pre("deleteOne", { document: true, query: false }, blockDeletion);

/* Serves "latest record per kind for one person": the standing read. */
consentRecordSchema.index(
  { userId: 1, documentKind: 1, consentedAt: -1, _id: -1 },
  { name: "index_consentRecords_userId_documentKind_consentedAt" }
);

consentRecordSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const ConsentRecordModel = mongoose.model("ConsentRecord", consentRecordSchema, "consentRecords");

module.exports = { ConsentRecordModel };

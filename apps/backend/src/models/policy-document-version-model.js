const mongoose = require("mongoose");
const { POLICY_DOCUMENT_KINDS } = require("../constants/consent-constants");

/*
 * The registry of published legal texts: one row per version of each document
 * we ask people to accept.
 *
 * THE ROW CARRIES THE TEXT ITSELF, and the hash is computed from that text
 * and nothing else. The registry is the single source of truth for what a
 * participant is shown: the public read serves `text` from here, so the hash
 * describes exactly the wording that was rendered, by construction rather
 * than by discipline. A consent record copies the hash at the moment of
 * acceptance, so later — in a dispute, an audit, a regulator's request — the
 * version can be shown back verbatim and its hash re-derived from it.
 * The hash is SHA-256 of the normalised text (consent-service.hashPolicyText).
 *
 * IMMUTABLE ONCE EFFECTIVE, NEVER DELETED. Publishing changed text is
 * publishing a NEW version; the old one stays, because records point at it.
 * The one field that may change on an existing row is isEffective, and only
 * from true to false — the act of being superseded.
 *
 * EXACTLY ONE EFFECTIVE VERSION PER KIND, enforced by the partial unique index
 * below rather than by application discipline alone.
 *
 * isLegacy marks the placeholder row the backfill mints for text that was
 * accepted before versioning existed. Its contentHash is null — honestly
 * unknown — because we did not hash what people saw then, and inventing a
 * hash now would be inventing evidence.
 */
const policyDocumentVersionSchema = new mongoose.Schema(
  {
    kind: { type: String, required: true, enum: Object.values(POLICY_DOCUMENT_KINDS) },
    versionLabel: { type: String, required: true, trim: true },
    effectiveAt: { type: Date, required: true },
    contentHash: {
      type: String,
      default: null,
      validate: {
        validator: (value) => value === null || /^[a-f0-9]{64}$/.test(value),
        message: "contentHash must be a lowercase hex SHA-256 digest, or null for a legacy version.",
      },
    },
    /* The full document text this version consists of. null only on the
       legacy placeholder, whose wording was never captured. */
    text: { type: String, default: null },
    isEffective: { type: Boolean, required: true, default: false },
    isLegacy: { type: Boolean, required: true, default: false },
    publishedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

const MUTABLE_PATHS = new Set(["isEffective", "updatedAt"]);

/*
 * Shape rules for a NEW row, in pre("validate") — invalidate() only counts
 * during validation, which runs before any pre("save") hook.
 */
policyDocumentVersionSchema.pre("validate", function validateNewVersion(next) {
  if (!this.isNew) {
    return next();
  }
  if (!this.isLegacy && this.contentHash === null) {
    this.invalidate("contentHash", "A non-legacy version must carry a content hash.");
  }
  if (!this.isLegacy && (typeof this.text !== "string" || this.text.trim().length === 0)) {
    this.invalidate("text", "A non-legacy version must carry its full text.");
  }
  if (this.isLegacy && this.isEffective) {
    this.invalidate("isEffective", "A legacy placeholder is history and can never be effective.");
  }
  return next();
});

policyDocumentVersionSchema.pre("save", function guardImmutability(next) {
  if (this.isNew) {
    return next();
  }
  const changed = this.modifiedPaths().filter((path) => !MUTABLE_PATHS.has(path));
  if (changed.length > 0) {
    return next(
      new Error(
        "A policy document version is immutable once published; publish a new version instead " +
          `(attempted: ${changed.join(", ")}).`
      )
    );
  }
  if (this.isModified("isEffective") && this.isEffective === true) {
    return next(new Error("A superseded policy version cannot be made effective again."));
  }
  return next();
});

function blockQueryWrites() {
  throw new Error(
    "Policy document versions are written only through consent-service.publishPolicyVersion."
  );
}
function blockDeletion() {
  throw new Error("Policy document versions are never deleted.");
}
policyDocumentVersionSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne"],
  { query: true },
  blockQueryWrites
);
policyDocumentVersionSchema.pre(
  ["deleteOne", "deleteMany", "findOneAndDelete", "findOneAndRemove"],
  { query: true },
  blockDeletion
);
policyDocumentVersionSchema.pre("deleteOne", { document: true, query: false }, blockDeletion);

/* One effective version per kind, and the effective-version lookup. */
policyDocumentVersionSchema.index(
  { kind: 1, isEffective: 1 },
  {
    name: "index_policyDocumentVersions_kind_isEffective",
    unique: true,
    partialFilterExpression: { isEffective: true },
  }
);
policyDocumentVersionSchema.index(
  { kind: 1, versionLabel: 1 },
  { name: "index_policyDocumentVersions_kind_versionLabel", unique: true }
);

policyDocumentVersionSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const PolicyDocumentVersionModel = mongoose.model(
  "PolicyDocumentVersion",
  policyDocumentVersionSchema,
  "policyDocumentVersions"
);

module.exports = { PolicyDocumentVersionModel };

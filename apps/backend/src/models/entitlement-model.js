const mongoose = require("mongoose");
const {
  ENTITLEMENT_TYPES,
  ENTITLEMENT_STATUSES,
  ENTITLEMENT_SOURCES,
} = require("../constants/pass-constants");

const entitlementSchema = new mongoose.Schema(
  {
    passId: { type: mongoose.Schema.Types.ObjectId, ref: "Pass", required: true },
    entitlementType: {
      type: String,
      required: true,
      enum: Object.values(ENTITLEMENT_TYPES),
    },

    /*
     * What the entitlement points at, or null when it points at nothing. For an
     * eventEntry it is the eventId; for gateAccess it is null. No ref is declared
     * because the target model varies by type, so a populate names the model.
     */
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // null means unlimited uses.
    maximumUses: { type: Number, min: 1, default: null },
    usedCount: { type: Number, min: 0, default: 0 },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },

    source: { type: String, required: true, enum: Object.values(ENTITLEMENT_SOURCES) },
    status: {
      type: String,
      required: true,
      enum: Object.values(ENTITLEMENT_STATUSES),
      default: ENTITLEMENT_STATUSES.ACTIVE,
    },
  },
  { timestamps: true }
);

/*
 * No UNBOUNDED unique index over (passId, type, referenceId): duplicate eventEntry
 * rows are deliberately allowed so an admin can manually grant a second entry for a
 * re-do. That carve-out still stands. But the registration-driven path must be
 * single-active — two concurrent registrations for the same event both find-then-
 * create and leave two active rows the door would accept twice — so a PARTIAL
 * unique index enforces uniqueness only for registration-sourced active rows.
 * Manual grants (source manualGrant) and revoked/replaced rows (non-active status)
 * fall outside the filter and are exempt, so both the manual-grant carve-out and
 * rescheduling-then-re-entitling keep working. Do not drop the partialFilterExpression
 * thinking the whole index is redundant — it is exactly what keeps manual grants legal.
 */
entitlementSchema.index({ passId: 1 }, { name: "index_entitlements_passId" });
entitlementSchema.index(
  { passId: 1, entitlementType: 1, status: 1 },
  { name: "index_entitlements_passId_entitlementType_status" }
);
entitlementSchema.index(
  { passId: 1, entitlementType: 1, referenceId: 1 },
  {
    name: "index_entitlements_passId_entitlementType_referenceId",
    unique: true,
    partialFilterExpression: {
      source: ENTITLEMENT_SOURCES.REGISTRATION,
      status: ENTITLEMENT_STATUSES.ACTIVE,
    },
  }
);

entitlementSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const EntitlementModel = mongoose.model("Entitlement", entitlementSchema, "entitlements");

module.exports = { EntitlementModel };

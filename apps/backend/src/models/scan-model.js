const mongoose = require("mongoose");
const {
  SCAN_METHODS,
  SCAN_DIRECTIONS,
  SCAN_RESULTS,
} = require("../constants/scan-constants");

/*
 * Append-only: a scan row is written once and never edited or deleted. It is the
 * audit trail of every attempt, accepted or rejected, so a dispute at the gate
 * can be replayed. clientScanId is the device-minted idempotency key — a retried
 * offline submission carries the same id and is deduped by its unique index.
 */
const scanSchema = new mongoose.Schema(
  {
    clientScanId: { type: String, required: true, trim: true },

    /*
     * Null only on a rejectedPassNotFound attempt: there is no pass to point at,
     * yet the attempt is still recorded. Every other outcome carries the pass.
     */
    passId: { type: mongoose.Schema.Types.ObjectId, ref: "Pass", default: null },
    checkpointId: { type: mongoose.Schema.Types.ObjectId, ref: "Checkpoint", required: true },

    // Set only on an accepted scan: the entitlement whose use this scan consumed.
    entitlementId: { type: mongoose.Schema.Types.ObjectId, ref: "Entitlement", default: null },

    scannedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    scanMethod: { type: String, required: true, enum: Object.values(SCAN_METHODS) },
    direction: { type: String, required: true, enum: Object.values(SCAN_DIRECTIONS) },
    result: { type: String, required: true, enum: Object.values(SCAN_RESULTS) },

    overrideByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    overrideReason: { type: String, trim: true, default: null },

    scannedAt: { type: Date, required: true },
    syncedAt: { type: Date, required: true, default: Date.now },
    deviceInfo: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

scanSchema.index({ clientScanId: 1 }, { name: "index_scans_clientScanId", unique: true });
scanSchema.index({ passId: 1, scannedAt: -1 }, { name: "index_scans_passId_scannedAt" });
scanSchema.index(
  { checkpointId: 1, scannedAt: -1 },
  { name: "index_scans_checkpointId_scannedAt" }
);
scanSchema.index({ scannedByUserId: 1 }, { name: "index_scans_scannedByUserId" });

scanSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const ScanModel = mongoose.model("Scan", scanSchema, "scans");

module.exports = { ScanModel };

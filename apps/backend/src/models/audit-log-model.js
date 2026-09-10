const mongoose = require("mongoose");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");

/*
 * Append-only per PRODUCT-SPEC 5.15: one row per meaningful admin or participant
 * action, written once and never edited or deleted. beforeState/afterState hold
 * only the changed fields — a small snapshot for updates — not the whole document.
 */
const auditLogSchema = new mongoose.Schema(
  {
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    festId: { type: mongoose.Schema.Types.ObjectId, ref: "Fest", default: null },

    action: { type: String, required: true, enum: Object.values(AUDIT_ACTIONS) },
    entityType: { type: String, required: true, enum: Object.values(AUDIT_ENTITY_TYPES) },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },

    beforeState: { type: mongoose.Schema.Types.Mixed, default: null },
    afterState: { type: mongoose.Schema.Types.Mixed, default: null },

    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true }
);

auditLogSchema.index({ actorUserId: 1 }, { name: "index_auditLogs_actorUserId" });
auditLogSchema.index({ festId: 1, createdAt: -1 }, { name: "index_auditLogs_festId_createdAt" });
auditLogSchema.index(
  { entityType: 1, entityId: 1 },
  { name: "index_auditLogs_entityType_entityId" }
);

auditLogSchema.set("toJSON", {
  virtuals: true,
  versionKey: false,
  transform: (document, plainObject) => {
    delete plainObject._id;
    return plainObject;
  },
});

const AuditLogModel = mongoose.model("AuditLog", auditLogSchema, "auditLogs");

module.exports = { AuditLogModel };

/*
 * PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL.
 *
 * A hard delete of one fest and everything under it, for a team testing against a
 * live-connected Atlas database who would otherwise be deleting rows by hand in
 * Compass. It exists ONLY so that is not necessary.
 *
 * This is the deliberate exception to the codebase's delete-nothing policy, and
 * it is bounded on every side:
 *   · Environment-gated at the ROUTE, before any handler runs (development,
 *     staging, test only — production answers 403 without touching the database).
 *   · One fest per request. There is deliberately no purge-all endpoint: the
 *     blast radius of one accidental request must never exceed one fest.
 *   · Rate limited per administrator, so a looping integration test cannot drain
 *     the database.
 *   · CONSENT RECORDS ARE NEVER PURGED (see the note below).
 *   · An audit row is written FIRST, before anything is deleted, carrying the
 *     counts. It survives the purge and is the only remaining evidence the fest
 *     ever existed.
 *
 * It must NOT be confused with cancelFest, which preserves every row — see the
 * header of fest-cancellation-service.js.
 */
const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { PassModel } = require("../models/pass-model");
const { EntitlementModel } = require("../models/entitlement-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { ScanModel } = require("../models/scan-model");
const { PaymentOrderModel } = require("../models/payment-order-model");
const { AuditLogModel } = require("../models/audit-log-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { ContingentModel } = require("../models/contingent-model");
const { ContingentClaimModel } = require("../models/contingent-claim-model");
const { CertificateModel } = require("../models/certificate-model");
const { VolunteerShiftModel } = require("../models/volunteer-shift-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { assertAdministratorOfFest } = require("../helpers/assert-administrator-of-fest");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");

/* Five per administrator per rolling hour. In-memory on purpose: this tool never
 * runs in production, so a process-local counter is the right amount of machinery. */
const PURGE_LIMIT_PER_HOUR = 5;
const PURGE_WINDOW_MILLISECONDS = 60 * 60 * 1000;
const purgeTimestampsByAdministrator = new Map();

function assertPurgeRateLimit(actorUserId) {
  const now = Date.now();
  const previous = purgeTimestampsByAdministrator.get(String(actorUserId)) ?? [];
  const withinWindow = previous.filter(
    (timestamp) => now - timestamp < PURGE_WINDOW_MILLISECONDS
  );
  if (withinWindow.length >= PURGE_LIMIT_PER_HOUR) {
    throw new ApplicationError(
      429,
      ERROR_CODES.PURGE_RATE_LIMITED,
      `The test purge tool allows ${PURGE_LIMIT_PER_HOUR} purges per hour.`,
      { limit: PURGE_LIMIT_PER_HOUR }
    );
  }
  withinWindow.push(now);
  purgeTimestampsByAdministrator.set(String(actorUserId), withinWindow);
}

/*
 * Everything the purge would touch, resolved once and shared by the preview and
 * the purge itself so the numbers an admin confirms are the numbers that go.
 */
async function resolvePurgeScope(fest) {
  const eventIds = await EventModel.find({ festId: fest._id }).distinct("_id");
  const passIds = await PassModel.find({ festId: fest._id }).distinct("_id");
  const checkpointIds = await CheckpointModel.find({ festId: fest._id }).distinct("_id");
  const contingentIds = await ContingentModel.find({ festId: fest._id }).distinct("_id");
  const paymentGroupIds = await RegistrationModel.find({
    eventId: { $in: eventIds },
    paymentGroupId: { $ne: null },
  }).distinct("paymentGroupId");
  const contingentPurchaseGroupIds = await ContingentClaimModel.find({
    festId: fest._id,
  }).distinct("contingentPurchaseGroupId");

  return {
    eventIds,
    passIds,
    checkpointIds,
    contingentIds,
    paymentGroupIds: [...paymentGroupIds, ...contingentPurchaseGroupIds],
  };
}

async function countPurgeScope(fest, scope) {
  const [
    events,
    registrations,
    passes,
    entitlements,
    checkpoints,
    scans,
    paymentOrders,
    auditLogs,
    staffAssignments,
    contingents,
    contingentClaims,
    certificates,
    volunteerShifts,
  ] = await Promise.all([
    EventModel.countDocuments({ festId: fest._id }),
    RegistrationModel.countDocuments({ eventId: { $in: scope.eventIds } }),
    PassModel.countDocuments({ festId: fest._id }),
    EntitlementModel.countDocuments({ passId: { $in: scope.passIds } }),
    CheckpointModel.countDocuments({ festId: fest._id }),
    ScanModel.countDocuments({ checkpointId: { $in: scope.checkpointIds } }),
    PaymentOrderModel.countDocuments({ paymentGroupId: { $in: scope.paymentGroupIds } }),
    AuditLogModel.countDocuments({
      $or: [{ festId: fest._id }, { entityId: { $in: scope.eventIds } }],
    }),
    StaffAssignmentModel.countDocuments({ festId: fest._id }),
    ContingentModel.countDocuments({ festId: fest._id }),
    ContingentClaimModel.countDocuments({ festId: fest._id }),
    CertificateModel.countDocuments({ festId: fest._id }),
    VolunteerShiftModel.countDocuments({ festId: fest._id }),
  ]);

  return {
    events,
    registrations,
    passes,
    entitlements,
    checkpoints,
    scans,
    paymentOrders,
    auditLogs,
    staffAssignments,
    contingents,
    contingentClaims,
    certificates,
    volunteerShifts,
    /*
     * Consent records are NOT in this list and never will be. ConsentRecordModel
     * (consent-record-model.js) refuses deletion at the data layer, and it stays
     * out of the purge on principle: a record that someone accepted a given text
     * at a given moment is compliance evidence about a PERSON, not data about a
     * fest, and it must outlive anything an admin can delete.
     */
    consentRecordsPreserved: true,
  };
}

/* PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL. */
async function previewPurgeFest(actorUserId, festId) {
  const { fest } = await assertAdministratorOfFest(actorUserId, festId);
  const scope = await resolvePurgeScope(fest);
  const counts = await countPurgeScope(fest, scope);
  return { festId: String(fest._id), festName: fest.festName, counts };
}

/* PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL. */
async function purgeFest(actorUserId, festId, context = {}) {
  const { fest } = await assertAdministratorOfFest(actorUserId, festId);
  assertPurgeRateLimit(actorUserId);

  const scope = await resolvePurgeScope(fest);
  const counts = await countPurgeScope(fest, scope);

  /*
   * The audit row goes FIRST, before a single document is removed. Written after
   * the deletes it would be the one row describing a fest that no longer exists,
   * written by a process that might have failed halfway. It carries festId and
   * festName so the trail still names what was purged once the fest is gone.
   */
  await recordAuditLog({
    actorUserId,
    festId: fest._id,
    action: AUDIT_ACTIONS.TEST_FEST_PURGED,
    entityType: AUDIT_ENTITY_TYPES.FEST,
    entityId: fest._id,
    beforeState: { festName: fest.festName, festSlug: fest.festSlug, status: fest.status },
    afterState: { purgedCounts: counts },
    ...context,
  });
  const purgeAuditRowId = await AuditLogModel.findOne({
    action: AUDIT_ACTIONS.TEST_FEST_PURGED,
    festId: fest._id,
  })
    .sort({ createdAt: -1 })
    .distinct("_id");

  /*
   * Dependents first, fest last, so a failure part-way leaves orphans rather than
   * a fest pointing at collections that are already half gone. Every delete goes
   * through the MODEL so any pre-remove hook fires.
   *
   * Note on staffAssignments: the model has a hook that REFUSES deletion, because
   * assignments are permanent history everywhere else in the system. The purge
   * tool is the one caller allowed past it, and it says so explicitly.
   */
  await EntitlementModel.deleteMany({ passId: { $in: scope.passIds } });
  await ScanModel.deleteMany({ checkpointId: { $in: scope.checkpointIds } });
  await PassModel.deleteMany({ festId: fest._id });
  await RegistrationModel.deleteMany({ eventId: { $in: scope.eventIds } });
  await ContingentClaimModel.deleteMany({ festId: fest._id });
  await ContingentModel.deleteMany({ festId: fest._id });
  await CertificateModel.deleteMany({ festId: fest._id });
  await VolunteerShiftModel.deleteMany({ festId: fest._id });
  await CheckpointModel.deleteMany({ festId: fest._id });
  await PaymentOrderModel.deleteMany({ paymentGroupId: { $in: scope.paymentGroupIds } });
  await StaffAssignmentModel.deleteMany(
    { festId: fest._id },
    // PURGE_TEST_TOOL: the deletion guard is bypassed only here.
    { allowTestPurge: true }
  );
  /*
   * Audit rows for the fest go too — EXCEPT the purge row itself, which is the
   * record of this operation and would otherwise delete its own evidence.
   */
  await AuditLogModel.deleteMany({
    _id: { $nin: purgeAuditRowId },
    $or: [{ festId: fest._id }, { entityId: { $in: scope.eventIds } }],
  });
  await EventModel.deleteMany({ festId: fest._id });
  await FestModel.deleteOne({ _id: fest._id });

  return { festId: String(fest._id), festName: fest.festName, purgedCounts: counts };
}

module.exports = {
  purgeFest,
  previewPurgeFest,
  PURGE_LIMIT_PER_HOUR,
};

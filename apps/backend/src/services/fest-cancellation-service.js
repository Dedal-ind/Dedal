const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { EntitlementModel } = require("../models/entitlement-model");
const { UserModel } = require("../models/user-model");
const { ContingentModel } = require("../models/contingent-model");
const { ContingentClaimModel } = require("../models/contingent-claim-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { FEST_STATUSES } = require("../constants/fest-constants");
const { EVENT_STATUSES } = require("../constants/event-constants");
const {
  ACTIVE_REGISTRATION_STATUSES,
  CANCELLED_BY_ROLES,
} = require("../constants/registration-constants");
const { ENTITLEMENT_TYPES, ENTITLEMENT_STATUSES } = require("../constants/pass-constants");
const {
  CONTINGENT_STATUSES,
  CONTINGENT_CLAIM_STATUSES,
  SEAT_HOLDING_CLAIM_STATUSES,
} = require("../constants/contingent-constants");
const { assertAdministratorOfFest } = require("../helpers/assert-administrator-of-fest");
const {
  findFestPassIds,
  STAFF_REVOCATION_REASON_FEST_CANCELLED,
} = require("../helpers/event-cancellation-helpers");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");

/*
 * Cancelling a FEST is a different operation from archiving one, and the two are
 * deliberately not variations of each other:
 *
 *   ARCHIVE — "hide this from participants". Reversible, notifies nobody, changes
 *             no registration. Data stays readable in Data Controls.
 *   CANCEL  — "this is called off". Every participant of every event under the
 *             fest needs to know, every held seat ends, captured money becomes
 *             refund-pending. IRREVERSIBLE.
 *
 * CANCEL IS NOT DELETE. Nothing is removed: registrations, passes, entitlements,
 * scans, payment orders, certificates and audit rows all survive, flipped or
 * revoked but readable. They have to — a chargeback, a refund, a tax record, and
 * the "did I actually attend that" dispute two months later all read these rows
 * long after the fest is over. The dev-only purge tool (grep PURGE_TEST_TOOL) is
 * a separate, environment-gated thing and must never be conflated with this.
 *
 * Cancel is one-way ON PURPOSE. Un-cancelling would have to decide whether to
 * un-notify people (impossible), re-instate revoked entitlements, and un-mark
 * refunds an operator may already have paid out. If plans change, the honest
 * move is a new fest — so transitionFest has no CANCELLED -> anything edge and
 * this service exposes no reverse call.
 */
const MINIMUM_CANCELLATION_REASON_LENGTH = 10;

async function loadCancellableFest(userId, festId) {
  const { fest } = await assertAdministratorOfFest(userId, festId);

  if (fest.status === FEST_STATUSES.CANCELLED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_FEST_STATE,
      "This fest is already cancelled.",
      { currentStatus: fest.status, attemptedTransition: FEST_STATUSES.CANCELLED }
    );
  }
  /*
   * Only a PUBLISHED fest can be cancelled. A draft has no participants to
   * notify (delete the draft's events or just leave it), and an archived fest is
   * already invisible — cancelling it would email people about something they
   * can no longer see.
   */
  if (fest.status !== FEST_STATUSES.PUBLISHED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_FEST_STATE,
      `A ${fest.status} fest cannot be cancelled. Only a published fest has participants to notify.`,
      { currentStatus: fest.status, attemptedTransition: FEST_STATUSES.CANCELLED }
    );
  }
  return fest;
}

/*
 * What cancelling this fest would do, for the confirmation dialog. Read-only, on
 * its own GET route. An admin who sees the real numbers before pressing confirm
 * does not cancel the wrong fest.
 */
async function previewCancelFest(userId, festId) {
  const { fest } = await assertAdministratorOfFest(userId, festId);

  const events = await EventModel.find({
    festId: fest._id,
    status: { $ne: EVENT_STATUSES.CANCELLED },
  })
    .select("_id")
    .lean();
  const eventIds = events.map((event) => event._id);

  const activeRegistrations = await RegistrationModel.find({
    eventId: { $in: eventIds },
    status: { $in: ACTIVE_REGISTRATION_STATUSES },
  })
    .select("userId totalFeePaise")
    .lean();

  const contingents = await ContingentModel.find({
    festId: fest._id,
    status: { $ne: CONTINGENT_STATUSES.CANCELLED },
  })
    .select("_id")
    .lean();
  const contingentClaimCount = await ContingentClaimModel.countDocuments({
    contingentId: { $in: contingents.map((contingent) => contingent._id) },
    claimStatus: { $in: SEAT_HOLDING_CLAIM_STATUSES },
  });

  return {
    eventCount: events.length,
    registrationCount: activeRegistrations.length,
    paidRegistrationCount: activeRegistrations.filter(
      (registration) => (registration.totalFeePaise ?? 0) > 0
    ).length,
    contingentCount: contingents.length,
    contingentClaimCount,
    // Distinct people, not rows: one participant in four events is one person to
    // notify, and the admin is judging human impact here.
    participantCount: new Set(activeRegistrations.map((registration) => String(registration.userId)))
      .size,
    totalRefundPendingPaise: activeRegistrations.reduce(
      (runningTotal, registration) => runningTotal + (registration.totalFeePaise ?? 0),
      0
    ),
  };
}

/*
 * Every live contingent under the fest ends with it. The seats its claims held
 * are academic once the events are cancelled, but the CLAIMS must still be closed
 * or a bundle keeps advertising itself as purchasable in the data. Rows are
 * flipped, never deleted.
 */
async function cancelFestContingents(fest, actorUserId, context) {
  const contingents = await ContingentModel.find({
    festId: fest._id,
    status: { $ne: CONTINGENT_STATUSES.CANCELLED },
  });
  if (contingents.length === 0) {
    return { contingentsCancelled: 0, claimsCancelled: 0 };
  }

  const contingentIds = contingents.map((contingent) => contingent._id);
  const claimResult = await ContingentClaimModel.updateMany(
    { contingentId: { $in: contingentIds }, claimStatus: { $in: SEAT_HOLDING_CLAIM_STATUSES } },
    { $set: { claimStatus: CONTINGENT_CLAIM_STATUSES.CANCELLED, cancelledAt: new Date() } }
  );
  await ContingentModel.updateMany(
    { _id: { $in: contingentIds } },
    { $set: { status: CONTINGENT_STATUSES.CANCELLED } }
  );

  for (const contingent of contingents) {
    await recordAuditLog({
      actorUserId,
      festId: fest._id,
      action: AUDIT_ACTIONS.CONTINGENT_CANCELLED,
      entityType: AUDIT_ENTITY_TYPES.CONTINGENT,
      entityId: contingent._id,
      afterState: { status: CONTINGENT_STATUSES.CANCELLED, initiatedBy: "cancelFest" },
      ...context,
    });
  }
  return { contingentsCancelled: contingents.length, claimsCancelled: claimResult.modifiedCount ?? 0 };
}

/*
 * Every ACTIVE staff assignment on the fest loses its access: both roles, the
 * ones scoped to individual events AND the fest-wide ones (empty eventIds).
 * Unlike the per-event cascade — which only touches an assignment that existed
 * for that one event — a cancelled fest leaves nothing for anyone to staff.
 *
 * Driven through revokeStaffAssignment, NOT by writing REVOKED on the model, so
 * the staff.revoked audit row and the revocation email fire once per person
 * exactly as a manual revoke does.
 */
async function revokeAllFestStaff(fest, actorUserId, context) {
  const { StaffAssignmentModel } = require("../models/staff-assignment-model");
  const { STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
  const { revokeStaffAssignment } = require("./staff-assignment-service");

  const assignments = await StaffAssignmentModel.find({
    festId: fest._id,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("_id userId")
    .lean();

  let revokedCount = 0;
  const staffUserIds = new Set();
  for (const assignment of assignments) {
    await revokeStaffAssignment(
      actorUserId,
      String(fest._id),
      String(assignment._id),
      STAFF_REVOCATION_REASON_FEST_CANCELLED,
      context
    );
    revokedCount += 1;
    staffUserIds.add(String(assignment.userId));
  }
  return { staffAssignmentsRevoked: revokedCount, staffUserIds };
}

/*
 * ONE email per participant for the whole fest, listing every event they were
 * registered for. Driving this from the fest level is the only way to avoid a
 * five-event participant receiving five separate notices.
 */
async function notifyFestCancelled(fest, eventNamesByUserId, refundPaiseByUserId, reason) {
  const { sendFestCancelledEmail } = require("./email-service");
  const userIds = [...eventNamesByUserId.keys()];
  if (userIds.length === 0) {
    return 0;
  }
  const recipients = await UserModel.find({ _id: { $in: userIds } })
    .select("emailAddress fullName")
    .lean();

  let sentCount = 0;
  for (const recipient of recipients) {
    const wasSent = await sendFestCancelledEmail({
      emailAddress: recipient.emailAddress,
      fullName: recipient.fullName,
      festName: fest.festName,
      festBannerImageUrl: fest.bannerImageUrl ?? null,
      eventNames: eventNamesByUserId.get(String(recipient._id)) ?? [],
      reason,
      refundPendingPaise: refundPaiseByUserId.get(String(recipient._id)) ?? 0,
      supportEmailAddress: fest.contactEmail ?? null,
    });
    if (wasSent) {
      sentCount += 1;
    }
  }
  return sentCount;
}

/*
 * The fest cancellation. Cascades through the SAME per-event cascade cancelEvent
 * uses (one implementation of "what cancelling an event means"), with
 * notifications suppressed per event and grouped once at the end.
 */
async function cancelFest(userId, festId, reason, context = {}) {
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  if (trimmedReason.length < MINIMUM_CANCELLATION_REASON_LENGTH) {
    throw new ApplicationError(
      400,
      ERROR_CODES.CANCELLATION_REASON_REQUIRED,
      `Cancelling a fest needs a reason of at least ${MINIMUM_CANCELLATION_REASON_LENGTH} characters — it is emailed to every participant and kept in the audit trail.`,
      { minimumLength: MINIMUM_CANCELLATION_REASON_LENGTH }
    );
  }

  const fest = await loadCancellableFest(userId, festId);

  /*
   * Contingents first. Their claims are what would otherwise make the per-event
   * guard (assertEventNotLockedByContingent) refuse each bundled sub-event — and
   * a fest-wide cancellation legitimately supersedes that guard, because the
   * contingent is being cancelled in the same operation rather than orphaned.
   */
  const contingentResult = await cancelFestContingents(fest, userId, context);

  /*
   * Staff next, at FEST scope — every role, every assignment, event-scoped and
   * fest-wide alike. Done here rather than per event so one coordinator covering
   * four events is revoked once (one email about their access), and so the
   * per-event cascades below can skip their own narrower revocation pass.
   */
  const staffResult = await revokeAllFestStaff(fest, userId, context);

  // Collect for the grouped email as each event cascades.
  const eventNamesByUserId = new Map();
  const refundPaiseByUserId = new Map();
  const cascadeTotals = {
    eventsCancelled: 0,
    registrationsFlipped: 0,
    entitlementsRevoked: 0,
    checkpointsDeactivated: 0,
    refundMarkerCount: 0,
  };

  const events = await EventModel.find({
    festId: fest._id,
    status: { $ne: EVENT_STATUSES.CANCELLED },
  }).select("_id");

  // Required lazily to avoid a require cycle: event-service already imports the
  // cascade helper, and this service is reached from the fest routes.
  const { cancelEvent } = require("./event-service");

  for (const eventRow of events) {
    const registrationsBefore = await RegistrationModel.find({
      eventId: eventRow._id,
      status: { $in: ACTIVE_REGISTRATION_STATUSES },
    })
      .select("userId totalFeePaise")
      .lean();

    const cancelled = await cancelEvent(userId, String(fest._id), String(eventRow._id), context, {
      reason: trimmedReason,
      shouldNotify: false,
      // Fest scope already revoked every assignment, above.
      shouldRevokeStaff: false,
    });

    cascadeTotals.eventsCancelled += 1;
    cascadeTotals.registrationsFlipped += cancelled.cascade.registrationsFlipped;
    cascadeTotals.entitlementsRevoked += cancelled.cascade.entitlementsRevoked;
    cascadeTotals.checkpointsDeactivated += cancelled.cascade.checkpointsDeactivated;
    cascadeTotals.refundMarkerCount += cancelled.cascade.refundMarkerCount;

    for (const registration of registrationsBefore) {
      const userKey = String(registration.userId);
      if (!eventNamesByUserId.has(userKey)) {
        eventNamesByUserId.set(userKey, []);
      }
      eventNamesByUserId.get(userKey).push(cancelled.eventName);
      refundPaiseByUserId.set(
        userKey,
        (refundPaiseByUserId.get(userKey) ?? 0) + (registration.totalFeePaise ?? 0)
      );
    }
  }

  /*
   * The fest gate closes too. Scoped to passes of this fest, and to GATE_ACCESS
   * only — an offerClaim is a record of something bought and stays readable, and
   * event entries were already revoked by their own cascades.
   */
  const passIds = await findFestPassIds(fest._id, [...eventNamesByUserId.keys()]);
  const gateResult = await EntitlementModel.updateMany(
    {
      passId: { $in: passIds },
      entitlementType: ENTITLEMENT_TYPES.GATE_ACCESS,
      status: ENTITLEMENT_STATUSES.ACTIVE,
    },
    { $set: { status: ENTITLEMENT_STATUSES.REVOKED } }
  );

  /*
   * TWO populations, TWO messages, and they are not the same list.
   *
   * eventNamesByUserId is built purely from REGISTRATIONS, so a volunteer or
   * coordinator who was never registered as a participant does NOT receive the
   * participant-facing "the fest is cancelled" email — they already received the
   * staff revocation email, which is the message that concerns them. Someone who
   * is BOTH staff and a registered participant receives both: one about their
   * access, one about their attendance. That is correct, not a duplicate.
   */
  const notifiedCount = await notifyFestCancelled(
    fest,
    eventNamesByUserId,
    refundPaiseByUserId,
    trimmedReason
  );

  fest.status = FEST_STATUSES.CANCELLED;
  fest.cancelledAt = new Date();
  fest.cancellationReason = trimmedReason;
  await fest.save();

  const result = {
    ...cascadeTotals,
    staffAssignmentsRevoked: staffResult.staffAssignmentsRevoked,
    gateEntitlementsRevoked: gateResult.modifiedCount ?? 0,
    ...contingentResult,
    participantsNotified: notifiedCount,
    cancelledByRole: CANCELLED_BY_ROLES.ADMIN,
  };

  await recordAuditLog({
    actorUserId: userId,
    festId: fest._id,
    action: AUDIT_ACTIONS.FEST_CANCELLED,
    entityType: AUDIT_ENTITY_TYPES.FEST,
    entityId: fest._id,
    afterState: { status: fest.status, reason: trimmedReason, ...result },
    ...context,
  });

  return { fest: fest.toJSON(), ...result };
}

module.exports = {
  cancelFest,
  previewCancelFest,
  MINIMUM_CANCELLATION_REASON_LENGTH,
};

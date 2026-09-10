const { RegistrationModel } = require("../models/registration-model");
const { EntitlementModel } = require("../models/entitlement-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { PassModel } = require("../models/pass-model");
const { ScanModel } = require("../models/scan-model");
const { UserModel } = require("../models/user-model");
const { ContingentClaimModel } = require("../models/contingent-claim-model");
const {
  PaymentOrderModel,
  PAYMENT_ORDER_STATUSES,
} = require("../models/payment-order-model");
const {
  REGISTRATION_STATUSES,
  ACTIVE_REGISTRATION_STATUSES,
  CANCELLED_BY_ROLES,
} = require("../constants/registration-constants");
const { ENTITLEMENT_TYPES, ENTITLEMENT_STATUSES } = require("../constants/pass-constants");
const { SCAN_RESULTS } = require("../constants/scan-constants");
const { SEAT_HOLDING_CLAIM_STATUSES } = require("../constants/contingent-constants");
const { recordAuditLog } = require("../services/audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");

/* Reasons carried into the staff revocation email and audit row. */
const STAFF_REVOCATION_REASON_EVENT_CANCELLED = "Event cancelled";
const STAFF_REVOCATION_REASON_FEST_CANCELLED = "Fest cancelled - organiser-initiated";

/*
 * Cancelling an event used to flip one status field and write one audit row,
 * which left every downstream fact contradicting it: registrations still read
 * CONFIRMED, the participant's pass still carried an ACTIVE eventEntry, and the
 * door checkpoint still admitted people. That is the "cancelled event that isn't
 * cancelled" shape — participants arrive at an empty room holding a pass the
 * scanner accepts. This file is the cascade that makes the flip true.
 *
 * Deliberate non-actions, each one load-bearing:
 *   · PENDING_PAYMENT rows are NOT touched. They are inside their hold window and
 *     the existing payment-expiry sweep releases them; reaching in here would
 *     race that sweep for the same seat.
 *   · Seats are NOT released. registeredCount is history for a dead event, and
 *     the release paths assume a live event to give the seat back to.
 *   · NOTHING is deleted. Entitlements are revoked, checkpoints deactivated,
 *     scan rows untouched — the audit trail of who scanned what survives the
 *     event it belonged to.
 *   · gateAccess, other events' eventEntry, and every offerClaim are untouched.
 *     Cancelling one sub-event must not lock a participant out of the fest, of
 *     their other events, or of the food they paid for.
 */

/*
 * What an admin sees BEFORE confirming. A separate read, on a separate GET route
 * — never a flag on the destructive POST, because a mistyped flag that turns a
 * preview into a real cancellation costs a live event.
 */
async function buildEventCancellationPreview(event) {
  const activeRegistrations = await RegistrationModel.find({
    eventId: event._id,
    status: { $in: ACTIVE_REGISTRATION_STATUSES },
  })
    .select("userId totalFeePaise paymentGroupId")
    .lean();

  const paidRegistrationCount = activeRegistrations.filter(
    (registration) => (registration.totalFeePaise ?? 0) > 0
  ).length;
  const totalRefundPendingPaise = activeRegistrations.reduce(
    (runningTotal, registration) => runningTotal + (registration.totalFeePaise ?? 0),
    0
  );

  const entitlementCount = await EntitlementModel.countDocuments({
    entitlementType: ENTITLEMENT_TYPES.EVENT_ENTRY,
    referenceId: event._id,
    status: ENTITLEMENT_STATUSES.ACTIVE,
  });

  /*
   * Contingent claims are counted separately because they are NOT registrations
   * yet: an invited-but-unaccepted claim holds a seat with no registration row,
   * so a preview reading only registrations would tell an admin "0 affected"
   * while twelve people are waiting on an invite.
   */
  const contingentClaimCount = await ContingentClaimModel.countDocuments({
    eventId: event._id,
    claimStatus: { $in: SEAT_HOLDING_CLAIM_STATUSES },
  });

  /*
   * Whether anyone has actually walked through this event's door. Cancelling an
   * event nobody has attended is an administrative correction; cancelling one
   * mid-run is a different conversation with different people, and the admin
   * should know which one they are having before they press the button.
   */
  const eventCheckpointIds = await CheckpointModel.find({ eventId: event._id }).distinct("_id");
  const hasActiveScans =
    eventCheckpointIds.length > 0 &&
    Boolean(
      await ScanModel.findOne({
        checkpointId: { $in: eventCheckpointIds },
        result: SCAN_RESULTS.ACCEPTED,
      })
        .select("_id")
        .lean()
    );

  return {
    activeRegistrationCount: activeRegistrations.length,
    paidRegistrationCount,
    entitlementCount,
    contingentClaimCount,
    hasActiveScans,
    totalRefundPendingPaise,
  };
}

/*
 * Marks each affected payment group refund-pending. Reuses the EXISTING
 * PAYMENT_ORDER_STATUSES.REFUND_PENDING and the EXISTING
 * AUDIT_ACTIONS.PAYMENT_REFUND_PENDING rather than minting parallel names for
 * one concept — contingent cancellation already established both.
 *
 * There is deliberately no Razorpay call: the platform has no refund API, and
 * adding one needs a client-approved refund policy (see docs/security-debt.md).
 * The marker plus the audit row is what the operator acts on from the dashboard.
 */
async function markRefundsPending(event, registrations, actorUserId, context) {
  const paidRegistrations = registrations.filter(
    (registration) => (registration.totalFeePaise ?? 0) > 0 && registration.paymentGroupId
  );
  const seenGroupIds = new Set();
  let refundMarkerCount = 0;

  for (const registration of paidRegistrations) {
    if (seenGroupIds.has(registration.paymentGroupId)) {
      continue;
    }
    seenGroupIds.add(registration.paymentGroupId);

    const order = await PaymentOrderModel.findOne({
      paymentGroupId: registration.paymentGroupId,
    });
    if (!order || order.status !== PAYMENT_ORDER_STATUSES.CAPTURED) {
      // Nothing was captured, so there is nothing to refund.
      continue;
    }
    order.status = PAYMENT_ORDER_STATUSES.REFUND_PENDING;
    await order.save();
    refundMarkerCount += 1;

    await recordAuditLog({
      actorUserId,
      festId: event.festId?._id ?? event.festId,
      action: AUDIT_ACTIONS.PAYMENT_REFUND_PENDING,
      entityType: AUDIT_ENTITY_TYPES.REGISTRATION,
      entityId: registration._id,
      afterState: {
        paymentGroupId: registration.paymentGroupId,
        registrationId: String(registration._id),
        amountPaise: order.totalAmountPaise,
        initiatedBy: "cancelEvent",
        eventId: String(event._id),
        eventName: event.eventName,
      },
      ...context,
    });
  }
  return refundMarkerCount;
}

/*
 * Staff whose reason to exist was THIS event lose their access with it.
 *
 * The scope rule is deliberately narrow: only an assignment whose eventIds is
 * EXACTLY this one event is revoked. A fest-wide assignment (empty eventIds) and
 * a multi-event assignment that still covers other live events are UNCHANGED —
 * revoking those would strip a coordinator of events that are still running
 * because one of their events was called off.
 *
 * It goes through revokeStaffAssignment rather than writing REVOKED on the model,
 * so the existing audit row (staff.revoked) and the revocation email fire exactly
 * as they do for a manual revoke. One path, one set of side effects.
 */
async function revokeStaffAssignmentsForCancelledEvent(event, actorUserId, context) {
  const { StaffAssignmentModel } = require("../models/staff-assignment-model");
  const { STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
  const { revokeStaffAssignment } = require("../services/staff-assignment-service");

  const festId = event.festId?._id ?? event.festId;
  const candidates = await StaffAssignmentModel.find({
    festId,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    eventIds: event._id,
  })
    .select("_id eventIds")
    .lean();

  const singleEventAssignments = candidates.filter(
    (assignment) => (assignment.eventIds ?? []).length === 1
  );

  let revokedCount = 0;
  for (const assignment of singleEventAssignments) {
    await revokeStaffAssignment(
      actorUserId,
      String(festId),
      String(assignment._id),
      STAFF_REVOCATION_REASON_EVENT_CANCELLED,
      context
    );
    revokedCount += 1;
  }
  return revokedCount;
}

/*
 * The cascade. Runs BEFORE the caller writes its own event-cancelled audit row,
 * so the audit trail reads in causal order.
 *
 * `shouldNotify` is false when a FEST cancellation drives this: one participant
 * registered for five events of one fest must get ONE "the fest is cancelled"
 * email, not five. The fest path collects the affected participants this
 * function returns and sends once.
 */
async function cascadeEventCancellation({
  event,
  actorUserId,
  reason,
  context = {},
  shouldNotify = true,
  shouldRevokeStaff = true,
}) {
  const options = { shouldRevokeStaff };
  const cancelledAt = new Date();
  const activeRegistrations = await RegistrationModel.find({
    eventId: event._id,
    status: { $in: ACTIVE_REGISTRATION_STATUSES },
  });

  // 1. The registrations end with the event, labelled as the organiser's act.
  if (activeRegistrations.length > 0) {
    await RegistrationModel.updateMany(
      { _id: { $in: activeRegistrations.map((registration) => registration._id) } },
      {
        $set: {
          status: REGISTRATION_STATUSES.EVENT_CANCELLED,
          eventCancelledAt: cancelledAt,
          cancelledAt,
          cancellationReason: reason,
          cancelledByRole: CANCELLED_BY_ROLES.ADMIN,
          cancelledByUserId: actorUserId,
        },
      }
    );
  }

  /*
   * 2. This event's door entitlement only. Matching on referenceId is what keeps
   * the blast radius to one event: gate access, other events' entries and every
   * offerClaim carry different referenceIds and are never seen by this filter.
   * REVOKED is the existing status for exactly this meaning (the participant
   * cancel path already uses it) — no new near-duplicate status was invented.
   * scan-decision's findMatchingEntitlement filters on ACTIVE, so the door now
   * rejects with rejectedNoEntitlement, which is the correct answer.
   */
  const entitlementResult = await EntitlementModel.updateMany(
    {
      entitlementType: ENTITLEMENT_TYPES.EVENT_ENTRY,
      referenceId: event._id,
      status: ENTITLEMENT_STATUSES.ACTIVE,
    },
    { $set: { status: ENTITLEMENT_STATUSES.REVOKED } }
  );

  /*
   * 3. Every checkpoint of this event stops accepting scans — the door AND any
   * event-scoped offer counter, since both belong to an event that is no longer
   * happening. Deactivated, NEVER deleted: scans already logged against them are
   * append-only history.
   */
  const checkpointResult = await CheckpointModel.updateMany(
    { eventId: event._id, isActive: true },
    { $set: { isActive: false } }
  );

  // 4. Money already captured is owed back; marker + audit, no gateway call.
  const refundMarkerCount = await markRefundsPending(
    event,
    activeRegistrations,
    actorUserId,
    context
  );

  /*
   * 5. Staff assigned to THIS EVENT ONLY lose their access. A fest cancellation
   * revokes staff itself, at fest scope, so it skips this narrower pass.
   */
  const staffRevokedCount = options.shouldRevokeStaff === false
    ? 0
    : await revokeStaffAssignmentsForCancelledEvent(event, actorUserId, context);

  /*
   * 6. Who to tell. Returned to the caller so a fest-wide cancellation can group
   * one email per person; the single-event path sends immediately below.
   */
  const affectedUserIds = [
    ...new Set(activeRegistrations.map((registration) => String(registration.userId))),
  ];
  /*
   * Whether money is owed is a property of the REGISTRATION, not of the event.
   * Since the offers rework a free event can carry paid registrations (someone
   * bought food or a travel add-on), so reading event.feeAmountPaise here would
   * tell a participant who paid Rs 400 for meals that no refund is coming.
   */
  const refundPaiseByUserId = new Map();
  for (const registration of activeRegistrations) {
    const userKey = String(registration.userId);
    refundPaiseByUserId.set(
      userKey,
      (refundPaiseByUserId.get(userKey) ?? 0) + (registration.totalFeePaise ?? 0)
    );
  }

  let notifiedCount = 0;
  if (shouldNotify && affectedUserIds.length > 0) {
    notifiedCount = await notifyEventCancelled(event, affectedUserIds, reason, refundPaiseByUserId);
  }

  return {
    registrationsFlipped: activeRegistrations.length,
    staffAssignmentsRevoked: staffRevokedCount,
    entitlementsRevoked: entitlementResult.modifiedCount ?? 0,
    checkpointsDeactivated: checkpointResult.modifiedCount ?? 0,
    refundMarkerCount,
    notifiedCount,
    affectedUserIds,
    paidRegistrationCount: activeRegistrations.filter(
      (registration) => (registration.totalFeePaise ?? 0) > 0
    ).length,
  };
}

/*
 * One email per affected participant, iterated rather than queued.
 *
 * That is a deliberate, sized decision, not an oversight: a fest event tops out
 * in the low hundreds of participants, each send is a fire-and-forget HTTP call
 * that cannot fail the cancellation, and the alternative is building a job queue
 * this codebase does not have. At thousands of recipients a queue IS the right
 * shape — that is the point to revisit, not now.
 */
async function notifyEventCancelled(event, affectedUserIds, reason, refundPaiseByUserId = new Map()) {
  // Required lazily: email-service is stubbed in tests by seeding the require
  // cache, and a top-level require here would capture the real module first.
  const { sendEventCancelledEmail } = require("../services/email-service");
  const { FestModel } = require("../models/fest-model");

  const fest = await FestModel.findById(event.festId?._id ?? event.festId)
    .select("festName contactEmail bannerImageUrl")
    .lean();
  const recipients = await UserModel.find({ _id: { $in: affectedUserIds } })
    .select("emailAddress fullName")
    .lean();
  let sentCount = 0;
  for (const recipient of recipients) {
    const wasSent = await sendEventCancelledEmail({
      emailAddress: recipient.emailAddress,
      fullName: recipient.fullName,
      eventName: event.eventName,
      festName: fest?.festName ?? "",
      festBannerImageUrl: fest?.bannerImageUrl ?? null,
      reason,
      // Per PARTICIPANT, from what they actually paid — see the note above.
      isRefundPending: (refundPaiseByUserId.get(String(recipient._id)) ?? 0) > 0,
      supportEmailAddress: fest?.contactEmail ?? null,
    });
    if (wasSent) {
      sentCount += 1;
    }
  }
  return sentCount;
}

/* Passes for a set of users in one fest — the fest-cancel path closes their gates. */
async function findFestPassIds(festId, userIds) {
  return PassModel.find({ festId, userId: { $in: userIds } }).distinct("_id");
}

module.exports = {
  STAFF_REVOCATION_REASON_EVENT_CANCELLED,
  STAFF_REVOCATION_REASON_FEST_CANCELLED,
  buildEventCancellationPreview,
  cascadeEventCancellation,
  notifyEventCancelled,
  findFestPassIds,
};

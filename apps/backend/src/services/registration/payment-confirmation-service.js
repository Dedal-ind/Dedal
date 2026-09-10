const { RegistrationModel } = require("../../models/registration-model");
const { ApplicationError } = require("../../helpers/application-error");
const { ERROR_CODES } = require("../../constants/error-codes");
const { REGISTRATION_STATUSES, PAYMENT_STATUSES } = require("../../constants/registration-constants");
const { loadEventForRegistration } = require("../../helpers/registration-payment-helpers");
const { assertAdministratorOfFest } = require("../../helpers/assert-administrator-of-fest");
const { ensurePassAndEventEntitlement } = require("../pass-service");
const { recordAuditLog } = require("../audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../../constants/audit-log-constants");
const { awardBadgesInBackground } = require("../achievement-service");

/*
 * The shared confirmation core, keyed on paymentGroupId. Flips the whole group from
 * PENDING_PAYMENT to CONFIRMED and mints each member's pass and event-entry
 * entitlement — the side effects the free path grants at registration time. No
 * authorization here: the two callers gate it themselves (the admin endpoint asserts
 * administrator; the Razorpay path proves payment by signature).
 */
async function confirmPaymentGroup(actorUserId, paymentGroupId, paymentReference, context = {}) {
  const pending = await RegistrationModel.find({
    paymentGroupId,
    paymentStatus: PAYMENT_STATUSES.PENDING,
  });
  if (pending.length === 0) {
    /*
     * A capture can land after the lazy expiry sweep has already flipped this
     * group to PAYMENT_EXPIRED and released its seats — a participant who paid
     * at minute 29 of the 30-minute window. Razorpay has the money, so this must
     * not vanish into a generic 404: record the refund trail and say what
     * happened. The seat is deliberately NOT resurrected — it may already have
     * been claimed by someone else, and silently overbooking an event to paper
     * over a refund case is worse than the refund.
     */
    const expiredRows = await RegistrationModel.find({
      paymentGroupId,
      status: REGISTRATION_STATUSES.PAYMENT_EXPIRED,
      paymentStatus: PAYMENT_STATUSES.EXPIRED,
    }).lean();
    if (expiredRows.length > 0) {
      const expiredEvent = await loadEventForRegistration(expiredRows[0].eventId);
      // The webhook path has no actor; the audit schema requires one, so the row
      // is attributed to the participant whose payment it was.
      await recordAuditLog({
        actorUserId: actorUserId ?? expiredRows[0].userId,
        festId: expiredEvent ? expiredEvent.festId : null,
        action: AUDIT_ACTIONS.PAYMENT_CAPTURED_AFTER_EXPIRY,
        entityType: AUDIT_ENTITY_TYPES.REGISTRATION,
        entityId: expiredRows[0]._id,
        afterState: {
          paymentGroupId,
          paymentReference: paymentReference || null,
          totalFeePaise: expiredRows[0].totalFeePaise ?? null,
          expiredCount: expiredRows.length,
        },
        ...context,
      });
      throw new ApplicationError(
        409,
        ERROR_CODES.PAYMENT_CAPTURED_AFTER_EXPIRY,
        "This payment was captured after the hold expired. The amount will be refunded — you have not lost your money."
      );
    }
    throw new ApplicationError(
      404,
      ERROR_CODES.PAYMENT_GROUP_NOT_FOUND,
      "No pending payment was found for that group."
    );
  }

  await RegistrationModel.updateMany(
    { paymentGroupId, paymentStatus: PAYMENT_STATUSES.PENDING },
    {
      $set: {
        paymentStatus: PAYMENT_STATUSES.COMPLETED,
        paymentReference: paymentReference || null,
        status: REGISTRATION_STATUSES.CONFIRMED,
      },
    }
  );

  // Now the seats are truly held: mint each member's pass and event-entry entitlement.
  for (const registration of pending) {
    const event = await loadEventForRegistration(registration.eventId);
    if (event) {
      await ensurePassAndEventEntitlement(registration.userId, event.festId, event._id);
    }
  }

  /*
   * The seats are now confirmed, so re-evaluate each member's badges in real time —
   * firstFest and fiveEvents can flip on this very confirmation. Fire-and-forget: a
   * badge award must never block or fail the payment confirmation that earned it.
   */
  for (const registration of pending) {
    awardBadgesInBackground(registration.userId);
  }

  // One audit row for the whole group, not one per member.
  const firstEvent = await loadEventForRegistration(pending[0].eventId);
  await recordAuditLog({
    actorUserId,
    festId: firstEvent ? firstEvent.festId : null,
    action: AUDIT_ACTIONS.REGISTRATION_CREATED,
    entityType: AUDIT_ENTITY_TYPES.REGISTRATION,
    entityId: pending[0]._id,
    afterState: {
      paymentGroupId,
      paymentReference: paymentReference || null,
      confirmedCount: pending.length,
    },
    ...context,
  });

  return { confirmedCount: pending.length };
}

/*
 * The manual admin stand-in for the gateway, unchanged in behaviour: scoped to an
 * administrator of the group's fest, then the shared confirmation core.
 */
async function confirmPayment(actorUserId, paymentGroupId, paymentReference, context = {}) {
  const pending = await RegistrationModel.findOne({
    paymentGroupId,
    paymentStatus: PAYMENT_STATUSES.PENDING,
  }).lean();
  if (!pending) {
    throw new ApplicationError(
      404,
      ERROR_CODES.PAYMENT_GROUP_NOT_FOUND,
      "No pending payment was found for that group."
    );
  }
  const groupEvent = await loadEventForRegistration(pending.eventId);
  if (groupEvent) {
    await assertAdministratorOfFest(actorUserId, groupEvent.festId);
  }
  return confirmPaymentGroup(actorUserId, paymentGroupId, paymentReference, context);
}

module.exports = { confirmPayment, confirmPaymentGroup };

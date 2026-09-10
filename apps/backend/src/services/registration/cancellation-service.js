const mongoose = require("mongoose");

const { EventModel } = require("../../models/event-model");
const { FestModel } = require("../../models/fest-model");
const { RegistrationModel } = require("../../models/registration-model");
const { ApplicationError } = require("../../helpers/application-error");
const { ERROR_CODES } = require("../../constants/error-codes");
const {
  REGISTRATION_STATUSES,
  ACTIVE_REGISTRATION_STATUSES,
  CANCELLED_BY_ROLES,
} = require("../../constants/registration-constants");
const {
  resolveCancellationPolicy,
  assertSelfCancellationAllowed,
  resolveCancellationReason,
  AUDIT_ACTION_BY_ROLE,
} = require("../../helpers/cancellation-policy-helpers");
const { cancelTeamRegistration } = require("../../helpers/team-cancellation-helpers");
const { findCallerPendingHold, releasePendingHold } = require("../../helpers/pending-hold-helpers");
const { recordAuditLog } = require("../audit-log-service");
const { AUDIT_ENTITY_TYPES } = require("../../constants/audit-log-constants");
const { revokeEventEntitlementOnCancel } = require("../pass-service");

/*
 * The one cancellation path. Which rules apply is decided by the actor's
 * relationship to the row, not by the endpoint they arrived through, so every
 * surface enforces the same policy.
 *
 * An already-cancelled row returns its existing state and writes no second audit
 * entry: cancelling twice is the same request arriving twice, and the log records
 * what happened, not how many times it was asked for.
 */
async function cancelRegistration({ registrationId, actorUserId, cancellationReason, context = {} }) {
  const registration = mongoose.Types.ObjectId.isValid(registrationId)
    ? await RegistrationModel.findById(registrationId)
    : null;
  if (!registration) {
    throw new ApplicationError(404, ERROR_CODES.REGISTRATION_NOT_FOUND, "Registration not found.");
  }

  const event = await EventModel.findById(registration.eventId);
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  const fest = await FestModel.findById(event.festId);
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }

  const policy = await resolveCancellationPolicy({ registration, event, fest, actorUserId });

  if (registration.status === REGISTRATION_STATUSES.CANCELLED) {
    return { cancelledCount: 0, alreadyCancelled: true, event: event.toJSON() };
  }

  if (policy === CANCELLED_BY_ROLES.SELF) {
    assertSelfCancellationAllowed(registration, event);
  }
  const reason = resolveCancellationReason(policy, cancellationReason);

  const festId = event.festId;
  const beforeState = { status: registration.status };
  const cancellation = { policy, reason, actorUserId };

  let result;
  if (registration.teamId) {
    result = await cancelTeamRegistration(
      registration.userId,
      event,
      festId,
      registration,
      cancellation
    );
  } else {
    /*
     * Only a seat that was actually counted may be given back. claimSoloSeat
     * increments nothing on an unlimited event (capacity null) and nothing for a
     * waitlisted row, so decrementing either would drive registeredCount below
     * zero — the two conditions here mirror that claim exactly.
     */
    const heldASeat =
      registration.status === REGISTRATION_STATUSES.CONFIRMED && event.capacity !== null;
    registration.status = REGISTRATION_STATUSES.CANCELLED;
    registration.cancelledAt = new Date();
    registration.cancellationReason = reason;
    registration.cancelledByRole = policy;
    registration.cancelledByUserId = actorUserId;
    await registration.save();

    await revokeEventEntitlementOnCancel(registration.userId, festId, registration.eventId);

    const updatedEvent = heldASeat
      ? await EventModel.findOneAndUpdate({ _id: registration.eventId }, { $inc: { registeredCount: -1 } }, { new: true })
      : await EventModel.findById(registration.eventId);

    /*
     * A seat came back, so the queue moves — but ONLY if a seat was genuinely
     * released. Cancelling an uncapped registration, or a waitlisted one,
     * frees nothing (heldASeat mirrors exactly what claimSoloSeat counted), and
     * promoting on those would overbook the event by one every time.
     *
     * Runs after the count is decremented so the promotion's own increment
     * cannot race it, and never throws — a failed promotion must not undo a
     * cancellation that has already committed.
     */
    if (heldASeat) {
      const {
        promoteFromWaitlist,
      } = require("./waitlist-promotion-service");
      await promoteFromWaitlist(registration.eventId, 1, actorUserId);
    }

    result = { cancelledCount: 1, event: updatedEvent.toJSON() };
  }

  await recordAuditLog({
    actorUserId,
    festId,
    action: AUDIT_ACTION_BY_ROLE[policy],
    entityType: AUDIT_ENTITY_TYPES.REGISTRATION,
    entityId: registration._id,
    beforeState,
    afterState: {
      status: REGISTRATION_STATUSES.CANCELLED,
      cancellationReason: reason,
      cancelledByRole: policy,
    },
    ...context,
  });

  return { ...result, cancelledByRole: policy, cancellationReason: reason };
}

/*
 * The event-keyed entry point the participant's own screen uses: it resolves the
 * caller's own row for this event and hands it to the one policy engine above.
 * The registration id is what cancellation is really keyed on — an actor can
 * cancel a row that is not their own — so this is a lookup, not a second policy.
 */
async function cancelMyRegistration(userId, eventId, cancellationReason, context = {}) {
  const registration = await RegistrationModel.findOne({
    userId,
    eventId,
    status: { $in: ACTIVE_REGISTRATION_STATUSES },
  });
  if (!registration) {
    throw new ApplicationError(404, ERROR_CODES.REGISTRATION_NOT_FOUND, "Registration not found.");
  }

  return cancelRegistration({
    registrationId: registration._id,
    actorUserId: userId,
    cancellationReason,
    context,
  });
}

/*
 * Releasing the caller's own pending-payment hold — the "cancel & start over"
 * action the form offers when a retry meets a checkout still in flight. It is a
 * separate path from cancelMyRegistration on purpose: that one is bounded by the
 * self-cancellation window and only sees CONFIRMED/WAITLISTED rows, while a hold
 * that was never paid is none of those and its seat accounting is the claim's, not
 * the active-row count the cancellation policy uses. Deleting nothing when there is
 * no hold is a 404 so a double-tap is not mistaken for success.
 */
async function cancelMyPendingRegistration(userId, eventId, context = {}) {
  const event = mongoose.Types.ObjectId.isValid(eventId)
    ? await EventModel.findById(eventId)
    : null;
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }

  const hold = await findCallerPendingHold(userId, event._id);
  if (!hold) {
    throw new ApplicationError(
      404,
      ERROR_CODES.REGISTRATION_NOT_FOUND,
      "You have no pending registration to cancel for this event."
    );
  }

  await releasePendingHold(event, hold);

  for (const registration of hold.registrations) {
    await recordAuditLog({
      actorUserId: userId,
      festId: event.festId,
      action: AUDIT_ACTION_BY_ROLE[CANCELLED_BY_ROLES.SELF],
      entityType: AUDIT_ENTITY_TYPES.REGISTRATION,
      entityId: registration._id,
      beforeState: { status: REGISTRATION_STATUSES.PENDING_PAYMENT },
      afterState: { status: REGISTRATION_STATUSES.PAYMENT_EXPIRED, cancelledByRole: CANCELLED_BY_ROLES.SELF },
      ...context,
    });
  }

  return { cancelledCount: hold.registrations.length, paymentGroupId: hold.paymentGroupId };
}

module.exports = { cancelRegistration, cancelMyRegistration, cancelMyPendingRegistration };

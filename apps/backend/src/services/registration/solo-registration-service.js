const { RegistrationModel } = require("../../models/registration-model");
const { ApplicationError } = require("../../helpers/application-error");
const { ERROR_CODES } = require("../../constants/error-codes");
const { EVENT_TYPES } = require("../../constants/event-constants");
const { FEST_VISIBILITIES } = require("../../constants/fest-constants");
const { REGISTRATION_STATUSES, PAYMENT_STATUSES } = require("../../constants/registration-constants");
const {

  generatePaymentGroupId,
  computeRegistrationFee,
  releaseExpiredPendingPaymentSeats,
} = require("../../helpers/registration-payment-helpers");
const { createPaymentOrder } = require("../razorpay-service");
const { validateCustomResponses } = require("../../helpers/validate-custom-responses");
const { resolveMedicalAcceptance } = require("../../helpers/medical-declaration-helpers");
const {
  resolveFoodPreference,
  resolveAccommodationNeed,
  resolveFoodOrderCount,
  resolveOfferSelections,
} = require("../../helpers/offer-preference-helpers");
const { toRegistrationJson } = require("../../helpers/registration-serializers");
const { claimSoloSeat, releaseTeamSeats } = require("../../helpers/registration-seat-helpers");
const {
  findCallerPendingHold,
  pendingHoldHasPaymentOrder,
  releasePendingHold,
} = require("../../helpers/pending-hold-helpers");
const {
  loadRegisterableUser,
  loadRegisterableEvent,
  assertRegistrationWindowOpen,
  belongsToHostCollege,
  assertNoActiveRegistration,
  assertCallerIsNotAdministrator,
} = require("../../helpers/registration-guards");
const { recordAuditLog } = require("../audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../../constants/audit-log-constants");
const {
  ensurePassAndEventEntitlement,
  getOrCreatePassForUserInFest,
} = require("../pass-service");
const { awardBadgesInBackground } = require("../achievement-service");

const DUPLICATE_KEY_ERROR_CODE = 11000;

/* One person taking one seat. The team path is its own file: the two share their
 * guards and their seat arithmetic, and nothing else. */
async function registerParticipantSolo(userId, eventId, payload = {}, context = {}) {
  await assertCallerIsNotAdministrator(userId);
  const user = await loadRegisterableUser(userId);
  const { event, fest } = await loadRegisterableEvent(eventId);

  if (event.eventType !== EVENT_TYPES.SOLO) {
    throw new ApplicationError(400, ERROR_CODES.TEAM_REGISTRATION_REQUIRED, "This event needs a team.");
  }
  assertRegistrationWindowOpen(event, new Date());
  if (fest.visibility === FEST_VISIBILITIES.INTRA_COLLEGE && !belongsToHostCollege(user, fest)) {
    throw new ApplicationError(403, ERROR_CODES.WRONG_COLLEGE, "This fest is open to the host college only.", { requiredCollegeId: String(fest.hostCollegeId) });
  }
  await assertNoActiveRegistration(userId, eventId);

  /*
   * A prior failed paid attempt leaves a PENDING_PAYMENT row. assertNoActiveRegistration
   * and the partial unique index both ignore it (neither covers pendingPayment), so
   * without this a retry would silently claim a SECOND seat and leak the first. Free
   * lapsed holds first, then resolve the caller's own: a hold that never opened a
   * payment order can never be paid, so it is superseded and the retry proceeds; one
   * that did is a real checkout in flight, refused with its group id for resume-or-cancel.
   */
  await releaseExpiredPendingPaymentSeats(event);
  const priorHold = await findCallerPendingHold(userId, eventId);
  if (priorHold) {
    if (await pendingHoldHasPaymentOrder(priorHold.paymentGroupId)) {
      throw new ApplicationError(
        409,
        ERROR_CODES.PENDING_PAYMENT_EXISTS,
        "You already have a pending registration for this event.",
        { paymentGroupId: priorHold.paymentGroupId }
      );
    }
    await releasePendingHold(event, priorHold);
  }

  // Both ahead of claimSoloSeat: a rejected answer must not consume a seat first.
  const customResponses = validateCustomResponses(event.customQuestions, payload.customResponses);
  const medicalDeclarationAcceptedAt = resolveMedicalAcceptance(
    event,
    payload.hasAcceptedMedicalDeclaration
  );
  const foodPreference = resolveFoodPreference(fest, payload.foodPreference, event);
  const foodOrderCount = resolveFoodOrderCount(fest, event, foodPreference, payload.foodOrderCount);
  const needsAccommodation = resolveAccommodationNeed(fest, payload.needsAccommodation, event);
  const offerSelections = resolveOfferSelections(fest, payload.offerSelections, event);

  // Lapsed holds were already freed up front (before the caller's own hold was
  // resolved), so an expired seat is available to the claim below.
  /*
   * Paid events hold the seat under PENDING_PAYMENT until the payment confirms;
   * the pass and entitlement are deferred to the confirmation path. Free events are
   * unchanged: notRequired, straight to the claim's status.
   */
  /*
   * The fee comes from the RESOLVED answers (event + offers × quantity), and
   * `paid` keys off that computed total — never event.feeAmountPaise alone. A
   * "free" event with a paid meal selection must NOT auto-confirm.
   */
  const fee = computeRegistrationFee(event, 1, fest, offerSelections, foodOrderCount, needsAccommodation);
  const paid = fee.totalFeePaise > 0;
  const paymentStatus = paid ? PAYMENT_STATUSES.PENDING : PAYMENT_STATUSES.NOT_REQUIRED;
  const paymentGroupId = paid ? generatePaymentGroupId() : null;
  const totalFeePaise = fee.totalFeePaise;

  /*
   * The claim and the row create run under a compensator, the mirror of the team
   * path's. assertNoActiveRegistration above is a plain findOne, so two concurrent
   * registrations from the same user both pass it, both claim a seat, and only one
   * wins the registrations partial unique index — the loser's create throws E11000
   * after claimSoloSeat has already taken its seat. Any failure here (the duplicate
   * key, a transient DB error, a validation error) hands the claimed seat back, or
   * registeredCount drifts up for good and the event refuses real registrations as
   * full.
   *
   * Only a confirmed claim on a capped event took a counted seat, so only it is
   * released: an uncapped claim (releaseTeamSeats is then a no-op) or a waitlisted
   * one incremented nothing, and releasing would drive the count below the seats
   * actually held. If claimSoloSeat itself threw EVENT_FULL, no seat was taken and
   * claimResult is unset, so nothing is released. That is the same symmetry
   * releaseTeamSeats already enforces for the team path.
   *
   * The span ends at the committed row: once it exists the seat is genuinely held,
   * so the pass, entitlement and audit writes below must never hand it back. A
   * transaction would express this; standalone MongoDB cannot, so it is hand rolled
   * exactly as the team path documents.
   */
  let claimResult;
  let registration;
  try {
    claimResult = await claimSoloSeat(event);
    /*
     * A WAITLISTED claim outranks `paid`. This used to read
     * `paid ? PENDING_PAYMENT : claimResult.status`, which meant someone joining
     * the waitlist for a PAID event was written as PENDING_PAYMENT and then
     * handed a Razorpay order below — charged to hold a seat that was never
     * claimed (registeredCount was not incremented). Nobody may be asked to pay
     * for a place in a queue; payment is collected on promotion.
     */
    const isWaitlisted = claimResult.status === REGISTRATION_STATUSES.WAITLISTED;
    registration = await RegistrationModel.create({
      eventId: event._id,
      userId,
      teamId: null,
      status: isWaitlisted
        ? REGISTRATION_STATUSES.WAITLISTED
        : paid
          ? REGISTRATION_STATUSES.PENDING_PAYMENT
          : claimResult.status,
      waitlistPosition: isWaitlisted ? claimResult.waitlistPosition : null,
      feeAmountSnapshotPaise: event.feeAmountPaise,
      paymentStatus,
      paymentGroupId,
      totalFeePaise,
      feeBreakdown: fee.breakdown,
      customResponses,
      contactPhoneOverride: payload.contactPhoneOverride || null,
      medicalDeclarationAcceptedAt,
      foodPreference,
      needsAccommodation,
      foodOrderCount,
      offerSelections,
      registeredAt: new Date(),
    });
  } catch (error) {
    if (claimResult && claimResult.status === REGISTRATION_STATUSES.CONFIRMED) {
      await releaseTeamSeats(event, 1);
    }
    /*
     * A same-user create that loses the (eventId, userId) partial unique index is
     * the concurrent form of an existing registration, so it surfaces as the
     * guard's ALREADY_REGISTERED rather than a raw duplicate-key fault. Every other
     * error is rethrown untouched, so a synthetic or transient failure still
     * reaches the caller unchanged.
     */
    if (error?.code === DUPLICATE_KEY_ERROR_CODE) {
      throw new ApplicationError(409, ERROR_CODES.ALREADY_REGISTERED, "You are already registered for this event.");
    }
    throw error;
  }

  const { status, event: resultEvent } = claimResult;

  /*
   * Opening the Razorpay order used to run last, after the audit write and outside
   * any compensator: a gateway that was unreachable — or an uninstalled SDK — threw
   * a bare 500 and stranded a PENDING_PAYMENT row nobody could pay, which the next
   * retry then either duplicated (the guards ignore pendingPayment) or tripped over.
   * It now runs here under its own compensator, before the audit write: a failed
   * order hands back the seat it claimed (only a confirmed claim on a capped event
   * counted one, the same condition claimSoloSeat incremented under) and drops the
   * unpayable row, so the retry starts clean and the original error surfaces.
   */
  let payment = null;
  // No order for a waitlisted row: there is no seat to pay for yet. The
  // promotion path opens one when a place actually frees up.
  if (paid && status !== REGISTRATION_STATUSES.WAITLISTED) {
    try {
      const order = await createPaymentOrder(paymentGroupId, userId);
      payment = {
        paymentGroupId,
        razorpayOrderId: order.razorpayOrderId,
        razorpayKeyId: order.razorpayKeyId,
      };
    } catch (error) {
      if (status === REGISTRATION_STATUSES.CONFIRMED && event.capacity !== null) {
        await releaseTeamSeats(event, 1);
      }
      await RegistrationModel.deleteOne({ _id: registration._id });
      throw error;
    }
  }

  // A paid seat is only held, not entered: its pass and entitlement are deferred to
  // the payment-confirmation path. Free events are unchanged — a confirmed seat
  // earns an event-entry entitlement; a waitlisted one gets the pass but no entitlement.
  if (!paid) {
    if (status === REGISTRATION_STATUSES.CONFIRMED) {
      await ensurePassAndEventEntitlement(userId, event.festId._id, event._id);
      // A free confirmed seat may earn firstFest/fiveEvents right now — fire-and-forget.
      awardBadgesInBackground(userId);
    } else {
      await getOrCreatePassForUserInFest(userId, event.festId._id);
    }
  }

  await recordAuditLog({
    actorUserId: userId,
    festId: event.festId._id,
    action: AUDIT_ACTIONS.REGISTRATION_CREATED,
    entityType: AUDIT_ENTITY_TYPES.REGISTRATION,
    entityId: registration._id,
    afterState: { eventId: event._id, status: registration.status },
    ...context,
  });

  const result = { registration: registration.toJSON(), event: resultEvent.toJSON() };
  // The paid registration's order was opened above (under its own compensator, so a
  // gateway failure never strands this row); free events have none.
  if (payment) {
    result.payment = payment;
  }
  return result;
}

/* Deduped, lowercased, leader-first: the leader is always index 0 of the roster. */

module.exports = { registerParticipantSolo };

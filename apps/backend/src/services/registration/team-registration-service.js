const { RegistrationModel } = require("../../models/registration-model");
const { TeamModel } = require("../../models/team-model");
const { ApplicationError } = require("../../helpers/application-error");
const { ERROR_CODES } = require("../../constants/error-codes");
const { EVENT_TYPES } = require("../../constants/event-constants");
const { TEAM_STATUSES } = require("../../constants/team-constants");
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
const { insertTeamWithUniqueInviteCode } = require("../../helpers/insert-team-with-unique-invite-code");
const { claimTeamSeats, releaseTeamSeats } = require("../../helpers/registration-seat-helpers");
const {
  findCallerPendingHold,
  pendingHoldHasPaymentOrder,
  releasePendingHold,
} = require("../../helpers/pending-hold-helpers");
const {
  loadRegisterableUser,
  loadRegisterableEvent,
  assertRegistrationWindowOpen,
  assertCallerIsNotAdministrator,
  assertNoAdministratorMembers,
} = require("../../helpers/registration-guards");
const {
  buildTeamRoster,
  assertTeamSize,
  resolveMembers,
  assertTeamCollege,
  assertMembersFree,
  notifyTeammates,
} = require("../../helpers/team-roster-helpers");
const { recordAuditLog } = require("../audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../../constants/audit-log-constants");
const { ensurePassAndEventEntitlement } = require("../pass-service");
const { awardBadgesInBackground } = require("../achievement-service");

const DUPLICATE_KEY_ERROR_CODE = 11000;
const REGISTRATION_MEMBER_INDEX = "index_registrations_eventId_userId";

/*
 * A losing racer's insertMany trips the registrations (eventId, userId) partial
 * unique index — the concurrent form of a member already being taken for the
 * event. It is identified by that index's name in the duplicate-key error (a bulk
 * write does not always surface a structured keyPattern), and the collided
 * member's id is read from the offending write op (bulk) or keyValue (single), so
 * the translated error carries the same conflictingMemberEmail detail
 * assertMembersFree uses. Returns null for any other error, which the caller then
 * rethrows untouched.
 */
function memberRegistrationCollision(error, members) {
  if (error?.code !== DUPLICATE_KEY_ERROR_CODE) return null;
  const message =
    error.errorResponse?.message || error.writeErrors?.[0]?.err?.errmsg || error.message || "";
  if (!message.includes(REGISTRATION_MEMBER_INDEX)) return null;
  const collidedUserId = error.writeErrors?.[0]?.err?.op?.userId ?? error.keyValue?.userId;
  const member = members.find((entry) => String(entry.user._id) === String(collidedUserId));
  return { conflictingMemberEmail: member ? member.email : undefined };
}

/*
 * A whole roster taking seats at once. The roster is assembled and vetted in
 * team-roster-helpers; what is left here is the order of operations, which is
 * the part that has bitten us — the claim, the compensator that gives it back,
 * and the fact that neither may run for an uncapped event.
 */
async function registerParticipantTeam(userId, eventId, payload, context = {}) {
  // Ahead of resolveMembers, which creates a placeholder user per unknown email:
  // an administrator's own attempt must not leave those rows behind.
  await assertCallerIsNotAdministrator(userId);
  const leader = await loadRegisterableUser(userId);
  const { event, fest } = await loadRegisterableEvent(eventId);

  if (event.eventType !== EVENT_TYPES.TEAM) {
    throw new ApplicationError(400, ERROR_CODES.SOLO_REGISTRATION_REQUIRED, "This event is registered solo.");
  }
  assertRegistrationWindowOpen(event, new Date());

  /*
   * A leader retrying after a failed paid attempt would otherwise be locked out by
   * the wreckage of the first: the LOCKED team from that attempt trips
   * assertMembersFree below with MEMBER_ALREADY_IN_TEAM, permanently — expiry
   * frees the seats but never disqualifies the team. So resolve the leader's own
   * prior hold up front. A hold that never opened a payment order can never be
   * paid (the order create is exactly what failed), so it is superseded silently
   * and the retry proceeds. A hold that did open one is a real checkout in flight;
   * it is refused with the group id so the client can offer resume-or-cancel.
   */
  await releaseExpiredPendingPaymentSeats(event);
  const priorHold = await findCallerPendingHold(userId, event._id);
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

  /*
   * Ahead of resolveMembers, which creates a placeholder user per unknown email:
   * a leader who has not accepted the declaration must not leave those rows
   * behind. It needs only the event and the flag, so nothing is gained by
   * waiting for the roster.
   */
  const medicalDeclarationAcceptedAt = resolveMedicalAcceptance(
    event,
    payload.hasAcceptedMedicalDeclaration
  );
  // The leader answers once for the whole team, exactly as with medical declaration.
  const foodPreference = resolveFoodPreference(fest, payload.foodPreference, event);
  const foodOrderCount = resolveFoodOrderCount(fest, event, foodPreference, payload.foodOrderCount);
  const needsAccommodation = resolveAccommodationNeed(fest, payload.needsAccommodation, event);
  const offerSelections = resolveOfferSelections(fest, payload.offerSelections, event);

  const roster = buildTeamRoster(leader, payload.memberEmails);
  assertTeamSize(roster.length, event);
  const members = await resolveMembers(roster);
  await assertNoAdministratorMembers(members);
  assertTeamCollege(members, fest);
  await assertMembersFree(members, event._id);

  const memberUserIds = members.map((member) => member.user._id);
  const customResponses = validateCustomResponses(event.customQuestions, payload.customResponses);

  // Lapsed holds were already freed up front (before the leader's own hold was
  // resolved); the roster now claims. Paid events hold it under PENDING_PAYMENT;
  // every member row shares one paymentGroupId and the group total.
  /*
   * The group's fee: event fee for the whole roster + the LEADER's offers ×
   * quantity (the leader answers once for the team). `paid` keys off the
   * computed total — a free event with a paid meal must not auto-confirm.
   */
  const groupFee = computeRegistrationFee(
    event,
    memberUserIds.length,
    fest,
    offerSelections,
    foodOrderCount,
    needsAccommodation
  );
  const paid = groupFee.totalFeePaise > 0;
  const rowStatus = paid ? REGISTRATION_STATUSES.PENDING_PAYMENT : REGISTRATION_STATUSES.CONFIRMED;
  const paymentStatus = paid ? PAYMENT_STATUSES.PENDING : PAYMENT_STATUSES.NOT_REQUIRED;
  const paymentGroupId = paid ? generatePaymentGroupId() : null;
  const totalFeePaise = groupFee.totalFeePaise;

  const resultEvent = await claimTeamSeats(event, memberUserIds.length);

  /*
   * Everything between the claim and the committed rows runs under a
   * compensator. assertMembersFree above is a read, so two leaders naming the
   * same member can both pass it; the loser is caught by the registrations
   * partial unique index, but only here, after claimTeamSeats has already taken
   * the seats. Without giving them back the count drifts upward for good and the
   * event starts refusing real registrations as full — the mirror of the
   * downward drift releaseTeamSeats exists to stop.
   *
   * Any error is compensated, not just the duplicate key: a failed team insert
   * strands the seats exactly as a failed roster insert does, and the cause does
   * not change who owes them back. The original error is rethrown untouched so
   * the caller still sees ALREADY_REGISTERED rather than a rollback artefact.
   *
   * The span ends at the committed rows on purpose. Once the registrations
   * exist the seats are genuinely held, so a later failure — an entitlement, an
   * audit write — must not hand them back.
   *
   * A transaction would express this better and is the right fix once the
   * deployment has a replica set; standalone MongoDB cannot, so this is the
   * correct shape for today. Filed as debt.
   */
  let team;
  let registrations;
  try {
    team = await insertTeamWithUniqueInviteCode({
      eventId: event._id,
      teamName: payload.teamName,
      leaderUserId: leader._id,
      memberUserIds,
      status: TEAM_STATUSES.LOCKED,
    });

    /*
     * The answers belong to the leader's row alone: they were given once, by the
     * person who filled the form. A member's row inherits none — per-member
     * questions would need each member to answer for themselves, which is a
     * separate feature, and copying the leader's answers onto them would invent
     * data they never gave.
     *
     * The medical acceptance goes the other way: every member's row carries the
     * leader's timestamp, verbatim and identical, because a member without one
     * could not hold a seat on an event that demands it. That is a knowing
     * compromise — the leader is accepting on behalf of people who did not read
     * the declaration — and is flagged for revisit if it becomes a compliance
     * question.
     */
    registrations = await RegistrationModel.insertMany(
      memberUserIds.map((memberId) => ({
        eventId: event._id,
        userId: memberId,
        teamId: team._id,
        status: rowStatus,
        feeAmountSnapshotPaise: event.feeAmountPaise,
        paymentStatus,
        paymentGroupId,
        totalFeePaise,
        customResponses: String(memberId) === String(leader._id) ? customResponses : [],
        // Like the meal count: the override was typed by the leader on THEIR
        // form, so only the leader's row carries it.
        contactPhoneOverride:
          String(memberId) === String(leader._id) ? payload.contactPhoneOverride || null : null,
        medicalDeclarationAcceptedAt,
        foodPreference,
        needsAccommodation,
        // The meal count belongs to the person who booked it: the leader's row
        // alone carries it, a member's row stays null.
        foodOrderCount: String(memberId) === String(leader._id) ? foodOrderCount : null,
        feeBreakdown: String(memberId) === String(leader._id) ? groupFee.breakdown : [],
        offerSelections: String(memberId) === String(leader._id) ? offerSelections : [],
        registeredAt: new Date(),
      }))
    );
  } catch (error) {
    /*
     * Give back both things this block took. The seats are the loud one — an
     * uncompensated claim leaks the count upward until the event refuses real
     * registrations as full — but the team row is just as real: it is inserted
     * before the roster, so a failed insertMany leaves a team with no members
     * pointing at it. Worse than untidy: assertMembersFree matches on team
     * membership, so the orphan would go on blocking the very people whose
     * registration never happened, and the leader's retry would be refused by
     * the wreckage of their first attempt.
     *
     * The original error is rethrown untouched — the caller needs
     * ALREADY_REGISTERED, not whatever the cleanup had to say. If the cleanup
     * itself fails there is nothing useful left to do: the seats are already
     * released and the real error is the one worth surfacing.
     *
     * All of this is what a transaction would do for free. Standalone MongoDB
     * cannot, so it is done by hand; when the deployment moves to a replica set,
     * wrap the claim and both inserts in a session and delete this block.
     */
    await releaseTeamSeats(event, memberUserIds.length);
    if (team) {
      await TeamModel.deleteOne({ _id: team._id }).catch(() => {});
    }
    /*
     * The mirror of the solo path's translation: a loser caught by the
     * registrations (eventId, userId) partial unique index is the concurrent form
     * of the member already being taken, so it surfaces as the same
     * MEMBER_ALREADY_IN_TEAM 409 (with the same conflictingMemberEmail detail)
     * assertMembersFree would have thrown had it not raced. Every other error —
     * the team insert, a transient fault — rethrows untouched.
     */
    const collision = memberRegistrationCollision(error, members);
    if (collision) {
      throw new ApplicationError(
        409,
        ERROR_CODES.MEMBER_ALREADY_IN_TEAM,
        "A member is already on a team for this event.",
        collision
      );
    }
    throw error;
  }

  /*
   * Opening the group's Razorpay order is the last thing that can fail, and until
   * now it failed AFTER the rows were committed and outside any compensator: a
   * gateway that was unreachable — or, in this deployment, an uninstalled SDK —
   * threw a bare 500 and left a PENDING_PAYMENT hold nobody could ever pay, so the
   * leader's retry hit the LOCKED team as a permanent MEMBER_ALREADY_IN_TEAM 409.
   * It now runs under its own compensator: if the order cannot be opened the whole
   * hold is handed back — seats, team and rows — and the original gateway error is
   * rethrown, leaving nothing behind to lock the retry out. It runs before the
   * audit and notification writes so a failed order leaves no trace of those either.
   */
  let payment = null;
  if (paid) {
    try {
      const order = await createPaymentOrder(paymentGroupId, leader._id);
      payment = {
        paymentGroupId,
        razorpayOrderId: order.razorpayOrderId,
        razorpayKeyId: order.razorpayKeyId,
      };
    } catch (error) {
      await releasePendingHold(event, { team, registrations });
      throw error;
    }
  }

  // A confirmed (free) team earns each member a pass and event-entry entitlement.
  // A paid team is only holding seats — those side-effects wait for payment to confirm.
  if (!paid) {
    for (const memberId of memberUserIds) {
      await ensurePassAndEventEntitlement(memberId, fest._id, event._id);
      // Every member's badges re-evaluate on this confirmation — teamCaptain for the
      // leader, firstFest for a first-timer. Fire-and-forget, never blocking the roster.
      awardBadgesInBackground(memberId);
    }
  }

  // One audit row per member, so a later query can trace every seat the team took.
  for (const registration of registrations) {
    await recordAuditLog({
      actorUserId: userId,
      festId: fest._id,
      action: AUDIT_ACTIONS.REGISTRATION_CREATED,
      entityType: AUDIT_ENTITY_TYPES.REGISTRATION,
      entityId: registration._id,
      afterState: { eventId: event._id, status: registration.status, userId: registration.userId },
      ...context,
    });
  }

  await notifyTeammates(members, leader, team, event, fest);
  const result = {
    team: team.toJSON(),
    registrations: registrations.map((registration) => registration.toJSON()),
    event: resultEvent.toJSON(),
  };
  // The paid group's order was opened above (under its own compensator); free skips it.
  if (payment) {
    result.payment = payment;
  }
  return result;
}

module.exports = { registerParticipantTeam };

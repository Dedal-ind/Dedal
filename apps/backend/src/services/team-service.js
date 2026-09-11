const mongoose = require("mongoose");

const { RegistrationModel } = require("../models/registration-model");
const { TeamModel } = require("../models/team-model");
const { EventModel } = require("../models/event-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { EVENT_TYPES } = require("../constants/event-constants");
const { TEAM_STATUSES } = require("../constants/team-constants");
const { REGISTRATION_STATUSES, PAYMENT_STATUSES } = require("../constants/registration-constants");
const {

  generatePaymentGroupId,
  computeTotalFeePaise,
  computeRegistrationFee,
  releaseExpiredPendingPaymentSeats,
} = require("../helpers/registration-payment-helpers");
const { insertTeamWithUniqueInviteCode } = require("../helpers/insert-team-with-unique-invite-code");
const { claimTeamSeats, releaseTeamSeats } = require("../helpers/registration-seat-helpers");
const {
  loadRegisterableUser,
  loadRegisterableEvent,
  assertRegistrationWindowOpen,
  assertCallerIsNotAdministrator,
} = require("../helpers/registration-guards");
const { assertMembersFree, assertTeamCollege } = require("../helpers/team-roster-helpers");
const { validateCustomResponses } = require("../helpers/validate-custom-responses");
const { resolveMedicalAcceptance } = require("../helpers/medical-declaration-helpers");
const {
  resolveFoodPreference,
  resolveAccommodationNeed,
  resolveFoodOrderCount,
  resolveOfferSelections,
} = require("../helpers/offer-preference-helpers");
const { ensurePassAndEventEntitlement } = require("./pass-service");
const { awardBadgesInBackground } = require("./achievement-service");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");

const DUPLICATE_KEY_ERROR_CODE = 11000;

// The read shape for a team the caller belongs to: enough to render the roster
// card without a second query. Members and leader carry only their display name
// and avatar — the picture is a public-facing display field like the name itself.
const TEAM_READ_POPULATE = [
  {
    path: "eventId",
    select:
      /* registrationManuallyClosedAt is load-bearing: it is the only thing that
       closes registration, so isJoinable below reads undefined without it and
       shows a join code for a team the admin has already closed. */
      "eventName eventType minimumTeamSize maximumTeamSize venue startsAt endsAt festId registrationOpensAt registrationClosesAt registrationManuallyClosedAt",
    populate: { path: "festId", select: "festName festSlug" },
  },
  { path: "memberUserIds", select: "fullName emailAddress participantId profilePictureUrl" },
  { path: "leaderUserId", select: "fullName" },
  /* Populated, not just the id: the roster card names the captain. */
  { path: "captainUserId", select: "fullName" },
];

/*
 * The flat read fields the roster surfaces need beyond the populate: sizes from
 * the event, a display-side isJoinable (a FORMING team whose registration window
 * has closed is effectively closed to joins — the join endpoint enforces this,
 * this stops the UI showing a code that can no longer be redeemed), and the
 * caller's own registration for the event so the UI can deep-link to the pass.
 */
function serializeTeamForCaller(team, callerRegistrationId = null, now = new Date()) {
  const teamJson = team.toJSON();
  const event = team.eventId ?? {};
  const memberCount = (team.memberUserIds ?? []).length;
  /*
   * Mirrors assertRegistrationWindowOpen, which the join endpoint actually
   * enforces: open once registrationOpensAt has passed, and shut only by an
   * admin's explicit close. This used to close on registrationClosesAt too and
   * so hid a join code that the endpoint would still have honoured.
   */
  const isWindowOpen = event.registrationOpensAt
    ? now >= event.registrationOpensAt && !event.registrationManuallyClosedAt
    : false;
  teamJson.memberCount = memberCount;
  teamJson.minimumTeamSize = event.minimumTeamSize ?? null;
  teamJson.maximumTeamSize = event.maximumTeamSize ?? null;
  teamJson.isJoinable =
    team.status === TEAM_STATUSES.FORMING &&
    isWindowOpen &&
    (event.maximumTeamSize == null || memberCount < event.maximumTeamSize);
  teamJson.callerRegistrationId = callerRegistrationId ? String(callerRegistrationId) : null;
  return teamJson;
}

/*
 * One person taking one seat, in the same order-of-operations the whole-roster
 * team path uses: claim the seat, then commit the row under a compensator that
 * gives the seat back on any failure. A free seat confirms and earns a pass; a
 * paid seat is held under PENDING_PAYMENT and its group id is returned so the
 * caller can drive checkout, exactly as the solo/team registration paths do.
 */
function buildRegistrationRow(event, userId, teamId, paid, paymentGroupId, answers = {}) {
  return {
    eventId: event._id,
    userId,
    teamId,
    status: paid ? REGISTRATION_STATUSES.PENDING_PAYMENT : REGISTRATION_STATUSES.CONFIRMED,
    feeAmountSnapshotPaise: event.feeAmountPaise,
    paymentStatus: paid ? PAYMENT_STATUSES.PENDING : PAYMENT_STATUSES.NOT_REQUIRED,
    paymentGroupId,
    totalFeePaise: answers.totalFeePaise ?? computeTotalFeePaise(event, 1),
    feeBreakdown: answers.feeBreakdown ?? [],
    customResponses: answers.customResponses ?? [],
    medicalDeclarationAcceptedAt: answers.medicalDeclarationAcceptedAt ?? null,
    foodPreference: answers.foodPreference ?? null,
    needsAccommodation: answers.needsAccommodation ?? null,
    foodOrderCount: answers.foodOrderCount ?? null,
    offerSelections: answers.offerSelections ?? [],
    registeredAt: new Date(),
  };
}

async function loadTeamForRead(teamId, callerRegistrationId = null) {
  const team = await TeamModel.findById(teamId).populate(TEAM_READ_POPULATE);
  return team ? serializeTeamForCaller(team, callerRegistrationId) : null;
}

/*
 * Create a forming team for a team event: the caller becomes the leader and the
 * sole first member, an invite code is minted, and everyone else joins later by
 * that code. The event must be a team event with an open registration window and
 * a seat free, and the caller must not already hold a seat on it.
 */
async function createTeam(userId, payload, context = {}) {
  await assertCallerIsNotAdministrator(userId);
  const leader = await loadRegisterableUser(userId);
  const { event, fest } = await loadRegisterableEvent(payload.eventId);

  if (event.eventType !== EVENT_TYPES.TEAM) {
    throw new ApplicationError(
      400,
      ERROR_CODES.SOLO_REGISTRATION_REQUIRED,
      "This event is registered solo, not as a team."
    );
  }
  assertRegistrationWindowOpen(event, new Date());

  const leaderMember = { email: leader.emailAddress, user: leader };
  assertTeamCollege([leaderMember], fest);
  await assertMembersFree([leaderMember], event._id);

  // All four resolvers ahead of claimTeamSeats, in the solo path's order: a
  // rejected answer must not consume a seat first.
  const customResponses = validateCustomResponses(event.customQuestions, payload.customResponses);
  const medicalDeclarationAcceptedAt = resolveMedicalAcceptance(
    event,
    payload.hasAcceptedMedicalDeclaration
  );
  const foodPreference = resolveFoodPreference(fest, payload.foodPreference, event);
  const needsAccommodation = resolveAccommodationNeed(fest, payload.needsAccommodation, event);
  const foodOrderCount = resolveFoodOrderCount(fest, event, foodPreference, payload.foodOrderCount);
  const offerSelections = resolveOfferSelections(fest, payload.offerSelections, event);

  await releaseExpiredPendingPaymentSeats(event);
  // The leader's fee: event share + THEIR offers × quantity. `paid` keys off the
  // computed total, so a free event with a paid meal still goes through checkout.
  const leaderFee = computeRegistrationFee(event, 1, fest, offerSelections, foodOrderCount, needsAccommodation);
  const paid = leaderFee.totalFeePaise > 0;
  const paymentGroupId = paid ? generatePaymentGroupId() : null;

  const resultEvent = await claimTeamSeats(event, 1);

  let team;
  let registration;
  try {
    team = await insertTeamWithUniqueInviteCode({
      eventId: event._id,
      teamName: payload.teamName,
      leaderUserId: leader._id,
      memberUserIds: [leader._id],
      status: TEAM_STATUSES.FORMING,
    });
    registration = await RegistrationModel.create(
      buildRegistrationRow(event, leader._id, team._id, paid, paymentGroupId, {
        customResponses,
        medicalDeclarationAcceptedAt,
        foodPreference,
        needsAccommodation,
        foodOrderCount,
        offerSelections,
        totalFeePaise: leaderFee.totalFeePaise,
        feeBreakdown: leaderFee.breakdown,
      })
    );
  } catch (error) {
    await releaseTeamSeats(event, 1);
    if (team) {
      await TeamModel.deleteOne({ _id: team._id }).catch(() => {});
    }
    if (error?.code === DUPLICATE_KEY_ERROR_CODE) {
      throw new ApplicationError(
        409,
        ERROR_CODES.ALREADY_REGISTERED,
        "You are already registered for this event."
      );
    }
    throw error;
  }

  if (!paid) {
    await ensurePassAndEventEntitlement(leader._id, fest._id, event._id);
    awardBadgesInBackground(leader._id);
  }

  await recordAuditLog({
    actorUserId: userId,
    festId: fest._id,
    action: AUDIT_ACTIONS.REGISTRATION_CREATED,
    entityType: AUDIT_ENTITY_TYPES.REGISTRATION,
    entityId: registration._id,
    afterState: { eventId: event._id, status: registration.status, teamId: team._id },
    ...context,
  });

  const result = {
    team: await loadTeamForRead(team._id, registration._id),
    registration: registration.toJSON(),
  };
  if (paid) {
    result.payment = { paymentGroupId };
  }
  return result;
}

/*
 * WHO CAPTAINS THE TEAM, decided at the moment somebody joins.
 *
 * Two ways to become captain here:
 *   1. Asking for it (claimCaptain), while the post is still vacant.
 *   2. Being the LAST person in {D} if the team is now full and nobody has taken
 *      it, the joiner gets it whether they asked or not.
 *
 * The second rule exists because a captain is not a reward, it is a phone number
 * a coordinator can call on the day. A full team with nobody answering is the
 * failure this prevents, and the last joiner is the only person left who can be
 * given it without asking someone who already declined.
 *
 * Both writes are CONDITIONAL on captainUserId still being null, so two people
 * racing the last seat cannot both be made captain {D} the loser's update
 * matches nothing and they are simply not captain.
 */
async function resolveCaptaincyOnJoin({ team, joinerUserId, maximumTeamSize, wantsCaptaincy }) {
  if (team.captainUserId) {
    return { isCaptain: String(team.captainUserId) === String(joinerUserId), captainAutoAssigned: false };
  }

  const isNowFull =
    typeof maximumTeamSize === "number" && (team.memberUserIds ?? []).length >= maximumTeamSize;
  if (!wantsCaptaincy && !isNowFull) {
    // Still room, and they did not ask. The post stays open for a later claim.
    return { isCaptain: false, captainAutoAssigned: false };
  }

  const claimed = await TeamModel.findOneAndUpdate(
    { _id: team._id, captainUserId: null },
    { $set: { captainUserId: joinerUserId } },
    { new: true }
  );
  if (!claimed) {
    return { isCaptain: false, captainAutoAssigned: false };
  }
  return {
    isCaptain: true,
    // Only the forced case is announced; someone who asked already knows.
    captainAutoAssigned: !wantsCaptaincy,
  };
}

/*
 * Join a forming team by its invite code. The joiner takes one seat under the
 * same claim-then-compensate shape as create, and is appended to the roster. The
 * team must be forming (not locked or disqualified) and have room within the
 * event's maximum team size.
 */
async function joinTeamByInviteCode(userId, payload, context = {}) {
  const { inviteCode } = payload;
  // Opt-in during the join, so somebody willing to captain does not have to
  // find a second button afterwards.
  const wantsCaptaincy = payload?.claimCaptain === true;
  await assertCallerIsNotAdministrator(userId);
  const joiner = await loadRegisterableUser(userId);

  // Filled by resolveCaptaincyOnJoin inside the try below; reported in the result.
  let captaincy = { isCaptain: false, captainAutoAssigned: false };
  // See the compensator in the catch: the roster append has to be undone too.
  let didAppendToRoster = false;

  const team = await TeamModel.findOne({ inviteCode });
  if (!team) {
    throw new ApplicationError(404, ERROR_CODES.TEAM_NOT_FOUND, "No team matches this invite code.");
  }
  if (team.status !== TEAM_STATUSES.FORMING) {
    throw new ApplicationError(
      409,
      ERROR_CODES.TEAM_NOT_ACCEPTING_MEMBERS,
      "This team is no longer accepting members."
    );
  }

  const { event, fest } = await loadRegisterableEvent(team.eventId);
  assertRegistrationWindowOpen(event, new Date());

  if (team.memberUserIds.length >= event.maximumTeamSize) {
    throw new ApplicationError(409, ERROR_CODES.TEAM_FULL, "This team is already full.", {
      maximumTeamSize: event.maximumTeamSize,
    });
  }

  const joinerMember = { email: joiner.emailAddress, user: joiner };
  assertTeamCollege([joinerMember], fest);
  await assertMembersFree([joinerMember], event._id);

  /*
   * The JOINER accepts their own medical declaration. The email-based team path
   * copies the leader's timestamp onto every member as a knowing compromise; the
   * code path has the joiner present and acting for themselves, so it must not
   * inherit that compromise. Resolved ahead of claimTeamSeats so a missing
   * acceptance never consumes a seat.
   */
  const medicalDeclarationAcceptedAt = resolveMedicalAcceptance(
    event,
    payload.hasAcceptedMedicalDeclaration
  );

  /*
   * Food and accommodation go the other way: booked by the person who registers
   * (the client's rule), so the joiner inherits the leader's answers and is not
   * asked. foodOrderCount stays null on a joined member's row — the leader's row
   * carries the team's meal count.
   */
  const leaderRegistration = await RegistrationModel.findOne({
    teamId: team._id,
    userId: team.leaderUserId,
  })
    .select("foodPreference needsAccommodation")
    .lean();

  await releaseExpiredPendingPaymentSeats(event);
  /*
   * Phase 1: the joiner pays their EVENT share only — reserved food/accommodation
   * were booked (and priced) on the leader's row, and the join UI collects no
   * non-reserved offers. TODO(client decision): whether joiners can add their own
   * offer selections (and pay for them) at join time.
   */
  const joinerFee = computeRegistrationFee(event, 1, fest, [], 0, false);
  const paid = joinerFee.totalFeePaise > 0;
  const paymentGroupId = paid ? generatePaymentGroupId() : null;

  const resultEvent = await claimTeamSeats(event, 1);

  let registration;
  try {
    registration = await RegistrationModel.create(
      buildRegistrationRow(event, joiner._id, team._id, paid, paymentGroupId, {
        medicalDeclarationAcceptedAt,
        foodPreference: leaderRegistration?.foodPreference ?? null,
        needsAccommodation: leaderRegistration?.needsAccommodation ?? null,
        totalFeePaise: joinerFee.totalFeePaise,
        feeBreakdown: joinerFee.breakdown,
      })
    );
    /*
     * The append's precondition lives IN the filter, like claimSoloSeat: the
     * earlier read-side full check is only a fast pre-check, and two joiners
     * racing for the last spot would both pass it. Only the update whose team is
     * still FORMING and still under maximumTeamSize appends; a null result means
     * the team filled or locked underneath this caller, so the claimed seat is
     * compensated (in the catch below) and the join refused.
     */
    const appendedTeam = await TeamModel.findOneAndUpdate(
      {
        _id: team._id,
        status: TEAM_STATUSES.FORMING,
        $expr: { $lt: [{ $size: "$memberUserIds" }, event.maximumTeamSize] },
      },
      { $addToSet: { memberUserIds: joiner._id } },
      { new: true }
    );
    if (!appendedTeam) {
      throw new ApplicationError(409, ERROR_CODES.TEAM_FULL, "This team is already full.", {
        maximumTeamSize: event.maximumTeamSize,
      });
    }
    /*
     * Recorded so the compensator below can undo it. A join writes THREE things
     * — a claimed seat, a registration row and this roster append — and the
     * catch only knew how to undo the first two.
     */
    didAppendToRoster = true;
    captaincy = await resolveCaptaincyOnJoin({
      team: appendedTeam,
      joinerUserId: joiner._id,
      maximumTeamSize: event.maximumTeamSize,
      wantsCaptaincy,
    });
  } catch (error) {
    /*
     * THE COMPENSATOR HAS TO UNDO THE ROSTER APPEND TOO.
     *
     * A join writes three things: it claims a seat, it creates the registration
     * row, and it appends the joiner to memberUserIds. This block used to give
     * back the seat and delete the row but leave the append standing — so a
     * failure AFTER the append (resolveCaptaincyOnJoin is the live example, and
     * anything added between the two in future) left the person on the roster
     * holding no seat and no registration.
     *
     * That ghost is not cosmetic. memberUserIds is what /teams/mine reads and
     * what the size precondition on the append above counts, so a ghost shows
     * on the roster, inflates memberCount, occupies one of maximumTeamSize
     * against real joiners, and counts toward the minimum that lets a leader
     * lock the team. Nothing anywhere else pulls a member — the only $pull in
     * the codebase is the admin-data cleanup — so if this block does not undo
     * it, nothing ever will.
     *
     * Pulled only when we know the append succeeded: an unconditional $pull
     * would remove a member who was already legitimately on the roster when the
     * failure came from somewhere earlier.
     */
    if (didAppendToRoster) {
      await TeamModel.updateOne(
        { _id: team._id },
        { $pull: { memberUserIds: joiner._id } }
      ).catch(() => {});
    }
    await releaseTeamSeats(event, 1);
    if (registration) {
      await RegistrationModel.deleteOne({ _id: registration._id }).catch(() => {});
    }
    if (error?.code === DUPLICATE_KEY_ERROR_CODE) {
      throw new ApplicationError(
        409,
        ERROR_CODES.ALREADY_REGISTERED,
        "You are already registered for this event."
      );
    }
    throw error;
  }

  if (!paid) {
    await ensurePassAndEventEntitlement(joiner._id, fest._id, event._id);
    awardBadgesInBackground(joiner._id);
  }

  await recordAuditLog({
    actorUserId: userId,
    festId: fest._id,
    action: AUDIT_ACTIONS.REGISTRATION_CREATED,
    entityType: AUDIT_ENTITY_TYPES.REGISTRATION,
    entityId: registration._id,
    afterState: { eventId: event._id, status: registration.status, teamId: team._id },
    ...context,
  });

  const result = {
    team: await loadTeamForRead(team._id, registration._id),
    registration: registration.toJSON(),
  };
  if (paid) {
    result.payment = { paymentGroupId };
  }
  // Whether this join made them captain, and whether it was forced on them.
  result.isCaptain = captaincy.isCaptain;
  result.captainAutoAssigned = captaincy.captainAutoAssigned;
  return result;
}

/* Every team the caller is a member of, newest first, with roster and event. */
async function listMyTeams(userId) {
  const teams = await TeamModel.find({ memberUserIds: userId })
    .sort({ createdAt: -1 })
    .populate(TEAM_READ_POPULATE);
  const callerRegistrations = await RegistrationModel.find({
    userId,
    teamId: { $in: teams.map((team) => team._id) },
  })
    .select("teamId")
    .lean();
  const registrationIdByTeamId = new Map(
    callerRegistrations.map((registration) => [String(registration.teamId), registration._id])
  );
  return teams.map((team) =>
    serializeTeamForCaller(team, registrationIdByTeamId.get(String(team._id)) ?? null)
  );
}

/*
 * The leader closes their roster. Locking is an explicit act by the leader (or
 * the registration window closing, which the join guard already enforces) — never
 * a timer or a cron. This is also the only place minimumTeamSize is enforced on
 * the code flow: a team below it cannot lock.
 */
async function lockTeam(userId, teamId, context = {}) {
  const team = mongoose.Types.ObjectId.isValid(teamId) ? await TeamModel.findById(teamId) : null;
  if (!team) {
    throw new ApplicationError(404, ERROR_CODES.TEAM_NOT_FOUND, "That team could not be found.");
  }
  if (String(team.leaderUserId) !== String(userId)) {
    throw new ApplicationError(
      403,
      ERROR_CODES.TEAM_LOCK_LEADER_ONLY,
      "Only the team leader can lock the team."
    );
  }
  if (team.status !== TEAM_STATUSES.FORMING) {
    throw new ApplicationError(
      409,
      ERROR_CODES.TEAM_NOT_ACCEPTING_MEMBERS,
      "This team is not forming, so it cannot be locked."
    );
  }

  const event = await EventModel.findById(team.eventId);
  const minimumTeamSize = event?.minimumTeamSize ?? 1;
  if (team.memberUserIds.length < minimumTeamSize) {
    throw new ApplicationError(
      409,
      ERROR_CODES.TEAM_BELOW_MINIMUM_SIZE,
      "This team does not have enough members to lock.",
      { minimumTeamSize, currentSize: team.memberUserIds.length }
    );
  }

  // Guarded on FORMING so a concurrent lock cannot double-write.
  const lockedTeam = await TeamModel.findOneAndUpdate(
    { _id: team._id, status: TEAM_STATUSES.FORMING },
    { $set: { status: TEAM_STATUSES.LOCKED } },
    { new: true }
  );
  if (!lockedTeam) {
    throw new ApplicationError(
      409,
      ERROR_CODES.TEAM_NOT_ACCEPTING_MEMBERS,
      "This team is not forming, so it cannot be locked."
    );
  }

  await recordAuditLog({
    actorUserId: userId,
    festId: event ? event.festId : null,
    action: AUDIT_ACTIONS.TEAM_LOCKED,
    entityType: AUDIT_ENTITY_TYPES.TEAM,
    entityId: team._id,
    afterState: { status: TEAM_STATUSES.LOCKED, memberCount: team.memberUserIds.length },
    ...context,
  });

  const callerRegistration = await RegistrationModel.findOne({ userId, teamId: team._id })
    .select("_id")
    .lean();
  return loadTeamForRead(team._id, callerRegistration?._id ?? null);
}

/*
 * THE CAPTAIN.
 *
 * Claimed, not appointed: whoever on the roster steps forward first takes it.
 * That is the whole point — a coordinator needs one name and number to call, and
 * making the leader supply it in advance just moves the problem to a person who
 * may not be at the venue.
 *
 * First claim wins and the field is then closed. It is NOT first-come-then-
 * anyone-may-steal-it: a captaincy that silently changes hands is worse than one
 * that has to be resigned deliberately, because the coordinator's roster would
 * go stale without anybody noticing.
 */
async function claimTeamCaptain(userId, teamId, context = {}) {
  const team = mongoose.Types.ObjectId.isValid(teamId) ? await TeamModel.findById(teamId) : null;
  if (!team) {
    throw new ApplicationError(404, ERROR_CODES.TEAM_NOT_FOUND, "Team not found.");
  }

  const isMember = (team.memberUserIds ?? []).some(
    (memberId) => String(memberId) === String(userId)
  );
  if (!isMember) {
    // Not a member is reported as not-found, so this endpoint cannot be used to
    // confirm that a team id exists.
    throw new ApplicationError(404, ERROR_CODES.TEAM_NOT_FOUND, "Team not found.");
  }

  // Idempotent for the holder: a double-tap is not an error.
  if (team.captainUserId && String(team.captainUserId) === String(userId)) {
    return team.toJSON();
  }
  if (team.captainUserId) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CAPTAIN_ALREADY_CLAIMED,
      "Another team member is already the captain.",
      { captainUserId: String(team.captainUserId) }
    );
  }

  team.captainUserId = userId;
  await team.save();

  const event = await EventModel.findById(team.eventId).select("festId").lean();
  await recordAuditLog({
    actorUserId: userId,
    festId: event ? event.festId : null,
    action: AUDIT_ACTIONS.TEAM_CAPTAIN_CLAIMED,
    entityType: AUDIT_ENTITY_TYPES.TEAM,
    entityId: team._id,
    afterState: { captainUserId: String(userId) },
    ...context,
  });

  return team.toJSON();
}

/* The captain stepping down, which reopens the claim to the rest of the roster. */
async function resignTeamCaptain(userId, teamId, context = {}) {
  const team = mongoose.Types.ObjectId.isValid(teamId) ? await TeamModel.findById(teamId) : null;
  if (!team) {
    throw new ApplicationError(404, ERROR_CODES.TEAM_NOT_FOUND, "Team not found.");
  }
  if (!team.captainUserId || String(team.captainUserId) !== String(userId)) {
    throw new ApplicationError(
      403,
      ERROR_CODES.CAPTAIN_ALREADY_CLAIMED,
      "Only the current captain can resign the role."
    );
  }

  team.captainUserId = null;
  await team.save();

  const event = await EventModel.findById(team.eventId).select("festId").lean();
  await recordAuditLog({
    actorUserId: userId,
    festId: event ? event.festId : null,
    action: AUDIT_ACTIONS.TEAM_CAPTAIN_RESIGNED,
    entityType: AUDIT_ENTITY_TYPES.TEAM,
    entityId: team._id,
    beforeState: { captainUserId: String(userId) },
    afterState: { captainUserId: null },
    ...context,
  });

  return team.toJSON();
}

module.exports = {
  createTeam,
  joinTeamByInviteCode,
  listMyTeams,
  lockTeam,
  claimTeamCaptain,
  resignTeamCaptain,
};

const mongoose = require("mongoose");

const { ContingentModel } = require("../models/contingent-model");
const {
  ContingentPurchaseModel,
  isContingentCodeFull,
  isContingentCodeExpired,
  resolveContingentCodeExpiresAt,
} = require("../models/contingent-purchase-model");
const { ContingentClaimModel } = require("../models/contingent-claim-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { TeamModel } = require("../models/team-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const {
  loadRegisterableUser,
  loadRegisterableEvent,
  assertRegistrationWindowOpen,
  belongsToHostCollege,
  assertCallerIsNotAdministrator,
} = require("../helpers/registration-guards");
const { claimTeamSeats, releaseTeamSeats } = require("../helpers/registration-seat-helpers");
const { releaseExpiredPendingPaymentSeats } = require("../helpers/registration-payment-helpers");
const { insertTeamWithUniqueInviteCode } = require("../helpers/insert-team-with-unique-invite-code");
const { assertMembersFree } = require("../helpers/team-roster-helpers");
const { validateCustomResponses } = require("../helpers/validate-custom-responses");
const { resolveMedicalAcceptance } = require("../helpers/medical-declaration-helpers");
const { resolveOfferSelections } = require("../helpers/offer-preference-helpers");
const { ensurePassAndEventEntitlement } = require("./pass-service");
const { awardBadgesInBackground } = require("./achievement-service");
const { describeAddOnOffers, addRegistrationAddOns } = require("./add-on-service");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { EVENT_TYPES } = require("../constants/event-constants");
const { FEST_VISIBILITIES } = require("../constants/fest-constants");
const {
  REGISTRATION_STATUSES,
  PAYMENT_STATUSES,
  ACTIVE_REGISTRATION_STATUSES,
} = require("../constants/registration-constants");
const { TEAM_STATUSES } = require("../constants/team-constants");
const {
  CONTINGENT_STATUSES,
  CONTINGENT_PURCHASE_STATUSES,
  SEAT_HOLDING_CLAIM_STATUSES,
} = require("../constants/contingent-constants");

/*
 * CODE-DISTRIBUTION CONTINGENTS — THE REDEEMER'S SIDE.
 *
 * Whoever holds a code registers THEMSELVES for that code's event: their own
 * account, their own answers, their own consent. The buyer already paid for the
 * access, so the registration carries no event fee; anything extra the redeemer
 * wants (add-ons) they choose and pay for here, separately from the buyer.
 *
 * A solo code admits one person. A team code admits up to the team's maximum
 * size, and every one of them joins the ONE team that code stands for — the
 * code is the team's invite mechanism.
 *
 * inspect and redeem ask the SAME rulebook (assertCodeRedeemable), so the join
 * screen can never be told a code is usable and then have redeem refuse it for
 * a reason the preview did not mention.
 */

const DUPLICATE_KEY_ERROR_CODE = 11000;
/* What a contingent team is called until one of its members names it. */
const PLACEHOLDER_TEAM_NAME = "Unnamed team";

function toObjectId(userId) {
  return new mongoose.Types.ObjectId(String(userId));
}

function hasClaimedCode(codeEntry, userId) {
  return (codeEntry.claims ?? []).some((claim) => String(claim.userId) === String(userId));
}

function describeCodeUsage(codeEntry, userId, fest) {
  const claimCount = (codeEntry.claims ?? []).length;
  return {
    eventType: codeEntry.eventType,
    maxUses: codeEntry.maxUses,
    claimCount,
    remainingUses: Math.max(0, codeEntry.maxUses - claimCount),
    isFull: isContingentCodeFull(codeEntry),
    isRedeemedByYou: hasClaimedCode(codeEntry, userId),
    expiresAt: resolveContingentCodeExpiresAt(fest),
    isExpired: isContingentCodeExpired(fest),
  };
}

/*
 * How many people this code's team can hold. The code was sized from the
 * event's maximum at minting; if an organiser has since lowered the maximum, the
 * lower number wins, because the roster append below is bound by the event.
 */
function resolveTeamCapacity(codeEntry, event) {
  return Math.min(codeEntry.maxUses, event.maximumTeamSize);
}

async function loadCodeState(code) {
  const purchase = await ContingentPurchaseModel.findOne({ "codes.code": code });
  if (!purchase) {
    throw new ApplicationError(404, ERROR_CODES.INVITE_CODE_NOT_FOUND, "No contingent code matches this code.");
  }
  const entry = purchase.codes.find((row) => row.code === code);
  const [contingent, event] = await Promise.all([
    ContingentModel.findById(purchase.contingentId),
    EventModel.findById(entry.eventId).populate("festId"),
  ]);
  // One code, one team: a purchase holds exactly one code per event.
  const team =
    entry.eventType === EVENT_TYPES.TEAM
      ? await TeamModel.findOne({ contingentPurchaseId: purchase._id, eventId: entry.eventId })
      : null;
  return { purchase, entry, contingent, event, fest: event?.festId ?? null, team };
}

/*
 * Every reason a code cannot be redeemed by this caller, as a throw. Code-level
 * refusals come first (a dead or used-up code is so whoever holds it), then the
 * ordinary registration guards the solo path applies, then capacity.
 */
async function assertCodeRedeemable(userId, state) {
  const { purchase, entry, contingent, team } = state;

  if (purchase.status !== CONTINGENT_PURCHASE_STATUSES.COMPLETED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_CODE_INVALIDATED,
      "This code is no longer valid.",
      { reason: `purchase is ${purchase.status}` }
    );
  }
  if (!contingent || contingent.status !== CONTINGENT_STATUSES.PUBLISHED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_CODE_INVALIDATED,
      "This code is no longer valid.",
      { reason: `contingent is ${contingent ? contingent.status : "missing"}` }
    );
  }
  /*
   * Codes expire with their fest. Asked of the fest on every read, never stored,
   * so extending the fest revives every unused use with no data change.
   */
  if (state.fest && isContingentCodeExpired(state.fest)) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_CODE_EXPIRED,
      "This code has expired — the fest has ended.",
      { expiresAt: resolveContingentCodeExpiresAt(state.fest) }
    );
  }
  if (hasClaimedCode(entry, userId)) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_CODE_ALREADY_REDEEMED,
      "You have already redeemed this code.",
      { eventId: String(entry.eventId) }
    );
  }
  if (isContingentCodeFull(entry)) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_CODE_FULLY_CLAIMED,
      "This code has been fully claimed.",
      { eventId: String(entry.eventId), maxUses: entry.maxUses }
    );
  }

  await assertCallerIsNotAdministrator(userId);
  const user = await loadRegisterableUser(userId);
  const { event, fest } = await loadRegisterableEvent(entry.eventId);
  assertRegistrationWindowOpen(event, new Date());
  if (fest.visibility === FEST_VISIBILITIES.INTRA_COLLEGE && !belongsToHostCollege(user, fest)) {
    throw new ApplicationError(
      403,
      ERROR_CODES.WRONG_COLLEGE,
      "This fest is open to the host college only.",
      { requiredCollegeId: String(fest.hostCollegeId) }
    );
  }

  /*
   * A pending-payment row counts here even though it does not block the unique
   * index: a person mid-checkout for this event must finish or cancel that, not
   * take a second seat through a code.
   */
  const existingRegistration = await RegistrationModel.findOne({
    eventId: event._id,
    userId,
    status: { $in: [...ACTIVE_REGISTRATION_STATUSES, REGISTRATION_STATUSES.PENDING_PAYMENT] },
  })
    .select("_id")
    .lean();
  if (existingRegistration) {
    throw new ApplicationError(
      409,
      ERROR_CODES.ALREADY_REGISTERED,
      "You are already registered for this event.",
      { existingId: String(existingRegistration._id) }
    );
  }
  if (event.eventType === EVENT_TYPES.TEAM) {
    await assertMembersFree([{ email: user.emailAddress, user }], event._id);
  }
  // A legacy claim still holding a seat for this person in this event.
  const heldClaim = await ContingentClaimModel.findOne({
    eventId: event._id,
    attendeeUserId: userId,
    claimStatus: { $in: SEAT_HOLDING_CLAIM_STATUSES },
  })
    .select("_id")
    .lean();
  if (heldClaim) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_CLAIM_EXISTS,
      "You already hold a contingent seat for this event.",
      { eventId: String(event._id) }
    );
  }

  /*
   * Fast pre-checks only: the conditional seat claim and roster append are the
   * guards. A capacity refusal writes NOTHING to the code — it stays valid, and
   * the same code works the moment a seat frees up.
   */
  if (event.capacity !== null && event.registeredCount >= event.capacity) {
    throw new ApplicationError(409, ERROR_CODES.EVENT_FULL, "This event is full.");
  }
  if (team && team.memberUserIds.length >= resolveTeamCapacity(entry, event)) {
    throw new ApplicationError(409, ERROR_CODES.TEAM_FULL, "This team is already full.", {
      maximumTeamSize: resolveTeamCapacity(entry, event),
    });
  }

  return { user, event, fest };
}

/*
 * THE TEAM RULE, as data for the join screen and as the check redeem enforces.
 *
 * Every redeemer before the last MAY claim the captaincy and MAY name the team,
 * while those are still open, and may equally skip both. The redeemer whose
 * arrival fills the team to its maximum MUST supply whichever of the two is
 * still missing — a full team cannot exist without a captain and a name.
 */
function describeTeamRequirements(team, event, codeEntry) {
  const teamCapacity = resolveTeamCapacity(codeEntry, event);
  const memberCount = team ? team.memberUserIds.length : 0;
  const fillsTeam = memberCount + 1 >= teamCapacity;
  const hasCaptain = Boolean(team?.captainUserId);
  const hasChosenName = Boolean(team?.teamNameChosenAt);
  return {
    teamId: team ? String(team._id) : null,
    teamName: hasChosenName ? team.teamName : null,
    memberCount,
    minimumTeamSize: event.minimumTeamSize,
    maximumTeamSize: teamCapacity,
    hasCaptain,
    hasChosenName,
    fillsTeam,
    canClaimCaptain: !hasCaptain,
    canSetTeamName: !hasChosenName,
    captainRequired: fillsTeam && !hasCaptain,
    teamNameRequired: fillsTeam && !hasChosenName,
  };
}

function assertTeamChoicesSatisfied(team, event, codeEntry, payload) {
  const requirements = describeTeamRequirements(team, event, codeEntry);
  const missing = {};
  if (requirements.captainRequired && payload.claimCaptain !== true) {
    missing.claimCaptain = "you are filling the team, so you must take the captaincy";
  }
  if (requirements.teamNameRequired && !payload.teamName) {
    missing.teamName = "you are filling the team, so you must name it";
  }
  if (Object.keys(missing).length > 0) {
    throw new ApplicationError(
      400,
      ERROR_CODES.CONTINGENT_TEAM_CAPTAIN_REQUIRED,
      "You are filling this team, and a full team cannot exist without a captain and a name.",
      missing
    );
  }
}

/*
 * Gives back exactly what joinContingentTeam wrote for this person. Only the
 * captaincy and name THIS join set are reverted, and the team is deleted only if
 * this person was its whole roster.
 */
async function undoTeamJoin(teamId, userId, didNameTeam) {
  await TeamModel.updateOne({ _id: teamId, captainUserId: userId }, { $set: { captainUserId: null } });
  if (didNameTeam) {
    await TeamModel.updateOne(
      { _id: teamId },
      { $set: { teamName: PLACEHOLDER_TEAM_NAME, teamNameChosenAt: null } }
    );
  }
  const pulled = await TeamModel.findOneAndUpdate(
    { _id: teamId },
    { $pull: { memberUserIds: userId } },
    { new: true }
  );
  if (!pulled) {
    return;
  }
  if (pulled.memberUserIds.length === 0) {
    await TeamModel.deleteOne({ _id: teamId });
    return;
  }
  // The leader must stay on the roster; hand it to whoever joined next.
  if (String(pulled.leaderUserId) === String(userId)) {
    await TeamModel.updateOne({ _id: teamId }, { $set: { leaderUserId: pulled.memberUserIds[0] } });
  }
}

/*
 * Puts the redeemer on the code's team, creating it on the first redemption.
 * Every write is conditional — the roster append on room left, the captaincy on
 * nobody holding it, the name on nobody having chosen one — so concurrent
 * redeemers cannot overfill the team or both become captain.
 *
 * The fill rule is re-checked AFTER the writes, against the team as it now
 * stands: the pre-check ran on a read another redeemer may have overtaken. On
 * failure this undoes its own writes before throwing, so the caller only has to
 * compensate what happened after it returned.
 */
async function joinContingentTeam({ purchase, event, codeEntry, userId, payload }) {
  const teamCapacity = resolveTeamCapacity(codeEntry, event);
  let team = await TeamModel.findOne({ contingentPurchaseId: purchase._id, eventId: event._id });
  let createdTeam = false;
  let didNameTeam = false;
  let didClaimCaptain = false;

  if (!team) {
    try {
      /*
       * The Team model requires an invite code, so one is minted, but it is
       * never shown and never accepted: joinTeamByInviteCode refuses any team
       * carrying a contingentPurchaseId. The contingent code is the only way in.
       */
      team = await insertTeamWithUniqueInviteCode({
        eventId: event._id,
        teamName: payload.teamName ?? PLACEHOLDER_TEAM_NAME,
        teamNameChosenAt: payload.teamName ? new Date() : null,
        leaderUserId: userId,
        memberUserIds: [userId],
        captainUserId: payload.claimCaptain ? userId : null,
        contingentPurchaseId: purchase._id,
        status: TEAM_STATUSES.FORMING,
      });
      createdTeam = true;
      didNameTeam = Boolean(payload.teamName);
      didClaimCaptain = Boolean(payload.claimCaptain);
    } catch (error) {
      // Lost the first-redemption race: the other redeemer's team is the team.
      if (error?.code !== DUPLICATE_KEY_ERROR_CODE) {
        throw error;
      }
      team = await TeamModel.findOne({ contingentPurchaseId: purchase._id, eventId: event._id });
      if (!team) {
        throw error;
      }
    }
  }

  if (!createdTeam) {
    const appended = await TeamModel.findOneAndUpdate(
      {
        _id: team._id,
        $expr: { $lt: [{ $size: "$memberUserIds" }, teamCapacity] },
      },
      { $addToSet: { memberUserIds: userId } },
      { new: true }
    );
    if (!appended) {
      throw new ApplicationError(409, ERROR_CODES.TEAM_FULL, "This team is already full.", {
        maximumTeamSize: teamCapacity,
      });
    }
    team = appended;
    if (payload.claimCaptain) {
      didClaimCaptain = Boolean(
        await TeamModel.findOneAndUpdate(
          { _id: team._id, captainUserId: null },
          { $set: { captainUserId: userId } }
        )
      );
    }
    if (payload.teamName) {
      didNameTeam = Boolean(
        await TeamModel.findOneAndUpdate(
          { _id: team._id, teamNameChosenAt: null },
          { $set: { teamName: payload.teamName, teamNameChosenAt: new Date() } }
        )
      );
    }
  }

  const settled = await TeamModel.findById(team._id);
  const isFull = settled.memberUserIds.length >= teamCapacity;
  if (isFull && (!settled.captainUserId || !settled.teamNameChosenAt)) {
    await undoTeamJoin(settled._id, userId, didNameTeam);
    throw new ApplicationError(
      400,
      ERROR_CODES.CONTINGENT_TEAM_CAPTAIN_REQUIRED,
      "You are filling this team, and a full team cannot exist without a captain and a name.",
      {
        ...(settled.captainUserId ? {} : { claimCaptain: "the team still has no captain" }),
        ...(settled.teamNameChosenAt ? {} : { teamName: "the team still has no name" }),
      }
    );
  }

  return { team: settled, didNameTeam, didClaimCaptain };
}

function summariseTeam(team, teamCapacity, userId) {
  if (!team) {
    return null;
  }
  return {
    id: String(team._id),
    teamName: team.teamName,
    isTeamNameChosen: Boolean(team.teamNameChosenAt),
    captainUserId: team.captainUserId ? String(team.captainUserId) : null,
    isCaptain: Boolean(team.captainUserId) && String(team.captainUserId) === String(userId),
    memberUserIds: team.memberUserIds.map(String),
    memberCount: team.memberUserIds.length,
    maximumTeamSize: teamCapacity,
  };
}

/* GET /contingents/codes/:code/inspect — what redeeming would give, before committing. */
async function inspectContingentCode(userId, code) {
  const state = await loadCodeState(code);
  let refusal = null;
  let resolved = null;
  try {
    resolved = await assertCodeRedeemable(userId, state);
  } catch (error) {
    if (!(error instanceof ApplicationError)) {
      throw error;
    }
    refusal = error;
  }

  const event = resolved?.event ?? state.event;
  const fest = resolved?.fest ?? state.fest;
  const parentEvent = state.contingent?.parentEventId
    ? await EventModel.findById(state.contingent.parentEventId).select("eventName").lean()
    : null;

  return {
    code,
    usage: describeCodeUsage(state.entry, userId, state.fest),
    redeemable: refusal === null,
    refusal: refusal
      ? { code: refusal.errorCode, message: refusal.message, details: refusal.details ?? null }
      : null,
    contingent: state.contingent
      ? {
          id: String(state.contingent._id),
          contingentName: state.contingent.contingentName,
          description: state.contingent.description ?? null,
          parentEventId: state.contingent.parentEventId ? String(state.contingent.parentEventId) : null,
          parentEventName: parentEvent?.eventName ?? null,
        }
      : null,
    event: event
      ? {
          id: String(event._id),
          eventName: event.eventName,
          eventSlug: event.eventSlug,
          eventType: event.eventType,
          category: event.category ?? null,
          venue: event.venue ?? null,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          minimumTeamSize: event.minimumTeamSize,
          maximumTeamSize: event.maximumTeamSize,
          requiresMedicalDeclaration: Boolean(event.requiresMedicalDeclaration),
          customQuestions: event.customQuestions ?? [],
        }
      : null,
    fest: fest ? { id: String(fest._id), festName: fest.festName } : null,
    addOns: event && fest ? describeAddOnOffers(fest, event) : [],
    team:
      event && state.entry.eventType === EVENT_TYPES.TEAM
        ? describeTeamRequirements(state.team, event, state.entry)
        : null,
  };
}

/*
 * POST /contingents/codes/:code/redeem.
 *
 * Write order: one USE of the code first (the conditional push IS "no second
 * use by the same person, no use past maxUses"), then the seat, the team, the
 * registration. Any failure before the registration commits unwinds all of it
 * in reverse, and the use goes back. After the commit, the pass and entitlements
 * are issued and the add-ons are applied — free ones inline, paid ones parked on
 * an AddOnOrder for the existing checkout, exactly as post-join add-ons work.
 */
async function redeemContingentCode(userId, code, payload = {}, context = {}) {
  const state = await loadCodeState(code);
  if (state.event) {
    // Lapsed pending holds free their seats first, as every registration path does.
    await releaseExpiredPendingPaymentSeats(state.event);
    state.event = await EventModel.findById(state.event._id).populate("festId");
  }
  const { event, fest } = await assertCodeRedeemable(userId, state);
  const isTeamCode = state.entry.eventType === EVENT_TYPES.TEAM;

  // Every answer resolved before anything is written: a rejected answer must not consume a use.
  const customResponses = validateCustomResponses(event.customQuestions, payload.customResponses);
  const medicalDeclarationAcceptedAt = resolveMedicalAcceptance(
    event,
    payload.hasAcceptedMedicalDeclaration
  );
  const rawOfferSelections = payload.offerSelections ?? [];
  const resolvedOfferSelections = resolveOfferSelections(fest, rawOfferSelections, event);
  if (rawOfferSelections.length > 0 && resolvedOfferSelections.length === 0) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "No valid add-ons were selected.", {
      offerSelections: "none of the selected offers are available for this event",
    });
  }
  if (isTeamCode) {
    assertTeamChoicesSatisfied(state.team, event, state.entry, payload);
  }

  /*
   * Taking a use, atomically. "Room left" is expressed as "the array has no
   * element at index maxUses-1", which the filter can check without reading the
   * length first — so two redeemers racing for the last use cannot both get it.
   */
  const userObjectId = toObjectId(userId);
  const claimedAt = new Date();
  const lastUseIndexPath = `claims.${state.entry.maxUses - 1}`;
  const reserved = await ContingentPurchaseModel.findOneAndUpdate(
    {
      _id: state.purchase._id,
      status: CONTINGENT_PURCHASE_STATUSES.COMPLETED,
      codes: {
        $elemMatch: {
          code,
          "claims.userId": { $ne: userObjectId },
          [lastUseIndexPath]: { $exists: false },
        },
      },
    },
    { $push: { "codes.$.claims": { userId: userObjectId, claimedAt, registrationId: null } } },
    { new: true }
  );
  if (!reserved) {
    const fresh = await ContingentPurchaseModel.findById(state.purchase._id).lean();
    const freshEntry = fresh?.codes.find((row) => row.code === code);
    if (fresh?.status !== CONTINGENT_PURCHASE_STATUSES.COMPLETED || !freshEntry) {
      throw new ApplicationError(409, ERROR_CODES.CONTINGENT_CODE_INVALIDATED, "This code is no longer valid.", {
        reason: `purchase is ${fresh?.status ?? "missing"}`,
      });
    }
    if (hasClaimedCode(freshEntry, userId)) {
      throw new ApplicationError(409, ERROR_CODES.CONTINGENT_CODE_ALREADY_REDEEMED, "You have already redeemed this code.", {
        eventId: String(event._id),
      });
    }
    throw new ApplicationError(409, ERROR_CODES.CONTINGENT_CODE_FULLY_CLAIMED, "This code has been fully claimed.", {
      eventId: String(event._id),
      maxUses: freshEntry.maxUses,
    });
  }

  let seatClaimed = false;
  let teamOutcome = null;
  let registration = null;
  try {
    // claimTeamSeats, not claimSoloSeat: a code buys a seat or nothing — never a waitlist place.
    await claimTeamSeats(event, 1);
    seatClaimed = true;
    if (isTeamCode) {
      teamOutcome = await joinContingentTeam({
        purchase: state.purchase,
        event,
        codeEntry: state.entry,
        userId,
        payload,
      });
    }
    registration = await RegistrationModel.create({
      eventId: event._id,
      userId,
      teamId: teamOutcome ? teamOutcome.team._id : null,
      status: REGISTRATION_STATUSES.CONFIRMED,
      feeAmountSnapshotPaise: event.feeAmountPaise,
      // The buyer paid for access; the redeemer owes nothing for the event itself.
      paymentStatus: PAYMENT_STATUSES.NOT_REQUIRED,
      totalFeePaise: 0,
      feeBreakdown: [],
      customResponses,
      medicalDeclarationAcceptedAt,
      contingentPurchaseId: state.purchase._id,
      registeredAt: claimedAt,
    });
    await ContingentPurchaseModel.updateOne(
      { _id: state.purchase._id },
      { $set: { "codes.$[codeEntry].claims.$[use].registrationId": registration._id } },
      { arrayFilters: [{ "codeEntry.code": code }, { "use.userId": userObjectId }] }
    );
  } catch (error) {
    if (registration) {
      await RegistrationModel.deleteOne({ _id: registration._id }).catch(() => {});
    }
    if (teamOutcome) {
      await undoTeamJoin(teamOutcome.team._id, userId, teamOutcome.didNameTeam).catch(() => {});
    }
    if (seatClaimed) {
      await releaseTeamSeats(event, 1);
    }
    await ContingentPurchaseModel.updateOne(
      { _id: state.purchase._id },
      { $pull: { "codes.$[codeEntry].claims": { userId: userObjectId } } },
      { arrayFilters: [{ "codeEntry.code": code }] }
    );
    if (error?.code === DUPLICATE_KEY_ERROR_CODE) {
      throw new ApplicationError(409, ERROR_CODES.ALREADY_REGISTERED, "You are already registered for this event.");
    }
    throw error;
  }

  // The seat is held from here on: nothing below may hand it back.
  await ensurePassAndEventEntitlement(userId, fest._id, event._id);
  awardBadgesInBackground(userId);

  /*
   * The add-ons are the redeemer's own purchase, separate from the buyer's. The
   * selections were validated above, so a failure here is exceptional — and it
   * must not report a join that DID happen as failed.
   */
  let addOns = null;
  if (resolvedOfferSelections.length > 0) {
    try {
      addOns = await addRegistrationAddOns(userId, String(registration._id), rawOfferSelections, context);
    } catch (error) {
      console.error(`Add-ons on contingent redemption ${registration._id} failed: ${error.message}`);
      addOns = { paid: false, applied: false, errorCode: error?.errorCode ?? ERROR_CODES.INTERNAL_ERROR };
    }
  }

  if (teamOutcome?.didClaimCaptain) {
    await recordAuditLog({
      actorUserId: userId,
      festId: fest._id,
      action: AUDIT_ACTIONS.TEAM_CAPTAIN_CLAIMED,
      entityType: AUDIT_ENTITY_TYPES.TEAM,
      entityId: teamOutcome.team._id,
      afterState: { captainUserId: String(userId), via: "contingentCode" },
      ...context,
    });
  }
  const finalEntry = (await ContingentPurchaseModel.findById(state.purchase._id).lean()).codes.find(
    (row) => row.code === code
  );
  await recordAuditLog({
    actorUserId: userId,
    festId: fest._id,
    action: AUDIT_ACTIONS.CONTINGENT_CODE_REDEEMED,
    entityType: AUDIT_ENTITY_TYPES.CONTINGENT_PURCHASE,
    entityId: state.purchase._id,
    afterState: {
      code,
      eventId: String(event._id),
      registrationId: String(registration._id),
      teamId: teamOutcome ? String(teamOutcome.team._id) : null,
      claimCount: finalEntry.claims.length,
      maxUses: finalEntry.maxUses,
      redeemedByBuyer: String(state.purchase.buyerUserId) === String(userId),
    },
    ...context,
  });

  const finalTeam = teamOutcome ? await TeamModel.findById(teamOutcome.team._id).lean() : null;
  return {
    contingentPurchaseId: String(state.purchase._id),
    eventId: String(event._id),
    eventName: event.eventName,
    usage: describeCodeUsage(finalEntry, userId, fest),
    registration: registration.toJSON(),
    team: summariseTeam(finalTeam, resolveTeamCapacity(state.entry, event), userId),
    addOns,
  };
}

module.exports = {
  inspectContingentCode,
  redeemContingentCode,
  describeTeamRequirements,
};

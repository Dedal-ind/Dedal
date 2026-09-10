const { ContingentVerticalCodeModel } = require("../models/contingent-vertical-code-model");
const { ContingentClaimModel } = require("../models/contingent-claim-model");
const { ContingentModel } = require("../models/contingent-model");
const { EventModel } = require("../models/event-model");
const { TeamModel } = require("../models/team-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { generateInviteCode } = require("../helpers/generate-invite-code");
const {
  CONTINGENT_CLAIM_STATUSES,
  SEAT_HOLDING_CLAIM_STATUSES,
} = require("../constants/contingent-constants");
const { PAYMENT_STATUSES } = require("../constants/registration-constants");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");

/*
 * Per-vertical contingent codes.
 *
 * A code does not create a seat and does not move money. Its whole job is to
 * let the buyer hand a seat they ALREADY PAID FOR to whoever is actually going
 * to compete, without the buyer having to know that person's email at checkout.
 * Redeeming one takes over an INVITED claim from that purchase and accepts it,
 * which is the same transition the emailed invite drives — so the seat
 * accounting, the pass issue and the refund story are all unchanged.
 *
 * Codes are minted at payment capture, never earlier: a code for an unpaid
 * bundle would summon people to seats that may lapse when the hold expires.
 */

const CODE_GENERATION_ATTEMPTS = 5;

/*
 * A code must be unique across BOTH collections it can be typed into. The unique
 * index on each is the real guarantee; this pre-check just avoids burning a
 * retry on a collision we can see coming.
 */
async function generateUnusedInviteCode() {
  for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = generateInviteCode();
    const [teamHit, codeHit] = await Promise.all([
      TeamModel.exists({ inviteCode: candidate }),
      ContingentVerticalCodeModel.exists({ inviteCode: candidate }),
    ]);
    if (!teamHit && !codeHit) {
      return candidate;
    }
  }
  throw new ApplicationError(
    500,
    ERROR_CODES.INTERNAL_ERROR,
    "Could not generate a unique invite code. Try again."
  );
}

/*
 * Called once per purchase, at capture. One code per sub-event the purchase
 * bought seats in, with maxClaims set to the number of those seats.
 *
 * Idempotent by construction: the (purchaseGroupId, eventId) unique index makes
 * a duplicate insert a no-op rather than a second code for the same vertical,
 * because a webhook that fires twice must not invalidate the code the buyer has
 * already copied off their success screen.
 */
async function generateVerticalCodesForPurchase(contingentPurchaseGroupId) {
  const claims = await ContingentClaimModel.find({ contingentPurchaseGroupId }).lean();
  if (claims.length === 0) {
    return { generatedCount: 0, codes: [] };
  }

  const existing = await ContingentVerticalCodeModel.find({ contingentPurchaseGroupId }).lean();
  const existingEventIds = new Set(existing.map((row) => String(row.eventId)));

  // Seats bought per sub-event in THIS purchase.
  const seatCountByEventId = new Map();
  for (const claim of claims) {
    const key = String(claim.eventId);
    seatCountByEventId.set(key, (seatCountByEventId.get(key) ?? 0) + 1);
  }

  const events = await EventModel.find({ _id: { $in: [...seatCountByEventId.keys()] } })
    .select("eventName")
    .lean();
  const eventNameById = new Map(events.map((event) => [String(event._id), event.eventName]));

  const created = [];
  for (const [eventId, seatCount] of seatCountByEventId) {
    if (existingEventIds.has(eventId)) {
      continue;
    }
    const inviteCode = await generateUnusedInviteCode();
    try {
      const row = await ContingentVerticalCodeModel.create({
        contingentId: claims[0].contingentId,
        festId: claims[0].festId,
        contingentPurchaseGroupId,
        eventId,
        eventName: eventNameById.get(eventId) ?? "Event",
        inviteCode,
        claimedCount: 0,
        maxClaims: seatCount,
      });
      created.push(row.toJSON());
    } catch (error) {
      // The unique index caught a concurrent generation for the same vertical.
      // The other writer's code is the real one; ours is discarded.
      if (error?.code !== 11000) {
        throw error;
      }
    }
  }

  return { generatedCount: created.length, codes: created };
}

/* Every code for one purchase, for the buyer's success screen and the admin table. */
async function listVerticalCodesForPurchase(contingentPurchaseGroupId) {
  const codes = await ContingentVerticalCodeModel.find({ contingentPurchaseGroupId })
    .sort({ eventName: 1 })
    .lean();
  return codes.map((code) => ({
    id: String(code._id),
    eventId: String(code.eventId),
    eventName: code.eventName,
    inviteCode: code.inviteCode,
    claimedCount: code.claimedCount,
    maxClaims: code.maxClaims,
    remainingSlots: Math.max(0, code.maxClaims - code.claimedCount),
  }));
}

async function listVerticalCodesForContingent(contingentId) {
  const codes = await ContingentVerticalCodeModel.find({ contingentId })
    .sort({ eventName: 1, createdAt: 1 })
    .lean();
  return codes.map((code) => ({
    id: String(code._id),
    eventId: String(code.eventId),
    eventName: code.eventName,
    inviteCode: code.inviteCode,
    claimedCount: code.claimedCount,
    maxClaims: code.maxClaims,
    remainingSlots: Math.max(0, code.maxClaims - code.claimedCount),
    contingentPurchaseGroupId: code.contingentPurchaseGroupId,
  }));
}

function normaliseCode(rawCode) {
  return String(rawCode ?? "").trim().toUpperCase();
}

/*
 * The read-only half of the join box: what WOULD happen if this code were
 * redeemed. Drives the live feedback under the input, so it must answer the
 * "already joined" and "fully claimed" cases rather than only "valid/invalid" —
 * a participant who is told a code is valid and then refused has been misled.
 */
async function inspectCode(userId, rawCode) {
  const inviteCode = normaliseCode(rawCode);
  if (!inviteCode) {
    return { kind: "invalid" };
  }

  // Teams first: team codes predate this feature and must keep resolving.
  const team = await TeamModel.findOne({ inviteCode }).select("_id eventId teamName").lean();
  if (team) {
    return { kind: "team", teamId: String(team._id), eventId: String(team.eventId) };
  }

  const code = await ContingentVerticalCodeModel.findOne({ inviteCode }).lean();
  if (!code) {
    return { kind: "invalid" };
  }

  const parentEvent = await ContingentModel.findById(code.contingentId)
    .select("parentEventId contingentName")
    .lean();
  const parent = parentEvent?.parentEventId
    ? await EventModel.findById(parentEvent.parentEventId).select("eventName").lean()
    : null;

  const base = {
    kind: "vertical",
    eventId: String(code.eventId),
    eventName: code.eventName,
    parentEventName: parent?.eventName ?? null,
    contingentName: parentEvent?.contingentName ?? null,
    remainingSlots: Math.max(0, code.maxClaims - code.claimedCount),
    maxClaims: code.maxClaims,
  };

  const alreadyHeld = await ContingentClaimModel.findOne({
    attendeeUserId: userId,
    eventId: code.eventId,
    claimStatus: { $in: SEAT_HOLDING_CLAIM_STATUSES },
  }).lean();
  if (alreadyHeld) {
    return { ...base, status: "alreadyClaimed" };
  }
  if (code.claimedCount >= code.maxClaims) {
    return { ...base, status: "exhausted" };
  }
  return { ...base, status: "available" };
}

/*
 * Redeem: take over one INVITED, PAID claim from this purchase for this
 * sub-event and accept it as the redeeming user.
 *
 * The counter is incremented with a CONDITIONAL update before the claim is
 * touched, so two people racing on the last slot cannot both pass the check —
 * the same conditional-$inc pattern the bundle slot and event seats already use.
 * If the claim step then fails, the increment is rolled back; a code that
 * silently loses a slot to a failed redemption is worse than one that briefly
 * double-counts.
 */
async function redeemVerticalCode(userId, rawCode, context = {}) {
  const inviteCode = normaliseCode(rawCode);
  const code = await ContingentVerticalCodeModel.findOne({ inviteCode });
  if (!code) {
    throw new ApplicationError(404, ERROR_CODES.INVITE_CODE_NOT_FOUND, "Invalid code.");
  }

  // D — one participant may not take two seats in the same sub-event.
  const alreadyHeld = await ContingentClaimModel.findOne({
    attendeeUserId: userId,
    eventId: code.eventId,
    claimStatus: { $in: SEAT_HOLDING_CLAIM_STATUSES },
  }).lean();
  if (alreadyHeld) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_CLAIM_EXISTS,
      "You have already joined this event.",
      { eventId: String(code.eventId) }
    );
  }

  const reserved = await ContingentVerticalCodeModel.findOneAndUpdate(
    { _id: code._id, $expr: { $lt: ["$claimedCount", "$maxClaims"] } },
    { $inc: { claimedCount: 1 } },
    { new: true }
  );
  if (!reserved) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVITE_CODE_EXHAUSTED,
      "This code has been fully claimed.",
      { eventId: String(code.eventId) }
    );
  }

  try {
    /*
     * An unaccepted, paid seat from this purchase for this sub-event. Sorted by
     * invitedAt so the oldest outstanding seat is filled first, which keeps the
     * buyer's own ordering meaningful when they hand out several codes.
     */
    const claim = await ContingentClaimModel.findOne({
      contingentPurchaseGroupId: code.contingentPurchaseGroupId,
      eventId: code.eventId,
      claimStatus: CONTINGENT_CLAIM_STATUSES.INVITED,
      paymentStatus: PAYMENT_STATUSES.COMPLETED,
    }).sort({ invitedAt: 1 });

    if (!claim) {
      throw new ApplicationError(
        409,
        ERROR_CODES.INVITE_CODE_EXHAUSTED,
        "There is no unclaimed seat left on this code.",
        { eventId: String(code.eventId) }
      );
    }

    /*
     * The redeeming participant BECOMES the attendee. The buyer typed a
     * placeholder name at checkout; the person actually competing is the one
     * holding the code, and the roster must show them.
     */
    claim.attendeeUserId = userId;
    await claim.save();

    const { acceptContingentClaimInternal } = require("./contingent-claim-service");
    const accepted = await acceptContingentClaimInternal(claim._id, userId, context);

    await recordAuditLog({
      actorUserId: userId,
      festId: code.festId,
      action: AUDIT_ACTIONS.CONTINGENT_VERTICAL_CODE_REDEEMED,
      entityType: AUDIT_ENTITY_TYPES.CONTINGENT_CLAIM,
      entityId: claim._id,
      afterState: {
        inviteCode: code.inviteCode,
        eventId: String(code.eventId),
        claimedCount: reserved.claimedCount,
        maxClaims: reserved.maxClaims,
      },
      ...context,
    });

    return {
      eventId: String(code.eventId),
      eventName: code.eventName,
      claim: accepted.claim,
      registration: accepted.registration,
      remainingSlots: Math.max(0, reserved.maxClaims - reserved.claimedCount),
    };
  } catch (error) {
    // Give the slot back — the redemption did not happen.
    await ContingentVerticalCodeModel.updateOne({ _id: code._id }, { $inc: { claimedCount: -1 } });
    throw error;
  }
}

module.exports = {
  generateVerticalCodesForPurchase,
  listVerticalCodesForPurchase,
  listVerticalCodesForContingent,
  inspectCode,
  redeemVerticalCode,
};

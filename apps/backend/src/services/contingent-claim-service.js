const { ContingentModel } = require("../models/contingent-model");
const { ContingentClaimModel } = require("../models/contingent-claim-model");
const { EventModel } = require("../models/event-model");
const { FestModel } = require("../models/fest-model");
const { RegistrationModel } = require("../models/registration-model");
const { PaymentOrderModel } = require("../models/payment-order-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { loadRegisterableUser } = require("../helpers/registration-guards");
const { releaseTeamSeats } = require("../helpers/registration-seat-helpers");
const { ensurePassAndEventEntitlement } = require("./pass-service");
const { awardBadgesInBackground } = require("./achievement-service");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const {
  REGISTRATION_STATUSES,
  PAYMENT_STATUSES,
} = require("../constants/registration-constants");
const { EVENT_STATUSES } = require("../constants/event-constants");
const {
  CONTINGENT_CLAIM_STATUSES,
  CONTINGENT_CLAIM_EXPIRY_HOURS_AFTER_FEST_START,
} = require("../constants/contingent-constants");

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const DUPLICATE_KEY_ERROR_CODE = 11000;

/*
 * F — the expiry sweep, run lazily from the claim read/accept paths (the same
 * no-cron pattern as releaseExpiredPendingPaymentSeats): an INVITED claim never
 * accepted by fest.startsOn + 24h flips to EXPIRED and hands its seat back, so
 * a dead invite cannot hold a seat a walk-up participant could take (I.6).
 */
async function expireLapsedContingentClaims(festId) {
  const fest = await FestModel.findById(festId).select("startsOn").lean();
  if (!fest) {
    return;
  }
  const expiryCutoff = new Date(
    fest.startsOn.getTime() + CONTINGENT_CLAIM_EXPIRY_HOURS_AFTER_FEST_START * MILLISECONDS_PER_HOUR
  );
  if (Date.now() < expiryCutoff.getTime()) {
    return;
  }
  const lapsedClaims = await ContingentClaimModel.find({
    festId,
    claimStatus: CONTINGENT_CLAIM_STATUSES.INVITED,
    paymentStatus: PAYMENT_STATUSES.COMPLETED,
  });
  if (lapsedClaims.length === 0) {
    return;
  }
  await ContingentClaimModel.updateMany(
    { _id: { $in: lapsedClaims.map((claim) => claim._id) } },
    { $set: { claimStatus: CONTINGENT_CLAIM_STATUSES.EXPIRED } }
  );
  for (const claim of lapsedClaims) {
    const event = await EventModel.findById(claim.eventId);
    if (event) {
      await releaseTeamSeats(event, 1);
    }
  }
}

const CLAIM_LIST_POPULATE = [
  { path: "contingentId", select: "contingentName status" },
  { path: "eventId", select: "eventName eventSlug startsAt venue status" },
  { path: "buyerUserId", select: "fullName emailAddress" },
];

/*
 * The attendee's own invited/accepted claims — the "you've been added to a
 * contingent" panel on /my-registrations. Only PAID claims surface: an unpaid
 * purchase may evaporate in thirty minutes and must not invite anyone.
 */
async function listMyContingentClaims(userId) {
  const ownClaims = await ContingentClaimModel.find({
    attendeeUserId: userId,
    paymentStatus: PAYMENT_STATUSES.COMPLETED,
  })
    .sort({ invitedAt: -1 })
    .populate(CLAIM_LIST_POPULATE);

  // The sweep runs per fest the caller has claims in, before the list is shaped.
  const festIds = [...new Set(ownClaims.map((claim) => String(claim.festId)))];
  for (const festId of festIds) {
    await expireLapsedContingentClaims(festId);
  }

  const refreshedClaims = await ContingentClaimModel.find({
    attendeeUserId: userId,
    paymentStatus: PAYMENT_STATUSES.COMPLETED,
  })
    .sort({ invitedAt: -1 })
    .populate(CLAIM_LIST_POPULATE);
  return refreshedClaims.map((claim) => claim.toJSON());
}

/*
 * The buyer's own purchases, grouped by purchase group — powers the "my
 * contingent purchases" panel and its cancel button.
 */
async function listMyContingentPurchases(userId) {
  const boughtClaims = await ContingentClaimModel.find({ buyerUserId: userId })
    .sort({ invitedAt: -1 })
    .populate([
      { path: "contingentId", select: "contingentName pricePaise status" },
      { path: "eventId", select: "eventName" },
    ]);
  const purchasesByGroupId = new Map();
  for (const claim of boughtClaims) {
    const groupId = claim.contingentPurchaseGroupId;
    if (!purchasesByGroupId.has(groupId)) {
      purchasesByGroupId.set(groupId, {
        contingentPurchaseGroupId: groupId,
        contingentName: claim.contingentId?.contingentName ?? null,
        pricePaise: claim.contingentId?.pricePaise ?? null,
        purchasedAt: claim.invitedAt,
        claims: [],
      });
    }
    purchasesByGroupId.get(groupId).claims.push({
      id: String(claim._id),
      eventName: claim.eventId?.eventName ?? null,
      attendeeFullName: claim.attendeeFullName,
      attendeeEmailAddress: claim.attendeeEmailAddress,
      claimStatus: claim.claimStatus,
      paymentStatus: claim.paymentStatus,
    });
  }
  const purchases = [...purchasesByGroupId.values()];
  for (const purchase of purchases) {
    const order = await PaymentOrderModel.findOne({
      paymentGroupId: purchase.contingentPurchaseGroupId,
    })
      .select("status totalAmountPaise")
      .lean();
    purchase.orderStatus = order?.status ?? null;
    purchase.totalAmountPaise = order?.totalAmountPaise ?? null;
  }
  return purchases;
}

async function loadOwnClaimOrThrow(userId, claimId) {
  const claim = await ContingentClaimModel.findById(claimId);
  if (!claim || String(claim.attendeeUserId) !== String(userId)) {
    // Someone else's claim and a nonexistent id are the same 403 — no probing.
    throw new ApplicationError(403, ERROR_CODES.PERMISSION_DENIED, "You cannot act on this claim.");
  }
  return claim;
}

/*
 * F — accept, the DPDP hinge of the whole feature. The attendee is signed in on
 * their OWN account (loadRegisterableUser also enforces the completed profile
 * that the profile-completion flow captures consent through), so the
 * registration that materialises here is theirs, created by them.
 *
 * TODO(consent): consent-service.recordAcceptance now exists (it is what
 * profile completion calls). Whether accepting a claim should ALSO write a
 * consent record for the terms in effect is a product decision not yet taken;
 * if it is, this is the exact attach point — immediately before the
 * Registration row is created. The flow deliberately does not gate on it.
 */
async function acceptContingentClaimInternal(claimId, attendeeUserId, context = {}) {
  const claim = await ContingentClaimModel.findById(claimId);
  if (!claim) {
    throw new ApplicationError(404, ERROR_CODES.CONTINGENT_CLAIM_NOT_FOUND, "Claim not found.");
  }
  await expireLapsedContingentClaims(claim.festId);
  const freshClaim = await ContingentClaimModel.findById(claimId);

  if (freshClaim.claimStatus !== CONTINGENT_CLAIM_STATUSES.INVITED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_CLAIM_NOT_ACCEPTABLE,
      "This claim can no longer be accepted.",
      { reason: `claim is ${freshClaim.claimStatus}` }
    );
  }
  if (freshClaim.paymentStatus !== PAYMENT_STATUSES.COMPLETED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_CLAIM_NOT_ACCEPTABLE,
      "The purchase behind this claim has not been paid.",
      { reason: "payment not completed" }
    );
  }

  /*
   * If the sub-event was cancelled by an admin since purchase (only possible by
   * unwinding the contingent, but defence in depth), or the fest closed, the
   * attendee gets a clear refusal — the UI then offers DECLINE, which returns
   * the seat (the accept/decline pair the prompt's F section names).
   */
  const event = await EventModel.findById(freshClaim.eventId);
  if (!event || event.status !== EVENT_STATUSES.PUBLISHED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_CLAIM_NOT_ACCEPTABLE,
      "This event is no longer running. You can decline the claim instead.",
      { reason: "event not published" }
    );
  }

  // Blocked accounts and incomplete profiles are refused here — the client
  // routes an incomplete profile through /profile-completion first.
  await loadRegisterableUser(attendeeUserId);

  /*
   * The seat was claimed at PURCHASE time and travels with the claim, so the
   * Registration row is created WITHOUT claiming a second seat. The attendee
   * pays nothing (the buyer paid the bundle): paymentStatus notRequired,
   * totalFeePaise 0. The buyer's money lives on the PaymentOrder, not here.
   */
  let registration;
  try {
    registration = await RegistrationModel.create({
      eventId: freshClaim.eventId,
      userId: attendeeUserId,
      teamId: null,
      status: REGISTRATION_STATUSES.CONFIRMED,
      feeAmountSnapshotPaise: event.feeAmountPaise,
      paymentStatus: PAYMENT_STATUSES.NOT_REQUIRED,
      totalFeePaise: 0,
      feeBreakdown: [],
      contingentClaimId: freshClaim._id,
      registeredAt: new Date(),
    });
  } catch (error) {
    if (error?.code === DUPLICATE_KEY_ERROR_CODE) {
      // The attendee registered individually between purchase and accept. The
      // purchase-time conflict check caught the reverse ordering; this one is
      // theirs to resolve (decline the claim, or cancel their individual seat).
      throw new ApplicationError(
        409,
        ERROR_CODES.INDIVIDUAL_REGISTRATION_EXISTS,
        "You are already registered for this event. Decline this claim or cancel your individual registration first.",
        { eventId: String(freshClaim.eventId) }
      );
    }
    throw error;
  }

  freshClaim.claimStatus = CONTINGENT_CLAIM_STATUSES.ACCEPTED;
  freshClaim.acceptedAt = new Date();
  freshClaim.registrationId = registration._id;
  await freshClaim.save();

  // The same side effects a confirmed seat earns anywhere else.
  await ensurePassAndEventEntitlement(attendeeUserId, freshClaim.festId, freshClaim.eventId);
  awardBadgesInBackground(attendeeUserId);

  await recordAuditLog({
    actorUserId: attendeeUserId,
    festId: freshClaim.festId,
    action: AUDIT_ACTIONS.CONTINGENT_CLAIM_ACCEPTED,
    entityType: AUDIT_ENTITY_TYPES.CONTINGENT_CLAIM,
    entityId: freshClaim._id,
    afterState: {
      buyerUserId: String(freshClaim.buyerUserId),
      attendeeUserId: String(attendeeUserId),
      contingentId: String(freshClaim.contingentId),
      eventId: String(freshClaim.eventId),
      registrationId: String(registration._id),
    },
    ...context,
  });

  return { claim: freshClaim.toJSON(), registration: registration.toJSON() };
}

async function acceptContingentClaim(userId, claimId, context = {}) {
  await loadOwnClaimOrThrow(userId, claimId);
  return acceptContingentClaimInternal(claimId, userId, context);
}

/*
 * F — decline. The seat goes back; the money does NOT.
 *
 * BUSINESS RULE, shipped default, to be revisited with the client: declining a
 * spot the buyer paid for does not refund the buyer. The buyer bought the
 * bundle; reassigning the seat means cancelling the purchase and buying again.
 * Whether a partial refund (or a buyer-side "replace attendee") should exist is
 * a commercial question the platform cannot answer — confirm with the client.
 */
async function declineContingentClaim(userId, claimId, context = {}) {
  const claim = await loadOwnClaimOrThrow(userId, claimId);
  if (claim.claimStatus !== CONTINGENT_CLAIM_STATUSES.INVITED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_CLAIM_NOT_ACCEPTABLE,
      "Only a pending invitation can be declined.",
      { reason: `claim is ${claim.claimStatus}` }
    );
  }
  claim.claimStatus = CONTINGENT_CLAIM_STATUSES.DECLINED;
  claim.declinedAt = new Date();
  await claim.save();

  const event = await EventModel.findById(claim.eventId);
  if (event) {
    await releaseTeamSeats(event, 1);
  }

  await recordAuditLog({
    actorUserId: userId,
    festId: claim.festId,
    action: AUDIT_ACTIONS.CONTINGENT_CLAIM_DECLINED,
    entityType: AUDIT_ENTITY_TYPES.CONTINGENT_CLAIM,
    entityId: claim._id,
    afterState: {
      buyerUserId: String(claim.buyerUserId),
      contingentId: String(claim.contingentId),
      eventId: String(claim.eventId),
    },
    ...context,
  });

  return claim.toJSON();
}

module.exports = {
  listMyContingentClaims,
  listMyContingentPurchases,
  acceptContingentClaim,
  acceptContingentClaimInternal,
  declineContingentClaim,
  expireLapsedContingentClaims,
};

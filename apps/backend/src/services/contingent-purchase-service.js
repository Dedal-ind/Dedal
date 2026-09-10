const { ContingentModel } = require("../models/contingent-model");
const { ContingentClaimModel } = require("../models/contingent-claim-model");
const { EventModel } = require("../models/event-model");
const { FestModel } = require("../models/fest-model");
const { RegistrationModel } = require("../models/registration-model");
const { ScanModel } = require("../models/scan-model");
const { PassModel } = require("../models/pass-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const {
  PaymentOrderModel,
  PAYMENT_ORDER_STATUSES,
  PAYMENT_ORDER_PURPOSE_TYPES,
} = require("../models/payment-order-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { applicationConfig } = require("../config/application-config");
const { createRazorpayOrder } = require("./razorpay-client");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { findOrCreateUserByEmailAddress } = require("../helpers/staff-assignment-helpers");
const { loadRegisterableUser, assertCallerIsNotAdministrator } = require("../helpers/registration-guards");
const { claimSoloSeat, releaseTeamSeats } = require("../helpers/registration-seat-helpers");
const {
  generatePaymentGroupId,
  releaseExpiredPendingPaymentSeats,
} = require("../helpers/registration-payment-helpers");
const { revokeEventEntitlementOnCancel } = require("./pass-service");
const {
  REGISTRATION_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_EXPIRY_MINUTES,
  ACTIVE_REGISTRATION_STATUSES,
  CANCELLED_BY_ROLES,
} = require("../constants/registration-constants");
const { SCAN_RESULTS } = require("../constants/scan-constants");
const {
  CONTINGENT_STATUSES,
  CONTINGENT_CLAIM_STATUSES,
  SEAT_HOLDING_CLAIM_STATUSES,
} = require("../constants/contingent-constants");
const {
  sendContingentInviteEmails,
  sendContingentCancelledEmails,
} = require("./contingent-invite-service");

const MILLISECONDS_PER_MINUTE = 60 * 1000;

/*
 * Same amount composition as a registration order: the bundle price plus the
 * platform fee and any GST on it. registrationFeePaise carries the bundle price
 * (contingent.pricePaise) — NEVER event.feeAmountPaise × N; the discount is the
 * whole point of the bundle.
 */
function computeContingentOrderAmounts(pricePaise) {
  const platformFeePaise = applicationConfig.platformFeePaise;
  const gstAmountPaise = applicationConfig.gstOnPlatformFeeEnabled
    ? Math.round((platformFeePaise * applicationConfig.gstRatePercent) / 100)
    : 0;
  return {
    registrationFeePaise: pricePaise,
    platformFeePaise,
    gstAmountPaise,
    totalAmountPaise: pricePaise + platformFeePaise + gstAmountPaise,
  };
}

/*
 * The bundle-count analogue of claimSoloSeat: a single conditional $inc, so two
 * buyers racing for the last bundle cannot both read "one left" and both write.
 * Uncapped (null) claims nothing and releases nothing — the same symmetry rule
 * registration-seat-helpers documents.
 */
async function claimBundleSlot(contingent) {
  if (contingent.maximumBundleClaims === null) {
    return true;
  }
  const updated = await ContingentModel.findOneAndUpdate(
    {
      _id: contingent._id,
      $expr: {
        $and: [
          { $ne: ["$maximumBundleClaims", null] },
          { $lt: ["$soldBundleCount", "$maximumBundleClaims"] },
        ],
      },
    },
    { $inc: { soldBundleCount: 1 } },
    { new: true }
  );
  return Boolean(updated);
}

async function releaseBundleSlot(contingent) {
  if (contingent.maximumBundleClaims === null) {
    return;
  }
  await ContingentModel.updateOne({ _id: contingent._id }, { $inc: { soldBundleCount: -1 } });
}

/*
 * Lazy purchase-hold expiry, the contingent mirror of
 * releaseExpiredPendingPaymentSeats: a purchase whose payment never captured
 * frees its seats (and its bundle slot) before the next buyer is evaluated,
 * without a cron job.
 */
async function releaseExpiredContingentPurchaseHolds(contingent) {
  const cutoff = new Date(Date.now() - PAYMENT_EXPIRY_MINUTES * MILLISECONDS_PER_MINUTE);
  const expiredClaims = await ContingentClaimModel.find({
    contingentId: contingent._id,
    paymentStatus: PAYMENT_STATUSES.PENDING,
    createdAt: { $lt: cutoff },
  });
  if (expiredClaims.length === 0) {
    return;
  }
  await ContingentClaimModel.updateMany(
    { _id: { $in: expiredClaims.map((claim) => claim._id) } },
    {
      $set: {
        claimStatus: CONTINGENT_CLAIM_STATUSES.CANCELLED,
        paymentStatus: PAYMENT_STATUSES.EXPIRED,
        cancelledAt: new Date(),
      },
    }
  );
  await releaseClaimSeats(expiredClaims);
  // One bundle slot per purchase group, not per claim.
  const expiredGroupCount = new Set(
    expiredClaims.map((claim) => claim.contingentPurchaseGroupId)
  ).size;
  for (let slotIndex = 0; slotIndex < expiredGroupCount; slotIndex += 1) {
    await releaseBundleSlot(contingent);
  }
}

/* Gives back one seat per claim, grouped per event so capped events get one
 * releaseTeamSeats call each (a no-op on uncapped events, by that helper's rule). */
async function releaseClaimSeats(claims) {
  const seatCountByEventId = new Map();
  for (const claim of claims) {
    const eventKey = String(claim.eventId);
    seatCountByEventId.set(eventKey, (seatCountByEventId.get(eventKey) ?? 0) + 1);
  }
  for (const [eventId, seatCount] of seatCountByEventId) {
    const event = await EventModel.findById(eventId);
    if (event) {
      await releaseTeamSeats(event, seatCount);
    }
  }
}

/*
 * E.3 — the pre-flight conflict pass, before any seat is touched. For each
 * (attendee × sub-event):
 *   · an active OR pending-payment individual registration blocks the whole
 *     purchase (INDIVIDUAL_REGISTRATION_EXISTS naming the event) — the buyer
 *     removes that attendee, or the attendee cancels their own seat first;
 *   · a live invited/accepted claim blocks it too (CONTINGENT_CLAIM_EXISTS) —
 *     two purchases must not hold two seats for one person in one event.
 * Cross-college attendees are deliberately NOT blocked (edge case I.4): a
 * contingent may span colleges; the fest's own visibility rules still apply at
 * accept time via the ordinary registration guards.
 */
async function assertNoConflictingSeats(attendeeRows, eventNameById) {
  for (const row of attendeeRows) {
    const existingRegistration = await RegistrationModel.findOne({
      eventId: row.eventId,
      userId: row.attendeeUserId,
      status: { $in: [...ACTIVE_REGISTRATION_STATUSES, REGISTRATION_STATUSES.PENDING_PAYMENT] },
    })
      .select("_id")
      .lean();
    if (existingRegistration) {
      throw new ApplicationError(
        409,
        ERROR_CODES.INDIVIDUAL_REGISTRATION_EXISTS,
        `${row.attendeeEmailAddress} is already registered individually for ${eventNameById.get(String(row.eventId))}.`,
        {
          attendeeEmailAddress: row.attendeeEmailAddress,
          eventId: String(row.eventId),
          eventName: eventNameById.get(String(row.eventId)),
        }
      );
    }
    const existingClaim = await ContingentClaimModel.findOne({
      eventId: row.eventId,
      attendeeUserId: row.attendeeUserId,
      claimStatus: { $in: SEAT_HOLDING_CLAIM_STATUSES },
    })
      .select("_id")
      .lean();
    if (existingClaim) {
      throw new ApplicationError(
        409,
        ERROR_CODES.CONTINGENT_CLAIM_EXISTS,
        `${row.attendeeEmailAddress} already has a contingent claim for ${eventNameById.get(String(row.eventId))}.`,
        {
          attendeeEmailAddress: row.attendeeEmailAddress,
          eventId: String(row.eventId),
          eventName: eventNameById.get(String(row.eventId)),
        }
      );
    }
  }
}

/*
 * E — the buyer's purchase. Creates the INVITED claims and the Razorpay order;
 * the invites themselves fire on payment capture (confirmContingentPurchase),
 * never before — an email about an unpaid purchase would invite people to a
 * bundle that may evaporate in thirty minutes.
 */
async function purchaseContingent(buyerUserId, festId, contingentId, attendees, context = {}) {
  await assertCallerIsNotAdministrator(buyerUserId);
  const buyer = await loadRegisterableUser(buyerUserId);
  const fest = await FestModel.findById(festId);
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  const contingent = await ContingentModel.findOne({ _id: contingentId, festId: fest._id });
  if (!contingent) {
    throw new ApplicationError(404, ERROR_CODES.CONTINGENT_NOT_FOUND, "Contingent not found.");
  }
  if (contingent.status !== CONTINGENT_STATUSES.PUBLISHED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_NOT_PURCHASABLE,
      "This contingent is not open for purchase.",
      { status: contingent.status }
    );
  }

  // Free any lapsed unpaid holds first, so their seats and bundle slots are
  // available to this buyer.
  await releaseExpiredContingentPurchaseHolds(contingent);

  // Exactly one attendee row per included sub-event, no more, no less.
  const includedIds = contingent.includedEventIds.map(String).sort();
  const submittedIds = attendees.map((row) => row.eventId).sort();
  if (JSON.stringify(includedIds) !== JSON.stringify(submittedIds)) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "Provide exactly one attendee per included sub-event.",
      { includedEventIds: includedIds }
    );
  }

  const includedEvents = await EventModel.find({ _id: { $in: contingent.includedEventIds } });
  const eventById = new Map(includedEvents.map((event) => [String(event._id), event]));
  const eventNameById = new Map(
    includedEvents.map((event) => [String(event._id), event.eventName])
  );

  /*
   * Attendee onboarding reuses the ONE placeholder-user path the staff
   * assignment flow established (findOrCreateUserByEmailAddress) — deliberately
   * not a second onboarding implementation. A created user carries only the
   * address; everything else waits for their own sign-in (the DPDP shape).
   */
  const attendeeRows = [];
  for (const row of attendees) {
    const { user } = await findOrCreateUserByEmailAddress(row.emailAddress);
    attendeeRows.push({
      ...row,
      attendeeUserId: user._id,
      attendeeEmailAddress: row.emailAddress,
    });
  }
  await assertNoConflictingSeats(attendeeRows, eventNameById);

  // Lapsed individual pending-payment holds on each sub-event free their seats
  // before the all-or-nothing claim below, same as the solo path does.
  for (const event of includedEvents) {
    await releaseExpiredPendingPaymentSeats(event);
  }

  // The bundle cap is claimed before any seat: losing it is the cheap failure.
  const gotBundleSlot = await claimBundleSlot(contingent);
  if (!gotBundleSlot) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_SOLD_OUT,
      "This contingent is sold out.",
      { maximumBundleClaims: contingent.maximumBundleClaims }
    );
  }

  /*
   * A — ALL-OR-NOTHING seat claim at purchase time. Each attendee row claims one
   * seat in its sub-event; the first failure compensates every seat already
   * taken and fails the whole purchase naming the full event. A WAITLISTED
   * outcome counts as unavailable here — a bundle where one attendee is only
   * waitlisted is bundle-and-hope, which is worse than a clean rejection.
   * The near-miss is logged for capacity planning (edge case I.5).
   */
  const claimedSeatRows = [];
  const contingentPurchaseGroupId = generatePaymentGroupId();
  let createdClaims = [];
  let paymentOrderRow = null;
  try {
    for (const row of attendeeRows) {
      const event = eventById.get(String(row.eventId));
      let claimResult;
      try {
        claimResult = await claimSoloSeat(event);
      } catch (error) {
        if (error?.errorCode === ERROR_CODES.EVENT_FULL) {
          claimResult = null;
        } else {
          throw error;
        }
      }
      if (!claimResult || claimResult.status !== REGISTRATION_STATUSES.CONFIRMED) {
        console.warn(
          `Contingent near-miss: ${contingent.contingentName} purchase failed on ${event.eventName} at capacity ${event.capacity}.`
        );
        throw new ApplicationError(
          409,
          ERROR_CODES.CONTINGENT_SEAT_UNAVAILABLE,
          `${event.eventName} has no seat left, so the contingent cannot be purchased.`,
          { eventId: String(event._id), eventName: event.eventName }
        );
      }
      claimedSeatRows.push(row);
    }

    createdClaims = await ContingentClaimModel.insertMany(
      attendeeRows.map((row) => ({
        contingentId: contingent._id,
        festId: fest._id,
        eventId: row.eventId,
        contingentPurchaseGroupId,
        buyerUserId,
        attendeeUserId: row.attendeeUserId,
        attendeeEmailAddress: row.attendeeEmailAddress,
        attendeeFullName: row.fullName,
        attendeePhoneNumber: row.phoneNumber,
        claimStatus: CONTINGENT_CLAIM_STATUSES.INVITED,
        paymentStatus: PAYMENT_STATUSES.PENDING,
        invitedAt: new Date(),
      }))
    );

    const amounts = computeContingentOrderAmounts(contingent.pricePaise);
    const { razorpayOrderId } = await createRazorpayOrder({
      amountPaise: amounts.totalAmountPaise,
      receipt: contingentPurchaseGroupId,
    });
    paymentOrderRow = await PaymentOrderModel.create({
      paymentGroupId: contingentPurchaseGroupId,
      purposeType: PAYMENT_ORDER_PURPOSE_TYPES.CONTINGENT,
      razorpayOrderId,
      ...amounts,
      status: PAYMENT_ORDER_STATUSES.CREATED,
      createdByUserId: buyerUserId,
    });
  } catch (error) {
    // Compensate in reverse: claims, seats, bundle slot. Only seats actually
    // claimed are released — a failure on attendee 3 releases attendees 1–2.
    if (createdClaims.length > 0) {
      await ContingentClaimModel.deleteMany({
        _id: { $in: createdClaims.map((claim) => claim._id) },
      });
    }
    await releaseClaimSeats(claimedSeatRows);
    await releaseBundleSlot(contingent);
    throw error;
  }

  await recordAuditLog({
    actorUserId: buyerUserId,
    festId: fest._id,
    action: AUDIT_ACTIONS.CONTINGENT_PURCHASED,
    entityType: AUDIT_ENTITY_TYPES.CONTINGENT,
    entityId: contingent._id,
    afterState: {
      contingentPurchaseGroupId,
      claimCount: createdClaims.length,
      pricePaise: contingent.pricePaise,
      buyerEmailAddress: buyer.emailAddress,
    },
    ...context,
  });

  return {
    contingentPurchaseGroupId,
    razorpayOrderId: paymentOrderRow.razorpayOrderId,
    razorpayKeyId: applicationConfig.razorpayKeyId,
    amountPaise: paymentOrderRow.totalAmountPaise,
  };
}

/*
 * Payment captured for a contingent purchase (checkout callback or webhook —
 * razorpay-service branches here on the order's purposeType). Flips the claims
 * to paid, auto-accepts the buyer's own rows, and fires the invite emails.
 * Deliberately does NOT flip other attendees' claims to ACCEPTED: acceptance is
 * each attendee's own act, with their own consent, on their own account.
 */
async function confirmContingentPurchase(contingentPurchaseGroupId, paymentReference) {
  const pendingClaims = await ContingentClaimModel.find({
    contingentPurchaseGroupId,
    paymentStatus: PAYMENT_STATUSES.PENDING,
  });
  if (pendingClaims.length === 0) {
    /*
     * The same capture-after-expiry race the registration path handles: the
     * 30-minute hold lapsed, the seats went back, and only then did the money
     * land. The seats are NOT resurrected; the refund trail is the deliverable.
     */
    const expiredClaims = await ContingentClaimModel.find({
      contingentPurchaseGroupId,
      paymentStatus: PAYMENT_STATUSES.EXPIRED,
    }).lean();
    if (expiredClaims.length > 0) {
      await recordAuditLog({
        actorUserId: expiredClaims[0].buyerUserId,
        festId: expiredClaims[0].festId,
        action: AUDIT_ACTIONS.PAYMENT_CAPTURED_AFTER_EXPIRY,
        entityType: AUDIT_ENTITY_TYPES.CONTINGENT_CLAIM,
        entityId: expiredClaims[0]._id,
        afterState: {
          contingentPurchaseGroupId,
          paymentReference: paymentReference || null,
          expiredCount: expiredClaims.length,
        },
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

  await ContingentClaimModel.updateMany(
    { contingentPurchaseGroupId, paymentStatus: PAYMENT_STATUSES.PENDING },
    { $set: { paymentStatus: PAYMENT_STATUSES.COMPLETED } }
  );

  /*
   * Edge case I.1 — the buyer named themselves as an attendee. They are signed
   * in, they accepted the terms as the paying user, so their claims auto-accept
   * now; no invite email for those slots. Everyone else gets invited.
   */
  const { acceptContingentClaimInternal } = require("./contingent-claim-service");
  for (const claim of pendingClaims) {
    if (String(claim.attendeeUserId) === String(claim.buyerUserId)) {
      try {
        await acceptContingentClaimInternal(claim._id, claim.buyerUserId, {});
      } catch (error) {
        // A self-claim the buyer cannot hold (e.g. their profile regressed) must
        // not fail the whole capture — the claim stays INVITED for them to
        // accept from /my-registrations like any attendee.
        console.error(`Contingent self-accept failed for claim ${claim._id}: ${error.message}`);
      }
    }
  }

  /*
   * Vertical codes are minted HERE, at capture, and never at purchase: a code
   * for an unpaid bundle would summon people to seats that vanish when the
   * 30-minute hold lapses. Failure to mint must not fail the capture — the money
   * has landed and the claims are real; the buyer can re-read their codes from
   * the purchase endpoint, which regenerates any that are missing.
   */
  try {
    const {
      generateVerticalCodesForPurchase,
    } = require("./contingent-vertical-code-service");
    await generateVerticalCodesForPurchase(contingentPurchaseGroupId);
  } catch (error) {
    console.error(
      `Vertical code generation failed for purchase ${contingentPurchaseGroupId}: ${error.message}`
    );
  }

  await sendContingentInviteEmails(contingentPurchaseGroupId);
  return { confirmedCount: pendingClaims.length };
}

/* True when any claim in the list has an accepted scan at any checkpoint of its
 * sub-event — the signal that cancellation money-back is no longer clean. */
async function anyClaimHasAcceptedScan(claims) {
  const acceptedClaims = claims.filter(
    (claim) => claim.claimStatus === CONTINGENT_CLAIM_STATUSES.ACCEPTED && claim.attendeeUserId
  );
  if (acceptedClaims.length === 0) {
    return false;
  }
  const eventIds = [...new Set(acceptedClaims.map((claim) => String(claim.eventId)))];
  const checkpointIds = await CheckpointModel.find({ eventId: { $in: eventIds } }).distinct("_id");
  if (checkpointIds.length === 0) {
    return false;
  }
  const attendeePassIds = await PassModel.find({
    userId: { $in: acceptedClaims.map((claim) => claim.attendeeUserId) },
    festId: claims[0].festId,
  }).distinct("_id");
  if (attendeePassIds.length === 0) {
    return false;
  }
  const acceptedScan = await ScanModel.findOne({
    checkpointId: { $in: checkpointIds },
    passId: { $in: attendeePassIds },
    result: SCAN_RESULTS.ACCEPTED,
  })
    .select("_id")
    .lean();
  return Boolean(acceptedScan);
}

/*
 * The shared unwind for one purchase: claims → CANCELLED, registrations of
 * accepted claims → cancelled (entitlement revoked), every held seat and the
 * bundle slot released, the captured order → refundPending with its audit row.
 * The actual refund is out of band on the Razorpay dashboard — the platform has
 * no refund API (checked: razorpay-client only creates orders).
 */
async function unwindPurchase(contingent, claims, actorUserId, cancelledByRole, context = {}) {
  const seatHoldingClaims = claims.filter((claim) =>
    SEAT_HOLDING_CLAIM_STATUSES.includes(claim.claimStatus)
  );

  for (const claim of seatHoldingClaims) {
    if (claim.claimStatus === CONTINGENT_CLAIM_STATUSES.ACCEPTED && claim.registrationId) {
      await RegistrationModel.updateOne(
        { _id: claim.registrationId },
        {
          $set: {
            status: REGISTRATION_STATUSES.CANCELLED,
            cancelledAt: new Date(),
            cancelledByRole,
            cancelledByUserId: actorUserId,
            cancellationReason: "Contingent purchase cancelled.",
          },
        }
      );
      await revokeEventEntitlementOnCancel(claim.attendeeUserId, claim.festId, claim.eventId);
    }
  }

  await ContingentClaimModel.updateMany(
    { _id: { $in: seatHoldingClaims.map((claim) => claim._id) } },
    { $set: { claimStatus: CONTINGENT_CLAIM_STATUSES.CANCELLED, cancelledAt: new Date() } }
  );
  await releaseClaimSeats(seatHoldingClaims);
  await releaseBundleSlot(contingent);

  const groupId = claims[0].contingentPurchaseGroupId;
  const order = await PaymentOrderModel.findOne({ paymentGroupId: groupId });
  if (order && order.status === PAYMENT_ORDER_STATUSES.CAPTURED) {
    order.status = PAYMENT_ORDER_STATUSES.REFUND_PENDING;
    await order.save();
    await recordAuditLog({
      actorUserId,
      festId: claims[0].festId,
      action: AUDIT_ACTIONS.PAYMENT_REFUND_PENDING,
      entityType: AUDIT_ENTITY_TYPES.CONTINGENT,
      entityId: contingent._id,
      afterState: {
        contingentPurchaseGroupId: groupId,
        amountPaise: order.totalAmountPaise,
        razorpayPaymentId: order.razorpayPaymentId,
      },
      ...context,
    });
  }

  await recordAuditLog({
    actorUserId,
    festId: claims[0].festId,
    action: AUDIT_ACTIONS.CONTINGENT_PURCHASE_CANCELLED,
    entityType: AUDIT_ENTITY_TYPES.CONTINGENT,
    entityId: contingent._id,
    afterState: { contingentPurchaseGroupId: groupId, cancelledClaimCount: seatHoldingClaims.length },
    ...context,
  });
}

/*
 * H — the buyer cancels their whole purchase. All-or-nothing, and only while no
 * attendee has an accepted scan: once someone is inside, unwinding the money is
 * an out-of-band conversation, not a button.
 */
async function cancelContingentPurchase(buyerUserId, contingentPurchaseGroupId, context = {}) {
  const claims = await ContingentClaimModel.find({ contingentPurchaseGroupId });
  if (claims.length === 0 || String(claims[0].buyerUserId) !== String(buyerUserId)) {
    // Someone else's purchase and a nonexistent group are the same 403, so the
    // endpoint cannot probe which group ids exist.
    throw new ApplicationError(403, ERROR_CODES.PERMISSION_DENIED, "You cannot cancel this purchase.");
  }
  const liveClaims = claims.filter((claim) =>
    SEAT_HOLDING_CLAIM_STATUSES.includes(claim.claimStatus)
  );
  if (liveClaims.length === 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_CLAIM_NOT_FOUND,
      "There is nothing left to cancel in this purchase."
    );
  }
  if (await anyClaimHasAcceptedScan(claims)) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_CANCEL_BLOCKED_BY_SCANS,
      "An attendee has already scanned in, so this purchase can no longer be cancelled here. Contact the organisers.",
      { contingentPurchaseGroupId }
    );
  }
  const contingent = await ContingentModel.findById(claims[0].contingentId);
  await unwindPurchase(contingent, claims, buyerUserId, CANCELLED_BY_ROLES.SELF, context);
  return { cancelledClaimCount: liveClaims.length };
}

/*
 * H — organiser-initiated cancellation of the contingent itself. Every purchase
 * against it becomes refund-pending, seats go back, and every affected buyer is
 * emailed. Existing claims are kept (CANCELLED, not deleted) — a purchased
 * contingent is never removed, only cancelled (C.6).
 */
async function cancelContingent(actorUserId, festId, contingentId, context = {}) {
  const { assertAdministratorOfFest } = require("../helpers/assert-administrator-of-fest");
  await assertAdministratorOfFest(actorUserId, festId);
  const contingent = await ContingentModel.findOne({ _id: contingentId, festId });
  if (!contingent) {
    throw new ApplicationError(404, ERROR_CODES.CONTINGENT_NOT_FOUND, "Contingent not found.");
  }
  if (contingent.status === CONTINGENT_STATUSES.CANCELLED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_EVENT_STATE,
      "This contingent is already cancelled.",
      { currentStatus: contingent.status }
    );
  }

  const allClaims = await ContingentClaimModel.find({ contingentId: contingent._id });
  const groupIds = [...new Set(allClaims.map((claim) => claim.contingentPurchaseGroupId))];
  for (const groupId of groupIds) {
    const groupClaims = allClaims.filter(
      (claim) => claim.contingentPurchaseGroupId === groupId
    );
    if (groupClaims.some((claim) => SEAT_HOLDING_CLAIM_STATUSES.includes(claim.claimStatus))) {
      await unwindPurchase(contingent, groupClaims, actorUserId, CANCELLED_BY_ROLES.ADMIN, context);
    }
  }

  contingent.status = CONTINGENT_STATUSES.CANCELLED;
  await contingent.save();

  await recordAuditLog({
    actorUserId,
    festId: contingent.festId,
    action: AUDIT_ACTIONS.CONTINGENT_CANCELLED,
    entityType: AUDIT_ENTITY_TYPES.CONTINGENT,
    entityId: contingent._id,
    afterState: { status: contingent.status, unwoundPurchaseCount: groupIds.length },
    ...context,
  });

  await sendContingentCancelledEmails(contingent, allClaims);
  return contingent.toJSON();
}

module.exports = {
  purchaseContingent,
  confirmContingentPurchase,
  cancelContingentPurchase,
  cancelContingent,
  releaseExpiredContingentPurchaseHolds,
  computeContingentOrderAmounts,
  anyClaimHasAcceptedScan,
};

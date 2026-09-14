const mongoose = require("mongoose");

const { ContingentModel } = require("../models/contingent-model");
const {
  ContingentPurchaseModel,
  isContingentCodeFull,
  isContingentCodeExpired,
  resolveContingentCodeExpiresAt,
} = require("../models/contingent-purchase-model");
const { ContingentVerticalCodeModel } = require("../models/contingent-vertical-code-model");
const { TeamModel } = require("../models/team-model");
const { EventModel } = require("../models/event-model");
const { FestModel } = require("../models/fest-model");
const { UserModel } = require("../models/user-model");
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
const { generateInviteCode } = require("../helpers/generate-invite-code");
const { generatePaymentGroupId } = require("../helpers/registration-payment-helpers");
const {
  loadRegisterableUser,
  assertCallerIsNotAdministrator,
  REGISTERABLE_FEST_STATUSES,
} = require("../helpers/registration-guards");
const { EVENT_TYPES } = require("../constants/event-constants");
const { PAYMENT_EXPIRY_MINUTES } = require("../constants/registration-constants");
const {
  CONTINGENT_STATUSES,
  CONTINGENT_FLOW_TYPES,
  CONTINGENT_PURCHASE_STATUSES,
  resolveContingentFlowType,
} = require("../constants/contingent-constants");
const {
  computeContingentOrderAmounts,
  claimBundleSlot,
  releaseBundleSlot,
} = require("./contingent-purchase-service");

/*
 * CODE-DISTRIBUTION CONTINGENTS — THE BUYER'S SIDE.
 *
 * The buyer registers only themselves and pays for the bundle. What they get
 * back is one code per included event, and nothing else: no seat is held,
 * nobody is registered, and the buyer is not a participant. Seats are taken one
 * use at a time, by whoever redeems a code (see
 * contingent-code-redemption-service), under that event's ordinary capacity.
 *
 * The legacy claim-based purchase lives on in contingent-purchase-service and
 * is untouched; the two flows share only the bundle-slot counter and the order
 * amount formula, so a bundle cap and a platform fee mean the same thing in both.
 */

const MILLISECONDS_PER_MINUTE = 60 * 1000;
const CODE_GENERATION_ATTEMPTS = 5;
const DUPLICATE_KEY_ERROR_CODE = 11000;

const LIVE_PURCHASE_STATUSES = [
  CONTINGENT_PURCHASE_STATUSES.PENDING,
  CONTINGENT_PURCHASE_STATUSES.COMPLETED,
];

/*
 * How many people one code admits. A solo event is one person. A team event's
 * code is the team: everyone who redeems it joins the same team, so it admits
 * the event's maximum team size.
 */
function resolveCodeMaxUses(event) {
  return event.eventType === EVENT_TYPES.TEAM ? event.maximumTeamSize : 1;
}

/*
 * A participant types a bare code into one join box, so a string must not mean
 * two things anywhere it could be typed: team invite codes, legacy vertical
 * codes and these. Each collection's unique index is the real guarantee; this
 * pre-check just avoids burning a whole minting attempt on a visible collision.
 */
async function isCodeInUse(candidate) {
  const [teamHit, verticalCodeHit, purchaseHit] = await Promise.all([
    TeamModel.exists({ inviteCode: candidate }),
    ContingentVerticalCodeModel.exists({ inviteCode: candidate }),
    ContingentPurchaseModel.exists({ "codes.code": candidate }),
  ]);
  return Boolean(teamHit || verticalCodeHit || purchaseHit);
}

async function generateUnusedContingentCode(mintedInThisPurchase) {
  for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = generateInviteCode();
    if (!mintedInThisPurchase.has(candidate) && !(await isCodeInUse(candidate))) {
      return candidate;
    }
  }
  throw new ApplicationError(
    500,
    ERROR_CODES.INTERNAL_ERROR,
    "Could not generate a unique contingent code. Try again."
  );
}

async function loadContingentForCodePurchase(contingentId) {
  const contingent = mongoose.Types.ObjectId.isValid(contingentId)
    ? await ContingentModel.findById(contingentId)
    : null;
  if (!contingent) {
    throw new ApplicationError(404, ERROR_CODES.CONTINGENT_NOT_FOUND, "Contingent not found.");
  }
  if (resolveContingentFlowType(contingent) !== CONTINGENT_FLOW_TYPES.CODE_DISTRIBUTION) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_FLOW_MISMATCH,
      "This contingent names its attendees at checkout and cannot be bought as codes.",
      { flowType: resolveContingentFlowType(contingent) }
    );
  }
  if (contingent.status !== CONTINGENT_STATUSES.PUBLISHED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_NOT_PURCHASABLE,
      "This contingent is not open for purchase.",
      { status: contingent.status }
    );
  }
  return contingent;
}

/*
 * Lazy expiry, the no-cron pattern every hold in this codebase uses: an unpaid
 * purchase older than the payment window gives its bundle slot back before the
 * next buyer is evaluated. It never had codes, so nothing else unwinds.
 */
async function expireLapsedCodePurchases(contingent) {
  const cutoff = new Date(Date.now() - PAYMENT_EXPIRY_MINUTES * MILLISECONDS_PER_MINUTE);
  const lapsed = await ContingentPurchaseModel.find({
    contingentId: contingent._id,
    status: CONTINGENT_PURCHASE_STATUSES.PENDING,
    createdAt: { $lt: cutoff },
  })
    .select("_id buyerUserId festId")
    .lean();

  for (const row of lapsed) {
    // Conditional, so a capture landing mid-sweep wins and the slot is not freed twice.
    const expired = await ContingentPurchaseModel.findOneAndUpdate(
      { _id: row._id, status: CONTINGENT_PURCHASE_STATUSES.PENDING },
      { $set: { status: CONTINGENT_PURCHASE_STATUSES.EXPIRED } }
    );
    if (!expired) {
      continue;
    }
    await releaseBundleSlot(contingent);
    await recordAuditLog({
      actorUserId: row.buyerUserId,
      festId: row.festId,
      action: AUDIT_ACTIONS.CONTINGENT_CODE_PURCHASE_EXPIRED,
      entityType: AUDIT_ENTITY_TYPES.CONTINGENT_PURCHASE,
      entityId: row._id,
      afterState: { status: CONTINGENT_PURCHASE_STATUSES.EXPIRED },
    });
  }
}

/*
 * Pending → completed, with the codes minted in the same conditional write.
 *
 * The status filter is what makes this idempotent: the checkout callback and the
 * webhook can both arrive for one payment, and only the first flips the row. The
 * second finds nothing pending and gets the already-completed purchase back, so
 * the codes a buyer has already copied are never replaced.
 *
 * A duplicate-key failure means one of the freshly minted strings was taken by a
 * concurrent purchase between the pre-check and the write; the whole set is
 * re-minted, because a partial set would leave an event with no code.
 */
async function completeCodePurchase(purchaseId, paymentReference = null, context = {}) {
  const purchase = await ContingentPurchaseModel.findById(purchaseId);
  if (!purchase) {
    throw new ApplicationError(404, ERROR_CODES.CONTINGENT_NOT_FOUND, "Contingent purchase not found.");
  }
  if (purchase.status !== CONTINGENT_PURCHASE_STATUSES.PENDING) {
    return purchase;
  }

  const contingent = await ContingentModel.findById(purchase.contingentId)
    .select("includedEventIds")
    .lean();
  const events = await EventModel.find({ _id: { $in: contingent.includedEventIds } })
    .select("eventType maximumTeamSize")
    .lean();
  const eventById = new Map(events.map((event) => [String(event._id), event]));
  // The contingent's own order, so the buyer's list reads the way the admin built it.
  const orderedEvents = contingent.includedEventIds
    .map((eventId) => eventById.get(String(eventId)))
    .filter(Boolean);

  for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt += 1) {
    const minted = new Set();
    const codes = [];
    for (const event of orderedEvents) {
      const code = await generateUnusedContingentCode(minted);
      minted.add(code);
      codes.push({
        eventId: event._id,
        code,
        eventType: event.eventType,
        maxUses: resolveCodeMaxUses(event),
        claims: [],
      });
    }

    let completed;
    try {
      completed = await ContingentPurchaseModel.findOneAndUpdate(
        { _id: purchase._id, status: CONTINGENT_PURCHASE_STATUSES.PENDING },
        {
          $set: {
            status: CONTINGENT_PURCHASE_STATUSES.COMPLETED,
            codes,
            completedAt: new Date(),
          },
        },
        { new: true }
      );
    } catch (error) {
      if (error?.code === DUPLICATE_KEY_ERROR_CODE) {
        continue;
      }
      throw error;
    }

    if (!completed) {
      // Another capture completed it first, or it was cancelled meanwhile.
      return ContingentPurchaseModel.findById(purchase._id);
    }

    await recordAuditLog({
      actorUserId: completed.buyerUserId,
      festId: completed.festId,
      action: AUDIT_ACTIONS.CONTINGENT_CODES_ISSUED,
      entityType: AUDIT_ENTITY_TYPES.CONTINGENT_PURCHASE,
      entityId: completed._id,
      afterState: {
        contingentId: String(completed.contingentId),
        codeCount: completed.codes.length,
        totalUses: completed.codes.reduce((total, entry) => total + entry.maxUses, 0),
        paymentReference: paymentReference || null,
      },
      ...context,
    });
    return completed;
  }

  throw new ApplicationError(
    500,
    ERROR_CODES.INTERNAL_ERROR,
    "Could not generate unique contingent codes. Try again."
  );
}

/*
 * The buyer-facing shape, for one purchase or many, in a fixed number of
 * queries. Each code lists who has used it and whether it can still be used —
 * the buyer is the distributor and needs to know how far each code has gone.
 */
async function describePurchasesForBuyer(purchases) {
  if (purchases.length === 0) {
    return [];
  }
  const contingentIds = [...new Set(purchases.map((purchase) => String(purchase.contingentId)))];
  const festIds = [...new Set(purchases.map((purchase) => String(purchase.festId)))];
  const eventIds = [
    ...new Set(purchases.flatMap((purchase) => purchase.codes.map((entry) => String(entry.eventId)))),
  ];
  const claimantIds = [
    ...new Set(
      purchases.flatMap((purchase) =>
        purchase.codes.flatMap((entry) => (entry.claims ?? []).map((claim) => String(claim.userId)))
      )
    ),
  ];

  const [contingents, fests, events, claimants] = await Promise.all([
    ContingentModel.find({ _id: { $in: contingentIds } })
      .select("contingentName description status parentEventId")
      .lean(),
    FestModel.find({ _id: { $in: festIds } }).select("festName endsOn").lean(),
    eventIds.length > 0 ? EventModel.find({ _id: { $in: eventIds } }).select("eventName").lean() : [],
    claimantIds.length > 0
      ? UserModel.find({ _id: { $in: claimantIds } }).select("fullName").lean()
      : [],
  ]);
  const contingentById = new Map(contingents.map((row) => [String(row._id), row]));
  const festById = new Map(fests.map((row) => [String(row._id), row]));
  const eventById = new Map(events.map((row) => [String(row._id), row]));
  const claimantById = new Map(claimants.map((row) => [String(row._id), row]));

  return purchases.map((purchase) => {
    const contingent = contingentById.get(String(purchase.contingentId));
    const fest = festById.get(String(purchase.festId));
    const isExpired = isContingentCodeExpired(fest);
    const isOpen =
      purchase.status === CONTINGENT_PURCHASE_STATUSES.COMPLETED &&
      contingent?.status === CONTINGENT_STATUSES.PUBLISHED;
    const codes = purchase.codes.map((entry) => {
      const claims = (entry.claims ?? []).map((claim) => ({
        userId: String(claim.userId),
        fullName: claimantById.get(String(claim.userId))?.fullName ?? null,
        claimedAt: claim.claimedAt,
      }));
      const isFull = isContingentCodeFull(entry);
      return {
        code: entry.code,
        eventId: String(entry.eventId),
        eventName: eventById.get(String(entry.eventId))?.eventName ?? null,
        eventType: entry.eventType,
        maxUses: entry.maxUses,
        claimCount: claims.length,
        remainingUses: Math.max(0, entry.maxUses - claims.length),
        isFull,
        expiresAt: resolveContingentCodeExpiresAt(fest),
        isExpired,
        isRedeemable: isOpen && !isFull && !isExpired,
        claims,
      };
    });
    return {
      id: String(purchase._id),
      contingentId: String(purchase.contingentId),
      contingentName: contingent?.contingentName ?? null,
      festId: String(purchase.festId),
      festName: fest?.festName ?? null,
      codesExpireAt: resolveContingentCodeExpiresAt(fest),
      status: purchase.status,
      pricePaise: purchase.pricePaise,
      paymentGroupId: purchase.paymentGroupId ?? null,
      createdAt: purchase.createdAt,
      completedAt: purchase.completedAt ?? null,
      cancelledAt: purchase.cancelledAt ?? null,
      codeCount: codes.length,
      usedCodeCount: codes.filter((entry) => entry.claimCount > 0).length,
      fullCodeCount: codes.filter((entry) => entry.isFull).length,
      codes,
    };
  });
}

/*
 * POST /contingents/:contingentId/purchase.
 *
 * Free: the purchase completes inline and the codes come straight back.
 * Paid: the purchase is parked PENDING with its Razorpay order, and the codes
 * are minted when the capture lands (confirmCodePurchasePayment) — a code for an
 * unpaid bundle would hand out access that may never be paid for.
 */
async function purchaseContingentCodes(buyerUserId, contingentId, context = {}) {
  await assertCallerIsNotAdministrator(buyerUserId);
  const buyer = await loadRegisterableUser(buyerUserId);
  const contingent = await loadContingentForCodePurchase(contingentId);

  const fest = await FestModel.findById(contingent.festId).select("status festName endsOn").lean();
  if (!fest || !REGISTERABLE_FEST_STATUSES.includes(fest.status)) {
    throw new ApplicationError(
      409,
      ERROR_CODES.FEST_NOT_REGISTERABLE,
      "This fest is not open for registration.",
      { currentStatus: fest ? fest.status : null }
    );
  }
  // Selling codes that are expired the instant they are minted would take money for nothing.
  if (isContingentCodeExpired(fest)) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_NOT_PURCHASABLE,
      "This fest has ended, so its codes could never be used.",
      { festEndsOn: fest.endsOn }
    );
  }

  await expireLapsedCodePurchases(contingent);
  const gotBundleSlot = await claimBundleSlot(contingent);
  if (!gotBundleSlot) {
    throw new ApplicationError(409, ERROR_CODES.CONTINGENT_SOLD_OUT, "This contingent is sold out.", {
      maximumBundleClaims: contingent.maximumBundleClaims,
    });
  }

  const isPaid = contingent.pricePaise > 0;
  let purchase = null;
  let paymentOrder = null;
  try {
    purchase = await ContingentPurchaseModel.create({
      contingentId: contingent._id,
      festId: contingent.festId,
      buyerUserId,
      pricePaise: contingent.pricePaise,
      paymentGroupId: isPaid ? generatePaymentGroupId() : null,
      status: CONTINGENT_PURCHASE_STATUSES.PENDING,
    });
    if (isPaid) {
      const amounts = computeContingentOrderAmounts(contingent.pricePaise);
      const { razorpayOrderId } = await createRazorpayOrder({
        amountPaise: amounts.totalAmountPaise,
        receipt: purchase.paymentGroupId,
      });
      paymentOrder = await PaymentOrderModel.create({
        paymentGroupId: purchase.paymentGroupId,
        purposeType: PAYMENT_ORDER_PURPOSE_TYPES.CONTINGENT_CODES,
        razorpayOrderId,
        ...amounts,
        status: PAYMENT_ORDER_STATUSES.CREATED,
        createdByUserId: buyerUserId,
      });
      purchase.paymentOrderId = paymentOrder._id;
      await purchase.save();
    }
  } catch (error) {
    // Nothing may survive a failed checkout: no orphan purchase, no held slot.
    if (purchase) {
      await ContingentPurchaseModel.deleteOne({ _id: purchase._id }).catch(() => {});
    }
    await releaseBundleSlot(contingent);
    throw error;
  }

  await recordAuditLog({
    actorUserId: buyerUserId,
    festId: contingent.festId,
    action: AUDIT_ACTIONS.CONTINGENT_CODES_PURCHASED,
    entityType: AUDIT_ENTITY_TYPES.CONTINGENT_PURCHASE,
    entityId: purchase._id,
    afterState: {
      contingentId: String(contingent._id),
      pricePaise: contingent.pricePaise,
      isPaid,
      buyerEmailAddress: buyer.emailAddress,
    },
    ...context,
  });

  if (!isPaid) {
    const completed = await completeCodePurchase(purchase._id, null, context);
    const [described] = await describePurchasesForBuyer([completed.toObject()]);
    return { purchase: described, payment: null };
  }

  const [described] = await describePurchasesForBuyer([purchase.toObject()]);
  return {
    purchase: described,
    payment: {
      paymentGroupId: purchase.paymentGroupId,
      razorpayOrderId: paymentOrder.razorpayOrderId,
      razorpayKeyId: applicationConfig.razorpayKeyId,
      amountPaise: paymentOrder.totalAmountPaise,
    },
  };
}

/*
 * The capture dispatch for a CONTINGENT_CODES order (razorpay-service). A
 * capture for a purchase that is no longer pending is the same refund case the
 * registration path handles: the money landed after the hold lapsed, nothing is
 * resurrected, and the audit row is the operator's refund trail.
 */
async function confirmCodePurchasePayment(paymentGroupId, paymentReference = null) {
  const purchase = await ContingentPurchaseModel.findOne({ paymentGroupId });
  if (!purchase) {
    throw new ApplicationError(
      404,
      ERROR_CODES.PAYMENT_GROUP_NOT_FOUND,
      "No pending payment was found for that group."
    );
  }
  if (purchase.status === CONTINGENT_PURCHASE_STATUSES.COMPLETED) {
    return { alreadyConfirmed: true, contingentPurchaseId: String(purchase._id) };
  }
  if (purchase.status !== CONTINGENT_PURCHASE_STATUSES.PENDING) {
    await recordAuditLog({
      actorUserId: purchase.buyerUserId,
      festId: purchase.festId,
      action: AUDIT_ACTIONS.PAYMENT_CAPTURED_AFTER_EXPIRY,
      entityType: AUDIT_ENTITY_TYPES.CONTINGENT_PURCHASE,
      entityId: purchase._id,
      afterState: {
        paymentGroupId,
        paymentReference: paymentReference || null,
        purchaseStatus: purchase.status,
      },
    });
    throw new ApplicationError(
      409,
      ERROR_CODES.PAYMENT_CAPTURED_AFTER_EXPIRY,
      "This payment was captured after the purchase had closed. The amount will be refunded — you have not lost your money."
    );
  }

  const completed = await completeCodePurchase(purchase._id, paymentReference);
  return {
    alreadyConfirmed: false,
    contingentPurchaseId: String(completed._id),
    codeCount: completed.codes.length,
  };
}

/*
 * An organiser cancelling a purchase. Every use not yet taken dies with it — the
 * redemption guard requires a completed purchase, so a half-filled team code
 * stops admitting people too. Uses already taken are registrations their
 * holders made themselves, and they are left standing; whether to cancel those
 * is an organiser's call per person, not a side effect of refunding the buyer.
 */
async function cancelCodePurchase(purchase, contingent, actorUserId, context = {}) {
  const cancelled = await ContingentPurchaseModel.findOneAndUpdate(
    { _id: purchase._id, status: { $in: LIVE_PURCHASE_STATUSES } },
    { $set: { status: CONTINGENT_PURCHASE_STATUSES.CANCELLED, cancelledAt: new Date() } },
    { new: true }
  );
  if (!cancelled) {
    return false;
  }
  await releaseBundleSlot(contingent);

  if (cancelled.paymentGroupId) {
    const order = await PaymentOrderModel.findOne({ paymentGroupId: cancelled.paymentGroupId });
    if (order && order.status === PAYMENT_ORDER_STATUSES.CAPTURED) {
      order.status = PAYMENT_ORDER_STATUSES.REFUND_PENDING;
      await order.save();
      await recordAuditLog({
        actorUserId,
        festId: cancelled.festId,
        action: AUDIT_ACTIONS.PAYMENT_REFUND_PENDING,
        entityType: AUDIT_ENTITY_TYPES.CONTINGENT_PURCHASE,
        entityId: cancelled._id,
        afterState: {
          paymentGroupId: cancelled.paymentGroupId,
          amountPaise: order.totalAmountPaise,
          razorpayPaymentId: order.razorpayPaymentId,
        },
        ...context,
      });
    }
  }

  const takenUseCount = cancelled.codes.reduce((total, entry) => total + entry.claims.length, 0);
  const totalUseCount = cancelled.codes.reduce((total, entry) => total + entry.maxUses, 0);
  await recordAuditLog({
    actorUserId,
    festId: cancelled.festId,
    action: AUDIT_ACTIONS.CONTINGENT_CODE_PURCHASE_CANCELLED,
    entityType: AUDIT_ENTITY_TYPES.CONTINGENT_PURCHASE,
    entityId: cancelled._id,
    beforeState: { status: purchase.status },
    afterState: {
      status: cancelled.status,
      invalidatedUseCount: totalUseCount - takenUseCount,
      takenUseCount,
    },
    ...context,
  });
  return true;
}

/* Every live code purchase of one contingent — called when the contingent itself ends. */
async function cancelCodePurchasesForContingent(contingent, actorUserId, context = {}) {
  const purchases = await ContingentPurchaseModel.find({
    contingentId: contingent._id,
    status: { $in: LIVE_PURCHASE_STATUSES },
  });
  let cancelledCount = 0;
  for (const purchase of purchases) {
    if (await cancelCodePurchase(purchase, contingent, actorUserId, context)) {
      cancelledCount += 1;
    }
  }
  return { cancelledCount };
}

/* GET /contingents/codes/mine — the buyer's purchases and every code in them. */
async function listMyCodePurchases(buyerUserId) {
  const purchases = await ContingentPurchaseModel.find({ buyerUserId })
    .sort({ createdAt: -1 })
    .lean();
  return describePurchasesForBuyer(purchases);
}

/*
 * The payment-processing poll for a code purchase. Returns null when the group
 * is not a code purchase at all, so the caller falls through to the other
 * readers; a code purchase that is not the caller's is the same probe-proof 403
 * every other reader throws.
 */
async function readCodePurchaseStatus(userId, paymentGroupId) {
  const purchase = await ContingentPurchaseModel.findOne({ paymentGroupId }).lean();
  if (!purchase) {
    return null;
  }
  if (String(purchase.buyerUserId) !== String(userId)) {
    throw new ApplicationError(403, ERROR_CODES.PERMISSION_DENIED, "You cannot view this payment.");
  }
  const order = await PaymentOrderModel.findOne({ paymentGroupId }).lean();
  const paymentStatusByPurchaseStatus = {
    [CONTINGENT_PURCHASE_STATUSES.COMPLETED]: "completed",
    [CONTINGENT_PURCHASE_STATUSES.EXPIRED]: "expired",
  };
  return {
    paymentGroupId,
    purposeType: PAYMENT_ORDER_PURPOSE_TYPES.CONTINGENT_CODES,
    orderStatus: order ? order.status : null,
    registrationStatus: null,
    paymentStatus: paymentStatusByPurchaseStatus[purchase.status] ?? "pending",
    registrationId: null,
    contingentPurchaseId: String(purchase._id),
    totalAmountPaise: order ? order.totalAmountPaise : null,
    paymentReference: order?.razorpayPaymentId ?? null,
    expiresAt: new Date(
      new Date(purchase.createdAt).getTime() + PAYMENT_EXPIRY_MINUTES * MILLISECONDS_PER_MINUTE
    ),
  };
}

module.exports = {
  purchaseContingentCodes,
  completeCodePurchase,
  confirmCodePurchasePayment,
  expireLapsedCodePurchases,
  cancelCodePurchase,
  cancelCodePurchasesForContingent,
  listMyCodePurchases,
  readCodePurchaseStatus,
  describePurchasesForBuyer,
  resolveCodeMaxUses,
};

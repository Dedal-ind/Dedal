const { applicationConfig } = require("../config/application-config");
const {
  PaymentOrderModel,
  PAYMENT_ORDER_STATUSES,
  PAYMENT_ORDER_PURPOSE_TYPES,
} = require("../models/payment-order-model");
const { ContingentClaimModel } = require("../models/contingent-claim-model");
const { RegistrationModel } = require("../models/registration-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const {
  PAYMENT_STATUSES,
  PAYMENT_EXPIRY_MINUTES,
} = require("../constants/registration-constants");
const {
  isValidPaymentSignature,
  isValidWebhookSignature,
} = require("../helpers/razorpay-signature-helpers");
const { createRazorpayOrder } = require("./razorpay-client");
const { confirmPaymentGroup } = require("./registration/payment-confirmation-service");
const { confirmContingentPurchase } = require("./contingent-purchase-service");

/*
 * One confirmation dispatch for both purposes a captured order can have: a
 * registration group confirms its rows; a contingent purchase flips its claims
 * paid and fires the attendee invites. The order row's purposeType decides.
 */
async function confirmCapturedOrder(order, razorpayPaymentId, actorUserId, context) {
  if (order.purposeType === PAYMENT_ORDER_PURPOSE_TYPES.CONTINGENT) {
    await confirmContingentPurchase(order.paymentGroupId, razorpayPaymentId);
    return;
  }
  if (order.purposeType === PAYMENT_ORDER_PURPOSE_TYPES.ADD_ON) {
    // The registration is already confirmed; capturing only attaches the offers
    // that were parked on the AddOnOrder and re-syncs the pass.
    const { confirmAddOnOrder } = require("./add-on-service");
    await confirmAddOnOrder(order.paymentGroupId, razorpayPaymentId);
    return;
  }
  await confirmPaymentGroup(actorUserId, order.paymentGroupId, razorpayPaymentId, context);
}

// Platform fee (config) plus optional GST on it; the registration fee is already the group total.
function computeOrderAmounts(registrationFeePaise) {
  const platformFeePaise = applicationConfig.platformFeePaise;
  const gstAmountPaise = applicationConfig.gstOnPlatformFeeEnabled
    ? Math.round((platformFeePaise * applicationConfig.gstRatePercent) / 100)
    : 0;
  return {
    registrationFeePaise,
    platformFeePaise,
    gstAmountPaise,
    totalAmountPaise: registrationFeePaise + platformFeePaise + gstAmountPaise,
  };
}

/*
 * Creates (or returns the existing) Razorpay order for a pending payment group. The
 * registration rows carry the group's registration fee; the order adds the platform
 * fee and any GST. Returns the order id plus the public key id so the client can
 * open Checkout.
 */
/*
 * The registration the checkout screen should land on after a verified payment,
 * and the creation time its expiry countdown runs from. Returned alongside the
 * order so a checkout reached WITHOUT navigation state — a refresh, a deep link,
 * or the "resume pending payment" path — still knows where success leads. Before
 * this, that path ended a successful payment on /registration-success/null.
 */
async function readGroupRegistrationContext(paymentGroupId) {
  const row = await RegistrationModel.findOne({
    paymentGroupId,
    paymentStatus: PAYMENT_STATUSES.PENDING,
  })
    .sort({ createdAt: 1 })
    .select("createdAt")
    .lean();
  return row
    ? { registrationId: String(row._id), registrationCreatedAt: row.createdAt }
    : { registrationId: null, registrationCreatedAt: null };
}

async function createPaymentOrder(paymentGroupId, actorUserId = null) {
  const existing = await PaymentOrderModel.findOne({ paymentGroupId });
  if (existing && existing.razorpayOrderId) {
    return {
      razorpayOrderId: existing.razorpayOrderId,
      razorpayKeyId: applicationConfig.razorpayKeyId,
      registrationFeePaise: existing.registrationFeePaise,
      platformFeePaise: existing.platformFeePaise,
      gstAmountPaise: existing.gstAmountPaise,
      totalAmountPaise: existing.totalAmountPaise,
      ...(await readGroupRegistrationContext(paymentGroupId)),
    };
  }

  /*
   * An add-on group has NO pending registration rows — its registration is
   * already confirmed and paid. The amount comes from the parked AddOnOrder
   * instead, and the order is stamped ADD_ON so the capture dispatch above
   * attaches the offers rather than trying to confirm a registration group.
   */
  const { AddOnOrderModel } = require("../models/add-on-order-model");
  const addOnOrder = await AddOnOrderModel.findOne({ paymentGroupId, status: "pending" }).lean();
  if (addOnOrder) {
    const addOnAmounts = computeOrderAmounts(addOnOrder.amountPaise || 0);
    const { razorpayOrderId: addOnRazorpayOrderId } = await createRazorpayOrder({
      amountPaise: addOnAmounts.totalAmountPaise,
      receipt: paymentGroupId,
    });
    await PaymentOrderModel.create({
      paymentGroupId,
      purposeType: PAYMENT_ORDER_PURPOSE_TYPES.ADD_ON,
      razorpayOrderId: addOnRazorpayOrderId,
      ...addOnAmounts,
      status: PAYMENT_ORDER_STATUSES.CREATED,
      createdByUserId: actorUserId,
    });
    return {
      razorpayOrderId: addOnRazorpayOrderId,
      razorpayKeyId: applicationConfig.razorpayKeyId,
      ...addOnAmounts,
      // Success lands back on the registration the add-ons were bought for.
      registrationId: String(addOnOrder.registrationId),
      registrationCreatedAt: addOnOrder.createdAt,
    };
  }

  const rows = await RegistrationModel.find({
    paymentGroupId,
    paymentStatus: PAYMENT_STATUSES.PENDING,
  }).lean();
  if (rows.length === 0) {
    throw new ApplicationError(
      404,
      ERROR_CODES.PAYMENT_GROUP_NOT_FOUND,
      "No pending payment was found for that group."
    );
  }

  const amounts = computeOrderAmounts(rows[0].totalFeePaise || 0);
  const { razorpayOrderId } = await createRazorpayOrder({
    amountPaise: amounts.totalAmountPaise,
    receipt: paymentGroupId,
  });

  await PaymentOrderModel.create({
    paymentGroupId,
    razorpayOrderId,
    ...amounts,
    status: PAYMENT_ORDER_STATUSES.CREATED,
    createdByUserId: actorUserId,
  });

  // The earliest pending row is the leader's registration in a team group and
  // the only row in a solo one — the right success destination either way.
  const sortedRows = [...rows].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return {
    razorpayOrderId,
    razorpayKeyId: applicationConfig.razorpayKeyId,
    ...amounts,
    registrationId: String(sortedRows[0]._id),
    registrationCreatedAt: sortedRows[0].createdAt,
  };
}

/*
 * The polling target for the payment-processing screen. Ownership rule mirrors
 * read-service.getRegistrationDetail: the group is returned only if the caller
 * owns a registration row in it, and everything else — including a group id that
 * does not exist — is the same 403, so the endpoint cannot be used to probe
 * which group ids exist.
 */
/*
 * The contingent flavour of the status poll: the group's rows are claims, not
 * registrations, and the owner is the buyer. Same probe-proof rule — anything
 * that is not the buyer's own purchase is the same 403.
 */
async function readContingentPurchaseStatus(userId, paymentGroupId) {
  const ownClaim = await ContingentClaimModel.findOne({
    contingentPurchaseGroupId: paymentGroupId,
    buyerUserId: userId,
  }).lean();
  if (!ownClaim) {
    throw new ApplicationError(403, ERROR_CODES.PERMISSION_DENIED, "You cannot view this payment.");
  }
  const earliestClaim = await ContingentClaimModel.findOne({
    contingentPurchaseGroupId: paymentGroupId,
  })
    .sort({ createdAt: 1 })
    .select("createdAt")
    .lean();
  const order = await PaymentOrderModel.findOne({ paymentGroupId }).lean();
  return {
    paymentGroupId,
    purposeType: PAYMENT_ORDER_PURPOSE_TYPES.CONTINGENT,
    orderStatus: order ? order.status : null,
    // The claim's paymentStatus stands in for the registration fields the
    // processing screen polls; there is no single registration to land on.
    registrationStatus: null,
    paymentStatus: ownClaim.paymentStatus,
    registrationId: null,
    totalAmountPaise: order ? order.totalAmountPaise : null,
    paymentReference: order?.razorpayPaymentId ?? null,
    expiresAt: earliestClaim
      ? new Date(
          new Date(earliestClaim.createdAt).getTime() + PAYMENT_EXPIRY_MINUTES * 60 * 1000
        )
      : null,
  };
}

async function readPaymentGroupStatus(userId, paymentGroupId) {
  /*
   * An add-on group is checked FIRST. Its registration carries the paymentGroupId
   * of the original registration, not this one, so the lookup below would miss it
   * and fall through to the contingent reader — which would refuse a purchase the
   * caller legitimately made.
   */
  const { AddOnOrderModel } = require("../models/add-on-order-model");
  const addOnOrder = await AddOnOrderModel.findOne({ paymentGroupId }).lean();
  if (addOnOrder) {
    if (String(addOnOrder.userId) !== String(userId)) {
      throw new ApplicationError(403, ERROR_CODES.FORBIDDEN, "This payment is not yours.");
    }
    const addOnPaymentOrder = await PaymentOrderModel.findOne({ paymentGroupId }).lean();
    return {
      paymentGroupId,
      purposeType: PAYMENT_ORDER_PURPOSE_TYPES.ADD_ON,
      orderStatus: addOnPaymentOrder ? addOnPaymentOrder.status : null,
      // Add-ons never hold a seat, so there is no registration status of their
      // own to report and no hold to expire — the seat is already confirmed.
      registrationStatus: addOnOrder.status === "completed" ? "confirmed" : null,
      paymentStatus: addOnOrder.status === "completed" ? "completed" : "pending",
      registrationId: String(addOnOrder.registrationId),
      totalAmountPaise: addOnPaymentOrder
        ? addOnPaymentOrder.totalAmountPaise
        : addOnOrder.amountPaise,
      paymentReference: addOnPaymentOrder ? addOnPaymentOrder.razorpayPaymentId ?? null : null,
      expiresAt: null,
    };
  }

  const ownRow = await RegistrationModel.findOne({ paymentGroupId, userId }).lean();
  if (!ownRow) {
    /*
     * Not a registration group of the caller's — it may be a contingent
     * purchase, whose group has no registration rows at all. The contingent
     * reader applies its own buyer-ownership rule and throws the same 403 for
     * everything else, so the not-found/not-yours surface stays probe-proof.
     */
    return readContingentPurchaseStatus(userId, paymentGroupId);
  }

  // The hold window runs from the earliest row in the group, exactly as the lazy
  // expiry sweep measures it — the client reads expiresAt instead of mirroring
  // PAYMENT_EXPIRY_MINUTES.
  const earliestRow = await RegistrationModel.findOne({ paymentGroupId })
    .sort({ createdAt: 1 })
    .select("createdAt")
    .lean();
  const expiresAt = earliestRow
    ? new Date(new Date(earliestRow.createdAt).getTime() + PAYMENT_EXPIRY_MINUTES * 60 * 1000)
    : null;

  const order = await PaymentOrderModel.findOne({ paymentGroupId }).lean();

  return {
    paymentGroupId,
    purposeType: PAYMENT_ORDER_PURPOSE_TYPES.REGISTRATION,
    orderStatus: order ? order.status : null,
    registrationStatus: ownRow.status,
    paymentStatus: ownRow.paymentStatus,
    registrationId: String(ownRow._id),
    totalAmountPaise: order ? order.totalAmountPaise : ownRow.totalFeePaise ?? null,
    paymentReference: ownRow.paymentReference ?? null,
    expiresAt,
  };
}

/*
 * The frontend checkout callback: verify the "orderId|paymentId" signature, mark the
 * order captured, then run the shared confirmation core to flip the group to CONFIRMED
 * and mint passes/entitlements.
 */
async function verifyAndCapture({
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  actorUserId = null,
  context = {},
}) {
  const valid = isValidPaymentSignature({
    razorpayOrderId,
    razorpayPaymentId,
    signature: razorpaySignature,
    keySecret: applicationConfig.razorpayKeySecret,
  });
  if (!valid) {
    throw new ApplicationError(
      400,
      ERROR_CODES.PAYMENT_VERIFICATION_FAILED,
      "The payment signature could not be verified."
    );
  }

  const order = await PaymentOrderModel.findOne({ razorpayOrderId });
  if (!order) {
    throw new ApplicationError(404, ERROR_CODES.PAYMENT_GROUP_NOT_FOUND, "Payment order not found.");
  }
  if (order.status === PAYMENT_ORDER_STATUSES.CAPTURED) {
    return { success: true, alreadyCaptured: true };
  }

  order.razorpayPaymentId = razorpayPaymentId;
  order.razorpaySignature = razorpaySignature;
  order.status = PAYMENT_ORDER_STATUSES.CAPTURED;
  await order.save();

  await confirmCapturedOrder(order, razorpayPaymentId, actorUserId, context);
  return { success: true };
}

/*
 * The webhook safety net (for a browser that closed after paying). Bad signature or
 * a non-captured/duplicate event is acknowledged silently — Razorpay retries on any
 * non-2xx, so the route always answers 200 regardless of what this returns.
 */
async function handleWebhook(rawBody, signature, eventId = null) {
  const valid = isValidWebhookSignature({
    rawBody,
    signature,
    webhookSecret: applicationConfig.razorpayWebhookSecret,
  });
  if (!valid) {
    return { handled: false };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody));
  } catch {
    return { handled: false };
  }
  if (payload.event !== "payment.captured") {
    return { handled: false };
  }

  const paymentEntity = payload.payload?.payment?.entity || {};
  const razorpayOrderId = paymentEntity.order_id;
  const razorpayPaymentId = paymentEntity.id;
  if (!razorpayOrderId) {
    return { handled: false };
  }

  // Idempotency: skip if this order is already captured or this event id was handled.
  if (eventId) {
    const seen = await PaymentOrderModel.findOne({ razorpayEventId: eventId }).select("_id").lean();
    if (seen) {
      return { handled: false };
    }
  }
  const order = await PaymentOrderModel.findOne({ razorpayOrderId });
  if (!order || order.status === PAYMENT_ORDER_STATUSES.CAPTURED) {
    return { handled: false };
  }

  order.razorpayPaymentId = razorpayPaymentId;
  order.razorpayEventId = eventId;
  order.status = PAYMENT_ORDER_STATUSES.CAPTURED;
  await order.save();

  await confirmCapturedOrder(order, razorpayPaymentId, null, {});
  return { handled: true };
}

module.exports = { createPaymentOrder, readPaymentGroupStatus, verifyAndCapture, handleWebhook };

const razorpayService = require("../services/razorpay-service");
const checkoutService = require("../services/checkout-service");
const { extractRequestContext } = require("../helpers/request-context");

async function getCheckoutSummary(request, response) {
  const summary = await checkoutService.getCheckoutSummary(
    request.params.festId,
    request.params.eventId,
    request.query.teamSize
  );
  return response.status(200).json({ data: summary });
}

async function postCreateOrder(request, response) {
  const { userId } = request.authenticatedUser;
  const order = await razorpayService.createPaymentOrder(request.body?.paymentGroupId, userId);
  return response.status(201).json({ data: order });
}

async function getPaymentStatus(request, response) {
  const { userId } = request.authenticatedUser;
  const status = await razorpayService.readPaymentGroupStatus(userId, request.params.paymentGroupId);
  return response.status(200).json({ data: status });
}

async function postVerify(request, response) {
  const { userId } = request.authenticatedUser;
  const result = await razorpayService.verifyAndCapture({
    razorpayOrderId: request.body?.razorpayOrderId,
    razorpayPaymentId: request.body?.razorpayPaymentId,
    razorpaySignature: request.body?.razorpaySignature,
    actorUserId: userId,
    context: extractRequestContext(request),
  });
  return response.status(200).json({ data: result });
}

/*
 * Always answers 200 — Razorpay retries on any non-2xx, so a processing failure or
 * a bad signature is acknowledged, not surfaced. request.body is a raw Buffer here
 * (express.raw on this route), which the service needs for signature verification.
 */
async function postWebhook(request, response) {
  try {
    await razorpayService.handleWebhook(
      request.body,
      request.headers["x-razorpay-signature"],
      request.headers["x-razorpay-event-id"] || null
    );
  } catch (error) {
    console.error(`Razorpay webhook handling failed: ${error.message}`);
  }
  return response.status(200).json({ received: true });
}

module.exports = { getCheckoutSummary, getPaymentStatus, postCreateOrder, postVerify, postWebhook };

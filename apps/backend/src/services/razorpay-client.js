const { applicationConfig } = require("../config/application-config");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");

/*
 * The thin SDK wrapper — the only place that touches the network. The Razorpay
 * package is lazy-required so the app boots without it installed (payment features
 * degrade), and only when the keys are actually present. Tests seed this module
 * into the require cache so the real SDK is never loaded.
 */
let cachedClient = null;

function getRazorpayClient() {
  if (!applicationConfig.razorpayKeyId || !applicationConfig.razorpayKeySecret) {
    throw new ApplicationError(
      503,
      ERROR_CODES.PAYMENT_NOT_CONFIGURED,
      "The payment gateway is not configured."
    );
  }
  if (!cachedClient) {
    let Razorpay;
    try {
      // eslint-disable-next-line global-require
      Razorpay = require("razorpay");
    } catch (error) {
      /*
       * The package is optional (see the module header): the app boots without it
       * so non-payment features stay up. But a raw MODULE_NOT_FOUND from require
       * bubbling out of a paid registration surfaces as a bare 500 — and, worse,
       * only after the seat-holding rows are already committed, stranding a
       * pending hold nobody can pay. Translate it to the same configured-absence
       * signal an empty key gives, so the caller degrades payment gracefully
       * (503) and rolls its hold back instead of leaking one.
       */
      if (error && error.code === "MODULE_NOT_FOUND") {
        throw new ApplicationError(
          503,
          ERROR_CODES.PAYMENT_NOT_CONFIGURED,
          "The payment gateway is not configured."
        );
      }
      throw error;
    }
    cachedClient = new Razorpay({
      key_id: applicationConfig.razorpayKeyId,
      key_secret: applicationConfig.razorpayKeySecret,
    });
  }
  return cachedClient;
}

async function createRazorpayOrder({ amountPaise, receipt }) {
  const client = getRazorpayClient();
  const order = await client.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt,
  });
  return { razorpayOrderId: order.id };
}

module.exports = { createRazorpayOrder };

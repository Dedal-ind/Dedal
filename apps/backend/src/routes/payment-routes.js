const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  getPaymentStatus,
  postCreateOrder,
  postVerify,
} = require("../controllers/payment-controller");

/*
 * The authenticated payment surface. The webhook is NOT here — it needs the raw
 * request body for signature verification, so it is mounted in application.js ahead
 * of the global JSON parser.
 */
const paymentRouter = express.Router();

paymentRouter.get("/status/:paymentGroupId", authenticationMiddleware, asyncHandler(getPaymentStatus));
paymentRouter.post("/create-order", authenticationMiddleware, asyncHandler(postCreateOrder));
paymentRouter.post("/verify", authenticationMiddleware, asyncHandler(postVerify));

module.exports = { paymentRouter };

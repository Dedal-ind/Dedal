const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const { postDeliveryEvents } = require("../controllers/delivery-controller");

/* Delivery tracking ingest. Authenticated: the decision it reports on was. */
const deliveryRouter = express.Router();

deliveryRouter.post("/events", authenticationMiddleware, asyncHandler(postDeliveryEvents));

module.exports = { deliveryRouter };

const mongoose = require("mongoose");

const { EventModel } = require("../models/event-model");
const { FestModel } = require("../models/fest-model");
const { applicationConfig } = require("../config/application-config");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { isPaidEvent, computeTotalFeePaise } = require("../helpers/registration-payment-helpers");

/*
 * A read-only fee preview: registration fee (per the event's feeType and the team
 * size), the flat platform fee, and GST on the platform fee if the hidden toggle is
 * on. Creates no rows. A free event is a single "free" line item at zero.
 */
async function getCheckoutSummary(festId, eventId, teamSizeInput = 1) {
  const event = mongoose.Types.ObjectId.isValid(eventId) ? await EventModel.findById(eventId) : null;
  if (!event || String(event.festId) !== String(festId)) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  const fest = await FestModel.findById(festId).select("festName").lean();

  const parsedSize = Number(teamSizeInput);
  const teamSize = Number.isInteger(parsedSize) && parsedSize > 0 ? parsedSize : 1;

  const paid = isPaidEvent(event);
  const registrationFeePaise = computeTotalFeePaise(event, teamSize);
  const platformFeePaise = paid ? applicationConfig.platformFeePaise : 0;
  const gstAmountPaise =
    paid && applicationConfig.gstOnPlatformFeeEnabled
      ? Math.round((platformFeePaise * applicationConfig.gstRatePercent) / 100)
      : 0;
  const totalAmountPaise = registrationFeePaise + platformFeePaise + gstAmountPaise;

  const lineItems = [];
  if (!paid) {
    lineItems.push({ label: "Free entry", amountPaise: 0 });
  } else {
    lineItems.push({ label: "Registration fee", amountPaise: registrationFeePaise });
    if (platformFeePaise > 0) {
      lineItems.push({ label: "Platform fee", amountPaise: platformFeePaise });
    }
    if (gstAmountPaise > 0) {
      lineItems.push({ label: `GST (${applicationConfig.gstRatePercent}%)`, amountPaise: gstAmountPaise });
    }
  }

  return {
    eventName: event.eventName,
    festName: fest ? fest.festName : null,
    registrationFeePaise,
    platformFeePaise,
    gstAmountPaise,
    totalAmountPaise,
    lineItems,
  };
}

module.exports = { getCheckoutSummary };

const mongoose = require("mongoose");

const { EventModel } = require("../models/event-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");

/* A malformed id is a miss, not a CastError-driven 500. */
async function findEventOrThrow(eventId) {
  const event = mongoose.Types.ObjectId.isValid(eventId) ? await EventModel.findById(eventId) : null;
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  return event;
}

module.exports = { findEventOrThrow };

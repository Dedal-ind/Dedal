const mongoose = require("mongoose");

const { RegistrationModel } = require("../../models/registration-model");
const { ApplicationError } = require("../../helpers/application-error");
const { ERROR_CODES } = require("../../constants/error-codes");
const { DETAIL_POPULATE, toRegistrationJson } = require("../../helpers/registration-serializers");

/* Reading a registration back. No writes live here, by construction. */
async function listMyRegistrations(userId) {
  const registrations = await RegistrationModel.find({ userId })
    .sort({ registeredAt: -1 })
    .populate(DETAIL_POPULATE);
  return registrations.map(toRegistrationJson);
}

/*
 * Someone else's registration is refused as PERMISSION_DENIED, not NOT_FOUND: a
 * distinct 404 would confirm that a registration with that id exists.
 */
async function getRegistrationDetail(userId, registrationId) {
  const registration = mongoose.Types.ObjectId.isValid(registrationId)
    ? await RegistrationModel.findById(registrationId)
    : null;
  if (!registration || String(registration.userId) !== String(userId)) {
    throw new ApplicationError(403, ERROR_CODES.PERMISSION_DENIED, "You cannot view this registration.");
  }
  await registration.populate(DETAIL_POPULATE);
  return toRegistrationJson(registration);
}

module.exports = { listMyRegistrations, getRegistrationDetail };

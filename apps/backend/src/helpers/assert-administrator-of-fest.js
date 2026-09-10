const mongoose = require("mongoose");

const { FestModel } = require("../models/fest-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { assertAdministrator } = require("./administrator-helpers");

/*
 * A malformed id is a miss, not a fault: findById would raise a CastError and
 * surface as a 500 rather than the 404 the caller deserves.
 */
async function findFestOrThrow(festId) {
  const fest = mongoose.Types.ObjectId.isValid(festId) ? await FestModel.findById(festId) : null;

  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  return fest;
}

/*
 * Defence in depth. require-administrator-middleware already ran at the HTTP
 * layer; this runs again at the service layer, so an event endpoint mounted
 * without the middleware still cannot be reached by a non-administrator.
 *
 * The fest is returned because every caller needs it anyway — to check the
 * fest's own status before letting an event change.
 */
async function assertAdministratorOfFest(userId, festId) {
  const fest = await findFestOrThrow(festId);
  const staffAssignment = await assertAdministrator(userId, fest.hostCollegeId);
  return { fest, staffAssignment };
}

module.exports = { assertAdministratorOfFest, findFestOrThrow };

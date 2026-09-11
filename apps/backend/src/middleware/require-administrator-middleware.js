const mongoose = require("mongoose");

const { FestModel } = require("../models/fest-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { findAdministratorAuthority } = require("../helpers/administrator-helpers");

/*
 * On create, the target college arrives in the body. On mutate, it is whatever
 * college owns the fest named in the path — so the fest must be loaded first,
 * and a missing fest is a 404 here rather than a duplicated check in every
 * handler downstream.
 */
async function resolveTargetCollegeId(request) {
  const { festId } = request.params;

  if (!festId) {
    const { hostCollegeId } = request.body || {};
    if (!mongoose.Types.ObjectId.isValid(hostCollegeId)) {
      throw new ApplicationError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        "hostCollegeId must be a valid ObjectId.",
        { hostCollegeId: "must be a valid ObjectId" }
      );
    }
    return new mongoose.Types.ObjectId(hostCollegeId);
  }

  if (!mongoose.Types.ObjectId.isValid(festId)) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }

  const fest = await FestModel.findById(festId).select("hostCollegeId").lean();
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  return fest.hostCollegeId;
}

async function requireAdministratorMiddleware(request, response, next) {
  try {
    const { userId } = request.authenticatedUser;
    // Resolve (and validate) the target college first, so a bad fest/college id is
    // still a 404/400 even for the platform owner.
    const collegeId = await resolveTargetCollegeId(request);

    /*
     * One predicate covers both a college administrator and the platform owner,
     * who administers every college. This used to be two branches here and two
     * more elsewhere; see findAdministratorAuthority for why that was the bug.
     */
    const authority = await findAdministratorAuthority(userId, collegeId);
    if (!authority) {
      throw new ApplicationError(
        403,
        ERROR_CODES.PERMISSION_DENIED,
        "You are not an administrator of this college."
      );
    }

    request.currentAdministrator = authority.platformAdmin
      ? { collegeId, platformAdmin: true }
      : { collegeId, assignmentId: authority._id };
    /*
     * The flag the coordinator-or-admin middleware also sets. Handlers shared
     * between the two chains (the shift service's coverage check) read it to
     * decide whether coverage narrowing applies; without it an administrator
     * passing THIS gate looked like a coordinator with no assignment, and
     * assignmentCoversEvent dereferenced undefined — the shifts-screen 500.
     */
    request.isAdministrator = true;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { requireAdministratorMiddleware };

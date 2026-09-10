const mongoose = require("mongoose");

const { UserModel } = require("../models/user-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { EVENT_STATUSES } = require("../constants/event-constants");
const { FEST_STATUSES, FEST_VISIBILITIES } = require("../constants/fest-constants");
const { ACTIVE_REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { findActiveAdministratorUserIds } = require("./administrator-helpers");

/*
 * The questions asked before anybody takes a seat: is this caller allowed to
 * register at all, is this event open, does this fest admit them. Shared by the
 * solo and team paths, which is the point — the two drifted apart once already
 * while they lived side by side in one file.
 */
// A fest has no ongoing/completed status of its own; published is the registerable state.
const REGISTERABLE_EVENT_STATUSES = [EVENT_STATUSES.PUBLISHED, EVENT_STATUSES.ONGOING];
const REGISTERABLE_FEST_STATUSES = [FEST_STATUSES.PUBLISHED];

async function loadRegisterableUser(userId) {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new ApplicationError(404, ERROR_CODES.USER_NOT_FOUND, "User not found.");
  }
  if (user.isBlocked) {
    throw new ApplicationError(403, ERROR_CODES.USER_BLOCKED, "This account is blocked.");
  }
  if (!user.isProfileComplete) {
    throw new ApplicationError(403, ERROR_CODES.PROFILE_INCOMPLETE, "Complete your profile first.");
  }
  return user;
}

/* Loads the event and its fest, and proves both are in a state that accepts registrations. */

async function loadRegisterableEvent(eventId) {
  const event = mongoose.Types.ObjectId.isValid(eventId)
    ? await EventModel.findById(eventId).populate("festId")
    : null;
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  if (!REGISTERABLE_EVENT_STATUSES.includes(event.status)) {
    throw new ApplicationError(409, ERROR_CODES.EVENT_NOT_REGISTERABLE, "This event is not open for registration.", { currentStatus: event.status });
  }
  const fest = event.festId;
  if (!fest || !REGISTERABLE_FEST_STATUSES.includes(fest.status)) {
    throw new ApplicationError(409, ERROR_CODES.FEST_NOT_REGISTERABLE, "This fest is not open for registration.", { currentStatus: fest ? fest.status : null });
  }
  // A grouping (container) event has child events; registration is a leaf-only act.
  const childCount = await EventModel.countDocuments({ parentEventId: event._id });
  if (childCount > 0) {
    throw new ApplicationError(
      400,
      ERROR_CODES.REGISTRATION_ON_PARENT_EVENT,
      "Registration is only allowed on leaf events, not on ones that group sub-events."
    );
  }
  // An uncategorized event is either a childless container or a leaf the admin has
  // not finished setting up; either way it is not ready to take registrations.
  if (!event.category) {
    throw new ApplicationError(
      400,
      ERROR_CODES.REGISTRATION_EVENT_NOT_CATEGORIZED,
      "This event must have a category before registration is allowed."
    );
  }
  return { event, fest };
}

function assertRegistrationWindowOpen(event, now) {
  if (now < event.registrationOpensAt) {
    throw new ApplicationError(409, ERROR_CODES.REGISTRATION_NOT_OPEN_YET, "Registration has not opened yet.", { opensAt: event.registrationOpensAt });
  }
  /*
   * AN ADMIN'S EXPLICIT CLOSE IS NOW THE ONLY THING THAT SHUTS THE DOOR.
   *
   * There used to be a second, automatic rule here: registration also closed once
   * the event's endsAt had passed. It is gone, deliberately.
   *
   * The reason is that no date on this model reliably means "stop taking people".
   * registrationClosesAt was already unenforced — walk-ups register at the venue
   * after the start time, which is the normal case, not the exception — and endsAt
   * turned out to be no better: an organiser who set a placeholder end time, or
   * who ran long, or who wanted to keep a desk open for the last few arrivals,
   * found registration shut by a clock nobody had chosen to consult. The console
   * showed the event as open, the participant was refused, and there was no
   * setting anywhere that explained it.
   *
   * So the rule is now a decision rather than an inference: registration is open
   * until an administrator closes it, and the timestamp records exactly when they
   * did. registrationClosesAt survives as a DISPLAYED deadline — participants see
   * "registration closes on the 24th" — but it decides nothing.
   *
   * registrationOpensAt is deliberately still enforced below/above: "not open
   * yet" is a different claim from "closed", and an event that has not begun
   * accepting people has never been open in the first place.
   */
  if (event.registrationManuallyClosedAt) {
    throw new ApplicationError(
      409,
      ERROR_CODES.REGISTRATION_CLOSED,
      "Registration for this event has been closed by the organisers.",
      { closedAt: event.registrationManuallyClosedAt }
    );
  }
}

function belongsToHostCollege(user, fest) {
  return user.collegeId && String(user.collegeId) === String(fest.hostCollegeId);
}

async function assertNoActiveRegistration(userId, eventId) {
  const existing = await RegistrationModel.findOne({
    userId,
    eventId,
    status: { $in: ACTIVE_REGISTRATION_STATUSES },
  });
  if (existing) {
    throw new ApplicationError(409, ERROR_CODES.ALREADY_REGISTERED, "You are already registered for this event.", { existingId: existing.id });
  }
}

const ADMIN_CANNOT_REGISTER_MESSAGE =
  "Administrators cannot register for events. Use a different account for participant testing.";

/*
 * Runs before every other check, so an administrator is told why they were
 * refused rather than being sent to complete a profile they will never register
 * with. A frontend that hides the register button is not the enforcement; this
 * is, so a direct POST cannot get around it.
 */
async function assertCallerIsNotAdministrator(userId) {
  const administratorIds = await findActiveAdministratorUserIds([userId]);
  if (administratorIds.size > 0) {
    throw new ApplicationError(403, ERROR_CODES.ADMIN_CANNOT_REGISTER, ADMIN_CANNOT_REGISTER_MESSAGE);
  }
}

/*
 * A team member is registered by the leader's call rather than their own, so the
 * roster is checked too: without this, naming an administrator in memberEmails
 * would hand them a registration they are not allowed to hold.
 */
async function assertNoAdministratorMembers(members) {
  const administratorIds = await findActiveAdministratorUserIds(
    members.map((member) => member.user._id)
  );
  if (administratorIds.size === 0) {
    return;
  }

  const administrator = members.find((member) => administratorIds.has(String(member.user._id)));
  throw new ApplicationError(403, ERROR_CODES.ADMIN_CANNOT_REGISTER, ADMIN_CANNOT_REGISTER_MESSAGE, {
    administratorEmail: administrator.email,
  });
}

module.exports = {
  REGISTERABLE_EVENT_STATUSES,
  REGISTERABLE_FEST_STATUSES,
  loadRegisterableUser,
  loadRegisterableEvent,
  assertRegistrationWindowOpen,
  belongsToHostCollege,
  assertNoActiveRegistration,
  assertCallerIsNotAdministrator,
  assertNoAdministratorMembers,
};

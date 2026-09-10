const { EventModel } = require("../models/event-model");
const { ApplicationError } = require("./application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");

/* The queue is capped so it stays a real prospect rather than a polite fiction. */
const MAXIMUM_WAITLIST_LENGTH = 50;

/*
 * Every read and write of event.registeredCount, in one file and nowhere else.
 *
 * The claims and the release live together deliberately. A release has to be
 * guarded by exactly the condition its matching claim used — an uncapped event
 * increments nothing, so giving seats back on one drives the count negative —
 * and that rule is only obviously true when both halves are on the same screen.
 * It was not, once, and the count went to -N on every uncapped team cancel.
 */
/*
 * The seat is claimed with a single conditional $inc, so two callers racing for
 * the last spot cannot both read "one left" and both write. The filter is the
 * check: only the update whose precondition still holds increments the count.
 */
async function claimSoloSeat(event) {
  if (event.capacity === null) {
    return { status: REGISTRATION_STATUSES.CONFIRMED, event };
  }
  // Compare registeredCount against the DB doc's own capacity, not the number read
  // into JS at load time: an admin who shrinks capacity between the read and this
  // claim would otherwise be checked against the stale, higher value and overbook.
  const updated = await EventModel.findOneAndUpdate(
    {
      _id: event._id,
      $expr: { $and: [{ $ne: ["$capacity", null] }, { $lt: ["$registeredCount", "$capacity"] }] },
    },
    { $inc: { registeredCount: 1 } },
    { new: true }
  );
  if (updated) {
    return { status: REGISTRATION_STATUSES.CONFIRMED, event: updated };
  }
  if (event.waitlistEnabled) {
    return {
      status: REGISTRATION_STATUSES.WAITLISTED,
      event,
      waitlistPosition: await claimWaitlistPosition(event),
    };
  }
  throw new ApplicationError(409, ERROR_CODES.EVENT_FULL, "This event is full.");
}

/*
 * The next place in the queue, and the cap that stops the queue becoming a lie.
 *
 * FIFTY IS A PROMISE, NOT A LIMIT OF THE SYSTEM. A waitlist of 400 for a
 * 30-seat event tells 370 people they have a chance they do not have. Refusing
 * at 50 is the honest answer, and WAITLIST_FULL is distinct from EVENT_FULL so
 * the client can say "the waitlist is full too" rather than the wrong thing.
 *
 * Position is count+1 at the moment of joining. Two people racing can be handed
 * the same number — accepted deliberately: the alternative is a counter on the
 * event document incremented in the same breath as the seat claim, which
 * couples the queue to the seat maths for a tie that only affects display
 * order. Promotion breaks the tie by createdAt anyway.
 */
async function claimWaitlistPosition(event) {
  const { RegistrationModel } = require("../models/registration-model");

  const waitlistedCount = await RegistrationModel.countDocuments({
    eventId: event._id,
    status: REGISTRATION_STATUSES.WAITLISTED,
  });
  if (waitlistedCount >= MAXIMUM_WAITLIST_LENGTH) {
    throw new ApplicationError(
      409,
      ERROR_CODES.WAITLIST_FULL,
      "This event is full and its waitlist is full too.",
      { maximumWaitlistLength: MAXIMUM_WAITLIST_LENGTH }
    );
  }
  return waitlistedCount + 1;
}

async function claimTeamSeats(event, teamSize) {
  if (event.capacity === null) {
    return event;
  }
  // Self-referential against the DB doc's current capacity, so a mid-flight
  // capacity cut cannot let the team through against a stale, higher JS value.
  const updated = await EventModel.findOneAndUpdate(
    {
      _id: event._id,
      $expr: {
        $and: [
          { $ne: ["$capacity", null] },
          { $lte: [{ $add: ["$registeredCount", teamSize] }, "$capacity"] },
        ],
      },
    },
    { $inc: { registeredCount: teamSize } },
    { new: true }
  );
  if (!updated) {
    throw new ApplicationError(409, ERROR_CODES.EVENT_FULL, "This event does not have room for the whole team.");
  }
  return updated;
}

/*
 * Gives back exactly what claimTeamSeats took, and nothing it did not.
 *
 * The condition is the same one the claim uses: an uncapped event increments no
 * seats, so giving seats back on one drives registeredCount below zero. Mongoose's
 * min: 0 on the field does not catch it — min is document validation and $inc
 * through findOneAndUpdate never runs it — so the count silently goes negative
 * and compounds. This mirrors the guard STEP-D12-CHUNK-12.8 added to the solo
 * cancel path (see heldASeat in cancelRegistration); the team path was missed.
 *
 * Both callers — cancelling a team and compensating a failed team create — go
 * through here, so the rule is stated once and cannot drift between them.
 */
async function releaseTeamSeats(event, teamSize) {
  if (event.capacity === null || teamSize === 0) {
    return EventModel.findById(event._id);
  }
  return EventModel.findOneAndUpdate(
    { _id: event._id },
    { $inc: { registeredCount: -teamSize } },
    { new: true }
  );
}

module.exports = {
  MAXIMUM_WAITLIST_LENGTH,
  claimSoloSeat,
  claimTeamSeats,
  releaseTeamSeats,
};

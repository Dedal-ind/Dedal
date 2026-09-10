const mongoose = require("mongoose");

const { EventFeedbackModel } = require("../models/event-feedback-model");
const { EventModel } = require("../models/event-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { ScanModel } = require("../models/scan-model");
const { PassModel } = require("../models/pass-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { SCAN_RESULTS, CHECKPOINT_TYPES } = require("../constants/scan-constants");

/*
 * Post-event feedback: a 1–5 rating and an optional comment from someone who
 * was actually there.
 *
 * THE ATTENDANCE GATE IS THE POINT. Registering for an event and turning up to
 * it are different things, and a rating from someone who never came is noise a
 * coordinator cannot act on. Attendance is proven the only way the system can
 * prove it: an ACCEPTED scan at one of the event's own entry checkpoints. That
 * is the same evidence the door roster is built from, so "who may rate this"
 * and "who came" are guaranteed to be the same set.
 */

const RECENT_COMMENT_LIMIT = 10;
const MINIMUM_RATING = 1;
const MAXIMUM_RATING = 5;

async function loadEventOrThrow(eventId) {
  const event = mongoose.Types.ObjectId.isValid(eventId)
    ? await EventModel.findById(eventId).select("eventName festId").lean()
    : null;
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  return event;
}

/*
 * True when this participant has an accepted scan at one of the event's entry
 * checkpoints. Resolved through their passes because a scan records the PASS,
 * not the user — the same indirection listEventScanParticipants walks.
 */
async function hasAttendedEvent(userId, eventId) {
  const checkpointIds = await CheckpointModel.find({
    eventId,
    checkpointType: CHECKPOINT_TYPES.EVENT_ENTRY,
  }).distinct("_id");
  if (checkpointIds.length === 0) {
    return false; // an event with no door cannot have been entered through one
  }

  const passIds = await PassModel.find({ userId }).distinct("_id");
  if (passIds.length === 0) {
    return false;
  }

  const acceptedScanCount = await ScanModel.countDocuments({
    checkpointId: { $in: checkpointIds },
    passId: { $in: passIds },
    result: SCAN_RESULTS.ACCEPTED,
  });
  return acceptedScanCount > 0;
}

function validateRating(rating) {
  if (!Number.isInteger(rating) || rating < MINIMUM_RATING || rating > MAXIMUM_RATING) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Give the event a rating.", {
      rating: `must be a whole number from ${MINIMUM_RATING} to ${MAXIMUM_RATING}`,
    });
  }
  return rating;
}

async function submitFeedback(userId, eventId, payload = {}) {
  const event = await loadEventOrThrow(eventId);
  const rating = validateRating(payload.rating);

  // Checked before the attendance query: a participant who already rated should
  // be told that, not told they did not attend.
  const existing = await EventFeedbackModel.findOne({ eventId: event._id, userId })
    .select("_id")
    .lean();
  if (existing) {
    throw new ApplicationError(
      409,
      ERROR_CODES.FEEDBACK_ALREADY_SUBMITTED,
      "You have already rated this event. Ratings cannot be changed."
    );
  }

  if (!(await hasAttendedEvent(userId, event._id))) {
    throw new ApplicationError(
      403,
      ERROR_CODES.FEEDBACK_NOT_ATTENDED,
      "Only people who attended this event can rate it."
    );
  }

  const comment = typeof payload.comment === "string" ? payload.comment.trim() : "";

  try {
    const feedback = await EventFeedbackModel.create({
      eventId: event._id,
      festId: event.festId,
      userId,
      rating,
      comment: comment || null,
      submittedAt: new Date(),
    });
    return feedback.toJSON();
  } catch (error) {
    /*
     * Two submissions racing past the check above both reach create(); the
     * unique index refuses the loser with E11000. Translated to the same 409 the
     * check produces, so the caller sees one behaviour rather than two.
     */
    if (error?.code === 11000) {
      throw new ApplicationError(
        409,
        ERROR_CODES.FEEDBACK_ALREADY_SUBMITTED,
        "You have already rated this event. Ratings cannot be changed."
      );
    }
    throw error;
  }
}

/*
 * What the participant app needs to decide whether to show the rating card:
 * did they attend, and have they already rated. Returned together because the
 * screen cannot answer either question on its own.
 */
async function getFeedbackEligibility(userId, eventId) {
  const event = await loadEventOrThrow(eventId);
  const submitted = await EventFeedbackModel.findOne({ eventId: event._id, userId })
    .select("rating comment submittedAt")
    .lean();

  if (submitted) {
    return {
      hasAttended: true, // they could only have rated it by attending
      hasSubmitted: true,
      rating: submitted.rating,
      comment: submitted.comment ?? null,
    };
  }
  return {
    hasAttended: await hasAttendedEvent(userId, event._id),
    hasSubmitted: false,
    rating: null,
    comment: null,
  };
}

/*
 * The coordinator's read. The distribution is built with every bucket present
 * even when empty — a chart that silently omits "no 1-star ratings" is a chart
 * that looks like missing data rather than good news.
 */
async function getFeedbackSummary(eventId) {
  const event = await loadEventOrThrow(eventId);

  const [aggregate] = await EventFeedbackModel.aggregate([
    { $match: { eventId: new mongoose.Types.ObjectId(String(event._id)) } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: "$rating" },
        totalResponses: { $sum: 1 },
        ratings: { $push: "$rating" },
      },
    },
  ]);

  const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const rating of aggregate?.ratings ?? []) {
    ratingDistribution[rating] = (ratingDistribution[rating] ?? 0) + 1;
  }

  const recentComments = await EventFeedbackModel.find({
    eventId: event._id,
    comment: { $nin: [null, ""] },
  })
    .select("rating comment submittedAt")
    .sort({ submittedAt: -1 })
    .limit(RECENT_COMMENT_LIMIT)
    // Deliberately NOT populated with the author. A coordinator reading a
    // complaint next to the name of the person who made it changes what people
    // are willing to write.
    .lean();

  return {
    eventId: String(event._id),
    eventName: event.eventName,
    // Rounded to one decimal: the extra digits of an average of nine ratings
    // are noise presented as precision.
    averageRating: aggregate ? Math.round(aggregate.averageRating * 10) / 10 : null,
    totalResponses: aggregate?.totalResponses ?? 0,
    ratingDistribution,
    recentComments: recentComments.map((row) => ({
      rating: row.rating,
      comment: row.comment,
      submittedAt: row.submittedAt,
    })),
  };
}

/*
 * Averages for a whole fest's events in ONE query, for the admin event list.
 * Returns a Map keyed by event id string so the caller can decorate its rows
 * without an N+1.
 */
async function getFeedbackAveragesByEvent(festId) {
  const rows = await EventFeedbackModel.aggregate([
    { $match: { festId: new mongoose.Types.ObjectId(String(festId)) } },
    {
      $group: {
        _id: "$eventId",
        averageRating: { $avg: "$rating" },
        totalResponses: { $sum: 1 },
      },
    },
  ]);
  return new Map(
    rows.map((row) => [
      String(row._id),
      {
        averageRating: Math.round(row.averageRating * 10) / 10,
        totalResponses: row.totalResponses,
      },
    ])
  );
}

module.exports = {
  submitFeedback,
  getFeedbackEligibility,
  getFeedbackSummary,
  getFeedbackAveragesByEvent,
  hasAttendedEvent,
  RECENT_COMMENT_LIMIT,
};

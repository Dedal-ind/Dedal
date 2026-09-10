const mongoose = require("mongoose");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { PUBLICLY_VISIBLE_EVENT_STATUSES } = require("../constants/event-constants");
const { buildEventIcsFile, buildIcsFileName } = require("../helpers/calendar-helpers");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { FEST_VISIBILITIES, FEST_STATUSES } = require("../constants/fest-constants");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { recordAuditLog } = require("./audit-log-service");
const festService = require("./fest-service");
const eventService = require("./event-service");

/*
 * Independent events — the client's "standalone one-day conference" ask.
 *
 * DESIGN (decided, do not re-open): event.festId stays required. A standalone
 * event is wrapped in an auto-created, invisible SOLO CONTAINER fest
 * (isSoloContainer: true — see fest-model), so every fest-scoped invariant
 * (pass minting, scan authorization, checkpoints, audits, exports, offers)
 * works unchanged. The admin sees a standalone event; the backend sees a fest
 * with exactly one event. Lifecycle is coupled in event-service: publishing the
 * event publishes the fest, cancelling cancels it, rescheduling syncs dates,
 * and the dev purge tool already purges by fest.
 */

async function findAdministratorCollegeId(adminUserId) {
  const assignment = await StaffAssignmentModel.findOne({
    userId: adminUserId,
    role: STAFF_ROLES.ADMINISTRATOR,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  })
    .select("collegeId")
    .lean();
  if (!assignment?.collegeId) {
    throw new ApplicationError(
      403,
      ERROR_CODES.PERMISSION_DENIED,
      "Only a college administrator can create an independent event."
    );
  }
  return assignment.collegeId;
}

/*
 * Creates the wrapper fest and its one event. Not a Mongo transaction (the
 * deployment is not guaranteed a replica set); compensated instead — a failed
 * event insert deletes the just-created wrapper, which at that point is an
 * empty invisible draft nothing references.
 */
async function createIndependentEvent(adminUserId, eventAttributes, context = {}) {
  if (!eventAttributes.startsAt || !eventAttributes.endsAt) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "startsAt and endsAt are required.", {
      startsAt: eventAttributes.startsAt ? undefined : "is required",
      endsAt: eventAttributes.endsAt ? undefined : "is required",
    });
  }
  const hostCollegeId = await findAdministratorCollegeId(adminUserId);

  // The wrapper: named after the event, spanning the event's own dates.
  // Events carry no visibility field, so the wrapper is public — an
  // independent event is reachable by anyone with its link.
  const fest = await festService.createFest(
    adminUserId,
    {
      festName: eventAttributes.eventName,
      hostCollegeId,
      startsOn: eventAttributes.startsAt,
      endsOn: eventAttributes.endsAt,
      visibility: FEST_VISIBILITIES.PUBLIC,
      status: FEST_STATUSES.DRAFT,
      isSoloContainer: true,
    },
    context
  );

  let event;
  try {
    event = await eventService.createEvent(adminUserId, fest.id, eventAttributes, context);
  } catch (creationError) {
    await FestModel.deleteOne({ _id: fest.id, isSoloContainer: true });
    throw creationError;
  }

  return { fest, event };
}

/*
 * One-way conversion: the admin who outgrew a solo container turns it into an
 * ordinary fest they can rename and add events to. Flipping BACK is refused by
 * omission — a fest with multiple events cannot become "solo" again.
 */
async function convertSoloContainerToFullFest(adminUserId, festId, context = {}) {
  const fest = await festService.fetchFestById(adminUserId, festId);
  if (!fest.isSoloContainer) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_FEST_STATE,
      "This fest is not a solo container."
    );
  }
  await FestModel.updateOne({ _id: fest.id }, { $set: { isSoloContainer: false } });
  await recordAuditLog({
    actorUserId: adminUserId,
    festId: fest.id,
    action: AUDIT_ACTIONS.FEST_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.FEST,
    entityId: fest.id,
    beforeState: { isSoloContainer: true },
    afterState: { isSoloContainer: false, convertedToFullFest: true },
    ...context,
  });
  return { ...fest, isSoloContainer: false };
}

/*
 * The .ics file for one event, for the public download endpoint.
 *
 * Publicly visible statuses only. A draft event's schedule has not been
 * announced, and a cancelled one must not keep handing out calendar entries for
 * something that is not happening — both 404 rather than 403, so the endpoint
 * never confirms that a hidden event exists.
 */
async function buildEventCalendarFile(eventId) {
  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  const event = await EventModel.findOne({
    _id: eventId,
    status: { $in: PUBLICLY_VISIBLE_EVENT_STATUSES },
  })
    .populate("festId", "festName")
    .lean();
  if (!event) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  return {
    icsFileContent: buildEventIcsFile(event, event.festId),
    icsFileName: buildIcsFileName(event.eventName),
  };
}

module.exports = { createIndependentEvent, convertSoloContainerToFullFest, buildEventCalendarFile };

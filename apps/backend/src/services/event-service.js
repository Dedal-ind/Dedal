const mongoose = require("mongoose");

const { EventModel } = require("../models/event-model");
const { FestModel } = require("../models/fest-model");
const { FEST_STATUSES } = require("../constants/fest-constants");
const { RegistrationModel } = require("../models/registration-model");
const { TeamModel } = require("../models/team-model");
const { ContingentClaimModel } = require("../models/contingent-claim-model");
const {
  REGISTRATION_STATUSES,
  PAYMENT_STATUSES,
  ACTIVE_REGISTRATION_STATUSES,
} = require("../constants/registration-constants");
const { CONTINGENT_CLAIM_STATUSES } = require("../constants/contingent-constants");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { EVENT_STATUSES, PUBLICLY_VISIBLE_EVENT_STATUSES } = require("../constants/event-constants");
const { applicationConfig } = require("../config/application-config");
const { generateEventSlug } = require("../helpers/generate-event-slug");
const { insertEventWithUniqueSlug } = require("../helpers/insert-event-with-unique-slug");
const {
  assertAdministratorOfFest,
  findFestOrThrow,
} = require("../helpers/assert-administrator-of-fest");
const {
  assertFestAcceptsNewEvents,
  assertEventEditable,
  assertEventPublishable,
  assertEventCancellable,
} = require("../helpers/event-transition-guards");
const {
  ensureEventEntryCheckpoint,
  ensureEventOfferCheckpoints,
} = require("../helpers/checkpoint-helpers");
const {
  buildEventCancellationPreview,
  cascadeEventCancellation,
} = require("../helpers/event-cancellation-helpers");

// Used when an admin cancels without typing one (the single-event path allows it;
// the fest path requires a reason of its own).
const EVENT_CANCELLED_DEFAULT_REASON = "The organisers cancelled this event.";
const { refreshEventEntitlementWindows } = require("./pass-service");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");

// Only the changed fields go into an update's before/after snapshot, never the whole document.
function pickFields(source, keys) {
  return keys.reduce((accumulator, key) => {
    accumulator[key] = source[key];
    return accumulator;
  }, {});
}

async function recordEventAudit(userId, event, action, context, states = {}) {
  await recordAuditLog({
    actorUserId: userId,
    festId: event.festId,
    action,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    beforeState: states.beforeState || null,
    afterState: states.afterState || null,
    ...context,
  });
}

/*
 * An event under the wrong fest is indistinguishable from an event that does not
 * exist. Saying otherwise would confirm an event id to someone who guessed it.
 * A malformed id is a miss too, not a CastError surfacing as a 500.
 */
async function findEventOrThrow(festId, eventId) {
  const event = mongoose.Types.ObjectId.isValid(eventId) ? await EventModel.findById(eventId) : null;

  if (!event || event.festId.toString() !== String(festId)) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  return event;
}

/* Proves the caller administers the fest, then hands back both documents. */
async function findEventForAdministrator(userId, festId, eventId) {
  const { fest } = await assertAdministratorOfFest(userId, festId);
  const event = await findEventOrThrow(fest.id, eventId);
  return { fest, event };
}

/*
 * A grouping parent must exist and live under the same fest. A missing parent is a
 * 404 like any other unknown event; a parent under another fest is its own error so
 * the admin knows the id was real but points across a fest boundary. A parent may
 * itself have a parent, so nesting is unbounded — the admin owns the depth.
 */
async function assertParentEventInFest(parentEventId, festId) {
  if (!parentEventId) {
    return;
  }
  const parent = mongoose.Types.ObjectId.isValid(parentEventId)
    ? await EventModel.findById(parentEventId)
    : null;
  if (!parent) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Parent event not found.");
  }
  if (parent.festId.toString() !== String(festId)) {
    throw new ApplicationError(
      400,
      ERROR_CODES.PARENT_EVENT_WRONG_FEST,
      "The parent event belongs to a different fest."
    );
  }
}

async function createEvent(userId, festId, eventAttributes, context = {}) {
  const { fest } = await assertAdministratorOfFest(userId, festId);
  assertFestAcceptsNewEvents(fest);
  await assertParentEventInFest(eventAttributes.parentEventId, fest.id);

  const baseSlug = generateEventSlug(eventAttributes.eventName);
  if (baseSlug.length === 0) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "eventName must contain at least one letter or digit.",
      { eventName: "produces an empty slug" }
    );
  }

  // status and registeredCount are the schema's to default; a client cannot set them.
  const event = await insertEventWithUniqueSlug(
    { ...eventAttributes, festId: fest.id, createdByUserId: userId },
    baseSlug
  );

  await recordEventAudit(userId, event, AUDIT_ACTIONS.EVENT_CREATED, context, {
    afterState: pickFields(event, ["eventName", "eventType", "category", "startsAt", "endsAt"]),
  });

  return event.toJSON();
}

/*
 * The participant browse view. By default it shows only top-level events (the
 * verticals) — parentEventId null. A parentEventId filter drills into one parent's
 * direct children. includeChildren returns the whole tree at every depth so the
 * frontend can build the hierarchy itself; every row carries its parentEventId.
 */
async function listPublicEvents(festId, options = {}) {
  const fest = await findFestOrThrow(festId);

  const filter = { festId: fest.id, status: { $in: PUBLICLY_VISIBLE_EVENT_STATUSES } };
  if (options.includeChildren) {
    // No parent filter: return the full tree.
  } else if (options.parentEventId !== undefined) {
    filter.parentEventId = options.parentEventId;
  } else {
    filter.parentEventId = null;
  }

  const events = await EventModel.find(filter).sort({ startsAt: 1 });
  return events.map((event) => buildPublicEventJson(event));
}

/*
 * The public event allowlist — everything a browsing/registering participant
 * legitimately needs, EXCLUDING the operational-only fields that have no
 * business reaching an unauthenticated caller: createdByUserId (the admin's
 * internal id) and the bulk-email throttle state (lastBulkEmailSentAt,
 * dailyBulkEmailCount) that only the coordinator broadcast feature reads.
 * Explicit rather than `event.toJSON()` spread, so a future schema field is
 * private by default and must be opted in here.
 */
function buildPublicEventJson(event) {
  const json = event.toJSON();
  return {
    id: json.id,
    festId: json.festId,
    parentEventId: json.parentEventId,
    // The admin's order within a level; a client that builds the tree from
    // includeChildren sorts each level by (siblingRank, id).
    siblingRank: json.siblingRank,
    eventName: json.eventName,
    eventSlug: json.eventSlug,
    description: json.description,
    rules: json.rules,
    posterImageUrl: json.posterImageUrl,
    category: json.category,
    eventType: json.eventType,
    minimumTeamSize: json.minimumTeamSize,
    maximumTeamSize: json.maximumTeamSize,
    scoringFormat: json.scoringFormat,
    venue: json.venue,
    startsAt: json.startsAt,
    endsAt: json.endsAt,
    registrationOpensAt: json.registrationOpensAt,
    /*
     * A DISPLAYED deadline only — it decides nothing. Registration is shut by an
     * administrator's explicit close and by nothing else, so the decision travels
     * in registrationStatus below. Do not derive "closed" from this date.
     */
    registrationClosesAt: json.registrationClosesAt,
    /*
     * The virtual off registrationManuallyClosedAt (cancelled/deleted fold in as
     * closed). Every client reads this to decide whether to offer registration;
     * left out of this allowlist it arrives undefined, and an event the admin
     * had closed went on showing an open register button.
     */
    registrationStatus: json.registrationStatus,
    capacity: json.capacity,
    registeredCount: json.registeredCount,
    waitlistEnabled: json.waitlistEnabled,
    feeType: json.feeType,
    feeAmountPaise: json.feeAmountPaise,
    prizePoolDescription: json.prizePoolDescription,
    certificateTemplateUrl: json.certificateTemplateUrl,
    weightCategories: json.weightCategories,
    genderCategories: json.genderCategories,
    ageCategories: json.ageCategories,
    customQuestions: json.customQuestions,
    // Organiser-written Q&A, shown before registration. Display-only, so it is
    // public for the same reason the rules and description are.
    faqs: json.faqs,
    offers: json.offers,
    // The event's own sponsor strip. Display-only and opted in here explicitly,
    // for the same reason the fest's sponsors are public: a participant cannot
    // render the strip from a field the allowlist withholds.
    sponsors: json.sponsors,
    requiresMedicalDeclaration: json.requiresMedicalDeclaration,
    isLeaderboardVisible: json.isLeaderboardVisible,
    status: json.status,
  };
}

/*
 * A QR-ready link, added only for a parent or standalone event (parentEventId
 * null). A sub-event is reached by browsing from its parent, so it does not
 * advertise its own QR URL even though the slug endpoint still resolves it. The
 * fest slug is passed in — the event stores only festId, never a slug copy.
 */
function buildPublicEventResponse(event, festSlug) {
  const json = buildPublicEventJson(event);
  if (!event.parentEventId) {
    json.shareableUrl = `${applicationConfig.frontendBaseUrl}/fests/${festSlug}/events/${event.eventSlug}`;
  }
  return json;
}

/*
 * The slug-based event lookup for the shareable link. Scoped to a festId (already
 * proven published by the caller). Resolves parent, leaf and standalone events;
 * the response builder decides which get a shareableUrl.
 */

async function getPublicEventBySlug(festId, eventSlug, festSlug) {
  const slug = typeof eventSlug === "string" ? eventSlug.trim().toLowerCase() : "";
  const event = await EventModel.findOne({ festId, eventSlug: slug });

  if (!event || !PUBLICLY_VISIBLE_EVENT_STATUSES.includes(event.status)) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  return buildPublicEventResponse(event, festSlug);
}

async function listAllEventsForAdmin(userId, festId) {
  const { fest } = await assertAdministratorOfFest(userId, festId);
  const events = await EventModel.find({ festId: fest.id }).sort({ createdAt: -1 });

  /*
   * Participant feedback, decorated on in ONE aggregation for the whole fest
   * rather than a query per row. Events nobody has rated carry a null average,
   * which the admin list renders as "—" — distinct from a real 0, which cannot
   * occur because the minimum rating is 1.
   */
  const { getFeedbackAveragesByEvent } = require("./event-feedback-service");
  const feedbackByEventId = await getFeedbackAveragesByEvent(fest.id);

  /*
   * How many people are queueing on each event, in one grouped count for the
   * whole fest. An admin deciding whether to raise a capacity needs to know a
   * queue exists, and the event document does not carry it (waitlisted rows
   * take no seat, so registeredCount is silent about them).
   */
  const { RegistrationModel } = require("../models/registration-model");
  const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
  const waitlistRows = await RegistrationModel.aggregate([
    {
      $match: {
        eventId: { $in: events.map((event) => event._id) },
        status: REGISTRATION_STATUSES.WAITLISTED,
      },
    },
    { $group: { _id: "$eventId", waitlistedCount: { $sum: 1 } } },
  ]);
  const waitlistedCountByEventId = new Map(
    waitlistRows.map((row) => [String(row._id), row.waitlistedCount])
  );

  /*
   * Contingent eligibility, decided HERE rather than in the admin UI.
   *
   * The rule is "a top-level event that has children" — a container an admin can
   * price as one bundle. A sub-event may not configure a contingent of its own,
   * because it is already inside somebody else's.
   *
   * It lives on the server because Phase 2 (the per-vertical code generation)
   * has to enforce the same rule at the point of writing, and two copies of a
   * rule this quiet is how the badge and the generator end up disagreeing about
   * which events are eligible. Phase 1 only displays it.
   */
  const childCountByParentId = new Map();
  for (const event of events) {
    if (!event.parentEventId) {
      continue;
    }
    const parentKey = String(event.parentEventId);
    childCountByParentId.set(parentKey, (childCountByParentId.get(parentKey) ?? 0) + 1);
  }

  return events.map((event) => {
    const json = event.toJSON();
    const feedback = feedbackByEventId.get(String(event._id));
    json.feedbackAverageRating = feedback?.averageRating ?? null;
    json.feedbackResponseCount = feedback?.totalResponses ?? 0;
    json.waitlistedCount = waitlistedCountByEventId.get(String(event._id)) ?? 0;
    json.childEventCount = childCountByParentId.get(String(event._id)) ?? 0;
    /*
     * Eligibility is "is this a container", i.e. does it have children — NOT
     * "is it top-level". Phase 1 also required parentEventId to be null, which
     * under-reported: createContingent only requires the included sub-events to
     * be children of the named parent, so a nested container is a perfectly
     * legal contingent parent and was being denied its badge.
     *
     * Still a display hint, not the gate. The real refusals (the parent must
     * carry no fee of its own, the sub-events must be published and solo, no
     * two live bundles may share a sub-event) need the included-event list and
     * live in contingent-service, which is the only place that can enforce them.
     */
    json.isContingentEligible = json.childEventCount > 0;
    return json;
  });
}

async function getEventById(userId, festId, eventId) {
  const { event } = await findEventForAdministrator(userId, festId, eventId);
  return event.toJSON();
}

const PARTICIPANT_POPULATE = [
  {
    path: "userId",
    /*
     * This roster is reachable only through the coordinator-or-admin gate, which
     * scopes a coordinator to the events their assignment names — so a
     * coordinator of another event is refused the route outright rather than
     * served a stripped row.
     *
     * The select is a deliberate, named list rather than the absence of an
     * exclusion: a select: false field on the user model (phoneNumber today)
     * needs a leading + to come back at all, so a populate written without one
     * cannot leak it by omission. Keep it that way.
     */
    /*
     * +phoneNumber is a deliberate, named request: the roster is the
     * coordinator's contact sheet. It is RESOLVED into a single contactPhone
     * per row (contactPhoneOverride || phoneNumber) and the raw field is
     * stripped before the row leaves listEventParticipants — never both.
     */
    select: "fullName emailAddress usn collegeId participantId +phoneNumber",
    populate: { path: "collegeId", select: "commonName", model: "College" },
  },
  {
    path: "teamId",
    /*
     * captainUserId rides along so the roster can mark the one member a
     * coordinator should call. Populated (not just the id) because the
     * coordinator's contact sheet needs the captain's name and number in the
     * row itself — matching an id against the member list client-side would
     * work, but leaves the phone number unavailable where it is most needed.
     */
    select: "teamName memberUserIds captainUserId",
    populate: [
      { path: "memberUserIds", select: "fullName emailAddress" },
      { path: "captainUserId", select: "fullName emailAddress +phoneNumber" },
    ],
  },
];

/*
 * The confirmed roster for one event, in the order people registered. Used by the
 * coordinator's participant list; the caller is already cleared by the
 * coordinator-or-admin gate, so no authorisation happens here.
 *
 * Returns TWO ordered slices plus the not-yet-confirmed invites:
 *   individual     — registrations with no contingentClaimId (today's rows);
 *   contingent     — registrations a contingent claim materialised, each carrying
 *                    contingentName, claimStatus and buyerFullName;
 *   pendingInvites — INVITED (paid) claims: the seat is reserved but the
 *                    attendee has not accepted, which matters on race-day
 *                    walk-ups — the coordinator sees WHO holds the seat.
 * Every row carries registrationType so the CSV export and the UI never infer it.
 */
async function listEventParticipants(festId, eventId, { includeAll = false } = {}) {
  const event = await findEventOrThrow(festId, eventId);
  /*
   * Default stays CONFIRMED-only, which is what every existing caller wants.
   * includeAll exists for the certificate screen: once results are finalised the
   * winners carry winner1st/2nd/3rd and the eliminated carry ELIMINATED, so a
   * CONFIRMED filter hides exactly the people who need certificates.
   */
  const registrations = await RegistrationModel.find({
    eventId: event._id,
    ...(includeAll ? {} : { status: REGISTRATION_STATUSES.CONFIRMED }),
  })
    .sort({ registeredAt: 1 })
    .populate([
      ...PARTICIPANT_POPULATE,
      {
        path: "contingentClaimId",
        select: "contingentId buyerUserId claimStatus attendeeFullName attendeeEmailAddress",
        populate: [
          { path: "contingentId", select: "contingentName", model: "Contingent" },
          { path: "buyerUserId", select: "fullName", model: "User" },
        ],
      },
    ]);

  const individual = [];
  const contingent = [];
  for (const registration of registrations) {
    const plainRow = registration.toJSON();
    // Single resolved contact at the leaf; the base phone never rides alongside.
    plainRow.contactPhone =
      registration.contactPhoneOverride || registration.userId?.phoneNumber || null;
    if (plainRow.userId && typeof plainRow.userId === "object") {
      delete plainRow.userId.phoneNumber;
    }
    delete plainRow.contactPhoneOverride;
    /*
     * Flattened onto the row so the UI and the CSV export read one shape rather
     * than each re-deriving "is this person the captain".
     */
    const team = registration.teamId;
    if (team && typeof team === "object" && team.captainUserId) {
      const captain = team.captainUserId;
      plainRow.teamCaptain = {
        userId: String(captain._id ?? captain),
        fullName: captain.fullName ?? null,
        emailAddress: captain.emailAddress ?? null,
        phoneNumber: captain.phoneNumber ?? null,
      };
      plainRow.isTeamCaptain =
        String(captain._id ?? captain) === String(registration.userId?._id ?? registration.userId);
    } else {
      plainRow.teamCaptain = null;
      plainRow.isTeamCaptain = false;
    }

    if (registration.contingentClaimId) {
      const claim = registration.contingentClaimId;
      plainRow.registrationType = "contingent";
      plainRow.contingentName = claim.contingentId?.contingentName ?? null;
      plainRow.claimStatus = claim.claimStatus;
      // Accountability: who bought the seat this attendee sits in.
      plainRow.buyerFullName = claim.buyerUserId?.fullName ?? null;
      contingent.push(plainRow);
    } else {
      plainRow.registrationType = "individual";
      individual.push(plainRow);
    }
  }

  const invitedClaims = await ContingentClaimModel.find({
    eventId: event._id,
    claimStatus: CONTINGENT_CLAIM_STATUSES.INVITED,
    paymentStatus: PAYMENT_STATUSES.COMPLETED,
  })
    .sort({ invitedAt: 1 })
    .populate([
      { path: "contingentId", select: "contingentName" },
      { path: "buyerUserId", select: "fullName" },
    ]);
  const pendingInvites = invitedClaims.map((claim) => ({
    id: String(claim._id),
    registrationType: "contingent",
    claimStatus: claim.claimStatus,
    contingentName: claim.contingentId?.contingentName ?? null,
    buyerFullName: claim.buyerUserId?.fullName ?? null,
    attendeeFullName: claim.attendeeFullName,
    attendeeEmailAddress: claim.attendeeEmailAddress,
    invitedAt: claim.invitedAt,
  }));

  return { individual, contingent, pendingInvites };
}

/*
 * The drill-down roster behind a check-ins / check-outs card: one row per
 * DISTINCT participant with at least one ACCEPTED scan in the given direction at
 * this event's entry checkpoints, carrying their FIRST such scan's timestamp.
 * Same coordinator-or-admin gate as listEventParticipants — the route reuses it.
 */
async function listEventScanParticipants(festId, eventId, direction) {
  const event = await findEventOrThrow(festId, eventId);
  const { CheckpointModel } = require("../models/checkpoint-model");
  const { ScanModel } = require("../models/scan-model");
  const { PassModel } = require("../models/pass-model");
  const { UserModel } = require("../models/user-model");
  const { SCAN_RESULTS, CHECKPOINT_TYPES } = require("../constants/scan-constants");

  const checkpointIds = await CheckpointModel.find({
    eventId: event._id,
    checkpointType: CHECKPOINT_TYPES.EVENT_ENTRY,
  }).distinct("_id");
  if (checkpointIds.length === 0) {
    return [];
  }

  // Earliest accepted scan per pass, in one aggregation.
  const firstScans = await ScanModel.aggregate([
    { $match: { checkpointId: { $in: checkpointIds }, result: SCAN_RESULTS.ACCEPTED, direction } },
    { $sort: { scannedAt: 1 } },
    { $group: { _id: "$passId", firstScannedAt: { $first: "$scannedAt" } } },
  ]);
  if (firstScans.length === 0) {
    return [];
  }

  const passes = await PassModel.find({ _id: { $in: firstScans.map((row) => row._id) } })
    .select("userId")
    .lean();
  const userIdByPassId = new Map(passes.map((pass) => [String(pass._id), String(pass.userId)]));
  const users = await UserModel.find({ _id: { $in: passes.map((pass) => pass.userId) } })
    // Named select, same rule as PARTICIPANT_POPULATE: phoneNumber is select:false
    // and a scan roster is the door list, so it is deliberately requested.
    .select("fullName emailAddress usn participantId collegeId +phoneNumber")
    .populate({ path: "collegeId", select: "commonName", model: "College" })
    .lean();
  const userById = new Map(users.map((user) => [String(user._id), user]));

  return firstScans
    .map((row) => {
      const user = userById.get(userIdByPassId.get(String(row._id)) ?? "");
      if (!user) {
        return null;
      }
      return {
        userId: String(user._id),
        fullName: user.fullName ?? null,
        emailAddress: user.emailAddress,
        usn: user.usn ?? null,
        participantId: user.participantId ?? null,
        phoneNumber: user.phoneNumber ?? null,
        collegeName: user.collegeId?.commonName ?? null,
        firstScannedAt: row.firstScannedAt,
      };
    })
    .filter(Boolean)
    .sort((first, second) => new Date(first.firstScannedAt) - new Date(second.firstScannedAt));
}

/*
 * Read one event for a caller the coordinator-or-admin gate has already cleared.
 * No administrator re-check, so a coordinator running the event can read it too.
 */
async function getEventByIdForStaff(festId, eventId) {
  const event = await findEventOrThrow(festId, eventId);
  return event.toJSON();
}

/*
 * A rescheduled event has to drag its door windows with it.
 *
 * Compares the stored timestamps rather than trusting the request's key list: a
 * client that re-sends the same endsAt has changed nothing, and re-cutting
 * windows for that would write an audit line saying an event moved when it did
 * not. Only a real shift in startsAt or endsAt counts.
 *
 * startsAt is watched even though it does not feed the window — validFrom is
 * open-ended, so only endsAt moves validTo. An event dragged earlier still tells
 * us the schedule moved, and the audit line is worth more when it records the
 * whole move rather than half of it.
 */
async function refreshWindowsIfRescheduled(event, previousSchedule, actorUserId, context) {
  const startsAtMoved = event.startsAt.getTime() !== previousSchedule.startsAt.getTime();
  const endsAtMoved = event.endsAt.getTime() !== previousSchedule.endsAt.getTime();
  if (!startsAtMoved && !endsAtMoved) {
    return;
  }

  const refreshedCount = await refreshEventEntitlementWindows(event);
  await recordAuditLog({
    actorUserId,
    festId: event.festId,
    action: AUDIT_ACTIONS.ENTITLEMENT_WINDOWS_REFRESHED,
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: {
      oldStartsAt: previousSchedule.startsAt,
      newStartsAt: event.startsAt,
      oldEndsAt: previousSchedule.endsAt,
      newEndsAt: event.endsAt,
      refreshedCount,
    },
    ...context,
  });
}

async function updateEvent(userId, festId, eventId, eventAttributes, context = {}) {
  const { event } = await findEventForAdministrator(userId, festId, eventId);
  assertEventEditable(event);

  const changedKeys = Object.keys(eventAttributes);
  const beforeState = pickFields(event, changedKeys);
  const previousSchedule = { startsAt: event.startsAt, endsAt: event.endsAt };

  /*
   * Assigning field by field, then save(), so the schema's pre('validate')
   * cross-field hook runs. findByIdAndUpdate would skip it unless every
   * interacting field were re-sent on every request.
   */
  const previousOffers = event.offers ? event.offers.map((offer) => offer.toObject()) : [];
  Object.assign(event, eventAttributes);
  await event.save();
  if (eventAttributes.offers !== undefined) {
    await ensureEventOfferCheckpoints(event, previousOffers);
  }
  await refreshWindowsIfRescheduled(event, previousSchedule, userId, context);

  // Solo-container coupling: an independent event's dates ARE its wrapper
  // fest's dates — a reschedule syncs the fest so nothing downstream drifts.
  if (eventAttributes.startsAt !== undefined || eventAttributes.endsAt !== undefined) {
    await FestModel.updateOne(
      { _id: event.festId, isSoloContainer: true },
      { $set: { startsOn: event.startsAt, endsOn: event.endsAt } }
    );
  }

  await recordEventAudit(userId, event, AUDIT_ACTIONS.EVENT_UPDATED, context, {
    beforeState,
    afterState: pickFields(event, changedKeys),
  });

  return event.toJSON();
}

/*
 * The coordinator-or-admin edit path. Authorisation has already happened in
 * require-coordinator-or-admin-middleware — an administrator of the fest, or a
 * coordinator whose window is open and whose assignment names this event — so
 * this does not re-assert administrator rights the way updateEvent does. The
 * event is still looked up under its fest, and the same editability guard applies.
 */
async function updateEventForStaff(actorUserId, festId, eventId, eventAttributes, context = {}) {
  const event = await findEventOrThrow(festId, eventId);
  assertEventEditable(event);

  const changedKeys = Object.keys(eventAttributes);
  const beforeState = pickFields(event, changedKeys);
  const previousSchedule = { startsAt: event.startsAt, endsAt: event.endsAt };

  const previousOffers = event.offers ? event.offers.map((offer) => offer.toObject()) : [];
  Object.assign(event, eventAttributes);
  await event.save();
  if (eventAttributes.offers !== undefined) {
    await ensureEventOfferCheckpoints(event, previousOffers);
  }
  await refreshWindowsIfRescheduled(event, previousSchedule, actorUserId, context);

  // Same solo-container date sync as updateEvent — this is the path the admin
  // console's PATCH actually takes.
  if (eventAttributes.startsAt !== undefined || eventAttributes.endsAt !== undefined) {
    await FestModel.updateOne(
      { _id: event.festId, isSoloContainer: true },
      { $set: { startsOn: event.startsAt, endsOn: event.endsAt } }
    );
  }

  await recordEventAudit(actorUserId, event, AUDIT_ACTIONS.EVENT_UPDATED, context, {
    beforeState,
    afterState: pickFields(event, changedKeys),
  });

  return event.toJSON();
}

async function publishEvent(userId, festId, eventId, context = {}) {
  const { fest, event } = await findEventForAdministrator(userId, festId, eventId);
  /*
   * Solo-container coupling runs BEFORE the publishable guard: the wrapper fest
   * of an independent event only ever publishes through its event (there is no
   * separate fest action in that flow), so the guard's "no published event in a
   * draft fest" rule would otherwise deadlock the pair. Auditing first keeps
   * the trail causal: fest.published, then event.published.
   */
  if (fest.isSoloContainer && fest.status === FEST_STATUSES.DRAFT && event.status === EVENT_STATUSES.DRAFT) {
    fest.status = FEST_STATUSES.PUBLISHED;
    await fest.save();
    await recordAuditLog({
      actorUserId: userId,
      festId: fest._id,
      action: AUDIT_ACTIONS.FEST_PUBLISHED,
      entityType: AUDIT_ENTITY_TYPES.FEST,
      entityId: fest._id,
      afterState: { status: fest.status, soloContainerAutoPublish: true },
      ...context,
    });
  }
  assertEventPublishable(fest, event);

  event.status = EVENT_STATUSES.PUBLISHED;
  await event.save();
  // A published event needs a door to scan at; idempotent across republishes.
  await ensureEventEntryCheckpoint(fest.id, event.id, event.eventName);
  // …and a counter per active event-scoped offer, the same floor-not-ceiling
  // rule the fest's own offers get.
  await ensureEventOfferCheckpoints(event);

  await recordEventAudit(userId, event, AUDIT_ACTIONS.EVENT_PUBLISHED, context, {
    afterState: { status: event.status },
  });

  return event.toJSON();
}

/*
 * An admin's manual "close registration now" — and its reverse. Deliberately
 * separate from registrationClosesAt, which is NOT enforced (walk-ups register
 * after the start time by design), so this is the only switch that genuinely
 * shuts the door.
 *
 * Non-destructive: it stamps or clears one field and touches no registration,
 * pass or scan. Everyone already registered stays registered.
 */
async function setEventRegistrationClosed(userId, festId, eventId, shouldClose, context = {}) {
  const { event } = await findEventForAdministrator(userId, festId, eventId);

  const alreadyClosed = Boolean(event.registrationManuallyClosedAt);
  if (alreadyClosed === Boolean(shouldClose)) {
    // Idempotent: a double-tap is not an error, and re-stamping would lose the
    // original close time that the audit trail depends on.
    return event.toJSON();
  }

  event.registrationManuallyClosedAt = shouldClose ? new Date() : null;
  await event.save();

  await recordEventAudit(
    userId,
    event,
    shouldClose
      ? (AUDIT_ACTIONS.EVENT_REGISTRATION_CLOSED ?? "event_registration_closed")
      : (AUDIT_ACTIONS.EVENT_REGISTRATION_REOPENED ?? "event_registration_reopened"),
    context,
    { afterState: { registrationManuallyClosedAt: event.registrationManuallyClosedAt } }
  );

  return event.toJSON();
}

/*
 * Reopen a CANCELLED event as a fresh DRAFT with new dates.
 *
 * What it deliberately does NOT do: resurrect the old registrations. Cancelling
 * flipped every seat to eventCancelled, marked paid ones for refund, and emailed
 * everyone "this event is off". Silently marking those seats confirmed again
 * would claim money and attendance from people who were told the opposite —
 * so the roster starts empty and participants register afresh once the admin
 * republishes. Old rows stay as the audit record they already are.
 *
 * What it restores: the event itself (details intact), with the NEW schedule the
 * admin supplies (required — the old dates are precisely what stopped being
 * true), its entry checkpoint reactivated on publish (ensureEventEntryCheckpoint
 * is idempotent), status back to DRAFT so it walks the normal publish path.
 */
async function reopenCancelledEvent(userId, festId, eventId, schedule = {}, context = {}) {
  const { event } = await findEventForAdministrator(userId, festId, eventId);

  if (event.status !== EVENT_STATUSES.CANCELLED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_EVENT_STATE,
      "Only a cancelled event can be reopened.",
      { currentStatus: event.status }
    );
  }

  const { startsAt, endsAt, registrationOpensAt, registrationClosesAt } = schedule;
  const details = {};
  for (const [field, value] of Object.entries({ startsAt, endsAt, registrationOpensAt, registrationClosesAt })) {
    const parsed = value ? new Date(value) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      details[field] = "is required — supply the new schedule when reopening";
    }
  }
  if (Object.keys(details).length > 0) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Reopening needs the full new schedule.", details);
  }

  /*
   * Reopening is the cancellation cascade run in REVERSE, step by step, so
   * every downstream fact agrees the event is on again — the same reasoning
   * cancelEvent gives for why it cascades. Each pass matches exactly what the
   * cancellation stamped and nothing broader:
   *
   *  1. Registrations: only rows the CANCELLATION flipped (status eventCancelled
   *     on this event) return to CONFIRMED. A participant who cancelled
   *     THEMSELVES before the event was called off stays cancelled — their
   *     choice was not the organiser's act and must not be overridden.
   *     Refund markers on paid rows are left standing: whether money already
   *     refunded should be re-collected is a finance decision no code should
   *     make silently. The admin sees the count in the audit row.
   *  2. Entitlements: the event-entry entitlements the cascade revoked go back
   *     to ACTIVE, so existing passes open this event's door again.
   *  3. Checkpoints: reactivated, so the door accepts scans.
   *  4. Staff: assignments the cascade revoked (revoked, single-event, matching
   *     revocationReason) are reinstated. A manually revoked coordinator stays
   *     revoked — that was a person's deliberate decision, not the cascade's.
   *  5. Everyone affected gets an in-app notification, worded per role.
   */
  const { EntitlementModel } = require("../models/entitlement-model");
  const { ENTITLEMENT_TYPES, ENTITLEMENT_STATUSES } = require("../constants/pass-constants");
  const { StaffAssignmentModel } = require("../models/staff-assignment-model");
  const { STAFF_ASSIGNMENT_STATUSES, STAFF_ROLES } = require("../constants/staff-constants");
  const { CheckpointModel } = require("../models/checkpoint-model");
  const { STAFF_REVOCATION_REASON_EVENT_CANCELLED } = require("../helpers/event-cancellation-helpers");

  // 1. Registrations back to confirmed — only the cascade's own rows.
  const flippedRegistrations = await RegistrationModel.find({
    eventId: event._id,
    status: REGISTRATION_STATUSES.EVENT_CANCELLED,
  })
    .select("userId")
    .lean();
  const restoredUserIds = [
    ...new Set(flippedRegistrations.map((registration) => String(registration.userId))),
  ];
  if (flippedRegistrations.length > 0) {
    await RegistrationModel.updateMany(
      { eventId: event._id, status: REGISTRATION_STATUSES.EVENT_CANCELLED },
      {
        $set: { status: REGISTRATION_STATUSES.CONFIRMED },
        $unset: {
          eventCancelledAt: "",
          cancelledAt: "",
          cancellationReason: "",
          cancelledByRole: "",
          cancelledByUserId: "",
        },
      }
    );
  }

  // 2. Door entitlements back to active.
  const entitlementResult = await EntitlementModel.updateMany(
    {
      entitlementType: ENTITLEMENT_TYPES.EVENT_ENTRY,
      referenceId: event._id,
      status: ENTITLEMENT_STATUSES.REVOKED,
    },
    { $set: { status: ENTITLEMENT_STATUSES.ACTIVE } }
  );

  // 3. The door itself.
  const checkpointResult = await CheckpointModel.updateMany(
    { eventId: event._id, isActive: false },
    { $set: { isActive: true } }
  );

  // 4. Staff the cascade revoked — and ONLY those (reason must match).
  const revokedByCascade = await StaffAssignmentModel.find({
    festId: event.festId,
    status: STAFF_ASSIGNMENT_STATUSES.REVOKED,
    eventIds: event._id,
    revocationReason: STAFF_REVOCATION_REASON_EVENT_CANCELLED,
  }).lean();
  const reinstatedStaff = revokedByCascade.filter(
    (assignment) => (assignment.eventIds ?? []).length === 1
  );
  if (reinstatedStaff.length > 0) {
    await StaffAssignmentModel.updateMany(
      { _id: { $in: reinstatedStaff.map((assignment) => assignment._id) } },
      {
        $set: { status: STAFF_ASSIGNMENT_STATUSES.ACTIVE },
        $unset: { revokedAt: "", revocationReason: "" },
      }
    );
  }

  // The event itself, on the new schedule.
  event.status = EVENT_STATUSES.DRAFT;
  event.startsAt = new Date(startsAt);
  event.endsAt = new Date(endsAt);
  event.registrationOpensAt = new Date(registrationOpensAt);
  event.registrationClosesAt = new Date(registrationClosesAt);
  event.registrationManuallyClosedAt = null;
  // Denormalised seat count must agree with the restored rows.
  event.registeredCount = await RegistrationModel.countDocuments({
    eventId: event._id,
    status: REGISTRATION_STATUSES.CONFIRMED,
  });
  await event.save();

  /*
   * 5. Tell everyone, in-app, worded for their role. Late require, same reason
   * every other caller gives: test mocks install after this module loads.
   */
  const { notifyUsers, NOTIFICATION_TYPES } = require("./notification-service");
  const whenLabel = event.startsAt.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
  let notifiedCount = 0;
  if (restoredUserIds.length > 0) {
    notifiedCount += await notifyUsers({
      userIds: restoredUserIds,
      notificationType: NOTIFICATION_TYPES.BROADCAST,
      title: `Great news — ${event.eventName} is back on!`,
      body: `${event.eventName} has been rescheduled to ${whenLabel}. Your registration has been restored, and your pass works again — no need to re-register. See you there!`,
      linkPath: `/events/${event.eventSlug ?? ""}`,
      festId: String(event.festId),
      eventId: String(event._id),
      actorUserId: userId,
    });
  }
  const staffByRole = new Map();
  for (const assignment of reinstatedStaff) {
    const role = assignment.role ?? STAFF_ROLES.VOLUNTEER;
    if (!staffByRole.has(role)) staffByRole.set(role, []);
    staffByRole.get(role).push(String(assignment.userId));
  }
  for (const [role, userIds] of staffByRole) {
    const roleLabel = role === STAFF_ROLES.COORDINATOR ? "coordinator" : "volunteer";
    notifiedCount += await notifyUsers({
      userIds: [...new Set(userIds)],
      notificationType: NOTIFICATION_TYPES.BROADCAST,
      title: `${event.eventName} is back — you're reinstated`,
      body: `The event has been rescheduled to ${whenLabel} and your ${roleLabel} access has been restored. Check Backstage for your duties.`,
      linkPath: "/backstage",
      festId: String(event.festId),
      eventId: String(event._id),
      actorUserId: userId,
    });
  }

  await recordEventAudit(
    userId,
    event,
    AUDIT_ACTIONS.EVENT_REOPENED ?? "event_reopened",
    context,
    {
      afterState: {
        status: event.status,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        registrationsRestored: flippedRegistrations.length,
        entitlementsRestored: entitlementResult.modifiedCount ?? 0,
        checkpointsReactivated: checkpointResult.modifiedCount ?? 0,
        staffReinstated: reinstatedStaff.length,
        notifiedCount,
      },
    }
  );

  return event.toJSON();
}


/*
 * Hard delete — the tool for events that never really happened: a draft typo,
 * a test event, a cancelled duplicate. Guarded to ZERO registrations of any
 * status, because a registration row references this event forever ("my
 * registrations", refund history, audit trail) and deleting its target orphans
 * all of it. An event people actually joined is cancelled, never deleted —
 * the 409 says so. Removes the event's own satellites (rounds, scores,
 * checkpoints) so nothing dangles; scans cannot exist without registrations.
 */
async function deleteEvent(userId, festId, eventId, context = {}) {
  const { event } = await findEventForAdministrator(userId, festId, eventId);

  const registrationCount = await RegistrationModel.countDocuments({ eventId: event._id });
  if (registrationCount > 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_EVENT_STATE,
      "This event has registrations, so it cannot be deleted — cancel it instead. Delete only works on events nobody ever registered for.",
      { registrationCount }
    );
  }
  const childCount = await EventModel.countDocuments({ parentEventId: event._id });
  if (childCount > 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_EVENT_STATE,
      "This event has sub-events under it. Delete or move those first.",
      { childCount }
    );
  }

  const { RoundModel } = require("../models/round-model");
  const { RoundScoreModel } = require("../models/round-score-model");
  const { CheckpointModel } = require("../models/checkpoint-model");
  const rounds = await RoundModel.find({ eventId: event._id }).select("_id").lean();
  if (rounds.length > 0) {
    await RoundScoreModel.deleteMany({ roundId: { $in: rounds.map((round) => round._id) } });
    await RoundModel.deleteMany({ eventId: event._id });
  }
  await CheckpointModel.deleteMany({ eventId: event._id });

  const removedName = event.eventName;
  await EventModel.deleteOne({ _id: event._id });

  await recordAuditLog({
    actorUserId: userId,
    festId: event.festId,
    action: AUDIT_ACTIONS.EVENT_DELETED ?? "event_deleted",
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: { eventName: removedName, roundsRemoved: rounds.length },
    ...context,
  });
  return { deleted: true, eventName: removedName };
}

/*
 * SOFT DELETE — withdraw an event from circulation without destroying anything.
 *
 * WHY THIS IS NOT deleteEvent ABOVE. That one physically removes the document
 * and is refused the moment a single registration exists, for a good reason:
 * registrations, payments, teams, entitlements, passes and every append-only scan
 * row hold this eventId, and removing the event does not remove them — it orphans
 * them. A participant's pass would then reference an event that cannot be named.
 *
 * So an event people signed up for is withdrawn, not erased, and this is that
 * verb. It stays available for events with registrations precisely because that
 * is the case the hard delete cannot serve.
 *
 * DELETE IS NOT CANCEL, and the difference is what happens to the people:
 *   · CANCEL says the event was called off. Registrations are flipped to
 *     eventCancelled, entitlements revoked, refunds marked, staff released — the
 *     participant's booking ends and they are owed something.
 *   · DELETE says the event should not have been listed. Registrations are left
 *     EXACTLY as they are — status, payment, team, pass all untouched — and the
 *     event simply stops appearing to participants and stops taking new sign-ups.
 *
 * That is why nothing here cascades. Anyone already registered is told, and their
 * booking is left alone for an administrator to resolve deliberately (usually by
 * cancelling instead, if refunds are owed). Silently flipping their registrations
 * would make delete a worse-labelled cancel.
 */
async function softDeleteEvent(userId, festId, eventId, context = {}) {
  const { event } = await findEventForAdministrator(userId, festId, eventId);

  if (event.status === EVENT_STATUSES.DELETED) {
    // Idempotent: a double-tap is not an error, and re-notifying would mail
    // everyone a second time about an event that is already gone.
    return { event: event.toJSON(), notifiedCount: 0, alreadyDeleted: true };
  }

  /*
   * Children first, and refused rather than cascaded. Deleting a vertical would
   * silently withdraw every event under it — a much bigger act than the admin
   * asked for, and one with no undo surface. Naming the count lets them decide.
   */
  const childCount = await EventModel.countDocuments({
    parentEventId: event._id,
    status: { $ne: EVENT_STATUSES.DELETED },
  });
  if (childCount > 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_EVENT_STATE,
      "This event has sub-events under it. Delete those first — deleting a parent does not delete its children.",
      { childCount }
    );
  }

  /* Who to tell, read BEFORE the status flips so the roster is the live one. */
  const affected = await RegistrationModel.find({
    eventId: event._id,
    status: { $in: ACTIVE_REGISTRATION_STATUSES },
  })
    .select("userId")
    .lean();
  const affectedUserIds = [...new Set(affected.map((registration) => String(registration.userId)))];

  event.status = EVENT_STATUSES.DELETED;
  /*
   * The door is shut as well as the listing hidden. Hiding alone is not enough:
   * a participant holding a direct link would still reach the registration
   * endpoint, which reads registrationStatus rather than searching the listings.
   */
  event.registrationManuallyClosedAt = event.registrationManuallyClosedAt ?? new Date();
  await event.save();

  /* Its checkpoints stop accepting scans, but are NEVER removed — scans are
   * append-only and every row carries checkpointId. Same rule as the offer
   * counters (see checkpoint-helpers). */
  const { CheckpointModel } = require("../models/checkpoint-model");
  await CheckpointModel.updateMany({ eventId: event._id }, { $set: { isActive: false } });

  const notifiedCount = await notifyEventDeletion(event, affectedUserIds, userId);

  await recordAuditLog({
    actorUserId: userId,
    festId: event.festId,
    action: AUDIT_ACTIONS.EVENT_DELETED ?? "event_deleted",
    entityType: AUDIT_ENTITY_TYPES.EVENT,
    entityId: event._id,
    afterState: {
      eventName: event.eventName,
      status: event.status,
      softDelete: true,
      affectedRegistrations: affectedUserIds.length,
      notifiedCount,
      // Stated in the audit trail because it is the surprising part: unlike a
      // cancellation, the registrations were deliberately left standing.
      registrationsPreserved: true,
    },
    ...context,
  });

  return { event: event.toJSON(), notifiedCount, alreadyDeleted: false };
}

/*
 * Tells the people who had signed up. BOTH channels, because they answer
 * different failure modes: the in-app row is there when they next open the app
 * even if the mail bounced, and the email reaches someone who is not going to
 * open the app again before the day of the event.
 *
 * Never throws. A notification failure must not undo a delete that has already
 * been written — the event is gone either way, and an admin retrying would only
 * re-run a mail loop.
 */
async function notifyEventDeletion(event, affectedUserIds, actorUserId) {
  if (affectedUserIds.length === 0) {
    return 0;
  }
  const title = `${event.eventName} has been removed`;
  const body = `${event.eventName} has been deleted and is no longer available. If you had registered, contact the organisers about your booking.`;

  let notifiedCount = 0;
  try {
    const notificationService = require("./notification-service");
    const { NOTIFICATION_TYPES } = require("../models/notification-model");
    notifiedCount = await notificationService.notifyUsers({
      userIds: affectedUserIds,
      notificationType: NOTIFICATION_TYPES.EVENT_REMOVED,
      title,
      body,
      festId: event.festId,
      eventId: event._id,
      actorUserId,
    });
  } catch (notificationError) {
    console.error(`In-app delete notice failed for event ${event._id}: ${notificationError.message}`);
  }

  try {
    const { UserModel } = require("../models/user-model");
    const { FestModel: Fest } = require("../models/fest-model");
    const { sendEventParticipantNotificationEmail } = require("./email-service");
    const fest = await Fest.findById(event.festId).select("festName bannerImageUrl").lean();
    const users = await UserModel.find({ _id: { $in: affectedUserIds } })
      .select("emailAddress fullName")
      .lean();
    for (const user of users) {
      if (!user.emailAddress) {
        continue;
      }
      // Per recipient, failures counted not thrown — one dead address must not
      // stop the rest of the roster being told.
      await sendEventParticipantNotificationEmail({
        emailAddress: user.emailAddress,
        fullName: user.fullName,
        subject: title,
        message: body,
        eventName: event.eventName,
        festName: fest?.festName ?? "",
        festBannerImageUrl: fest?.bannerImageUrl ?? null,
      }).catch(() => {});
    }
  } catch (emailError) {
    console.error(`Delete notice email failed for event ${event._id}: ${emailError.message}`);
  }

  return notifiedCount;
}

/*
 * FEST-WIDE registration close/reopen — one switch for every event under a fest.
 *
 * Exists because the per-event switch does not scale to the moment it is needed:
 * closing registration across a twenty-event fest an hour before it starts is
 * twenty confirmations, and the one an admin misses is the one that keeps taking
 * sign-ups. It is the SAME field the per-event action writes, so the two cannot
 * disagree, and the per-event switch still works afterwards for a single reopen.
 *
 * REOPEN SKIPS CANCELLED AND DELETED EVENTS. Both are final; reopening
 * registration on them would advertise an event that cannot be attended. They are
 * counted in the result as skipped rather than silently passed over, so the admin
 * is told the fest-wide action did not reach everything.
 */
async function setFestRegistrationClosed(userId, festId, shouldClose, context = {}) {
  const { fest } = await assertAdministratorOfFest(userId, festId);

  const finalStatuses = [EVENT_STATUSES.CANCELLED, EVENT_STATUSES.DELETED];
  const filter = shouldClose
    ? { festId: fest._id, status: { $nin: finalStatuses } }
    : { festId: fest._id, status: { $nin: finalStatuses } };

  const targets = await EventModel.find(filter).select("_id").lean();
  const skipped = await EventModel.countDocuments({
    festId: fest._id,
    status: { $in: finalStatuses },
  });

  const update = shouldClose
    ? { $set: { registrationManuallyClosedAt: new Date() } }
    : { $set: { registrationManuallyClosedAt: null } };
  /*
   * Only rows whose state actually differs are written, so the stored close TIME
   * on an event that was already closed is not overwritten — the audit trail and
   * the participant-facing "closed at" both depend on the original stamp.
   */
  const changeFilter = shouldClose
    ? { ...filter, registrationManuallyClosedAt: null }
    : { ...filter, registrationManuallyClosedAt: { $ne: null } };
  const result = await EventModel.updateMany(changeFilter, update);

  await recordAuditLog({
    actorUserId: userId,
    festId: fest._id,
    action: shouldClose
      ? (AUDIT_ACTIONS.EVENT_REGISTRATION_CLOSED ?? "event_registration_closed")
      : (AUDIT_ACTIONS.EVENT_REGISTRATION_REOPENED ?? "event_registration_reopened"),
    entityType: AUDIT_ENTITY_TYPES.FEST,
    entityId: fest._id,
    afterState: {
      festWide: true,
      shouldClose,
      eventsTargeted: targets.length,
      eventsChanged: result.modifiedCount ?? 0,
      eventsSkippedFinal: skipped,
    },
    ...context,
  });

  return {
    eventsTargeted: targets.length,
    eventsChanged: result.modifiedCount ?? 0,
    eventsSkippedFinal: skipped,
  };
}

/*
 * The fest-level twin, same philosophy: only a fest nobody ever registered for
 * anywhere may be deleted. Cascades to its (registration-free) events via the
 * same per-event cleanup.
 */
async function deleteFest(userId, festId, context = {}) {
  const { fest } = await assertAdministratorOfFest(userId, festId);
  const events = await EventModel.find({ festId: fest._id }).select("_id eventName").lean();
  const registrationCount = events.length
    ? await RegistrationModel.countDocuments({ eventId: { $in: events.map((e) => e._id) } })
    : 0;
  if (registrationCount > 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_FEST_STATE ?? ERROR_CODES.INVALID_EVENT_STATE,
      "This fest has registrations, so it cannot be deleted — cancel or archive it instead.",
      { registrationCount }
    );
  }
  const { RoundModel } = require("../models/round-model");
  const { RoundScoreModel } = require("../models/round-score-model");
  const { CheckpointModel } = require("../models/checkpoint-model");
  const eventIds = events.map((e) => e._id);
  if (eventIds.length > 0) {
    const rounds = await RoundModel.find({ eventId: { $in: eventIds } }).select("_id").lean();
    if (rounds.length > 0) {
      await RoundScoreModel.deleteMany({ roundId: { $in: rounds.map((r) => r._id) } });
      await RoundModel.deleteMany({ eventId: { $in: eventIds } });
    }
    await EventModel.deleteMany({ _id: { $in: eventIds } });
  }
  await CheckpointModel.deleteMany({ festId: fest._id });
  const removedName = fest.festName;
  await FestModel.deleteOne({ _id: fest._id });
  await recordAuditLog({
    actorUserId: userId,
    festId: fest._id,
    action: AUDIT_ACTIONS.FEST_DELETED ?? "fest_deleted",
    entityType: AUDIT_ENTITY_TYPES.FEST,
    entityId: fest._id,
    afterState: { festName: removedName, eventsRemoved: events.length },
    ...context,
  });
  return { deleted: true, festName: removedName };
}

/*
 * What cancelling this event would do, for the confirmation dialog. A read-only
 * GET on its own route — deliberately NOT a flag on the destructive POST, since
 * a mistyped flag that turned a preview into a real cancellation would cost a
 * live event.
 */
async function previewCancelEvent(userId, festId, eventId) {
  const { event } = await findEventForAdministrator(userId, festId, eventId);
  return buildEventCancellationPreview(event);
}

/*
 * Cancelling an event is a CASCADE, not a status flip. Before this, the flip was
 * all that happened: registrations still read CONFIRMED, passes still carried an
 * ACTIVE door entitlement, and the checkpoint still admitted people — so
 * participants arrived at an empty room holding a pass the scanner accepted.
 *
 * Order matters. The contingent guard refuses first (nothing must half-run for a
 * bundled event), the cascade makes every downstream fact agree, and only then
 * does the event flip and the audit row land — so the trail reads causally.
 */
async function cancelEvent(userId, festId, eventId, context = {}, options = {}) {
  const { event } = await findEventForAdministrator(userId, festId, eventId);
  assertEventCancellable(event);
  /*
   * A sub-event inside a live contingent cannot be cancelled directly: paid
   * claims would point at an event that no longer exists. The admin must cancel
   * the contingent (or remove the event while it is still claim-free) first; the
   * error names the contingent to unwind. This runs BEFORE the cascade, so a
   * locked event cascades nothing at all.
   */
  const { assertEventNotLockedByContingent } = require("./contingent-service");
  await assertEventNotLockedByContingent(event._id);

  const cascadeResult = await cascadeEventCancellation({
    event,
    actorUserId: userId,
    reason: options.reason ?? EVENT_CANCELLED_DEFAULT_REASON,
    context,
    // A FEST-wide cancellation groups its own notifications: one participant in
    // five events of one fest gets ONE email, not five. It also revokes staff at
    // fest scope, so the per-event narrow revocation is skipped there.
    shouldNotify: options.shouldNotify !== false,
    shouldRevokeStaff: options.shouldRevokeStaff !== false,
  });

  event.status = EVENT_STATUSES.CANCELLED;
  await event.save();

  await recordEventAudit(userId, event, AUDIT_ACTIONS.EVENT_CANCELLED, context, {
    afterState: {
      status: event.status,
      reason: options.reason ?? EVENT_CANCELLED_DEFAULT_REASON,
      registrationsFlipped: cascadeResult.registrationsFlipped,
      staffAssignmentsRevoked: cascadeResult.staffAssignmentsRevoked,
      entitlementsRevoked: cascadeResult.entitlementsRevoked,
      checkpointsDeactivated: cascadeResult.checkpointsDeactivated,
      refundMarkerCount: cascadeResult.refundMarkerCount,
      notifiedCount: cascadeResult.notifiedCount,
    },
  });

  /*
   * Solo-container coupling: the wrapper fest of an independent event follows
   * it into CANCELLED as part of the same cascade. A direct status flip, NOT
   * fest-cancellation-service.cancelFest — that service re-cascades every event
   * and re-notifies every participant, which the per-event cascade above just
   * did for the wrapper's only event.
   */
  const containerFest = await FestModel.findById(event.festId);
  if (containerFest?.isSoloContainer && containerFest.status !== FEST_STATUSES.CANCELLED) {
    containerFest.status = FEST_STATUSES.CANCELLED;
    containerFest.cancelledAt = new Date();
    containerFest.cancellationReason = options.reason ?? EVENT_CANCELLED_DEFAULT_REASON;
    await containerFest.save();
    await recordAuditLog({
      actorUserId: userId,
      festId: containerFest._id,
      action: AUDIT_ACTIONS.FEST_CANCELLED,
      entityType: AUDIT_ENTITY_TYPES.FEST,
      entityId: containerFest._id,
      afterState: { status: containerFest.status, soloContainerAutoCancel: true },
      ...context,
    });
  }

  return { ...event.toJSON(), cascade: cascadeResult };
}

/*
 * The FLAT slug lookup: GET /public/events/:eventSlug, no fest in the URL.
 * Independent events live inside hidden solo-container fests that the public
 * fest catalog deliberately excludes, so a deep link cannot be resolved through
 * the catalog — this is its resolver (also works as a rescue path for any
 * published event, container or otherwise). The wrapper fest must still be
 * PUBLISHED — a drafted or cancelled container hides its event — and
 * festSlug/festName are attached so the client can register without a second
 * lookup.
 */
async function getPublicEventByBareSlug(eventSlug) {
  const slug = typeof eventSlug === "string" ? eventSlug.trim().toLowerCase() : "";
  const event = await EventModel.findOne({ eventSlug: slug });
  if (!event || !PUBLICLY_VISIBLE_EVENT_STATUSES.includes(event.status)) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  const fest = await FestModel.findById(event.festId).select("festSlug festName status").lean();
  if (!fest || fest.status !== FEST_STATUSES.PUBLISHED) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  }
  const json = buildPublicEventResponse(event, fest.festSlug);
  json.festSlug = fest.festSlug;
  json.festName = fest.festName;
  return json;
}

async function listPublicIndependentEvents() {
  const containerFests = await FestModel.find({
    status: FEST_STATUSES.PUBLISHED,
    isSoloContainer: true,
  })
    .select("festSlug festName hostCollegeId")
    .populate("hostCollegeId", "commonName city")
    .lean();
  if (containerFests.length === 0) {
    return [];
  }
  const festById = new Map(containerFests.map((fest) => [String(fest._id), fest]));
  const events = await EventModel.find({
    festId: { $in: containerFests.map((fest) => fest._id) },
    status: { $in: PUBLICLY_VISIBLE_EVENT_STATUSES },
    parentEventId: null,
  }).sort({ startsAt: 1 });
  return events.map((event) => {
    const json = buildPublicEventJson(event);
    const wrapperFest = festById.get(String(event.festId));
    json.festSlug = wrapperFest?.festSlug ?? null;
    json.hostCollegeName =
      wrapperFest?.hostCollegeId?.commonName ?? wrapperFest?.hostCollegeId?.collegeName ?? null;
    return json;
  });
}

/*
 * The coordinator's directory: everyone on one event, grouped by team where the
 * event is a team event, with phone and email included.
 *
 * This is the ONE read that returns contact details for participants, and it is
 * mounted behind the coordinator gate only. The public participants roster
 * deliberately never selects phoneNumber (see PARTICIPANT_POPULATE above); this
 * function selects it explicitly with a leading +, because select:false fields
 * do not come back without one.
 *
 * The captain is leaderUserId on the Team — whoever registered the team and got
 * the code. Their phone is the card's call target, and they sort first in the
 * member list because they are who a coordinator actually needs to reach.
 */
async function getEventDirectory(festId, eventId) {
  const event = await findEventOrThrow(festId, eventId);

  const registrations = await RegistrationModel.find({
    eventId: event._id,
    status: REGISTRATION_STATUSES.CONFIRMED,
  })
    .select("userId teamId")
    .populate({
      path: "userId",
      select: "fullName emailAddress +phoneNumber collegeId",
      populate: { path: "collegeId", select: "commonName collegeName" },
    })
    .lean();

  const toPerson = (user) => ({
    userId: String(user._id),
    fullName: user.fullName ?? null,
    emailAddress: user.emailAddress ?? null,
    phoneNumber: user.phoneNumber ?? null,
    collegeName: user.collegeId?.commonName ?? user.collegeId?.collegeName ?? null,
  });

  if (event.eventType !== "team") {
    return {
      eventName: event.eventName,
      eventType: event.eventType,
      entries: registrations
        .filter((r) => r.userId)
        .map((r) => ({ kind: "solo", ...toPerson(r.userId) })),
    };
  }

  const teamIds = [...new Set(registrations.filter((r) => r.teamId).map((r) => String(r.teamId)))];
  const teams = teamIds.length
    ? await TeamModel.find({ _id: { $in: teamIds } })
        .select("teamName leaderUserId memberUserIds")
        .lean()
    : [];

  const personByUserId = new Map(
    registrations.filter((r) => r.userId).map((r) => [String(r.userId._id), toPerson(r.userId)])
  );

  const entries = [];
  const claimed = new Set();

  for (const team of teams) {
    const leaderId = String(team.leaderUserId);
    const members = (team.memberUserIds ?? [])
      .map(String)
      .filter((id) => personByUserId.has(id))
      /* Captain first: they are the call target and the person to reach. */
      .sort((a, b) => (a === leaderId ? -1 : b === leaderId ? 1 : 0))
      .map((id) => ({ ...personByUserId.get(id), isLeader: id === leaderId }));
    if (members.length === 0) continue;

    members.forEach((m) => claimed.add(m.userId));
    const leader = members.find((m) => m.isLeader) ?? members[0];

    entries.push({
      kind: "team",
      teamId: String(team._id),
      teamName: team.teamName,
      /* One college line: teams are same-college by rule, so the leader's is
       * the team's. */
      collegeName: leader.collegeName,
      phoneNumber: leader.phoneNumber,
      memberUserIds: members.map((m) => m.userId),
      members,
    });
  }

  /* Registered on a team event but on no team — shown, not hidden. */
  for (const [userId, person] of personByUserId) {
    if (!claimed.has(userId)) {
      entries.push({ kind: "solo", ...person });
    }
  }

  return { eventName: event.eventName, eventType: event.eventType, entries };
}

module.exports = {
  getEventDirectory,
  listPublicIndependentEvents,
  createEvent,
  listPublicEvents,
  getPublicEventBySlug,
  getPublicEventByBareSlug,
  listAllEventsForAdmin,
  getEventById,
  getEventByIdForStaff,
  listEventParticipants,
  listEventScanParticipants,
  updateEvent,
  updateEventForStaff,
  publishEvent,
  setEventRegistrationClosed,
  reopenCancelledEvent,
  deleteEvent,
  softDeleteEvent,
  setFestRegistrationClosed,
  deleteFest,
  cancelEvent,
  previewCancelEvent,
};

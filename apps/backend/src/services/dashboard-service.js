const mongoose = require("mongoose");

const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { RegistrationModel } = require("../models/registration-model");
const { ScanModel } = require("../models/scan-model");
const { PassModel } = require("../models/pass-model");
const { EntitlementModel } = require("../models/entitlement-model");
const { MatchModel } = require("../models/match-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { CHECKPOINT_TYPES, SCAN_RESULTS, SCAN_DIRECTIONS } = require("../constants/scan-constants");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { ENTITLEMENT_TYPES, ENTITLEMENT_STATUSES } = require("../constants/pass-constants");

const RECENT_SCAN_LIMIT = 10;
// A sentinel larger than any real round, so $min over finalised matches yields it.
const NO_ACTIVE_ROUND = 1000000;

const RECENT_SCAN_POPULATE = [
  { path: "passId", select: "userId", populate: { path: "userId", select: "fullName" } },
  { path: "checkpointId", select: "checkpointName eventId" },
];

async function loadFestOrThrow(festId) {
  const fest = mongoose.Types.ObjectId.isValid(festId)
    ? await FestModel.findById(festId).select("festName status startsOn endsOn offers").lean()
    : null;
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  return fest;
}

/*
 * The events the dashboard covers. An administrator sees every event of the fest;
 * a coordinator is scoped to the events their assignment names, so the whole
 * dashboard — totals included — is recomputed over that narrower set.
 */
async function loadScopedEvents(festId, scopeEventIds) {
  const filter = { festId };
  if (scopeEventIds) {
    filter._id = { $in: scopeEventIds };
  }
  return EventModel.find(filter)
    .select("eventName category status registeredCount capacity scoringFormat")
    .lean();
}

function indexById(documents) {
  return new Map(documents.map((document) => [String(document._id), document]));
}

/* Registrations grouped by event and status in one pipeline, never a per-event loop. */
async function aggregateRegistrations(eventIds) {
  if (eventIds.length === 0) {
    return [];
  }
  return RegistrationModel.aggregate([
    { $match: { eventId: { $in: eventIds } } },
    { $group: { _id: { eventId: "$eventId", status: "$status" }, count: { $sum: 1 } } },
  ]);
}

/* Scans grouped by checkpoint, direction and result in one pipeline. */
async function aggregateScans(checkpointIds) {
  if (checkpointIds.length === 0) {
    return [];
  }
  return ScanModel.aggregate([
    { $match: { checkpointId: { $in: checkpointIds } } },
    {
      $group: {
        _id: { checkpointId: "$checkpointId", direction: "$direction", result: "$result" },
        count: { $sum: 1 },
      },
    },
  ]);
}

/* Match totals and the round in progress per event in one pipeline. */
async function aggregateMatches(eventIds) {
  if (eventIds.length === 0) {
    return [];
  }
  return MatchModel.aggregate([
    { $match: { eventId: { $in: eventIds } } },
    {
      $group: {
        _id: "$eventId",
        totalMatches: { $sum: 1 },
        completedMatches: { $sum: { $cond: ["$isFinalized", 1, 0] } },
        activeRound: { $min: { $cond: ["$isFinalized", NO_ACTIVE_ROUND, "$roundNumber"] } },
      },
    },
  ]);
}

/*
 * Per-offer claim totals: what participants booked (sum of maximumUses over
 * active offerClaim entitlements) against what has been served at the counters
 * (sum of usedCount) — "meals claimed against meals booked" for the organiser.
 */
async function aggregateOfferClaims(fest) {
  const offers = fest.offers ?? [];
  if (offers.length === 0) {
    return [];
  }
  const passes = await PassModel.find({ festId: fest._id }).select("_id").lean();
  const claimGroups = passes.length
    ? await EntitlementModel.aggregate([
        {
          $match: {
            passId: { $in: passes.map((pass) => pass._id) },
            entitlementType: ENTITLEMENT_TYPES.OFFER_CLAIM,
            status: ENTITLEMENT_STATUSES.ACTIVE,
          },
        },
        {
          $group: {
            _id: "$referenceId",
            bookedCount: { $sum: { $ifNull: ["$maximumUses", 0] } },
            claimedCount: { $sum: "$usedCount" },
          },
        },
      ])
    : [];
  const groupByOfferId = new Map(claimGroups.map((group) => [String(group._id), group]));
  return offers
    .filter((offer) => offer.isActive !== false)
    .map((offer) => {
      const group = groupByOfferId.get(String(offer._id));
      return {
        offerId: String(offer._id),
        offerName: offer.offerName,
        offerKey: offer.offerKey,
        bookedCount: group ? group.bookedCount : 0,
        claimedCount: group ? group.claimedCount : 0,
      };
    });
}

function countStaffOnDuty(festId, now) {
  return StaffAssignmentModel.countDocuments({
    festId,
    role: { $in: [STAFF_ROLES.COORDINATOR, STAFF_ROLES.VOLUNTEER] },
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
    validFrom: { $lte: now },
    validTo: { $gte: now },
  });
}

function loadRecentScans(checkpointIds) {
  if (checkpointIds.length === 0) {
    return [];
  }
  return ScanModel.find({ checkpointId: { $in: checkpointIds } })
    .sort({ scannedAt: -1 })
    .limit(RECENT_SCAN_LIMIT)
    .populate(RECENT_SCAN_POPULATE)
    .lean();
}

/*
 * Decides which checkpoints the scan pipelines look at: every gate of the fest
 * when the caller may see the fest-wide headcount, plus the event-entry
 * checkpoints of the in-scope events.
 */
function selectRelevantCheckpoints(checkpoints, eventIdSet, includeGate) {
  const gateCheckpoints = [];
  const relevantCheckpoints = [];
  for (const checkpoint of checkpoints) {
    const isGate = checkpoint.checkpointType === CHECKPOINT_TYPES.GATE;
    if (isGate && includeGate) {
      gateCheckpoints.push(checkpoint);
      relevantCheckpoints.push(checkpoint);
    } else if (!isGate && checkpoint.eventId && eventIdSet.has(String(checkpoint.eventId))) {
      relevantCheckpoints.push(checkpoint);
    }
  }
  return { gateCheckpoints, relevantCheckpoints };
}

function buildTotals(registrationGroups, scanGroups, checkpointById, gateCheckpointIdSet) {
  const totals = {
    totalRegistrations: 0,
    totalConfirmed: 0,
    totalWaitlisted: 0,
    totalCancelled: 0,
    totalCheckedInAtGate: 0,
    currentHeadcount: 0,
  };

  for (const group of registrationGroups) {
    totals.totalRegistrations += group.count;
    if (group._id.status === REGISTRATION_STATUSES.CONFIRMED) {
      totals.totalConfirmed += group.count;
    } else if (group._id.status === REGISTRATION_STATUSES.WAITLISTED) {
      totals.totalWaitlisted += group.count;
    } else if (group._id.status === REGISTRATION_STATUSES.CANCELLED) {
      totals.totalCancelled += group.count;
    }
  }

  let gateAcceptedIn = 0;
  let gateAcceptedOut = 0;
  for (const group of scanGroups) {
    const isAccepted = group._id.result === SCAN_RESULTS.ACCEPTED;
    if (!isAccepted || !gateCheckpointIdSet.has(String(group._id.checkpointId))) {
      continue;
    }
    if (group._id.direction === SCAN_DIRECTIONS.OUT) {
      gateAcceptedOut += group.count;
    } else {
      gateAcceptedIn += group.count;
    }
  }
  totals.totalCheckedInAtGate = gateAcceptedIn;
  totals.currentHeadcount = gateAcceptedIn - gateAcceptedOut;
  return totals;
}

/* Accepted event-entry scans per event, keyed by eventId. */
function buildCheckedInByEvent(scanGroups, checkpointById) {
  const checkedInByEvent = new Map();
  for (const group of scanGroups) {
    if (group._id.result !== SCAN_RESULTS.ACCEPTED) {
      continue;
    }
    const checkpoint = checkpointById.get(String(group._id.checkpointId));
    if (!checkpoint || checkpoint.checkpointType === CHECKPOINT_TYPES.GATE || !checkpoint.eventId) {
      continue;
    }
    const key = String(checkpoint.eventId);
    checkedInByEvent.set(key, (checkedInByEvent.get(key) || 0) + group.count);
  }
  return checkedInByEvent;
}

function buildBracketProgress(matchGroup) {
  if (!matchGroup) {
    return null;
  }
  return {
    totalMatches: matchGroup.totalMatches,
    completedMatches: matchGroup.completedMatches,
    currentRound: matchGroup.activeRound === NO_ACTIVE_ROUND ? null : matchGroup.activeRound,
  };
}

function buildRecentScans(scans) {
  return scans.map((scan) => ({
    participantName: scan.passId?.userId?.fullName || null,
    checkpointName: scan.checkpointId?.checkpointName || null,
    eventId: scan.checkpointId?.eventId ? String(scan.checkpointId.eventId) : null,
    result: scan.result,
    scannedAt: scan.scannedAt,
  }));
}

/*
 * The fest dashboard, assembled from a fixed handful of aggregation pipelines
 * rather than any per-event query loop. scopeEventIds narrows every figure to a
 * coordinator's own events; includeGate keeps the fest-wide gate headcount out of
 * a coordinator's view.
 */
async function getFestDashboard(festId, options = {}) {
  const { scopeEventIds = null, includeGate = true } = options;
  const now = new Date();

  const fest = await loadFestOrThrow(festId);
  const events = await loadScopedEvents(festId, scopeEventIds);
  const eventIds = events.map((event) => event._id);
  const eventIdSet = new Set(eventIds.map(String));

  const checkpoints = await CheckpointModel.find({ festId })
    .select("checkpointName checkpointType eventId")
    .lean();
  const { gateCheckpoints, relevantCheckpoints } = selectRelevantCheckpoints(
    checkpoints,
    eventIdSet,
    includeGate
  );
  const relevantCheckpointIds = relevantCheckpoints.map((checkpoint) => checkpoint._id);
  const gateCheckpointIdSet = new Set(gateCheckpoints.map((checkpoint) => String(checkpoint._id)));
  const checkpointById = indexById(relevantCheckpoints);

  const [registrationGroups, scanGroups, matchGroups, staffOnDuty, recentScanDocuments, offerClaims] =
    await Promise.all([
      aggregateRegistrations(eventIds),
      aggregateScans(relevantCheckpointIds),
      aggregateMatches(eventIds),
      countStaffOnDuty(festId, now),
      loadRecentScans(relevantCheckpointIds),
      // Fest-wide like the gate headcount, so it stays out of a coordinator's view.
      includeGate ? aggregateOfferClaims(fest) : Promise.resolve([]),
    ]);

  const totals = buildTotals(registrationGroups, scanGroups, checkpointById, gateCheckpointIdSet);
  const checkedInByEvent = buildCheckedInByEvent(scanGroups, checkpointById);
  const matchGroupByEvent = indexById(matchGroups);

  const eventSummaries = events.map((event) => ({
    eventId: String(event._id),
    eventName: event.eventName,
    category: event.category,
    status: event.status,
    registeredCount: event.registeredCount,
    capacity: event.capacity,
    checkedInCount: checkedInByEvent.get(String(event._id)) || 0,
    bracketProgress: buildBracketProgress(matchGroupByEvent.get(String(event._id))),
  }));

  return {
    fest: {
      festName: fest.festName,
      status: fest.status,
      startsOn: fest.startsOn,
      endsOn: fest.endsOn,
    },
    totals,
    events: eventSummaries,
    recentScans: buildRecentScans(recentScanDocuments),
    staffOnDuty,
    offerClaims,
  };
}

module.exports = { getFestDashboard };

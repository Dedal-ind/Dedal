const mongoose = require("mongoose");

const { FestModel } = require("../models/fest-model");
const { resolveEventScopeIds } = require("../helpers/event-descendant-helpers");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { ScanModel } = require("../models/scan-model");
const { PassModel } = require("../models/pass-model");
const { EntitlementModel } = require("../models/entitlement-model");
const { TeamModel } = require("../models/team-model");
const { UserModel } = require("../models/user-model");
const { CollegeModel } = require("../models/college-model");
const { SignInLogModel } = require("../models/sign-in-log-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { assignmentCoversEvent } = require("../helpers/assignment-coverage-helpers");
const {
  getAddOnAnalytics,
  getContingentAnalytics,
  getAttendanceAnalytics,
  getCertificateAnalytics,
  getRevenueByPurpose,
  getEngagementVelocity,
  getPlatformAddOnAnalytics,
  getPlatformContingentAnalytics,
  getPlatformCollegeLeaderboards,
} = require("./analytics-extras-service");
const {
  REGISTRATION_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_EXPIRY_MINUTES,
} = require("../constants/registration-constants");
const { TEAM_STATUSES } = require("../constants/team-constants");
const { CHECKPOINT_TYPES, SCAN_RESULTS, SCAN_DIRECTIONS } = require("../constants/scan-constants");
const {
  ENTITLEMENT_TYPES,
  ENTITLEMENT_STATUSES,
} = require("../constants/pass-constants");
const { RESERVED_OFFER_KEYS } = require("../constants/fest-constants");
const { FEST_STATUSES } = require("../constants/fest-constants");

const TIME_SERIES_LOOKBACK_DAYS = 90;
const PLATFORM_SIGN_IN_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const HYGIENE_SAMPLE_SIZE = 5;

/*
 * The analytical layer, deliberately separate from dashboard-service (the
 * operational layer) so the two can evolve independently. Every figure here is
 * a single Mongo aggregation pipeline — no per-document loops.
 */

async function loadFestOrThrow(festId) {
  const fest = mongoose.Types.ObjectId.isValid(festId)
    ? await FestModel.findById(festId).lean()
    : null;
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  return fest;
}

/*
 * The event scope the caller may see: every fest event for an administrator, the
 * covered subset for a coordinator (assignmentCoversEvent — hierarchy-aware, the
 * same rule the dashboard and certificate scoping use, never a fourth copy).
 */
async function resolveScopedEvents(fest, scope) {
  const events = await EventModel.find({ festId: fest._id })
    .select("eventName status registeredCount capacity")
    .lean();
  if (!scope || scope.isAdministrator) {
    return events;
  }
  const covered = [];
  for (const event of events) {
    if (await assignmentCoversEvent(scope.staffAssignment, event._id)) {
      covered.push(event);
    }
  }
  return covered;
}

/* Zero-filled day buckets from `startDate` through today — a graphed series must
 * never skip days (a missing day renders as a broken line and misleads). */
function buildDailySeries(startDate, countsByDay, valueKey) {
  const series = [];
  const start = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let time = start.getTime(); time <= end.getTime(); time += MILLISECONDS_PER_DAY) {
    const day = new Date(time).toISOString().slice(0, 10);
    series.push({ day, [valueKey]: countsByDay.get(day) ?? 0 });
  }
  return series;
}

function ratePair(numerator, denominator) {
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : 0,
  };
}

/*
 * The one-fetch summary the analytics tab renders from.
 */
async function getFestAnalyticsSummary(festId, scope = null, options = {}) {
  const fest = await loadFestOrThrow(festId);
  let events = await resolveScopedEvents(fest, scope);
  /*
   * Optional single-event scoping (?eventId=). Applied HERE, before a single
   * count is computed, so EVERY number in the response — funnel, attendance,
   * revenue, per-event breakdowns — is scoped consistently. A partial
   * application (some counts scoped, others fest-wide) would be worse than
   * none, so there is exactly one narrowing point.
   */
  if (options.eventId) {
    /*
     * includeDescendants widens "this event" to "this event and everything
     * under it", which is what selecting a parent in the admin's cascading
     * filter means. Still ONE narrowing point — only the id set it matches
     * against changes.
     */
    const scopeIds = new Set(
      await resolveEventScopeIds(fest._id, options.eventId, Boolean(options.includeDescendants))
    );
    events = events.filter((event) => scopeIds.has(String(event._id)));
  }
  const eventIds = events.map((event) => event._id);
  const eventById = new Map(events.map((event) => [String(event._id), event]));

  // ---- Funnel: registrations grouped on (eventId, status). ----
  const funnelGroups = eventIds.length
    ? await RegistrationModel.aggregate([
        { $match: { eventId: { $in: eventIds } } },
        { $group: { _id: { eventId: "$eventId", status: "$status" }, count: { $sum: 1 } } },
      ])
    : [];

  /*
   * A FACTORY, not a shared literal. Seeding a per-event bucket with
   * `{ ...festFunnel }` (as this did) copies the running fest total into it, so
   * the second event's counts started at the first event's totals and every
   * per-event number came out inflated — 1, 2, 3, 4 for four events holding one
   * registration each. The fest bucket is just another zeroed bucket.
   */
  const buildEmptyFunnel = () => ({
    registrationsInitiated: 0,
    registrationsPendingPayment: 0,
    registrationsConfirmed: 0,
    registrationsCancelled: 0,
    registrationsPaymentExpired: 0,
  });

  const festFunnel = buildEmptyFunnel();
  const perEventFunnel = new Map();
  for (const group of funnelGroups) {
    const eventKey = String(group._id.eventId);
    if (!perEventFunnel.has(eventKey)) {
      perEventFunnel.set(eventKey, buildEmptyFunnel());
    }
    const buckets = [perEventFunnel.get(eventKey), festFunnel];
    for (const bucket of buckets) {
      bucket.registrationsInitiated += group.count;
      if (group._id.status === REGISTRATION_STATUSES.PENDING_PAYMENT) {
        bucket.registrationsPendingPayment += group.count;
      } else if (group._id.status === REGISTRATION_STATUSES.CANCELLED) {
        bucket.registrationsCancelled += group.count;
      } else if (group._id.status === REGISTRATION_STATUSES.PAYMENT_EXPIRED) {
        bucket.registrationsPaymentExpired += group.count;
      } else {
        // Everything else — confirmed, attended, winners, bracket progress — is
        // a CONFIRMED seat that later changed label; it still converted.
        bucket.registrationsConfirmed += group.count;
      }
    }
  }

  // ---- Attendance: distinct pass owners with ≥1 ACCEPTED scan at an
  // eventEntry checkpoint of an in-scope event. Grouped on pass.userId. ----
  const entryCheckpoints = eventIds.length
    ? await CheckpointModel.find({
        festId: fest._id,
        checkpointType: CHECKPOINT_TYPES.EVENT_ENTRY,
        eventId: { $in: eventIds },
      })
        .select("_id eventId")
        .lean()
    : [];
  const checkpointEventById = new Map(
    entryCheckpoints.map((checkpoint) => [String(checkpoint._id), String(checkpoint.eventId)])
  );
  /*
   * One pass over the accepted scans, grouped down to (checkpoint, direction,
   * person). Distinctness is per PERSON: someone scanned in three times is one
   * check-in, matching how a gate marshal counts heads.
   */
  const scanIdentityGroups = entryCheckpoints.length
    ? await ScanModel.aggregate([
        {
          $match: {
            checkpointId: { $in: entryCheckpoints.map((checkpoint) => checkpoint._id) },
            result: SCAN_RESULTS.ACCEPTED,
          },
        },
        { $lookup: { from: "passes", localField: "passId", foreignField: "_id", as: "pass" } },
        { $unwind: "$pass" },
        {
          $group: {
            _id: {
              checkpointId: "$checkpointId",
              direction: "$direction",
              userId: "$pass.userId",
            },
          },
        },
      ])
    : [];

  const attendedUserIds = new Set();
  const checkedOutUserIds = new Set();
  const scansPerEvent = new Map(); // eventId -> { checkIns: Set, checkOuts: Set }
  for (const group of scanIdentityGroups) {
    const eventKey = checkpointEventById.get(String(group._id.checkpointId));
    if (!eventKey) {
      continue;
    }
    if (!scansPerEvent.has(eventKey)) {
      scansPerEvent.set(eventKey, { checkIns: new Set(), checkOuts: new Set() });
    }
    const buckets = scansPerEvent.get(eventKey);
    const userKey = String(group._id.userId);
    if (group._id.direction === SCAN_DIRECTIONS.OUT) {
      buckets.checkOuts.add(userKey);
      checkedOutUserIds.add(userKey);
    } else {
      buckets.checkIns.add(userKey);
      attendedUserIds.add(userKey);
    }
  }
  const attendedCount = attendedUserIds.size;

  // ---- Revenue in paise, grouped on (eventId) over CONFIRMED-family rows. ----
  const confirmedStatuses = Object.values(REGISTRATION_STATUSES).filter(
    (status) =>
      ![
        REGISTRATION_STATUSES.PENDING_PAYMENT,
        REGISTRATION_STATUSES.CANCELLED,
        REGISTRATION_STATUSES.PAYMENT_EXPIRED,
      ].includes(status)
  );
  const revenueGroups = eventIds.length
    ? await RegistrationModel.aggregate([
        { $match: { eventId: { $in: eventIds }, status: { $in: confirmedStatuses } } },
        {
          $group: {
            _id: "$eventId",
            grossPaise: { $sum: { $ifNull: ["$totalFeePaise", 0] } },
            confirmedCount: { $sum: 1 },
          },
        },
      ])
    : [];
  const pendingRevenueGroups = eventIds.length
    ? await RegistrationModel.aggregate([
        { $match: { eventId: { $in: eventIds }, status: REGISTRATION_STATUSES.PENDING_PAYMENT } },
        { $group: { _id: null, pendingPaise: { $sum: { $ifNull: ["$totalFeePaise", 0] } } } },
      ])
    : [];
  const grossRevenuePaise = revenueGroups.reduce((total, group) => total + group.grossPaise, 0);
  const perEventRevenue = revenueGroups
    .map((group) => ({
      eventId: String(group._id),
      eventName: eventById.get(String(group._id))?.eventName ?? null,
      confirmedCount: group.confirmedCount,
      grossPaise: group.grossPaise,
    }))
    .sort((left, right) => right.grossPaise - left.grossPaise);

  // ---- Time series, bucketed on registeredAt (the schema has no confirmedAt;
  // registeredAt is the stable moment a row was created, and updatedAt moves on
  // unrelated edits). Zero-filled from startsOn - 90 days through today. ----
  const seriesStart = new Date(
    new Date(fest.startsOn).getTime() - TIME_SERIES_LOOKBACK_DAYS * MILLISECONDS_PER_DAY
  );
  const dailyGroups = eventIds.length
    ? await RegistrationModel.aggregate([
        { $match: { eventId: { $in: eventIds }, registeredAt: { $gte: seriesStart } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$registeredAt" } },
            registrationCount: { $sum: 1 },
            confirmedRevenuePaise: {
              $sum: {
                $cond: [
                  { $in: ["$status", confirmedStatuses] },
                  { $ifNull: ["$totalFeePaise", 0] },
                  0,
                ],
              },
            },
          },
        },
      ])
    : [];
  const registrationsByDay = new Map(dailyGroups.map((g) => [g._id, g.registrationCount]));
  const revenueByDay = new Map(dailyGroups.map((g) => [g._id, g.confirmedRevenuePaise]));

  // ---- Demographics over DISTINCT participants holding a confirmed seat.
  // Grouped first on userId (dedupe), then on each demographic field.
  // gender comes from registration.genderCategory (the user model carries no
  // gender field); null buckets as "unspecified" so totals tie out. ----
  const demographicRows = eventIds.length
    ? await RegistrationModel.aggregate([
        { $match: { eventId: { $in: eventIds }, status: { $in: confirmedStatuses } } },
        {
          $group: {
            _id: "$userId",
            genderCategory: { $first: "$genderCategory" },
            paidPaise: { $sum: { $ifNull: ["$totalFeePaise", 0] } },
          },
        },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            collegeId: "$user.collegeId",
            department: "$user.department",
            yearOfStudy: "$user.yearOfStudy",
            genderCategory: 1,
            paidPaise: 1,
          },
        },
      ])
    : [];
  const distinctConfirmedParticipants = demographicRows.length;

  function bucketBy(keyOf) {
    const buckets = new Map();
    for (const row of demographicRows) {
      const key = keyOf(row);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return [...buckets.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((left, right) => right.count - left.count);
  }

  const collegeBuckets = bucketBy((row) => (row.collegeId ? String(row.collegeId) : "unspecified"));
  const collegeNames = await CollegeModel.find({
    _id: {
      $in: collegeBuckets
        .filter((bucket) => bucket.key !== "unspecified")
        .map((bucket) => new mongoose.Types.ObjectId(bucket.key)),
    },
  })
    .select("commonName")
    .lean();
  const collegeNameById = new Map(collegeNames.map((college) => [String(college._id), college.commonName]));

  // Paid participants per college for the top-10 paid list.
  const paidByCollege = new Map();
  for (const row of demographicRows) {
    if (row.paidPaise > 0) {
      const key = row.collegeId ? String(row.collegeId) : "unspecified";
      paidByCollege.set(key, (paidByCollege.get(key) ?? 0) + 1);
    }
  }

  const demographics = {
    totalConfirmedParticipants: distinctConfirmedParticipants,
    byCollege: collegeBuckets.map((bucket) => ({
      collegeId: bucket.key === "unspecified" ? null : bucket.key,
      collegeName: collegeNameById.get(bucket.key) ?? "Unspecified",
      count: bucket.count,
    })),
    // Free text; the frontend collapses legacy slugs via formatDepartmentLabel.
    byDepartment: bucketBy((row) => row.department ?? "unspecified").map((bucket) => ({
      department: bucket.key,
      count: bucket.count,
    })),
    byYearOfStudy: bucketBy((row) => (row.yearOfStudy != null ? String(row.yearOfStudy) : "unspecified")).map(
      (bucket) => ({ yearOfStudy: bucket.key, count: bucket.count })
    ),
    byGender: bucketBy((row) => row.genderCategory ?? "unspecified").map((bucket) => ({
      gender: bucket.key,
      count: bucket.count,
    })),
    topCollegesByPaidCount: [...paidByCollege.entries()]
      .map(([key, count]) => ({
        collegeId: key === "unspecified" ? null : key,
        collegeName: collegeNameById.get(key) ?? "Unspecified",
        count,
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 10),
  };

  // ---- Offers: selected participants vs claims consumed at the counter.
  // selected groups on userId per offer; claimed sums usedCount over active
  // OFFER_CLAIM entitlements whose referenceId is the offer subdocument _id. ----
  const festPasses = await PassModel.find({ festId: fest._id }).select("_id").lean();
  const claimGroups = festPasses.length
    ? await EntitlementModel.aggregate([
        {
          $match: {
            passId: { $in: festPasses.map((pass) => pass._id) },
            entitlementType: ENTITLEMENT_TYPES.OFFER_CLAIM,
            status: ENTITLEMENT_STATUSES.ACTIVE,
          },
        },
        { $group: { _id: "$referenceId", claimedCount: { $sum: "$usedCount" } } },
      ])
    : [];
  const claimedByOfferId = new Map(claimGroups.map((group) => [String(group._id), group.claimedCount]));

  const offerStats = [];
  for (const offer of (fest.offers ?? []).filter((candidate) => candidate.isActive !== false)) {
    // Selection is per reserved key (dedicated fields) or offerSelections match.
    let selectionMatch;
    if (offer.offerKey === RESERVED_OFFER_KEYS.FOOD) {
      selectionMatch = { foodPreference: { $nin: [null, "noMealNeeded"] } };
    } else if (offer.offerKey === RESERVED_OFFER_KEYS.ACCOMMODATION) {
      selectionMatch = { needsAccommodation: true };
    } else {
      selectionMatch = { "offerSelections.offerId": offer._id };
    }
    const selectedGroups = eventIds.length
      ? await RegistrationModel.aggregate([
          {
            $match: {
              eventId: { $in: eventIds },
              status: { $in: confirmedStatuses },
              ...selectionMatch,
            },
          },
          { $group: { _id: "$userId" } },
          { $count: "selectedCount" },
        ])
      : [];
    const selectedCount = selectedGroups[0]?.selectedCount ?? 0;
    const claimedCount = claimedByOfferId.get(String(offer._id)) ?? 0;
    offerStats.push({
      offerId: String(offer._id),
      offerName: offer.offerName,
      offerKey: offer.offerKey,
      selectedCount,
      claimedCount,
      redemption: ratePair(claimedCount, selectedCount),
    });
  }

  // ---- Teams, grouped on status; sizes from the roster length. ----
  const teamGroups = eventIds.length
    ? await TeamModel.aggregate([
        { $match: { eventId: { $in: eventIds } } },
        {
          $lookup: {
            from: "events",
            localField: "eventId",
            foreignField: "_id",
            as: "event",
          },
        },
        { $unwind: "$event" },
        {
          $group: {
            _id: "$status",
            count: { $sum: 1 },
            averageSize: { $avg: { $size: "$memberUserIds" } },
            lockedExactlyAtMinimum: {
              $sum: {
                $cond: [
                  { $eq: [{ $size: "$memberUserIds" }, "$event.minimumTeamSize"] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
    : [];
  const teamByStatus = new Map(teamGroups.map((group) => [group._id, group]));
  const lockedGroup = teamByStatus.get(TEAM_STATUSES.LOCKED);
  const teamStats = {
    teamsForming: teamByStatus.get(TEAM_STATUSES.FORMING)?.count ?? 0,
    teamsLocked: lockedGroup?.count ?? 0,
    teamsCancelled: teamByStatus.get(TEAM_STATUSES.DISQUALIFIED)?.count ?? 0,
    averageTeamSizeOnConfirmed: lockedGroup?.averageSize ?? null,
    // Locking below minimum is impossible; teams that locked EXACTLY at minimum
    // are the "just barely made it" proxy.
    teamsLockedExactlyAtMinimum: lockedGroup?.lockedExactlyAtMinimum ?? 0,
  };

  /* Parallel: none of the six depends on another's result. */
  const [addOns, contingents, attendance, certificates, revenueByPurpose, velocity] =
    await Promise.all([
      getAddOnAnalytics(fest._id, eventIds, festFunnel.registrationsConfirmed),
      getContingentAnalytics(fest._id),
      getAttendanceAnalytics(fest._id, eventIds, festFunnel.registrationsConfirmed),
      getCertificateAnalytics(fest._id, eventIds),
      getRevenueByPurpose(fest._id),
      getEngagementVelocity(fest._id, eventIds, fest),
    ]);
  const extras = { addOns, contingents, attendance, certificates, revenueByPurpose, velocity };

  return {
    fest: { festId: String(fest._id), festName: fest.festName, festSlug: fest.festSlug },
    scopedEventCount: events.length,
    /*
     * The dashboard drill-down headline. Check-outs carry an honesty flag:
     * ensureEventEntryCheckpoint creates IN_ONLY doors, so unless an admin has
     * hand-configured an in-and-out door, no OUT scan can exist and a bare "0"
     * would read as "everyone is still inside". checkOutScanningObserved says
     * whether any OUT-capable data exists at all.
     */
    headline: {
      totalRegistrationsCount: festFunnel.registrationsConfirmed,
      totalCheckInsCount: attendedCount,
      totalCheckOutsCount: checkedOutUserIds.size,
      checkOutScanningObserved: checkedOutUserIds.size > 0,
    },
    scansPerEvent: events.map((event) => {
      const buckets = scansPerEvent.get(String(event._id));
      return {
        eventId: String(event._id),
        eventName: event.eventName,
        checkInsCount: buckets?.checkIns.size ?? 0,
        checkOutsCount: buckets?.checkOuts.size ?? 0,
      };
    }),
    funnel: {
      ...festFunnel,
      conversion: ratePair(festFunnel.registrationsConfirmed, festFunnel.registrationsInitiated),
      attendedCount,
      attendance: ratePair(attendedCount, festFunnel.registrationsConfirmed),
      perEvent: events.map((event) => ({
        eventId: String(event._id),
        eventName: event.eventName,
        capacity: event.capacity,
        ...(perEventFunnel.get(String(event._id)) ?? festFunnelZero()),
      })),
    },
    revenue: {
      grossRevenuePaise,
      pendingRevenuePaise: pendingRevenueGroups[0]?.pendingPaise ?? 0,
      perEventRevenue,
    },
    timeSeries: {
      registrationsPerDay: buildDailySeries(seriesStart, registrationsByDay, "count"),
      revenuePerDayPaise: buildDailySeries(seriesStart, revenueByDay, "paise"),
    },
    demographics,
    offers: offerStats,
    teams: teamStats,
    /*
     * THE SIX ADDITIONS, on the EXISTING endpoint rather than six new routes.
     *
     * The dashboard renders one screen from one request, and splitting these
     * across routes would mean six loading states for one page. They run in
     * parallel with each other and are computed from ids this function has
     * already resolved, so the scoping (?eventId=, includeDescendants) applies
     * to them exactly as it does to everything above.
     *
     * Each returns zeroes rather than throwing, so a fest with no add-ons and
     * no certificates — which is most fests, most of the time — still renders.
     */
    ...extras,
  };
}

function festFunnelZero() {
  return {
    registrationsInitiated: 0,
    registrationsPendingPayment: 0,
    registrationsConfirmed: 0,
    registrationsCancelled: 0,
    registrationsPaymentExpired: 0,
  };
}

/*
 * Data-integrity findings. Each is a bounded count plus the FIRST five ids only
 * — a hygiene report, not a database dump.
 */
async function getFestHygieneReport(festId) {
  const fest = await loadFestOrThrow(festId);
  const events = await EventModel.find({ festId: fest._id }).select("_id").lean();
  const eventIds = events.map((event) => event._id);
  const now = Date.now();
  const expiryCutoff = new Date(now - PAYMENT_EXPIRY_MINUTES * 60 * 1000);
  const expiringSoonCutoff = new Date(now - (PAYMENT_EXPIRY_MINUTES - 10) * 60 * 1000);

  async function finding(code, description, model, filter, extraPipeline = null) {
    let count;
    let sampleIds;
    if (extraPipeline) {
      const rows = await model.aggregate(extraPipeline);
      count = rows.length;
      sampleIds = rows.slice(0, HYGIENE_SAMPLE_SIZE).map((row) => String(row._id));
    } else {
      count = await model.countDocuments(filter);
      const samples = await model.find(filter).select("_id").limit(HYGIENE_SAMPLE_SIZE).lean();
      sampleIds = samples.map((row) => String(row._id));
    }
    return { code, description, count, sampleIds };
  }

  const festPasses = await PassModel.find({ festId: fest._id }).select("_id userId").lean();
  const festPassIds = festPasses.map((pass) => pass._id);

  return {
    findings: [
      await finding(
        "pendingPaymentsExpiringInNext10Minutes",
        "Pending payments whose 30-minute hold lapses within the next 10 minutes.",
        RegistrationModel,
        {
          eventId: { $in: eventIds },
          status: REGISTRATION_STATUSES.PENDING_PAYMENT,
          createdAt: { $lt: expiringSoonCutoff, $gte: expiryCutoff },
        }
      ),
      await finding(
        "pendingPaymentsPastExpiryNotYetReaped",
        "Pending payments past their expiry that the lazy sweep has not yet reaped.",
        RegistrationModel,
        {
          eventId: { $in: eventIds },
          status: REGISTRATION_STATUSES.PENDING_PAYMENT,
          createdAt: { $lt: expiryCutoff },
        }
      ),
      await finding(
        "registrationsWithNoUserId",
        "Registrations with no user attached (orphans).",
        RegistrationModel,
        { eventId: { $in: eventIds }, userId: null }
      ),
      await finding(
        "teamsWithNoLeader",
        "Teams whose leaderUserId is missing.",
        TeamModel,
        { eventId: { $in: eventIds }, leaderUserId: null }
      ),
      await finding(
        "entitlementsWithNoPass",
        "Entitlements pointing at a pass that no longer exists.",
        EntitlementModel,
        null,
        [
          { $match: festPassIds.length ? { passId: { $nin: festPassIds } } : {} },
          { $lookup: { from: "passes", localField: "passId", foreignField: "_id", as: "pass" } },
          { $match: { pass: { $size: 0 } } },
          { $limit: 500 },
        ]
      ),
      await finding(
        "passesWithoutGateAccessEntitlement",
        "Passes with no active gate-access entitlement — the gate will refuse them.",
        PassModel,
        null,
        [
          { $match: { festId: fest._id } },
          {
            $lookup: {
              from: "entitlements",
              let: { passId: "$_id" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$passId", "$$passId"] },
                        { $eq: ["$entitlementType", ENTITLEMENT_TYPES.GATE_ACCESS] },
                        { $eq: ["$status", ENTITLEMENT_STATUSES.ACTIVE] },
                      ],
                    },
                  },
                },
              ],
              as: "gateAccess",
            },
          },
          { $match: { gateAccess: { $size: 0 } } },
        ]
      ),
      await finding(
        "registrationsMarkedConfirmedWithoutPass",
        "Confirmed registrations whose holder has no pass — they cannot enter.",
        RegistrationModel,
        null,
        [
          {
            $match: {
              eventId: { $in: eventIds },
              status: REGISTRATION_STATUSES.CONFIRMED,
              paymentStatus: { $ne: PAYMENT_STATUSES.PENDING },
            },
          },
          {
            $lookup: {
              from: "passes",
              let: { userId: "$userId" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$userId", "$$userId"] },
                        { $eq: ["$festId", fest._id] },
                      ],
                    },
                  },
                },
              ],
              as: "pass",
            },
          },
          { $match: { pass: { $size: 0 } } },
        ]
      ),
      await finding(
        "usersWithIncompleteProfilesHoldingConfirmedSeat",
        "Confirmed participants whose profile is incomplete — they will be stopped at the gate.",
        RegistrationModel,
        null,
        [
          { $match: { eventId: { $in: eventIds }, status: REGISTRATION_STATUSES.CONFIRMED } },
          { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "user" } },
          { $unwind: "$user" },
          { $match: { "user.isProfileComplete": { $ne: true } } },
        ]
      ),
      await finding(
        "offerClaimsExceedingSelections",
        "Offer claims consumed past their ceiling — the sync clamp should make this impossible.",
        EntitlementModel,
        null,
        [
          {
            $match: {
              passId: { $in: festPassIds },
              entitlementType: ENTITLEMENT_TYPES.OFFER_CLAIM,
              $expr: { $gt: ["$usedCount", { $ifNull: ["$maximumUses", Number.MAX_SAFE_INTEGER] }] },
            },
          },
        ]
      ),
      /*
       * Browser crashes in the last 24 hours. PLATFORM-WIDE, not fest-scoped —
       * a client error carries no fest, and the question it answers ("is the
       * scanner falling over on someone's phone right now") is not one any fest
       * owns. It rides in this report because this is the panel an operator
       * already checks, and a finding nobody opens is a finding nobody acts on.
       */
      await buildClientErrorFinding(),
    ],
  };
}

/*
 * Shaped like the findings above — code, description, count — with the top
 * messages in place of sample ids, because an error id is useless to a human
 * and the message is the whole diagnosis.
 */
async function buildClientErrorFinding() {
  const {
    getRecentClientErrorSummary,
    HYGIENE_WINDOW_HOURS,
  } = require("./client-error-log-service");
  const summary = await getRecentClientErrorSummary();
  return {
    code: "clientErrorsLast24Hours",
    description: `Browser errors reported by the app in the last ${HYGIENE_WINDOW_HOURS} hours.`,
    count: summary.totalCount,
    sampleIds: [],
    topMessages: summary.topMessages,
  };
}

/* The platform-wide view — platform admin only (enforced at the route). */
async function getPlatformAnalytics() {
  const ninetyDaysAgo = new Date(Date.now() - TIME_SERIES_LOOKBACK_DAYS * MILLISECONDS_PER_DAY);
  const thirtyDaysAgo = new Date(Date.now() - PLATFORM_SIGN_IN_DAYS * MILLISECONDS_PER_DAY);
  const cancelledFamily = [
    REGISTRATION_STATUSES.PENDING_PAYMENT,
    REGISTRATION_STATUSES.CANCELLED,
    REGISTRATION_STATUSES.PAYMENT_EXPIRED,
  ];

  const [
    totalColleges,
    festStatusGroups,
    totalPublishedEvents,
    totalRegistrationsAllTime,
    confirmedGroups,
    registrationDayGroups,
    topFestGroups,
    collegeHostGroups,
    signInDayGroups,
  ] = await Promise.all([
    CollegeModel.countDocuments({}),
    // Grouped on fest.status.
    FestModel.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    EventModel.countDocuments({ status: "published" }),
    RegistrationModel.countDocuments({}),
    // Confirmed-family rows: everything that is not pending/cancelled/expired.
    RegistrationModel.aggregate([
      { $match: { status: { $nin: cancelledFamily } } },
      {
        $group: {
          _id: null,
          confirmedCount: { $sum: 1 },
          grossPaise: { $sum: { $ifNull: ["$totalFeePaise", 0] } },
        },
      },
    ]),
    // Grouped on the registeredAt calendar day.
    RegistrationModel.aggregate([
      { $match: { registeredAt: { $gte: ninetyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$registeredAt" } },
          count: { $sum: 1 },
        },
      },
    ]),
    // Grouped on the event's festId, counting confirmed-family rows.
    RegistrationModel.aggregate([
      { $match: { status: { $nin: cancelledFamily } } },
      { $lookup: { from: "events", localField: "eventId", foreignField: "_id", as: "event" } },
      { $unwind: "$event" },
      { $group: { _id: "$event.festId", confirmedCount: { $sum: 1 } } },
      { $sort: { confirmedCount: -1 } },
      { $limit: 10 },
      { $lookup: { from: "fests", localField: "_id", foreignField: "_id", as: "fest" } },
      { $unwind: "$fest" },
      { $project: { festName: "$fest.festName", confirmedCount: 1 } },
    ]),
    // Grouped on hostCollegeId: how many fests each college has hosted.
    FestModel.aggregate([
      { $group: { _id: "$hostCollegeId", festCount: { $sum: 1 } } },
      { $sort: { festCount: -1 } },
      { $limit: 10 },
      { $lookup: { from: "colleges", localField: "_id", foreignField: "_id", as: "college" } },
      { $unwind: { path: "$college", preserveNullAndEmptyArrays: true } },
      { $project: { collegeName: "$college.commonName", festCount: 1 } },
    ]),
    // Grouped on the signedInAt calendar day.
    SignInLogModel.aggregate([
      { $match: { signedInAt: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$signedInAt" } },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const festsByStatus = Object.fromEntries(
    Object.values(FEST_STATUSES).map((status) => [
      status,
      festStatusGroups.find((group) => group._id === status)?.count ?? 0,
    ])
  );

  const [platformAddOns, platformContingents, platformLeaderboards] = await Promise.all([
    getPlatformAddOnAnalytics(confirmedGroups[0]?.confirmedCount ?? 0),
    getPlatformContingentAnalytics(),
    getPlatformCollegeLeaderboards(),
  ]);

  return {
    totalColleges,
    totalFests: festsByStatus,
    totalPublishedEvents,
    totalRegistrationsAllTime,
    totalConfirmedRegistrationsAllTime: confirmedGroups[0]?.confirmedCount ?? 0,
    totalGrossRevenuePaise: confirmedGroups[0]?.grossPaise ?? 0,
    registrationsPerDay: buildDailySeries(
      ninetyDaysAgo,
      new Map(registrationDayGroups.map((group) => [group._id, group.count])),
      "count"
    ),
    signInsPerDay: buildDailySeries(
      thirtyDaysAgo,
      new Map(signInDayGroups.map((group) => [group._id, group.count])),
      "count"
    ),
    topFestsByConfirmedCount: topFestGroups.map((group) => ({
      festId: String(group._id),
      festName: group.festName,
      confirmedCount: group.confirmedCount,
    })),
    topCollegesByAdministratorActivity: collegeHostGroups.map((group) => ({
      collegeId: String(group._id),
      collegeName: group.collegeName ?? "Unknown",
      festCount: group.festCount,
    })),
    /*
     * The platform additions. topCollegesByAdministratorActivity above ranks by
     * how many fests a college HOSTS, which measures activity rather than
     * scale; these two rank by registrations and by money, which is what the
     * super-admin comparison is actually asking.
     */
    addOns: platformAddOns,
    contingents: platformContingents,
    ...platformLeaderboards,
  };
}

module.exports = { getFestAnalyticsSummary, getFestHygieneReport, getPlatformAnalytics };

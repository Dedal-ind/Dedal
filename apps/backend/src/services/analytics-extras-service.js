/*
 * analytics-extras-service.js
 *
 * The aggregations the fest summary was missing: add-on sales, contingent
 * purchases, attendance rates, certificates by type, revenue by purpose and
 * registration velocity.
 *
 * WHY A SEPARATE FILE. analytics-service.js is already 867 lines and
 * getFestAnalyticsSummary is one 440-line function; folding six more
 * aggregations into it would make the thing unreadable. These are pure
 * functions of (festId, eventIds) with no shared state, so they compose into
 * that summary from outside it. The patterns — $match/$group pipelines, the
 * ratePair shape, paise everywhere, plain objects out — are the existing ones.
 *
 * EVERY FUNCTION RETURNS ZEROES RATHER THAN THROWING. A fest with no add-ons,
 * no contingents and no certificates is the normal case for most of the year,
 * and an analytics panel is never worth failing a dashboard over. Where a
 * collection is empty the aggregate simply returns [] and the `?? 0` fallbacks
 * carry it; where an id list is empty the query is skipped entirely rather than
 * sent as `$in: []`.
 */
const { AddOnOrderModel } = require("../models/add-on-order-model");
const { ContingentModel } = require("../models/contingent-model");
const { ContingentClaimModel } = require("../models/contingent-claim-model");
const { CertificateModel } = require("../models/certificate-model");
const { PaymentOrderModel } = require("../models/payment-order-model");
const { RegistrationModel } = require("../models/registration-model");
const { ScanModel } = require("../models/scan-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { CollegeModel } = require("../models/college-model");
const { CERTIFICATE_TYPES } = require("../constants/certificate-constants");
const { CONTINGENT_CLAIM_STATUSES } = require("../constants/contingent-constants");
const { SCAN_RESULTS, SCAN_DIRECTIONS } = require("../constants/scan-constants");

/* Mirrors ratePair in analytics-service: the numerator and denominator travel
   with the rate so a dashboard can show "18 of 40" rather than only "45%". */
function ratePair(numerator, denominator) {
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : 0,
  };
}

/*
 * A completed add-on order is one the participant actually paid for. `pending`
 * is a checkout someone opened and did not finish, and `cancelled` is one that
 * was unwound — counting either as revenue would overstate what the fest has
 * taken, which is the one number an organiser must be able to trust.
 */
const ADD_ON_ORDER_COMPLETED = "completed";

/* ── 1. Add-ons ──────────────────────────────────────────────────────────── */

async function getAddOnAnalytics(festId, eventIds, confirmedRegistrationCount) {
  const match = { festId };
  if (eventIds?.length) {
    match.eventId = { $in: eventIds };
  }

  const [totals, perOffer] = await Promise.all([
    AddOnOrderModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$status",
          orderCount: { $sum: 1 },
          revenuePaise: { $sum: { $ifNull: ["$amountPaise", 0] } },
        },
      },
    ]),
    /*
     * One row per (scope, offerKey). An order carries several selections, so
     * $unwind first — otherwise a three-add-on order would count once and the
     * "most popular" answer would be about ORDERS, not about offers.
     *
     * scope rides in the key because a fest-wide "Shuttle" and an event-only
     * one are different offers at different rates; merging them on the key
     * alone would silently add two products together.
     */
    AddOnOrderModel.aggregate([
      { $match: { ...match, status: ADD_ON_ORDER_COMPLETED } },
      { $unwind: "$offerSelections" },
      {
        $group: {
          _id: {
            offerKey: "$offerSelections.offerKey",
            scope: "$offerSelections.scope",
          },
          orderCount: { $sum: 1 },
          numberOfPeople: { $sum: { $ifNull: ["$offerSelections.numberOfPeople", 0] } },
          numberOfDays: { $sum: { $ifNull: ["$offerSelections.numberOfDays", 0] } },
        },
      },
      { $sort: { orderCount: -1 } },
    ]),
  ]);

  const completed = totals.find((row) => row._id === ADD_ON_ORDER_COMPLETED);
  const pending = totals.find((row) => row._id === "pending");

  const byOffer = perOffer.map((row) => ({
    offerKey: row._id.offerKey,
    scope: row._id.scope ?? "fest",
    orderCount: row.orderCount,
    numberOfPeople: row.numberOfPeople,
    numberOfDays: row.numberOfDays,
  }));

  return {
    totalOrders: completed?.orderCount ?? 0,
    pendingOrders: pending?.orderCount ?? 0,
    revenuePaise: completed?.revenuePaise ?? 0,
    pendingRevenuePaise: pending?.revenuePaise ?? 0,
    /* The single most-bought offer, or null when nothing has sold. Sorted above,
       so this is the head of the list rather than a second pass. */
    mostPopularOffer: byOffer[0] ?? null,
    /*
     * ATTACH RATE: completed orders over confirmed registrations. It can exceed
     * 1 — one participant may place several add-on orders — and that is a real
     * and meaningful signal ("people are coming back for more"), so it is not
     * clamped. The pair travels with it so the dashboard can show both numbers.
     */
    attachRate: ratePair(completed?.orderCount ?? 0, confirmedRegistrationCount ?? 0),
    byOffer,
  };
}

/* ── 2. Contingents ──────────────────────────────────────────────────────── */

async function getContingentAnalytics(festId) {
  const contingents = await ContingentModel.find({ festId })
    .select("contingentName pricePaise maximumBundleClaims soldBundleCount includedEventIds status")
    .lean();

  if (contingents.length === 0) {
    return {
      totalPurchases: 0,
      revenuePaise: 0,
      slotsSold: 0,
      slotsTotal: 0,
      slotFill: ratePair(0, 0),
      byPackage: [],
    };
  }

  /*
   * Claims are the SEATS; soldBundleCount on the contingent is the BUNDLES.
   * They are different units and the dashboard needs both: five bundles of four
   * is five purchases and twenty seats. Counting claims as purchases would
   * quintuple the revenue.
   *
   * A declined, cancelled or expired claim is a seat that came back, so only
   * invited and accepted occupy one.
   */
  const liveClaimStatuses = [
    CONTINGENT_CLAIM_STATUSES.INVITED,
    CONTINGENT_CLAIM_STATUSES.ACCEPTED,
  ];
  const claimGroups = await ContingentClaimModel.aggregate([
    { $match: { festId, claimStatus: { $in: liveClaimStatuses } } },
    { $group: { _id: "$contingentId", claimCount: { $sum: 1 } } },
  ]);
  const claimsByContingent = new Map(
    claimGroups.map((row) => [String(row._id), row.claimCount])
  );

  let totalPurchases = 0;
  let revenuePaise = 0;
  let slotsSold = 0;
  let slotsTotal = 0;

  const byPackage = contingents.map((contingent) => {
    const sold = contingent.soldBundleCount ?? 0;
    const capacity = contingent.maximumBundleClaims ?? null;
    const claims = claimsByContingent.get(String(contingent._id)) ?? 0;
    const packageRevenue = sold * (contingent.pricePaise ?? 0);

    totalPurchases += sold;
    revenuePaise += packageRevenue;
    slotsSold += sold;
    /* An uncapped package contributes its sales to the total rather than an
       imaginary ceiling — otherwise "80 of 0 sold" comes out as the fill rate. */
    slotsTotal += capacity ?? sold;

    return {
      contingentId: String(contingent._id),
      contingentName: contingent.contingentName,
      status: contingent.status,
      pricePaise: contingent.pricePaise ?? 0,
      includedEventCount: contingent.includedEventIds?.length ?? 0,
      bundlesSold: sold,
      bundlesCapacity: capacity,
      seatsClaimed: claims,
      revenuePaise: packageRevenue,
      fill: ratePair(sold, capacity ?? sold),
    };
  });

  return {
    totalPurchases,
    revenuePaise,
    slotsSold,
    slotsTotal,
    slotFill: ratePair(slotsSold, slotsTotal),
    byPackage,
  };
}

/* ── 3. Attendance ───────────────────────────────────────────────────────── */

async function getAttendanceAnalytics(festId, eventIds, confirmedRegistrationCount) {
  const checkpoints = await CheckpointModel.find({ festId })
    .select("checkpointName checkpointType eventId")
    .lean();

  if (checkpoints.length === 0) {
    return {
      checkInRate: ratePair(0, confirmedRegistrationCount ?? 0),
      peakHour: null,
      perEvent: [],
      perGate: [],
    };
  }

  /*
   * DISTINCT PEOPLE, not scan rows. A gate that re-scans somebody is a second
   * row and the same attendee; counting rows would let one busy checkpoint push
   * the check-in rate above 100%.
   */
  const scans = await ScanModel.aggregate([
    {
      $match: {
        checkpointId: { $in: checkpoints.map((row) => row._id) },
        result: SCAN_RESULTS.ACCEPTED,
        direction: SCAN_DIRECTIONS.IN,
      },
    },
    { $project: { checkpointId: 1, passId: 1, scannedAt: 1 } },
  ]);

  const attendeesByCheckpoint = new Map();
  const attendeesOverall = new Set();
  const scansByHour = new Map();

  for (const scan of scans) {
    const checkpointKey = String(scan.checkpointId);
    const attendeeKey = String(scan.passId ?? "");
    if (!attendeesByCheckpoint.has(checkpointKey)) {
      attendeesByCheckpoint.set(checkpointKey, new Set());
    }
    attendeesByCheckpoint.get(checkpointKey).add(attendeeKey);
    attendeesOverall.add(attendeeKey);

    /*
     * PEAK HOUR IN IST. The fest is in one place and the organiser reads this
     * in local time; UTC hours would report a 6:30pm rush as 1pm. Asia/Kolkata
     * is +5:30, so the half hour matters and a plain getUTCHours() + 5 is
     * wrong for the back half of every hour.
     */
    if (scan.scannedAt) {
      const istHour = new Date(scan.scannedAt.getTime() + (5 * 60 + 30) * 60 * 1000).getUTCHours();
      scansByHour.set(istHour, (scansByHour.get(istHour) ?? 0) + 1);
    }
  }

  let peakHour = null;
  for (const [hour, count] of scansByHour.entries()) {
    if (!peakHour || count > peakHour.scanCount) {
      peakHour = { hour, scanCount: count };
    }
  }

  const perEventTallies = new Map();
  const perGate = [];
  for (const checkpoint of checkpoints) {
    const attendees = attendeesByCheckpoint.get(String(checkpoint._id))?.size ?? 0;
    if (checkpoint.eventId) {
      const key = String(checkpoint.eventId);
      perEventTallies.set(key, (perEventTallies.get(key) ?? 0) + attendees);
    }
    perGate.push({
      checkpointId: String(checkpoint._id),
      checkpointName: checkpoint.checkpointName,
      checkpointType: checkpoint.checkpointType,
      attendeeCount: attendees,
    });
  }
  perGate.sort((first, second) => second.attendeeCount - first.attendeeCount);

  /* Per-event rates need the per-event denominator, not the fest's. */
  const registeredPerEvent = eventIds?.length
    ? await RegistrationModel.aggregate([
        { $match: { eventId: { $in: eventIds }, status: "confirmed" } },
        { $group: { _id: "$eventId", count: { $sum: 1 } } },
      ])
    : [];
  const registeredByEvent = new Map(
    registeredPerEvent.map((row) => [String(row._id), row.count])
  );

  const perEvent = [...perEventTallies.entries()].map(([eventId, attendeeCount]) => ({
    eventId,
    attendeeCount,
    checkInRate: ratePair(attendeeCount, registeredByEvent.get(eventId) ?? 0),
  }));

  return {
    checkInRate: ratePair(attendeesOverall.size, confirmedRegistrationCount ?? 0),
    peakHour,
    perEvent,
    perGate,
    checkpointCount: checkpoints.length,
  };
}

/* ── 4. Certificates ─────────────────────────────────────────────────────── */

async function getCertificateAnalytics(festId, eventIds) {
  const match = { festId };
  if (eventIds?.length) {
    /* A fest-level certificate (coordinator, administrator) carries a null
       eventId, so it must survive an event-scoped filter — it belongs to the
       fest, not to any one event. */
    match.$or = [{ eventId: { $in: eventIds } }, { eventId: null }];
  }

  const groups = await CertificateModel.aggregate([
    { $match: match },
    { $group: { _id: "$certificateType", count: { $sum: 1 } } },
  ]);
  const countByType = new Map(groups.map((row) => [row._id, row.count]));

  /*
   * EVERY TYPE IS PRESENT, including the zeroes. A breakdown that omits the
   * types nobody has been issued makes a chart's bars move around between
   * refreshes, and "no volunteer certificates yet" is itself the answer to a
   * question an organiser asks.
   */
  const byType = Object.values(CERTIFICATE_TYPES).map((certificateType) => ({
    certificateType,
    count: countByType.get(certificateType) ?? 0,
  }));

  return {
    totalIssued: byType.reduce((running, row) => running + row.count, 0),
    byType,
  };
}

/* ── 5. Revenue by purpose ───────────────────────────────────────────────── */

/*
 * BY PURPOSE, NOT BY PAYMENT METHOD — and the difference is not a choice.
 *
 * PaymentOrderModel stores paymentGroupId, purposeType, the fee breakdown, the
 * Razorpay ids and a status. It does NOT store the method: card, UPI and
 * netbanking are never written to our side of the integration, so a
 * "revenue by payment method" breakdown cannot be computed from this database
 * at all. It would need Razorpay's payment object captured at webhook time,
 * which is a backend change to the payment flow rather than an aggregation.
 *
 * purposeType is what IS there, and it answers the question the dashboards
 * actually pose: how much came from registrations, how much from add-ons, how
 * much from contingents.
 */
async function getRevenueByPurpose(festId) {
  const groups = await PaymentOrderModel.aggregate([
    { $match: { festId, status: "captured" } },
    {
      $group: {
        _id: "$purposeType",
        orderCount: { $sum: 1 },
        totalPaise: { $sum: { $ifNull: ["$totalAmountPaise", 0] } },
        platformFeePaise: { $sum: { $ifNull: ["$platformFeePaise", 0] } },
        gstPaise: { $sum: { $ifNull: ["$gstAmountPaise", 0] } },
      },
    },
    { $sort: { totalPaise: -1 } },
  ]);

  return {
    capturedTotalPaise: groups.reduce((running, row) => running + row.totalPaise, 0),
    byPurpose: groups.map((row) => ({
      purposeType: row._id ?? "registration",
      orderCount: row.orderCount,
      totalPaise: row.totalPaise,
      platformFeePaise: row.platformFeePaise,
      gstPaise: row.gstPaise,
    })),
    /* Stated in the payload so a dashboard does not render an empty "by method"
       panel and leave the reader wondering whether it failed to load. */
    paymentMethodBreakdownAvailable: false,
  };
}

/* ── 6. Engagement velocity ──────────────────────────────────────────────── */

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const VELOCITY_WINDOW_DAYS = 7;

/*
 * Is registration speeding up or slowing down, and how long is left to act?
 *
 * The comparison is the last seven days against the seven before them. A single
 * running total cannot answer "should I be worried": 400 registrations is
 * excellent a week out and alarming the day before. Two windows and their
 * ratio is the smallest thing that does.
 */
async function getEngagementVelocity(festId, eventIds, fest, now = new Date()) {
  const windowEnd = now;
  const windowStart = new Date(windowEnd.getTime() - VELOCITY_WINDOW_DAYS * MILLISECONDS_PER_DAY);
  const priorStart = new Date(windowStart.getTime() - VELOCITY_WINDOW_DAYS * MILLISECONDS_PER_DAY);

  const [recent, prior] = eventIds?.length
    ? await Promise.all([
        RegistrationModel.countDocuments({
          eventId: { $in: eventIds },
          createdAt: { $gte: windowStart, $lte: windowEnd },
        }),
        RegistrationModel.countDocuments({
          eventId: { $in: eventIds },
          createdAt: { $gte: priorStart, $lt: windowStart },
        }),
      ])
    : [0, 0];

  /*
   * `trend` is a word, not a number, because the number is unreadable at the
   * edges: going from 0 to 5 is an infinite percentage increase. Steady is the
   * honest answer when there is nothing to compare against.
   */
  let trend = "steady";
  if (prior === 0 && recent > 0) {
    trend = "accelerating";
  } else if (prior > 0) {
    const change = (recent - prior) / prior;
    if (change > 0.1) trend = "accelerating";
    else if (change < -0.1) trend = "decelerating";
  }

  const startsOn = fest?.startsOn ? new Date(fest.startsOn) : null;
  const daysUntilFest = startsOn
    ? Math.ceil((startsOn.getTime() - now.getTime()) / MILLISECONDS_PER_DAY)
    : null;

  return {
    windowDays: VELOCITY_WINDOW_DAYS,
    registrationsThisWindow: recent,
    registrationsPreviousWindow: prior,
    perDayThisWindow: recent / VELOCITY_WINDOW_DAYS,
    trend,
    daysUntilFest,
    /* Negative once the fest has started; the sign is the information. */
    festHasStarted: daysUntilFest !== null && daysUntilFest <= 0,
  };
}

/* ── Platform-wide versions ──────────────────────────────────────────────── */

/*
 * The same three questions, unscoped. Deliberately NOT the fest functions
 * called in a loop over every fest: that is one round trip per fest and the
 * platform view exists to answer "how is the whole thing doing", which is a
 * single aggregate over every row.
 *
 * Same contract as everything above — zeroes on an empty database, never a
 * throw.
 */
async function getPlatformAddOnAnalytics(totalConfirmedRegistrations) {
  const groups = await AddOnOrderModel.aggregate([
    {
      $group: {
        _id: "$status",
        orderCount: { $sum: 1 },
        revenuePaise: { $sum: { $ifNull: ["$amountPaise", 0] } },
      },
    },
  ]);
  const completed = groups.find((row) => row._id === ADD_ON_ORDER_COMPLETED);
  return {
    totalOrders: completed?.orderCount ?? 0,
    revenuePaise: completed?.revenuePaise ?? 0,
    adoptionRate: ratePair(completed?.orderCount ?? 0, totalConfirmedRegistrations ?? 0),
  };
}

async function getPlatformContingentAnalytics() {
  const groups = await ContingentModel.aggregate([
    {
      $group: {
        _id: null,
        packageCount: { $sum: 1 },
        bundlesSold: { $sum: { $ifNull: ["$soldBundleCount", 0] } },
        revenuePaise: {
          $sum: {
            $multiply: [{ $ifNull: ["$soldBundleCount", 0] }, { $ifNull: ["$pricePaise", 0] }],
          },
        },
      },
    },
  ]);
  const row = groups[0];
  return {
    packageCount: row?.packageCount ?? 0,
    bundlesSold: row?.bundlesSold ?? 0,
    revenuePaise: row?.revenuePaise ?? 0,
  };
}

/*
 * Top colleges by REVENUE and by REGISTRATION COUNT. The existing platform
 * payload ranks colleges by how many fests they host, which measures activity
 * rather than scale — a college running six tiny fests outranks one running the
 * biggest event on the platform.
 */
async function getPlatformCollegeLeaderboards(limit = 5) {
  const groups = await RegistrationModel.aggregate([
    { $match: { status: "confirmed" } },
    { $lookup: { from: "events", localField: "eventId", foreignField: "_id", as: "event" } },
    { $unwind: "$event" },
    { $lookup: { from: "fests", localField: "event.festId", foreignField: "_id", as: "fest" } },
    { $unwind: "$fest" },
    {
      $group: {
        _id: "$fest.hostCollegeId",
        confirmedCount: { $sum: 1 },
        revenuePaise: { $sum: { $ifNull: ["$totalFeePaise", 0] } },
      },
    },
  ]);

  if (groups.length === 0) {
    return { topCollegesByRegistrations: [], topCollegesByRevenue: [] };
  }

  const colleges = await CollegeModel.find({ _id: { $in: groups.map((row) => row._id) } })
    .select("commonName collegeName")
    .lean();
  const nameById = new Map(
    colleges.map((college) => [
      String(college._id),
      college.commonName ?? college.collegeName ?? "Unknown",
    ])
  );

  const decorate = (row) => ({
    collegeId: String(row._id),
    collegeName: nameById.get(String(row._id)) ?? "Unknown",
    confirmedCount: row.confirmedCount,
    revenuePaise: row.revenuePaise,
  });

  return {
    topCollegesByRegistrations: [...groups]
      .sort((first, second) => second.confirmedCount - first.confirmedCount)
      .slice(0, limit)
      .map(decorate),
    topCollegesByRevenue: [...groups]
      .sort((first, second) => second.revenuePaise - first.revenuePaise)
      .slice(0, limit)
      .map(decorate),
  };
}

module.exports = {
  getPlatformAddOnAnalytics,
  getPlatformContingentAnalytics,
  getPlatformCollegeLeaderboards,
  getAddOnAnalytics,
  getContingentAnalytics,
  getAttendanceAnalytics,
  getCertificateAnalytics,
  getRevenueByPurpose,
  getEngagementVelocity,
};

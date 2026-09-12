/*
 * per-event-analytics-service.js
 *
 * The depth that only makes sense for ONE event: its capacity projection, its
 * arrival pattern hour by hour, its round-by-round drop-off, its team size
 * distribution, and how it compares with the rest of the fest it sits in.
 *
 * WHY A SEPARATE FILE, AND WHY NOT IN analytics-extras-service. The extras are
 * fest-level aggregations that happen to accept an eventIds narrowing. These
 * are different in kind: several of them are meaningless fest-wide (an "arrival
 * pattern" across forty events at different times is noise), and two of them -
 * the comparison and the rank - need the fest as their denominator while the
 * event is their subject. Mixing those into the extras would mean every fest
 * summary paying for queries it cannot use.
 *
 * SO THIS BLOCK IS ONLY COMPUTED WHEN ?eventId= IS PRESENT. getFestAnalyticsSummary
 * attaches it as `perEventDeep` and omits the key entirely otherwise, which is
 * also what tells the client whether to render the per-event view at all.
 *
 * EVERY FUNCTION RETURNS ZEROES RATHER THAN THROWING, same rule as the extras.
 * A freshly created event has no registrations, no scans, no teams and no
 * certificates, and that is the state an organiser looks at the dashboard in
 * most often.
 *
 * TWO THINGS THE BRIEF ASKED FOR ARE ABSENT, DELIBERATELY:
 *
 *   - Time-to-register (page view -> submission). Nothing tracks event page
 *     views; there is no view model, no analytics event, no counter on the
 *     event document. The brief said to skip it if views are not tracked.
 *   - Certificate download/share rate. certificate-model carries pdfUrl,
 *     generatedAt, releasedAt and revokedAt, and no download counter or share
 *     record. Same instruction, same outcome.
 *
 * Inventing either would mean returning a number with no data behind it, which
 * on a dashboard is worse than an absent card.
 */
const { RegistrationModel } = require("../models/registration-model");
const { ScanModel } = require("../models/scan-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { TeamModel } = require("../models/team-model");
const { CertificateModel } = require("../models/certificate-model");
const { AddOnOrderModel } = require("../models/add-on-order-model");
const {
  PaymentOrderModel,
  PAYMENT_ORDER_STATUSES,
} = require("../models/payment-order-model");
const { RoundModel } = require("../models/round-model");
const { EventModel } = require("../models/event-model");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { SCAN_RESULTS, SCAN_DIRECTIONS } = require("../constants/scan-constants");
const { TEAM_STATUSES } = require("../constants/team-constants");
const { EVENT_TYPES } = require("../constants/event-constants");
const { CERTIFICATE_TYPES } = require("../constants/certificate-constants");

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/* IST. The whole product is one country; an arrival-pattern chart drawn in UTC
   puts a 10am rush at 04:30 and reads as nobody turning up. Mirrors the
   IST_OFFSET handling in analytics-extras-service. */
const IST_OFFSET_MINUTES = 330;

function ratePair(numerator, denominator) {
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : 0,
  };
}

/*
 * THE CONFIRMED FAMILY, DEFINED BY EXCLUSION - the same way analytics-service
 * defines it, and deliberately not by listing the members.
 *
 * registration-constants carries fourteen statuses: confirmed and waitlisted,
 * but also attended, noShow, winner1st/2nd/3rd and five advancedTo* rows. A
 * seat that went on to win its event is still a seat that was taken and paid
 * for. Listing the family explicitly means every new outcome status silently
 * drops out of the revenue and the counts, which is exactly the bug that makes
 * a dashboard disagree with a bank statement - so the three NON-members are
 * named instead and everything else is in.
 */
const NOT_CONFIRMED_STATUSES = [
  REGISTRATION_STATUSES.PENDING_PAYMENT,
  REGISTRATION_STATUSES.CANCELLED,
  REGISTRATION_STATUSES.PAYMENT_EXPIRED,
];

const CONFIRMED_FAMILY = Object.values(REGISTRATION_STATUSES).filter(
  (status) => !NOT_CONFIRMED_STATUSES.includes(status)
);

function confirmedFamilyOrDefault() {
  return CONFIRMED_FAMILY;
}

/* ── 1. Capacity fill and its projection ─────────────────────────────────── */

/*
 * "At this rate it will fill on <date>", or an honest refusal to say so.
 *
 * THE ZERO-VELOCITY CASE IS THE WHOLE PROBLEM. confirmed / perDay is a division
 * by zero the moment an event has had a quiet week, and Infinity formats as
 * "will fill by Invalid Date". An event with no capacity set has no fill to
 * project at all. Both return a named status instead of a number, so the client
 * renders a sentence rather than arithmetic it has to guard.
 *
 * The projection is deliberately naive - a straight line through the recent
 * daily rate. Registration curves are not linear (they spike at announcement
 * and at the deadline), so this is a "what if today repeated" figure and the
 * copy says so rather than presenting it as a forecast.
 */
function buildCapacityProjection({ capacity, confirmedCount, registrationsPerDayRecent }) {
  if (!capacity || capacity <= 0) {
    return {
      status: "noCapacity",
      fill: ratePair(confirmedCount, 0),
      remainingSlots: null,
      perDayRecent: registrationsPerDayRecent,
      projectedFullOn: null,
      daysToFill: null,
    };
  }

  const remainingSlots = Math.max(0, capacity - confirmedCount);
  const fill = ratePair(confirmedCount, capacity);

  if (remainingSlots === 0) {
    return {
      status: "full",
      fill,
      remainingSlots: 0,
      perDayRecent: registrationsPerDayRecent,
      projectedFullOn: null,
      daysToFill: 0,
    };
  }

  if (registrationsPerDayRecent <= 0) {
    /* Stalled, not "will never fill". The difference matters: one is a
       measurement of the last seven days, the other is a prediction about the
       future, and only the first is something we actually know. */
    return {
      status: "stalled",
      fill,
      remainingSlots,
      perDayRecent: 0,
      projectedFullOn: null,
      daysToFill: null,
    };
  }

  const daysToFill = Math.ceil(remainingSlots / registrationsPerDayRecent);
  const projectedFullOn = new Date(Date.now() + daysToFill * MILLISECONDS_PER_DAY);
  return {
    status: "projected",
    fill,
    remainingSlots,
    perDayRecent: registrationsPerDayRecent,
    projectedFullOn: projectedFullOn.toISOString(),
    daysToFill,
  };
}

/* ── 2. Attendance: arrival pattern, no-shows, dwell ─────────────────────── */

/*
 * Scans for this event, resolved through its checkpoints.
 *
 * A scan references a CHECKPOINT, not an event, so the event's checkpoints have
 * to be resolved first. Only ALLOWED results count: a denied or duplicate scan
 * is a record of somebody being turned away, and counting it as attendance
 * would inflate the check-in rate with exactly the people who did not get in.
 */
async function loadEventScans(eventIds) {
  if (!eventIds?.length) {
    return [];
  }
  const checkpoints = await CheckpointModel.find({ eventId: { $in: eventIds } })
    .select("_id")
    .lean();
  if (checkpoints.length === 0) {
    return [];
  }
  return ScanModel.find({
    checkpointId: { $in: checkpoints.map((checkpoint) => checkpoint._id) },
    result: SCAN_RESULTS.ACCEPTED,
  })
    .select("userId direction scannedAt")
    .lean();
}

function buildAttendanceInsights(scans, confirmedUserIds) {
  const firstInByUser = new Map();
  const lastOutByUser = new Map();
  /* 24 buckets, always all of them. A chart that omits the quiet hours has no
     baseline to make the peak look like a peak. */
  const scansByHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));

  for (const scan of scans) {
    const userKey = String(scan.userId);
    const scannedAt = new Date(scan.scannedAt);

    if (scan.direction === SCAN_DIRECTIONS.OUT) {
      const previous = lastOutByUser.get(userKey);
      if (!previous || scannedAt > previous) {
        lastOutByUser.set(userKey, scannedAt);
      }
      continue;
    }

    /* FIRST in, not last: somebody who stepped out and came back has one
       arrival, and taking the latest scan would move them out of the morning
       rush the chart exists to show. */
    const previous = firstInByUser.get(userKey);
    if (!previous || scannedAt < previous) {
      firstInByUser.set(userKey, scannedAt);
    }

    const istHour = new Date(scannedAt.getTime() + IST_OFFSET_MINUTES * 60 * 1000).getUTCHours();
    scansByHour[istHour].count += 1;
  }

  const checkedInCount = firstInByUser.size;
  const peak = scansByHour.reduce(
    (best, bucket) => (bucket.count > best.count ? bucket : best),
    { hour: null, count: 0 }
  );

  /*
   * DWELL IS AVERAGED OVER THE PEOPLE WHO HAVE BOTH SCANS, not over everyone.
   * Most fests run IN_ONLY doors, so the out-set is usually empty and the
   * average is over nothing - which is why `observed` is returned rather than a
   * bare 0. A "0h 0m average stay" on a screen is read as a measurement, and it
   * would be a measurement of a door that was never configured.
   */
  let dwellTotalMilliseconds = 0;
  let dwellSampleCount = 0;
  for (const [userKey, inAt] of firstInByUser.entries()) {
    const outAt = lastOutByUser.get(userKey);
    if (outAt && outAt > inAt) {
      dwellTotalMilliseconds += outAt.getTime() - inAt.getTime();
      dwellSampleCount += 1;
    }
  }

  const noShowCount = Math.max(0, confirmedUserIds.size - checkedInCount);

  return {
    checkInRate: ratePair(checkedInCount, confirmedUserIds.size),
    checkOutRate: ratePair(lastOutByUser.size, confirmedUserIds.size),
    checkOutScanningObserved: lastOutByUser.size > 0,
    noShowRate: ratePair(noShowCount, confirmedUserIds.size),
    scansByHour,
    peakHour: peak.count > 0 ? peak.hour : null,
    peakHourCount: peak.count,
    dwell: {
      observed: dwellSampleCount > 0,
      sampleCount: dwellSampleCount,
      averageMinutes:
        dwellSampleCount > 0
          ? Math.round(dwellTotalMilliseconds / dwellSampleCount / 60000)
          : 0,
    },
  };
}

/* ── 3. Per-round drop-off ───────────────────────────────────────────────── */

/*
 * How many of the event's participants were still in it at each round.
 *
 * The roster is `participantIds` on the round itself, which is the list the
 * coordinator finalised - so this measures ADVANCEMENT, not attendance at the
 * round. That distinction is worth keeping: a participant who was eliminated in
 * round 1 is absent from round 2's roster by design, and reading the decline as
 * "people stopped turning up" would be wrong.
 *
 * Ordered by roundNumber so the drop-off reads left to right even if the rounds
 * were created out of order.
 */
async function buildRoundDropOff(eventIds) {
  if (!eventIds?.length) {
    return [];
  }
  const rounds = await RoundModel.find({ eventId: { $in: eventIds } })
    .select("roundNumber roundName participantIds status")
    .sort({ roundNumber: 1 })
    .lean();

  const firstCount = rounds[0]?.participantIds?.length ?? 0;
  return rounds.map((round) => {
    const count = round.participantIds?.length ?? 0;
    return {
      roundNumber: round.roundNumber,
      roundName: round.roundName ?? `Round ${round.roundNumber}`,
      status: round.status,
      participantCount: count,
      /* Share of the FIRST round, so every dot compares against one
         denominator. Against the previous round instead, three rounds each
         keeping half would all render as 50% and look flat. */
      shareOfFirstRound: ratePair(count, firstCount),
    };
  });
}

/* ── 4. Teams ────────────────────────────────────────────────────────────── */

/*
 * INVITE CODES ARE NOT A LEDGER. Every team document is created with exactly
 * one `inviteCode` (unique index on the collection), so there is no separate
 * record of codes issued or redemptions attempted. "Generated" is therefore the
 * team count and "redeemed" is the count of teams that grew past their leader -
 * a proxy, and named as one in the response so nobody reads it as a tracked
 * funnel.
 */
async function buildTeamInsights(eventIds, event) {
  const empty = {
    isTeamEvent: false,
    totalTeams: 0,
    averageTeamSize: 0,
    teamsLocked: 0,
    teamsForming: 0,
    teamsAtFullCapacity: 0,
    teamsWithOpenSlots: 0,
    sizeDistribution: [],
    inviteCodes: { generated: 0, redeemedProxy: 0, conversion: ratePair(0, 0) },
  };

  if (!event || event.eventType !== EVENT_TYPES.TEAM || !eventIds?.length) {
    return empty;
  }

  const teams = await TeamModel.find({ eventId: { $in: eventIds } })
    .select("memberUserIds status")
    .lean();
  if (teams.length === 0) {
    return { ...empty, isTeamEvent: true };
  }

  const sizeCounts = new Map();
  let memberTotal = 0;
  let teamsAtFullCapacity = 0;
  let redeemedProxy = 0;

  for (const team of teams) {
    const size = team.memberUserIds?.length ?? 0;
    memberTotal += size;
    sizeCounts.set(size, (sizeCounts.get(size) ?? 0) + 1);
    if (event.maximumTeamSize && size >= event.maximumTeamSize) {
      teamsAtFullCapacity += 1;
    }
    if (size > 1) {
      redeemedProxy += 1;
    }
  }

  return {
    isTeamEvent: true,
    totalTeams: teams.length,
    /* One decimal. "4" and "4.3" are different facts about whether teams are
       filling, and rounding to an integer erases the one that matters. */
    averageTeamSize: Math.round((memberTotal / teams.length) * 10) / 10,
    teamsLocked: teams.filter((team) => team.status === TEAM_STATUSES.LOCKED).length,
    teamsForming: teams.filter((team) => team.status === TEAM_STATUSES.FORMING).length,
    teamsAtFullCapacity,
    teamsWithOpenSlots: teams.length - teamsAtFullCapacity,
    sizeDistribution: [...sizeCounts.entries()]
      .map(([size, teamCount]) => ({ size, teamCount }))
      .sort((first, second) => first.size - second.size),
    inviteCodes: {
      generated: teams.length,
      redeemedProxy,
      conversion: ratePair(redeemedProxy, teams.length),
    },
  };
}

/* ── 5. Revenue depth ────────────────────────────────────────────────────── */

async function buildRevenueInsights(festId, eventIds, grossRevenuePaise, confirmedCount) {
  const [addOnRows, paymentRows, feeRows] = await Promise.all([
    eventIds?.length
      ? AddOnOrderModel.aggregate([
          { $match: { festId, eventId: { $in: eventIds }, status: "completed" } },
          { $unwind: "$selections" },
          {
            $group: {
              _id: { offerId: "$selections.offerId", offerKey: "$selections.offerKey" },
              orderCount: { $sum: 1 },
              revenuePaise: { $sum: "$amountPaise" },
            },
          },
        ])
      : [],
    PaymentOrderModel.aggregate([
      { $match: { festId } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    eventIds?.length
      ? RegistrationModel.aggregate([
          {
            $match: {
              eventId: { $in: eventIds },
              status: { $in: confirmedFamilyOrDefault() },
            },
          },
          {
            $group: {
              _id: null,
              freeCount: {
                $sum: { $cond: [{ $gt: [{ $ifNull: ["$totalFeePaise", 0] }, 0] }, 0, 1] },
              },
              paidCount: {
                $sum: { $cond: [{ $gt: [{ $ifNull: ["$totalFeePaise", 0] }, 0] }, 1, 0] },
              },
            },
          },
        ])
      : [],
  ]);

  const addOnOrderCount = addOnRows.reduce((total, row) => total + row.orderCount, 0);
  const addOnRevenuePaise = addOnRows.reduce((total, row) => total + row.revenuePaise, 0);

  const paymentByStatus = new Map(paymentRows.map((row) => [row._id, row.count]));

  return {
    grossRevenuePaise,
    /*
     * ZERO, NOT NaN. gross / 0 is NaN, which serialises to null and renders as
     * "₹NaN" or an empty cell depending on the formatter - and an event with no
     * registrations is the normal state of every event before it opens.
     */
    revenuePerRegistrantPaise:
      confirmedCount > 0 ? Math.round(grossRevenuePaise / confirmedCount) : 0,
    addOnRevenuePaise,
    addOnOrderCount,
    addOnAttachRate: ratePair(addOnOrderCount, confirmedCount),
    perOffer: addOnRows
      .map((row) => ({
        offerId: String(row._id.offerId),
        offerKey: row._id.offerKey,
        orderCount: row.orderCount,
        revenuePaise: row.revenuePaise,
      }))
      .sort((first, second) => second.revenuePaise - first.revenuePaise),
    /*
     * Payment status is FEST-SCOPED and says so. A payment order carries a
     * paymentGroupId and a purpose, not an eventId, so there is no honest way
     * to attribute one to a single event. Returning the fest's breakdown with a
     * flag is better than returning a plausible-looking wrong number.
     */
    paymentStatus: {
      scope: "fest",
      /*
       * CAPTURED is the paid state and CREATED is the unfinished one - there is
       * no "paid" or "pending" member on this enum, and no "refunded" either.
       * REFUND_PENDING is a captured payment whose purchase was cancelled; the
       * refund itself happens out of band on the Razorpay dashboard, so
       * "refundPending" is the furthest the platform can honestly report.
       */
      captured: paymentByStatus.get(PAYMENT_ORDER_STATUSES.CAPTURED) ?? 0,
      created: paymentByStatus.get(PAYMENT_ORDER_STATUSES.CREATED) ?? 0,
      failed: paymentByStatus.get(PAYMENT_ORDER_STATUSES.FAILED) ?? 0,
      refundPending: paymentByStatus.get(PAYMENT_ORDER_STATUSES.REFUND_PENDING) ?? 0,
    },
    freeVersusPaid: {
      freeCount: feeRows[0]?.freeCount ?? 0,
      paidCount: feeRows[0]?.paidCount ?? 0,
    },
  };
}

/* ── 6. Certificates ─────────────────────────────────────────────────────── */

async function buildCertificateInsights(eventIds, confirmedCount) {
  const rows = eventIds?.length
    ? await CertificateModel.aggregate([
        { $match: { eventId: { $in: eventIds } } },
        { $group: { _id: "$certificateType", count: { $sum: 1 } } },
      ])
    : [];

  const byType = new Map(rows.map((row) => [row._id, row.count]));
  const countOf = (type) => byType.get(type) ?? 0;
  const totalIssued = rows.reduce((total, row) => total + row.count, 0);
  const participationCount = countOf(CERTIFICATE_TYPES.PARTICIPATION);

  return {
    totalIssued,
    byType: [...byType.entries()].map(([certificateType, count]) => ({ certificateType, count })),
    winners: {
      first: countOf(CERTIFICATE_TYPES.WINNER_1ST),
      second: countOf(CERTIFICATE_TYPES.WINNER_2ND),
      third: countOf(CERTIFICATE_TYPES.WINNER_3RD),
      specialMention: countOf(CERTIFICATE_TYPES.SPECIAL_MENTION),
    },
    /* Eligible is the confirmed count: everyone who held a seat is entitled to
       a participation certificate whether or not one has been pushed yet. */
    participationCoverage: ratePair(participationCount, confirmedCount),
  };
}

/* ── 7. Competitive: rank, fest average, co-registration ─────────────────── */

/*
 * How this event sits against the rest of its fest.
 *
 * THE FEST AVERAGE EXCLUDES NOTHING, INCLUDING THIS EVENT. Removing the subject
 * from its own benchmark makes a fest's single large event look further above
 * average than it is, and with forty events the difference is negligible while
 * the explanation is not. One definition, stated.
 *
 * Container events with no registrations of their own are excluded, because an
 * average dragged down by six empty parent rows tells an organiser their event
 * is doing better than it is.
 */
async function buildComparison(festId, scopedEventIds, confirmedCount, grossRevenuePaise) {
  const allEvents = await EventModel.find({ festId }).select("_id capacity").lean();
  const allEventIds = allEvents.map((event) => event._id);
  if (allEventIds.length === 0) {
    return null;
  }

  const perEventRows = await RegistrationModel.aggregate([
    {
      $match: {
        eventId: { $in: allEventIds },
        status: { $in: confirmedFamilyOrDefault() },
      },
    },
    {
      $group: {
        _id: "$eventId",
        confirmedCount: { $sum: 1 },
        grossPaise: { $sum: { $ifNull: ["$totalFeePaise", 0] } },
      },
    },
    { $sort: { confirmedCount: -1 } },
  ]);

  const participating = perEventRows.filter((row) => row.confirmedCount > 0);
  const eventCount = participating.length;

  const averageRegistrations =
    eventCount > 0
      ? participating.reduce((total, row) => total + row.confirmedCount, 0) / eventCount
      : 0;
  const averageRevenuePerHeadPaise =
    eventCount > 0
      ? Math.round(
          participating.reduce(
            (total, row) => total + row.grossPaise / Math.max(1, row.confirmedCount),
            0
          ) / eventCount
        )
      : 0;

  const capacityById = new Map(allEvents.map((event) => [String(event._id), event.capacity]));
  const fillRates = participating
    .map((row) => {
      const capacity = capacityById.get(String(row._id));
      return capacity > 0 ? row.confirmedCount / capacity : null;
    })
    .filter((rate) => rate !== null);
  const averageFillRate =
    fillRates.length > 0 ? fillRates.reduce((total, rate) => total + rate, 0) / fillRates.length : 0;

  /*
   * Rank is over the SCOPED event as one unit. When includeDescendants widened
   * a parent to its children, the scoped confirmedCount is their sum, so it is
   * ranked by "how many rows would beat that total" rather than by looking the
   * event up in the list - the list has no row for the union.
   */
  const betterEvents = participating.filter((row) => row.confirmedCount > confirmedCount).length;

  return {
    rank: betterEvents + 1,
    rankedEventCount: eventCount,
    festAverage: {
      registrations: Math.round(averageRegistrations * 10) / 10,
      revenuePerHeadPaise: averageRevenuePerHeadPaise,
      fillRate: averageFillRate,
    },
    thisEvent: {
      registrations: confirmedCount,
      revenuePerHeadPaise:
        confirmedCount > 0 ? Math.round(grossRevenuePaise / confirmedCount) : 0,
    },
    scopedEventIdCount: scopedEventIds.length,
  };
}

/*
 * WHAT ELSE DID THESE PARTICIPANTS REGISTER FOR.
 *
 * The users holding a confirmed seat here, then their other confirmed seats in
 * the same fest, counted per event. Useful for scheduling (two popular events
 * with heavy overlap must not clash) and that is the framing the client uses.
 *
 * The scoped events are excluded from the result, otherwise this event always
 * tops its own list.
 */
async function buildCoRegistration(festId, scopedEventIds) {
  if (!scopedEventIds?.length) {
    return [];
  }

  const confirmed = confirmedFamilyOrDefault();
  const participantRows = await RegistrationModel.find({
    eventId: { $in: scopedEventIds },
    status: { $in: confirmed },
  })
    .select("userId")
    .lean();
  const userIds = [...new Set(participantRows.map((row) => String(row.userId)))];
  if (userIds.length === 0) {
    return [];
  }

  const festEvents = await EventModel.find({ festId }).select("_id eventName").lean();
  const scopedKeys = new Set(scopedEventIds.map((id) => String(id)));
  const otherEventIds = festEvents
    .filter((event) => !scopedKeys.has(String(event._id)))
    .map((event) => event._id);
  if (otherEventIds.length === 0) {
    return [];
  }

  const overlapRows = await RegistrationModel.aggregate([
    {
      $match: {
        eventId: { $in: otherEventIds },
        userId: { $in: participantRows.map((row) => row.userId) },
        status: { $in: confirmed },
      },
    },
    /* Distinct (user, event) first: a participant cannot overlap with the same
       event twice, and without this a duplicated row would inflate the count. */
    { $group: { _id: { userId: "$userId", eventId: "$eventId" } } },
    { $group: { _id: "$_id.eventId", sharedParticipantCount: { $sum: 1 } } },
    { $sort: { sharedParticipantCount: -1 } },
    { $limit: 5 },
  ]);

  const nameById = new Map(festEvents.map((event) => [String(event._id), event.eventName]));
  return overlapRows.map((row) => ({
    eventId: String(row._id),
    eventName: nameById.get(String(row._id)) ?? "Unnamed event",
    sharedParticipantCount: row.sharedParticipantCount,
    /* Share of THIS event's participants, so "38 of our 120 also did X" reads
       as a proportion rather than an unanchored count. */
    shareOfThisEvent: ratePair(row.sharedParticipantCount, userIds.length),
  }));
}

/* ── The composed block ──────────────────────────────────────────────────── */

/*
 * @param {object} input
 * @param {ObjectId} input.festId
 * @param {ObjectId[]} input.eventIds  the scoped events (one, or a parent and
 *   its descendants when includeDescendants was set)
 * @param {object} input.scopedFunnel  the funnel analytics-service already
 *   computed for this scope - reused rather than recounted
 * @param {number} input.grossRevenuePaise
 * @param {Array} input.registrationsPerDay  the daily series already built
 */
async function getPerEventDeepAnalytics({
  festId,
  eventIds,
  scopedFunnel,
  grossRevenuePaise,
  registrationsPerDay,
}) {
  const confirmedCount = scopedFunnel?.registrationsConfirmed ?? 0;

  /* The primary event of the scope: the one the admin actually chose. With
     includeDescendants its children ride along in eventIds, but the event
     TYPE and the team sizes come from the parent. */
  const primaryEvent = eventIds?.length
    ? await EventModel.findById(eventIds[0])
        .select("eventName eventType capacity minimumTeamSize maximumTeamSize")
        .lean()
    : null;

  const confirmedRows = eventIds?.length
    ? await RegistrationModel.find({
        eventId: { $in: eventIds },
        status: { $in: confirmedFamilyOrDefault() },
      })
        .select("userId teamId")
        .lean()
    : [];
  const confirmedUserIds = new Set(confirmedRows.map((row) => String(row.userId)));

  /*
   * RECENT rate, not lifetime. A month-old event with a launch spike and three
   * quiet weeks has a lifetime average that would project a fill date it has no
   * chance of hitting; the last seven days is what "at this rate" means.
   */
  const recentDays = (registrationsPerDay ?? []).slice(-7);
  const registrationsPerDayRecent =
    recentDays.length > 0
      ? recentDays.reduce((total, point) => total + (point.count ?? 0), 0) / recentDays.length
      : 0;

  const [scans, rounds, teams, revenue, certificates, comparison, coRegistration] =
    await Promise.all([
      loadEventScans(eventIds),
      buildRoundDropOff(eventIds),
      buildTeamInsights(eventIds, primaryEvent),
      buildRevenueInsights(festId, eventIds, grossRevenuePaise, confirmedCount),
      buildCertificateInsights(eventIds, confirmedCount),
      buildComparison(festId, eventIds ?? [], confirmedCount, grossRevenuePaise),
      buildCoRegistration(festId, eventIds ?? []),
    ]);

  const soloCount = confirmedRows.filter((row) => !row.teamId).length;

  return {
    event: primaryEvent
      ? {
          eventId: String(eventIds[0]),
          eventName: primaryEvent.eventName,
          eventType: primaryEvent.eventType,
          capacity: primaryEvent.capacity ?? null,
        }
      : null,
    capacity: buildCapacityProjection({
      capacity: primaryEvent?.capacity ?? null,
      confirmedCount,
      registrationsPerDayRecent,
    }),
    soloVersusTeam: {
      soloCount,
      teamCount: confirmedRows.length - soloCount,
    },
    attendance: buildAttendanceInsights(scans, confirmedUserIds),
    rounds,
    teams,
    revenue,
    certificates,
    comparison,
    coRegistration,
  };
}

module.exports = {
  getPerEventDeepAnalytics,
  /* Exported for named unit tests - the projection and the attendance fold are
     pure and are where the arithmetic edge cases live. */
  buildCapacityProjection,
  buildAttendanceInsights,
};

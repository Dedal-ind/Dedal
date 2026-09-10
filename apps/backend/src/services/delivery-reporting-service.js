const mongoose = require("mongoose");

const {
  DeliveryDailyRollupModel,
  DeliveryRollupStateModel,
  DeliveryRejectionModel,
} = require("../models/delivery-rollup-model");
const { CampaignModel } = require("../models/campaign-model");
const { CreativeModel } = require("../models/creative-model");
const { PromoterModel } = require("../models/promoter-model");
const { PlacementModel } = require("../models/placement-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { ROLLUP_STATE_ID } = require("./delivery-rollup-service");
const { PLACEMENT_KEYS } = require("../constants/campaign-constants");

/*
 * Delivery reporting for the platform admin (phase 5). READS ONLY.
 *
 * ROLLUPS ONLY, NEVER RAW EVENTS. The daily rollup is the durable reporting
 * record: one row per campaign, creative, placement and UTC day, one counter
 * per event kind. The raw delivery event store is a thirty-day audit trail
 * — a report that scanned it would get slower every day and then start
 * losing the rows it was counting when retention dropped them. So every
 * figure here comes from rollups, and a range that PREDATES the raw retention
 * window still reports correctly because the rollups for those days remain.
 * Do not "fix" that by reaching for raw events; there is nothing to fix.
 *
 * FOUR FIGURES, NEVER SUMMED. decision (what the server chose), measurable
 * (what the client rendered), viewable (what met the standard), click. They
 * describe different things and are reported side by side. The derived rates
 * say exactly what they divide:
 *   measurableRate = measurable / decision   (of what was chosen, what rendered)
 *   viewableRate   = viewable / measurable   (of what rendered, what was seen —
 *                    NOT over decisions: a decision the client never rendered
 *                    was never a chance to be seen)
 *   clickRate      = click / viewable        (of what was seen, what was tapped)
 *
 * HONESTY. Every response carries the range it covers and the last completed
 * rollup point. Today is always still open, and a range that runs past the
 * completed point is flagged incomplete so a low number reads as "not rolled
 * up yet" rather than "the campaign died". Empty periods return zeroes, not
 * absent keys: a campaign that served nothing is a real answer.
 *
 * Follows analytics-service: flat objects, per-day series, the
 * numerator/denominator/rate triple, one parallel block of queries, no cache.
 */

const MAXIMUM_RANGE_DAYS = 92;
const DEFAULT_RANGE_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const KINDS = ["decision", "measurable", "viewable", "click"];

/* ---------------------------------------------------------------- range */

function utcDay(value) {
  return value.toISOString().slice(0, 10);
}

function parseDay(value, fieldName) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "One or more fields are invalid.", {
      [fieldName]: "must be a date in YYYY-MM-DD form",
    });
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || utcDay(date) !== value) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "One or more fields are invalid.", {
      [fieldName]: "must be a real calendar date",
    });
  }
  return value;
}

/*
 * ?from and ?to as UTC days, inclusive. Absent: the last thirty days ending
 * today. Inverted is refused; longer than the cap is refused rather than run.
 */
function resolveRange(query = {}, now = new Date()) {
  const to = query.to === undefined ? utcDay(now) : parseDay(query.to, "to");
  const from =
    query.from === undefined
      ? utcDay(new Date(new Date(`${to}T00:00:00.000Z`).getTime() - (DEFAULT_RANGE_DAYS - 1) * MILLISECONDS_PER_DAY))
      : parseDay(query.from, "from");
  if (from > to) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "One or more fields are invalid.", {
      from: "must not be after to",
    });
  }
  const days =
    (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) /
      MILLISECONDS_PER_DAY +
    1;
  if (days > MAXIMUM_RANGE_DAYS) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "One or more fields are invalid.", {
      to: `the range may cover at most ${MAXIMUM_RANGE_DAYS} days; narrow it and query again`,
    });
  }
  return { from, to, days };
}

function eachDay(from, to) {
  const days = [];
  for (
    let time = new Date(`${from}T00:00:00.000Z`).getTime();
    time <= new Date(`${to}T00:00:00.000Z`).getTime();
    time += MILLISECONDS_PER_DAY
  ) {
    days.push(utcDay(new Date(time)));
  }
  return days;
}

/* ---------------------------------------------------------------- shapes */

function ratePair(numerator, denominator) {
  return { numerator, denominator, rate: denominator > 0 ? numerator / denominator : 0 };
}

function zeroTotals() {
  return { decision: 0, measurable: 0, viewable: 0, click: 0 };
}

function totalsFrom(group) {
  return {
    decision: group?.decision ?? 0,
    measurable: group?.measurable ?? 0,
    viewable: group?.viewable ?? 0,
    click: group?.click ?? 0,
  };
}

/* The rates, each labelled with what it divides — see the file header. */
function ratesFrom(totals) {
  return {
    measurableRate: { ...ratePair(totals.measurable, totals.decision), of: "measurable / decision" },
    viewableRate: { ...ratePair(totals.viewable, totals.measurable), of: "viewable / measurable" },
    clickRate: { ...ratePair(totals.click, totals.viewable), of: "click / viewable" },
  };
}

function seriesFrom(from, to, dayGroups) {
  const byDay = new Map(dayGroups.map((group) => [group._id, group]));
  return eachDay(from, to).map((day) => ({ day, ...totalsFrom(byDay.get(day)) }));
}

const SUM_KINDS = Object.fromEntries(KINDS.map((kind) => [kind, { $sum: `$${kind}` }]));

/*
 * The coverage block every response carries: the range, the last completed
 * rollup day, and whether the range runs past it. Stated, not implied.
 */
async function coverageFor(range) {
  const state = await DeliveryRollupStateModel.findById(ROLLUP_STATE_ID).lean();
  const completedThroughDay = state?.completedThroughDay ?? null;
  const incomplete = completedThroughDay === null || range.to > completedThroughDay;
  return {
    from: range.from,
    to: range.to,
    days: range.days,
    lastCompletedRollupDay: completedThroughDay,
    lastRollupRunAt: state?.lastRunAt ?? null,
    isComplete: !incomplete,
    note: incomplete
      ? "The range extends past the last completed rollup day; figures for days after it are partial or absent until the next rollup runs, not evidence of low delivery."
      : "Every day in the range has been fully rolled up.",
    source: "dailyRollups",
  };
}

/* Group over the rollups matching `match`, by `groupKey` (null = one total). */
function rollupGroups(match, groupKey) {
  return DeliveryDailyRollupModel.aggregate([{ $match: match }, { $group: { _id: groupKey, ...SUM_KINDS } }]);
}

/* ---------------------------------------------------------------- reads */

/*
 * The whole platform over a range. Rejections ride along at the only
 * granularity they are stored — per day and reason — because a rejected
 * event carries no trusted campaign to attribute it to.
 */
async function getPlatformOverview(query, now = new Date()) {
  const range = resolveRange(query, now);
  const match = { day: { $gte: range.from, $lte: range.to } };
  const [totalGroups, dayGroups, placementGroups, rejectionGroups, coverage] = await Promise.all([
    rollupGroups(match, null),
    rollupGroups(match, "$day"),
    rollupGroups(match, "$placementKey"),
    DeliveryRejectionModel.aggregate([
      { $match: match },
      { $group: { _id: "$reason", count: { $sum: "$count" } } },
      { $sort: { _id: 1 } },
    ]),
    coverageFor(range),
  ]);
  const totals = totalsFrom(totalGroups[0]);
  const placementByKey = new Map(placementGroups.map((group) => [group._id, group]));
  return {
    coverage,
    totals,
    rates: ratesFrom(totals),
    perDay: seriesFrom(range.from, range.to, dayGroups),
    perPlacement: Object.values(PLACEMENT_KEYS).map((key) => ({
      placementKey: key,
      ...totalsFrom(placementByKey.get(key)),
    })),
    rejections: {
      granularity: "per day and reason — never per campaign; a rejected event carries no trusted campaign",
      total: rejectionGroups.reduce((sum, group) => sum + group.count, 0),
      byReason: rejectionGroups.map((group) => ({ reason: group._id, count: group.count })),
    },
  };
}

/*
 * Pacing, from the campaign's own counters: goal, delivered (set by the
 * rollup job from viewables across the whole flight, not the range), share
 * of flight elapsed, and the ahead-or-behind figure an admin acts on.
 */
function pacingFor(campaign, now) {
  const target = campaign.pacing?.totalImpressionTarget ?? null;
  const delivered = campaign.pacing?.deliveredImpressions ?? 0;
  const start = new Date(campaign.flightStartsAt).getTime();
  const end = new Date(campaign.flightEndsAt).getTime();
  const elapsedShare = end > start ? Math.min(1, Math.max(0, (now.getTime() - start) / (end - start))) : 0;
  if (target === null) {
    return { hasGoal: false, target: null, delivered, elapsedShare, deliveredShare: null, expectedDelivered: null, difference: null, status: "noGoal" };
  }
  const expectedDelivered = Math.round(target * elapsedShare);
  const difference = delivered - expectedDelivered;
  return {
    hasGoal: true,
    target,
    delivered,
    elapsedShare,
    deliveredShare: delivered / target,
    expectedDelivered,
    /* Positive: ahead of pace by this many impressions. Negative: behind. */
    difference,
    status: difference > 0 ? "ahead" : difference < 0 ? "behind" : "onPace",
    note: "delivered counts viewables across the whole flight, as the rollup job last set it; expectedDelivered is the goal times the share of the flight elapsed",
  };
}

async function loadCampaignOrThrow(campaignId) {
  const campaign = mongoose.Types.ObjectId.isValid(campaignId)
    ? await CampaignModel.findById(campaignId).lean()
    : null;
  if (!campaign) {
    throw new ApplicationError(404, ERROR_CODES.CAMPAIGN_NOT_FOUND, "Campaign not found.");
  }
  return campaign;
}

async function getCampaignReport(campaignId, query, now = new Date()) {
  const campaign = await loadCampaignOrThrow(campaignId);
  const range = resolveRange(query, now);
  const match = { campaignId: campaign._id, day: { $gte: range.from, $lte: range.to } };
  const [totalGroups, dayGroups, coverage] = await Promise.all([
    rollupGroups(match, null),
    rollupGroups(match, "$day"),
    coverageFor(range),
  ]);
  const totals = totalsFrom(totalGroups[0]);
  return {
    coverage,
    campaign: {
      id: String(campaign._id),
      name: campaign.name,
      status: campaign.status,
      flightStartsAt: campaign.flightStartsAt,
      flightEndsAt: campaign.flightEndsAt,
    },
    totals,
    rates: ratesFrom(totals),
    perDay: seriesFrom(range.from, range.to, dayGroups),
    pacing: pacingFor(campaign, now),
  };
}

async function getCampaignCreativesReport(campaignId, query, now = new Date()) {
  const campaign = await loadCampaignOrThrow(campaignId);
  const range = resolveRange(query, now);
  const match = { campaignId: campaign._id, day: { $gte: range.from, $lte: range.to } };
  const [creativeGroups, totalGroups, coverage] = await Promise.all([
    rollupGroups(match, "$creativeId"),
    rollupGroups(match, null),
    coverageFor(range),
  ]);
  const creatives = await CreativeModel.find({
    _id: { $in: creativeGroups.map((group) => group._id) },
  })
    .select("title mediaType status")
    .lean();
  const creativeById = new Map(creatives.map((row) => [String(row._id), row]));
  const totals = totalsFrom(totalGroups[0]);
  return {
    coverage,
    campaign: { id: String(campaign._id), name: campaign.name },
    totals,
    rates: ratesFrom(totals),
    perCreative: creativeGroups
      .map((group) => {
        const creativeTotals = totalsFrom(group);
        const creative = creativeById.get(String(group._id));
        return {
          creativeId: String(group._id),
          title: creative?.title ?? null,
          mediaType: creative?.mediaType ?? null,
          status: creative?.status ?? null,
          ...creativeTotals,
          rates: ratesFrom(creativeTotals),
        };
      })
      .sort((left, right) => right.viewable - left.viewable),
  };
}

async function getPlacementReport(placementKey, query, now = new Date()) {
  if (!Object.values(PLACEMENT_KEYS).includes(placementKey)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Unknown placement.", {
      placementKey: `must be one of ${Object.values(PLACEMENT_KEYS).join(", ")}`,
    });
  }
  const range = resolveRange(query, now);
  const match = { placementKey, day: { $gte: range.from, $lte: range.to } };
  const [placement, totalGroups, dayGroups, campaignGroups, coverage] = await Promise.all([
    PlacementModel.findOne({ key: placementKey }).lean(),
    rollupGroups(match, null),
    rollupGroups(match, "$day"),
    rollupGroups(match, "$campaignId"),
    coverageFor(range),
  ]);
  const campaigns = await CampaignModel.find({ _id: { $in: campaignGroups.map((group) => group._id) } })
    .select("name status")
    .lean();
  const campaignById = new Map(campaigns.map((row) => [String(row._id), row]));
  const totals = totalsFrom(totalGroups[0]);
  return {
    coverage,
    placement: placement ? { key: placement.key, label: placement.label, isActive: placement.isActive } : { key: placementKey },
    totals,
    rates: ratesFrom(totals),
    perDay: seriesFrom(range.from, range.to, dayGroups),
    perCampaign: campaignGroups
      .map((group) => ({
        campaignId: String(group._id),
        name: campaignById.get(String(group._id))?.name ?? null,
        status: campaignById.get(String(group._id))?.status ?? null,
        ...totalsFrom(group),
      }))
      .sort((left, right) => right.viewable - left.viewable),
  };
}

/* The sponsor conversation: every campaign of a promoter with headline figures. */
async function getPromoterSummary(promoterId, query, now = new Date()) {
  const promoter = mongoose.Types.ObjectId.isValid(promoterId)
    ? await PromoterModel.findById(promoterId).lean()
    : null;
  if (!promoter) {
    throw new ApplicationError(404, ERROR_CODES.PROMOTER_NOT_FOUND, "Promoter not found.");
  }
  const range = resolveRange(query, now);
  const campaigns = await CampaignModel.find({ promoterId: promoter._id }).sort({ flightStartsAt: -1 }).lean();
  const match = {
    campaignId: { $in: campaigns.map((row) => row._id) },
    day: { $gte: range.from, $lte: range.to },
  };
  const [campaignGroups, totalGroups, coverage] = await Promise.all([
    rollupGroups(match, "$campaignId"),
    rollupGroups(match, null),
    coverageFor(range),
  ]);
  const groupById = new Map(campaignGroups.map((group) => [String(group._id), group]));
  const totals = totalsFrom(totalGroups[0]);
  return {
    coverage,
    promoter: { id: String(promoter._id), displayName: promoter.displayName, kind: promoter.kind, status: promoter.status },
    totals,
    rates: ratesFrom(totals),
    campaigns: campaigns.map((campaign) => {
      const campaignTotals = totalsFrom(groupById.get(String(campaign._id)));
      return {
        campaignId: String(campaign._id),
        name: campaign.name,
        status: campaign.status,
        flightStartsAt: campaign.flightStartsAt,
        flightEndsAt: campaign.flightEndsAt,
        ...campaignTotals,
        rates: ratesFrom(campaignTotals),
        pacing: pacingFor(campaign, now),
      };
    }),
  };
}

module.exports = {
  getPlatformOverview,
  getCampaignReport,
  getCampaignCreativesReport,
  getPlacementReport,
  getPromoterSummary,
  resolveRange,
  pacingFor,
  zeroTotals,
  MAXIMUM_RANGE_DAYS,
};

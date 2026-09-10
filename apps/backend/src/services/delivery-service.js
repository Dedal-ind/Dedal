const { DeliveryEventModel } = require("../models/delivery-event-model");
const { DeliveryReceiptModel } = require("../models/delivery-receipt-model");
const { DeliveryRejectionModel } = require("../models/delivery-rollup-model");
const { DecisionTokenModel } = require("../models/decision-token-model");
const { CampaignModel } = require("../models/campaign-model");
const { recordImpression, utcDayOf } = require("./frequency-cap-service");
const {
  DELIVERY_EVENT_KINDS,
  CLIENT_REPORTABLE_KINDS,
  DELIVERY_REJECTION_REASONS,
  MINIMUM_VIEWABLE_GAP_MILLISECONDS,
  MAXIMUM_EVENTS_PER_BATCH,
  CRAWLER_USER_AGENT_PATTERN,
} = require("../constants/delivery-constants");

/*
 * DELIVERY INGEST: what actually happened to a decision.
 *
 * EVERYTHING COMES FROM THE STORED TOKEN. A client names a token and a kind;
 * the campaign, creative, placement and — above all — the CAP SUBJECT are
 * read from the token row the engine minted, never from the request body.
 * A client therefore cannot shift its impressions onto another session or
 * another campaign, and an event whose token is unknown or expired is
 * refused.
 *
 * ONCE PER TOKEN PER KIND, enforced by the receipt collection's unique index.
 * A duplicate is reported as such, not as an error: clients retry.
 *
 * ONLY A VIEWABLE TOUCHES THE CAP LEDGERS. A cap counts what was seen, not
 * what was chosen or merely rendered.
 *
 * THE CAMPAIGN'S DELIVERED COUNTER IS NOT INCREMENTED HERE. The rollup job
 * sets it from viewable rollups. A single hot counter on every impression
 * write is exactly the contention this design avoids.
 */

const DUPLICATE_KEY_ERROR_CODE = 11000;

let eventStoreReady = null;

/*
 * The time-series collection must exist with its options BEFORE the first
 * insert, or the driver would silently create a plain one. createCollection
 * is a no-op when it already exists; memoised so it runs once per process.
 */
function ensureEventStore() {
  if (!eventStoreReady) {
    eventStoreReady = DeliveryEventModel.createCollection().catch((error) => {
      // NamespaceExists: a concurrent creator won the race; that is fine.
      if (error?.codeName !== "NamespaceExists" && error?.code !== 48) {
        eventStoreReady = null;
        throw error;
      }
    });
  }
  return eventStoreReady;
}

function isCrawlerUserAgent(userAgent) {
  return typeof userAgent === "string" && CRAWLER_USER_AGENT_PATTERN.test(userAgent);
}

async function countRejection(reason, at = new Date()) {
  await DeliveryRejectionModel.updateOne(
    { day: utcDayOf(at), reason },
    { $inc: { count: 1 } },
    { upsert: true }
  );
}

/* A token the engine minted and that has not expired. Read-only: a token is
   not consumed by reporting, because several kinds report against it. */
async function findLiveToken(token, now) {
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }
  return DecisionTokenModel.findOne({ token, expiresAt: { $gt: now } }).lean();
}

/*
 * Writes the receipt (the idempotency claim), then the event row. Returns
 * "recorded" or "duplicate". The receipt is the gate: if it exists the
 * event has been recorded before and nothing else happens.
 */
async function appendEvent({ tokenRow, kind, at, receivedAt }) {
  try {
    await DeliveryReceiptModel.create({ token: tokenRow.token, kind, at });
  } catch (error) {
    if (error?.code === DUPLICATE_KEY_ERROR_CODE) {
      return "duplicate";
    }
    throw error;
  }
  await ensureEventStore();
  await DeliveryEventModel.create({
    at,
    meta: {
      campaignId: tokenRow.campaignId,
      creativeId: tokenRow.creativeId,
      placementKey: tokenRow.placementKey,
      kind,
    },
    token: tokenRow.token,
    receivedAt,
  });
  return "recorded";
}

/*
 * The server's own record of the choice, written by the engine right after
 * it mints the token. Not client-reportable.
 */
async function recordDecisionEvent(tokenRow, at = new Date()) {
  return appendEvent({ tokenRow, kind: DELIVERY_EVENT_KINDS.DECISION, at, receivedAt: at });
}

/*
 * Clamp a client-supplied moment into something honest: never in the
 * future, never absurdly old. Absent → now.
 */
function resolveOccurredAt(rawValue, now) {
  if (rawValue === undefined || rawValue === null) {
    return now;
  }
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return now;
  }
  return parsed.getTime() > now.getTime() ? now : parsed;
}

async function ingestOne(rawEvent, { now, userAgent }) {
  const kind = rawEvent?.kind;
  if (!CLIENT_REPORTABLE_KINDS.includes(kind)) {
    await countRejection(DELIVERY_REJECTION_REASONS.KIND_INVALID, now);
    return { status: "rejected", reason: DELIVERY_REJECTION_REASONS.KIND_INVALID };
  }

  const tokenRow = await findLiveToken(rawEvent?.token, now);
  if (!tokenRow) {
    await countRejection(DELIVERY_REJECTION_REASONS.TOKEN_INVALID, now);
    return { status: "rejected", reason: DELIVERY_REJECTION_REASONS.TOKEN_INVALID };
  }

  const occurredAt = resolveOccurredAt(rawEvent.occurredAt, now);

  /*
   * INVALID TRAFFIC, the cheap and obvious kind. The decision is the token's
   * mint time; a viewable that claims to precede it, or to follow it faster
   * than a person could have seen anything, is not something an honest
   * client sends.
   */
  if (kind === DELIVERY_EVENT_KINDS.VIEWABLE) {
    const decidedAt = new Date(tokenRow.decidedAt).getTime();
    const gap = occurredAt.getTime() - decidedAt;
    if (gap < 0) {
      await countRejection(DELIVERY_REJECTION_REASONS.VIEWABLE_BEFORE_DECISION, now);
      return { status: "rejected", reason: DELIVERY_REJECTION_REASONS.VIEWABLE_BEFORE_DECISION };
    }
    if (gap < MINIMUM_VIEWABLE_GAP_MILLISECONDS) {
      await countRejection(DELIVERY_REJECTION_REASONS.IMPLAUSIBLE_GAP, now);
      return { status: "rejected", reason: DELIVERY_REJECTION_REASONS.IMPLAUSIBLE_GAP };
    }
  }
  void userAgent;

  const outcome = await appendEvent({ tokenRow, kind, at: occurredAt, receivedAt: now });
  if (outcome === "duplicate") {
    return { status: "duplicate" };
  }

  // Seen, once: both ledgers, for the subject THE TOKEN names.
  if (kind === DELIVERY_EVENT_KINDS.VIEWABLE) {
    const campaign = await CampaignModel.findById(tokenRow.campaignId).select("flightEndsAt").lean();
    await recordImpression({
      subjectKey: tokenRow.subjectKey,
      campaignId: tokenRow.campaignId,
      flightEndsAt: campaign?.flightEndsAt ?? tokenRow.expiresAt,
      at: occurredAt,
    });
  }

  return {
    status: "recorded",
    campaignId: String(tokenRow.campaignId),
    creativeId: String(tokenRow.creativeId),
    placementKey: tokenRow.placementKey,
  };
}

/*
 * A batch, each event processed independently: one bad event never rejects
 * the rest. Returns one outcome per input, in order. A crawler user agent
 * refuses the whole batch — every event in it — and counts each refusal.
 */
async function ingestEvents(rawEvents, { now = new Date(), userAgent = null } = {}) {
  const events = Array.isArray(rawEvents) ? rawEvents : [];
  if (events.length > MAXIMUM_EVENTS_PER_BATCH) {
    await countRejection(DELIVERY_REJECTION_REASONS.BATCH_TOO_LARGE, now);
    return events.map(() => ({
      status: "rejected",
      reason: DELIVERY_REJECTION_REASONS.BATCH_TOO_LARGE,
    }));
  }
  if (isCrawlerUserAgent(userAgent)) {
    for (let index = 0; index < events.length; index += 1) {
      await countRejection(DELIVERY_REJECTION_REASONS.CRAWLER_USER_AGENT, now);
    }
    return events.map(() => ({
      status: "rejected",
      reason: DELIVERY_REJECTION_REASONS.CRAWLER_USER_AGENT,
    }));
  }

  const outcomes = [];
  for (const rawEvent of events) {
    outcomes.push(await ingestOne(rawEvent, { now, userAgent }));
  }
  return outcomes;
}

module.exports = {
  ensureEventStore,
  recordDecisionEvent,
  ingestEvents,
  isCrawlerUserAgent,
};

/*
 * Vocabulary of delivery tracking (promotions phase 4).
 *
 * THE THREE IMPRESSION TIERS ARE SEPARATE KINDS AND ARE NEVER CONFLATED:
 *   decision    — what the SERVER chose. Written by the engine at mint time.
 *   measurable  — what the CLIENT rendered into the document.
 *   viewable    — what met the measurement standard (on screen, long enough).
 *   click       — a tap on the creative.
 * Sponsors are billed on VIEWABLE only. In a carousel slide four may never be
 * swiped to; counting its decision as a delivery reports something that did
 * not happen.
 */
const DELIVERY_EVENT_KINDS = {
  DECISION: "decision",
  MEASURABLE: "measurable",
  VIEWABLE: "viewable",
  CLICK: "click",
};

/* Kinds a client may report. `decision` is the server's own record. */
const CLIENT_REPORTABLE_KINDS = [
  DELIVERY_EVENT_KINDS.MEASURABLE,
  DELIVERY_EVENT_KINDS.VIEWABLE,
  DELIVERY_EVENT_KINDS.CLICK,
];

/* Why an event was refused. Counted, never silently dropped. */
const DELIVERY_REJECTION_REASONS = {
  TOKEN_INVALID: "tokenInvalid",
  KIND_INVALID: "kindInvalid",
  VIEWABLE_BEFORE_DECISION: "viewableBeforeDecision",
  IMPLAUSIBLE_GAP: "implausibleGap",
  CRAWLER_USER_AGENT: "crawlerUserAgent",
  BATCH_TOO_LARGE: "batchTooLarge",
};

/*
 * A viewable reported less than this long after the decision was minted is
 * not something a person saw; the measurement standard alone needs the
 * creative on screen for a second. Deliberately generous — the aim is to
 * refuse the impossible, not to argue with slow phones.
 */
const MINIMUM_VIEWABLE_GAP_MILLISECONDS = 500;

const MAXIMUM_EVENTS_PER_BATCH = 50;

/* Raw events are the audit trail, not the reporting source; rollups are. */
const RAW_EVENT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
const RECEIPT_RETENTION_SECONDS = 7 * 24 * 60 * 60;

/*
 * Known crawlers and headless browsers. A first-party, authenticated surface
 * with single-use tokens has no path for sophisticated fraud; this is the
 * cheap, obvious filter and nothing more elaborate is built.
 */
const CRAWLER_USER_AGENT_PATTERN =
  /bot|crawler|spider|headless|puppeteer|playwright|phantomjs|selenium|slurp|curl\/|wget\/|python-requests|httpclient|scrapy|lighthouse/i;

module.exports = {
  DELIVERY_EVENT_KINDS,
  CLIENT_REPORTABLE_KINDS,
  DELIVERY_REJECTION_REASONS,
  MINIMUM_VIEWABLE_GAP_MILLISECONDS,
  MAXIMUM_EVENTS_PER_BATCH,
  RAW_EVENT_RETENTION_SECONDS,
  RECEIPT_RETENTION_SECONDS,
  CRAWLER_USER_AGENT_PATTERN,
};

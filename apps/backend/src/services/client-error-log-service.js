const {
  ClientErrorLogModel,
  MESSAGE_MAXIMUM_LENGTH,
  STACK_MAXIMUM_LENGTH,
  URL_MAXIMUM_LENGTH,
  USER_AGENT_MAXIMUM_LENGTH,
} = require("../models/client-error-log-model");

/*
 * Browser crash reports in, a hygiene summary out.
 *
 * RECORDING NEVER THROWS. This is called from a client that is already broken;
 * a 500 from the error reporter would turn one crash into two and teach the
 * boundary to retry into a loop. Failures are logged server-side and swallowed.
 */

const HYGIENE_WINDOW_HOURS = 24;
const TOP_MESSAGE_COUNT = 3;

/* Attacker-controlled input: truncate rather than reject, so a long stack still
 * yields a usable report instead of being dropped. */
function clampText(value, maximumLength) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, maximumLength);
}

function parseReportedAt(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function recordClientError(payload = {}, userId = null) {
  const message = clampText(payload.message, MESSAGE_MAXIMUM_LENGTH);
  if (!message) {
    // Nothing usable. Not an error to the caller — they are already in trouble.
    return false;
  }
  try {
    await ClientErrorLogModel.create({
      message,
      stack: clampText(payload.stack, STACK_MAXIMUM_LENGTH),
      url: clampText(payload.url, URL_MAXIMUM_LENGTH),
      userAgent: clampText(payload.userAgent, USER_AGENT_MAXIMUM_LENGTH),
      reportedAt: parseReportedAt(payload.timestamp),
      userId,
    });
    return true;
  } catch (error) {
    console.error(`Client error report could not be stored: ${error.message}`);
    return false;
  }
}

/*
 * The hygiene finding: how bad is it right now, and what is breaking. Grouped by
 * message rather than by stack — one bug produces many stacks (different device,
 * different minified frames) and one message, so grouping by stack would report
 * a single fault as forty separate ones.
 */
async function getRecentClientErrorSummary(now = new Date()) {
  const since = new Date(now.getTime() - HYGIENE_WINDOW_HOURS * 60 * 60 * 1000);

  const [totalCount, topMessages] = await Promise.all([
    ClientErrorLogModel.countDocuments({ createdAt: { $gte: since } }),
    ClientErrorLogModel.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: "$message", count: { $sum: 1 }, lastSeenAt: { $max: "$createdAt" } } },
      { $sort: { count: -1 } },
      { $limit: TOP_MESSAGE_COUNT },
    ]),
  ]);

  return {
    windowHours: HYGIENE_WINDOW_HOURS,
    totalCount,
    topMessages: topMessages.map((row) => ({
      message: row._id,
      count: row.count,
      lastSeenAt: row.lastSeenAt,
    })),
  };
}

module.exports = {
  recordClientError,
  getRecentClientErrorSummary,
  HYGIENE_WINDOW_HOURS,
  TOP_MESSAGE_COUNT,
};

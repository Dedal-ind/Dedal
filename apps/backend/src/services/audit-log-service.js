const mongoose = require("mongoose");

const { AuditLogModel } = require("../models/audit-log-model");
const { assertAdministratorOfFest } = require("../helpers/assert-administrator-of-fest");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { USER_AGENT_MAX_LENGTH } = require("../constants/sign-in-constants");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAXIMUM_LIMIT = 200;
const ACTOR_POPULATE = { path: "actorUserId", select: "fullName emailAddress" };

function truncateUserAgent(userAgent) {
  return typeof userAgent === "string" ? userAgent.slice(0, USER_AGENT_MAX_LENGTH) : null;
}

/*
 * Pure append, and deliberately unbreakable: audit logging must never fail the
 * action it records. A failed insert is logged to stderr and swallowed, so a
 * fest still publishes even if its audit row could not be written.
 */
async function recordAuditLog({
  actorUserId,
  festId = null,
  action,
  entityType,
  entityId,
  beforeState = null,
  afterState = null,
  ipAddress = null,
  userAgent = null,
}) {
  try {
    await AuditLogModel.create({
      actorUserId,
      festId,
      action,
      entityType,
      entityId,
      beforeState,
      afterState,
      ipAddress,
      userAgent: truncateUserAgent(userAgent),
    });
  } catch (error) {
    console.error(`Audit log write failed for action ${action}: ${error.message}`);
  }
}

function normalisePagination(page, limit) {
  const safePage = Number.isInteger(page) && page > 0 ? page : DEFAULT_PAGE;
  const requestedLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  return { page: safePage, limit: Math.min(requestedLimit, MAXIMUM_LIMIT) };
}

/*
 * The narrowing a reader asks for, as a Mongo filter. Everything here is
 * optional; an absent filter is not a filter, never an empty $in — that
 * distinction is what made the fest-wide dashboard show nothing.
 *
 * action takes one value or several because the useful questions are of both
 * shapes: "who force-regenerated a bracket" and "show me every cancellation".
 */
function buildLogFilter(festId, filters = {}) {
  const filter = { festId };

  if (Array.isArray(filters.action) && filters.action.length > 0) {
    filter.action = { $in: filters.action };
  } else if (typeof filters.action === "string" && filters.action) {
    filter.action = filters.action;
  }
  if (filters.entityType) {
    filter.entityType = filters.entityType;
  }
  if (filters.actorUserId && mongoose.Types.ObjectId.isValid(filters.actorUserId)) {
    filter.actorUserId = new mongoose.Types.ObjectId(filters.actorUserId);
  }
  /*
   * The cursor. A page number over an append-only log drifts: entries land while
   * someone reads, every later row shifts down, and page 2 re-shows what page 1
   * already did. Anchoring to the last row's timestamp asks for "older than what
   * I have", which stays true however much arrives behind it.
   */
  if (filters.before instanceof Date && !Number.isNaN(filters.before.getTime())) {
    filter.createdAt = { $lt: filters.before };
  }

  return filter;
}

/*
 * The admin query: newest first, paginated, scoped to one fest the caller
 * administers. assertAdministratorOfFest is the gate — a non-administrator, or an
 * administrator of a different college, never reads another fest's trail.
 *
 * total counts the filtered set ignoring the cursor, so a reader paging through
 * still sees how many entries their filters match rather than how many are left.
 */
async function listAuditLogsForFest(userId, festId, options = {}) {
  const { fest } = await assertAdministratorOfFest(userId, festId);
  const { page, limit } = normalisePagination(options.page, options.limit);

  const filter = buildLogFilter(fest._id, options);
  const { createdAt, ...filterIgnoringCursor } = filter;

  const query = AuditLogModel.find(filter).sort({ createdAt: -1 });
  /* A cursor already says where to start; skipping as well would skip twice. */
  if (!filter.createdAt) {
    query.skip((page - 1) * limit);
  }

  const [logs, total] = await Promise.all([
    query.limit(limit).populate(ACTOR_POPULATE).lean(),
    AuditLogModel.countDocuments(filterIgnoringCursor),
  ]);

  return { logs, total, page, limit };
}

module.exports = { recordAuditLog, listAuditLogsForFest };

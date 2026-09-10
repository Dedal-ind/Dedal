const auditLogService = require("../services/audit-log-service");
const { ERROR_CODES } = require("../constants/error-codes");

function parsePositiveInteger(rawValue) {
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/*
 * An unparseable cursor is dropped rather than refused: the worst it costs is
 * the first page instead of the next one, and a reader who has mistyped a
 * timestamp is better served by a log than by an error about their query string.
 */
function parseTimestamp(rawValue) {
  if (typeof rawValue !== "string" || !rawValue) {
    return undefined;
  }
  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/* Express gives one string for ?action=x and an array for ?action=x&action=y. */
function parseActionFilter(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue.filter((entry) => typeof entry === "string" && entry);
  }
  return typeof rawValue === "string" && rawValue ? rawValue : undefined;
}

async function getAuditLogs(request, response) {
  const { festId } = request.query;
  if (!festId) {
    return response.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "festId is required.",
        details: { festId: "is required" },
      },
    });
  }

  const { userId } = request.authenticatedUser;
  const result = await auditLogService.listAuditLogsForFest(userId, festId, {
    page: parsePositiveInteger(request.query.page),
    limit: parsePositiveInteger(request.query.limit),
    before: parseTimestamp(request.query.before),
    action: parseActionFilter(request.query.action),
    entityType: typeof request.query.entityType === "string" ? request.query.entityType : undefined,
    actorUserId: typeof request.query.actorUserId === "string" ? request.query.actorUserId : undefined,
  });
  return response.status(200).json({ data: result });
}

module.exports = { getAuditLogs };

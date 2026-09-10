const analyticsService = require("../services/analytics-service");
const exportService = require("../services/export-service");
const { extractRequestContext } = require("../helpers/request-context");

// The coordinator/admin gate ran first and stamped isAdministrator + the
// covering staffAssignment; the services scope from them.
function buildScope(request) {
  // ?eventIds= (comma-separated) narrows an export to named events. Applied
  // AFTER authority resolution in resolveScopedEventIds, so a coordinator can
  // filter within their coverage but never widen past it.
  const requestedEventIds =
    typeof request.query?.eventIds === "string" && request.query.eventIds.length > 0
      ? request.query.eventIds.split(",").filter(Boolean)
      : null;
  return {
    isAdministrator: Boolean(request.isAdministrator),
    staffAssignment: request.staffAssignment,
    // The cascading filter sends ?eventId= for a single event too; either
    // spelling narrows the same way.
    requestedEventIds:
      requestedEventIds ?? (request.query?.eventId ? [request.query.eventId] : null),
    /*
     * ?includeDescendants=true widens a named parent event to its whole
     * subtree. The admin filter sets it when an EVENT is chosen but no
     * SUB-EVENT is — "show me this event and everything under it".
     */
    includeDescendants: request.query?.includeDescendants === "true",
  };
}

async function getAnalyticsSummary(request, response) {
  const summary = await analyticsService.getFestAnalyticsSummary(
    request.params.festId,
    buildScope(request),
    // ?eventId= narrows EVERY count in the summary to one event (section C).
    {
      eventId: request.query.eventId,
      includeDescendants: request.query.includeDescendants === "true",
    }
  );
  return response.status(200).json({ data: summary });
}

async function getHygieneReport(request, response) {
  const report = await analyticsService.getFestHygieneReport(request.params.festId);
  return response.status(200).json({ data: report });
}

async function getPlatformAnalytics(request, response) {
  const analytics = await analyticsService.getPlatformAnalytics();
  return response.status(200).json({ data: analytics });
}

async function getExportCounts(request, response) {
  const counts = await exportService.getExportCounts(request.params.festId, buildScope(request));
  return response.status(200).json({ data: counts });
}

/* The streaming CSV exports: the service writes the response itself. */
function buildCsvExportHandler(streamFunction, options = {}) {
  return async function handleCsvExport(request, response) {
    const { userId } = request.authenticatedUser;
    const streamArguments = [userId, request.params.festId, response];
    if (options.scoped) {
      streamArguments.push(buildScope(request));
    }
    streamArguments.push(extractRequestContext(request));
    await streamFunction(...streamArguments);
  };
}

const getRegistrationsCsv = buildCsvExportHandler(exportService.streamRegistrationsCsv, { scoped: true });

/* One handler per direction so the route names the sheet it serves. */
function buildScanCsvHandler(direction) {
  return async function handleScanCsv(request, response) {
    await exportService.streamEventScanDirectionCsv(
      request.authenticatedUser.userId,
      request.params.festId,
      request.params.eventId,
      direction,
      response,
      extractRequestContext(request)
    );
  };
}
const getCheckInsCsv = buildScanCsvHandler("in");
const getCheckOutsCsv = buildScanCsvHandler("out");
const getPaymentsCsv = buildCsvExportHandler(exportService.streamPaymentsCsv, { scoped: true });
const getScansCsv = buildCsvExportHandler(exportService.streamScansCsv, { scoped: true });
const getAuditLogCsv = buildCsvExportHandler(exportService.streamAuditLogCsv);
/*
 * The filtered staff export. role / status / eventId are each repeatable
 * (?role=coordinator&role=volunteer) and combine as AND; Express gives a lone
 * value as a string and repeats as an array, so both are normalised here.
 */
function parseStaffExportFilters(request) {
  const toArray = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
  return {
    roles: toArray(request.query.role),
    statuses: toArray(request.query.status),
    eventIds: toArray(request.query.eventId),
    includeDescendants: request.query.includeDescendants === "true",
  };
}

async function getStaffAssignmentsCsv(request, response) {
  const { userId } = request.authenticatedUser;
  await exportService.streamStaffAssignmentsCsv(
    userId,
    request.params.festId,
    response,
    extractRequestContext(request),
    parseStaffExportFilters(request)
  );
}

/* The download modal's live "Will export N rows" preview. */
async function getStaffAssignmentsExportCount(request, response) {
  const result = await exportService.countStaffAssignmentsForExport(
    request.params.festId,
    parseStaffExportFilters(request)
  );
  return response.status(200).json({ data: result });
}
const getCertificatesCsv = buildCsvExportHandler(exportService.streamCertificatesCsv);
const getFeedbackCsv = buildCsvExportHandler(exportService.streamFeedbackCsv);

module.exports = {
  getAnalyticsSummary,
  getHygieneReport,
  getPlatformAnalytics,
  getExportCounts,
  getRegistrationsCsv,
  getCheckInsCsv,
  getCheckOutsCsv,
  getPaymentsCsv,
  getScansCsv,
  getAuditLogCsv,
  getStaffAssignmentsCsv,
  getStaffAssignmentsExportCount,
  getCertificatesCsv,
  getFeedbackCsv,
};

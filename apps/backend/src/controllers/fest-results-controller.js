const festResultsService = require("../services/fest-results-service");
const { toCsvLine, setCsvResponseHeaders } = require("../helpers/csv-stream-helpers");

/*
 * GET /fests/:festId/results?eventId=…
 *
 * The level is derived from the scope, not asked for — see fest-results-service.
 * `eventId` absent means the whole fest.
 */
async function getFestResults(request, response) {
  const result = await festResultsService.getFestResults(
    request.params.festId,
    request.query.eventId || null
  );
  return response.status(200).json({ data: result });
}

/*
 * The same data as an attachment. `format` is accepted and only csv is
 * implemented; an unknown format is a 400 rather than a silent CSV, because a
 * caller asking for xlsx and receiving CSV under an .xlsx name gets a file their
 * spreadsheet refuses to open.
 */
async function getFestResultsDownload(request, response) {
  const requestedFormat = String(request.query.format ?? "csv").toLowerCase();
  if (requestedFormat !== "csv") {
    return response.status(400).json({
      error: {
        code: "VALIDATION_FAILED",
        message: "Only format=csv is supported.",
        details: { format: requestedFormat },
      },
    });
  }

  const { scope, festSlug, headers, rows } = await festResultsService.buildResultsCsv(
    request.params.festId,
    request.query.eventId || null
  );

  /* A filename segment is not a free-text field: a slash or a quote from an
     event name would break the Content-Disposition header it lands in. */
  const safeScope = scope.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  setCsvResponseHeaders(response, safeScope || "results", festSlug);

  response.write(toCsvLine(headers));
  for (const row of rows) {
    response.write(toCsvLine(row));
  }
  return response.end();
}

module.exports = { getFestResults, getFestResultsDownload };

/*
 * RFC 4180 CSV escaping for the streamed exports — the backend twin of the
 * frontend's helpers/admin-csv.js escaper (same rules: wrap when a comma, quote
 * or newline appears; double inner quotes), ported because the two projects
 * cannot share a module. Rows are written to the response one at a time; nothing
 * accumulates the full result in memory.
 */
function escapeCsvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsvLine(cells) {
  return `${cells.map(escapeCsvCell).join(",")}\r\n`;
}

/* yyyymmdd for the export filename. */
function formatFileDate(date = new Date()) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function setCsvResponseHeaders(response, scope, festSlug) {
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="${scope}-${festSlug}-${formatFileDate()}.csv"`
  );
}

module.exports = { escapeCsvCell, toCsvLine, formatFileDate, setCsvResponseHeaders };

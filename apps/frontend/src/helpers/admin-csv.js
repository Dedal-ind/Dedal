// admin-csv.js
// Client-side CSV generation + download. No backend involved — the admin exports
// exactly the rows currently visible in the directory. Values are escaped per
// RFC 4180 (wrap in quotes, double any inner quote) so a name or event title
// containing a comma, quote or newline can't break the columns.

function escapeCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

// rows: array of arrays (already ordered to match `headers`).
export function buildCsv(headers, rows) {
  const lines = [headers, ...rows].map((cells) => cells.map(escapeCell).join(','));
  return lines.join('\r\n');
}

// Triggers a browser download of `content` as `filename`. A leading UTF-8 BOM
// (U+FEFF) makes Excel read the file as UTF-8, so non-ASCII names render right.
export function downloadCsv(filename, content) {
  const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
  const blob = new Blob([BYTE_ORDER_MARK + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

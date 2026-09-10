/*
 * Calendar links for an event: an RFC 5545 .ics file and a Google Calendar
 * "create event" deep link.
 *
 * BOTH ARE STRING BUILDING. An .ics file is a line-oriented text format, and the
 * Google link is a query string — neither justifies a dependency, and an ics
 * library would be a supply-chain surface added for ~40 lines of concatenation.
 *
 * The fiddly parts of RFC 5545, all of which bite in practice:
 *   - Line endings are CRLF. Some parsers tolerate LF; Outlook does not.
 *   - Timestamps in the UTC "Z" form (20270301T100000Z), which sidesteps having
 *     to ship a VTIMEZONE block for Asia/Kolkata.
 *   - Commas, semicolons and backslashes are structural and must be escaped
 *     inside text values, and a literal newline is written as "\n".
 *   - Lines longer than 75 octets must be folded, continuing with a leading
 *     space. A venue plus a description reaches that easily.
 *   - UID must be globally unique and STABLE, so re-downloading updates the same
 *     calendar entry instead of creating a duplicate.
 */

const { applicationConfig } = require("../config/application-config");

const ICS_LINE_ENDING = "\r\n";
const ICS_MAXIMUM_LINE_OCTETS = 75;

/* RFC 5545 §3.3.5 — the basic UTC form, no separators. */
function formatIcsTimestamp(dateValue) {
  return new Date(dateValue).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/* RFC 5545 §3.3.11 — escape the four characters that are structural in TEXT. */
function escapeIcsText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/*
 * RFC 5545 §3.1 line folding. Measured in OCTETS, not characters — an event
 * named in Kannada or carrying an em dash is multi-byte, and folding on
 * character count would produce lines that are still too long.
 */
function foldIcsLine(line) {
  const lineBuffer = Buffer.from(line, "utf8");
  if (lineBuffer.length <= ICS_MAXIMUM_LINE_OCTETS) {
    return line;
  }
  const segments = [];
  let cursor = 0;
  let limit = ICS_MAXIMUM_LINE_OCTETS;
  while (cursor < lineBuffer.length) {
    let sliceEnd = Math.min(cursor + limit, lineBuffer.length);
    /*
     * Never split a multi-byte character. A UTF-8 continuation byte is
     * 10xxxxxx; walk back until the next byte starts a fresh character.
     */
    while (sliceEnd > cursor && sliceEnd < lineBuffer.length && (lineBuffer[sliceEnd] & 0xc0) === 0x80) {
      sliceEnd -= 1;
    }
    segments.push(lineBuffer.subarray(cursor, sliceEnd).toString("utf8"));
    cursor = sliceEnd;
    limit = ICS_MAXIMUM_LINE_OCTETS - 1; // continuation lines carry a leading space
  }
  return segments.join(`${ICS_LINE_ENDING} `);
}

/*
 * A filename safe on every OS: no path separators, no reserved characters, no
 * spaces to be mangled by a Content-Disposition parser.
 */
function buildIcsFileName(eventName) {
  const slug = String(eventName ?? "event")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "event"}.ics`;
}

function buildEventDescription(event, fest) {
  const parts = [];
  if (fest?.festName) {
    parts.push(`Part of ${fest.festName}.`);
  }
  if (event.description) {
    parts.push(event.description);
  }
  parts.push("Your pass and registration details are in the Dedal app.");
  return parts.join(" ");
}

/*
 * The .ics body. VCALENDAR wrapping one VEVENT — no alarms, no recurrence, no
 * attendee list: an attendee block would leak every participant's address to
 * everyone who downloaded the file.
 */
function buildEventIcsFile(event, fest) {
  const eventId = String(event._id ?? event.id);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dedal//Fest Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // Stable per event, so a second download updates rather than duplicates.
    `UID:event-${eventId}@dedal.in`,
    // DTSTAMP is when the FILE was produced; DTSTART/DTEND are the event.
    `DTSTAMP:${formatIcsTimestamp(new Date())}`,
    `DTSTART:${formatIcsTimestamp(event.startsAt)}`,
    `DTEND:${formatIcsTimestamp(event.endsAt)}`,
    `SUMMARY:${escapeIcsText(event.eventName)}`,
    `DESCRIPTION:${escapeIcsText(buildEventDescription(event, fest))}`,
    ...(event.venue ? [`LOCATION:${escapeIcsText(event.venue)}`] : []),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // Trailing CRLF: RFC 5545 wants every content line terminated, including the last.
  return `${lines.map(foldIcsLine).join(ICS_LINE_ENDING)}${ICS_LINE_ENDING}`;
}

/*
 * Google Calendar's template deep link. `dates` uses the same compact UTC form
 * as the .ics, separated by a slash. This is a plain URL — no API, no key, no
 * quota.
 */
function buildGoogleCalendarUrl(event, fest) {
  const parameters = new URLSearchParams({
    action: "TEMPLATE",
    text: event.eventName ?? "Event",
    dates: `${formatIcsTimestamp(event.startsAt)}/${formatIcsTimestamp(event.endsAt)}`,
    details: buildEventDescription(event, fest),
  });
  if (event.venue) {
    parameters.set("location", event.venue);
  }
  return `https://calendar.google.com/calendar/event?${parameters.toString()}`;
}

/* The public .ics endpoint, for the "Download .ics" link in an email. */
function buildIcsDownloadUrl(eventId) {
  return `${applicationConfig.backendBaseUrl}/api/v1/events/${eventId}/calendar.ics`;
}

module.exports = {
  buildEventIcsFile,
  buildGoogleCalendarUrl,
  buildIcsDownloadUrl,
  buildIcsFileName,
  formatIcsTimestamp,
  escapeIcsText,
  foldIcsLine,
};

/*
 * The registration confirmation email's body.
 *
 * DISTINCT FROM THE PASS EMAIL, on purpose. The pass email carries the QR — it
 * answers "how do I get in". This one answers "what did I actually sign up for":
 * when, where, with whom, what it cost, and how to put it in a calendar. They
 * are sent to the same person moments apart and must not be merged: a
 * participant re-reading the schedule should not have to scroll past a QR, and
 * someone at the gate should not have to scroll past a fee breakdown.
 *
 * Table-based HTML with inline attributes, for the same reason as
 * pass-email-helpers: Outlook web strips most of a <style> block and understands
 * almost no layout beyond tables.
 */

const { applicationConfig } = require("../config/application-config");
const {
  buildGoogleCalendarUrl,
  buildIcsDownloadUrl,
} = require("./calendar-helpers");
const { buildMapsUrl } = require("./venue-map-link-helpers");

/* Escapes the handful of characters that could break out of the HTML body. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Paise to a display string. Money is integer paise everywhere; this is the
   only place it becomes rupees, and it never does arithmetic on a float. */
function formatRupees(amountPaise) {
  const wholeRupees = Math.floor(amountPaise / 100);
  const paiseRemainder = amountPaise % 100;
  const grouped = wholeRupees.toLocaleString("en-IN");
  return paiseRemainder === 0 ? `₹${grouped}` : `₹${grouped}.${String(paiseRemainder).padStart(2, "0")}`;
}

function formatDateTimeRange(startsAt, endsAt) {
  const dateOptions = { day: "numeric", month: "short", year: "numeric" };
  const timeOptions = { hour: "numeric", minute: "2-digit", hour12: true };
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const startDate = start.toLocaleDateString("en-IN", dateOptions);
  const endDate = end.toLocaleDateString("en-IN", dateOptions);
  const startTime = start.toLocaleTimeString("en-IN", timeOptions);
  const endTime = end.toLocaleTimeString("en-IN", timeOptions);
  return startDate === endDate
    ? `${startDate}, ${startTime} – ${endTime}`
    : `${startDate}, ${startTime} – ${endDate}, ${endTime}`;
}

/*
 * The charged lines, in the participant's own words. feeBreakdown is the
 * authoritative snapshot of what they were billed — a later price edit never
 * rewrites it — so this reads that rather than re-deriving from the event.
 */
function buildFeeLines(registration) {
  return (registration.feeBreakdown ?? []).map((line) => ({
    label: line.quantity > 1 ? `${line.label} × ${line.quantity}` : line.label,
    amount: formatRupees(line.subtotalPaise),
  }));
}

function buildRegistrationEmail({ user, registration, event, fest, team, contactPhone }) {
  const eventName = event.eventName ?? "your event";
  const festName = fest?.festName ?? "";
  const subject = festName
    ? `You're registered for ${eventName} at ${festName}`
    : `You're registered for ${eventName}`;

  const totalPaise = registration.totalFeePaise ?? 0;
  const amountLabel = totalPaise > 0 ? formatRupees(totalPaise) : "FREE";
  const feeLines = buildFeeLines(registration);
  const scheduleLine = formatDateTimeRange(event.startsAt, event.endsAt);
  const registrationTypeLabel = team ? "Team" : "Solo";
  const eventId = String(event._id ?? event.id);

  const googleCalendarUrl = buildGoogleCalendarUrl(event, fest);
  const icsUrl = buildIcsDownloadUrl(eventId);
  const mapsUrl = buildMapsUrl(event.venue);

  /* ---------- plain text ---------- */
  const textLines = [
    `You're registered for ${eventName}.`,
    "",
    `When:  ${scheduleLine}`,
    ...(event.venue ? [`Where: ${event.venue}${mapsUrl ? ` (${mapsUrl})` : ""}`] : []),
    ...(festName ? [`Fest:  ${festName}`] : []),
    `Type:  ${registrationTypeLabel}`,
    ...(team ? [`Team:  ${team.teamName}`, `Invite code (share this): ${team.inviteCode}`] : []),
    "",
    ...(feeLines.length > 0
      ? ["What you booked:", ...feeLines.map((line) => `  - ${line.label}: ${line.amount}`), ""]
      : []),
    `Amount paid: ${amountLabel}`,
    `Registration ID: ${String(registration._id ?? registration.id)}`,
    "",
    "Add to your calendar:",
    `  Google Calendar: ${googleCalendarUrl}`,
    `  Download .ics:   ${icsUrl}`,
    "",
    ...(contactPhone ? [`Questions? Contact the event coordinator: ${contactPhone}`, ""] : []),
    "— The Dedal team",
  ];

  /* ---------- html ---------- */
  const detailRow = (label, value) =>
    `<tr>` +
    `<td style="padding:6px 12px 6px 0;font-family:Arial,sans-serif;font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>` +
    `<td style="padding:6px 0;font-family:Arial,sans-serif;font-size:14px;color:#0F172A;">${value}</td>` +
    `</tr>`;

  const venueCell = event.venue
    ? mapsUrl
      ? `<a href="${escapeHtml(mapsUrl)}" style="color:#2563EB;">${escapeHtml(event.venue)}</a>`
      : escapeHtml(event.venue)
    : "";

  const feeTableRows = feeLines
    .map(
      (line) =>
        `<tr>` +
        `<td style="padding:4px 0;font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">${escapeHtml(line.label)}</td>` +
        `<td style="padding:4px 0;font-family:Arial,sans-serif;font-size:13px;color:#0F172A;text-align:right;">${escapeHtml(line.amount)}</td>` +
        `</tr>`
    )
    .join("");

  const html =
    // A fragment: the 600px card, the header and the footer come from
    // wrapInBrandedTemplate, so this only carries the content.
    `<div>` +
    `<h1 style="margin:0 0 4px;font-family:Arial,sans-serif;font-size:22px;color:#0F172A;">You're registered</h1>` +
    `<p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:15px;color:#0F172A;">${escapeHtml(eventName)}</p>` +
    `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-top:1px solid #E2E8F0;border-bottom:1px solid #E2E8F0;padding:8px 0;">` +
    detailRow("When", escapeHtml(scheduleLine)) +
    (event.venue ? detailRow("Where", venueCell) : "") +
    (festName ? detailRow("Fest", escapeHtml(festName)) : "") +
    detailRow("Type", escapeHtml(registrationTypeLabel)) +
    (team ? detailRow("Team", escapeHtml(team.teamName)) : "") +
    (team ? detailRow("Invite code", `<strong>${escapeHtml(team.inviteCode)}</strong>`) : "") +
    `</table>` +
    (feeTableRows
      ? `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin-top:16px;">${feeTableRows}</table>`
      : "") +
    `<p style="margin:16px 0 4px;font-family:Arial,sans-serif;font-size:16px;color:#0F172A;"><strong>Amount paid: ${escapeHtml(amountLabel)}</strong></p>` +
    `<p style="margin:0 0 20px;font-family:Arial,sans-serif;font-size:12px;color:#64748B;">Registration ID: <span style="font-family:monospace;">${escapeHtml(String(registration._id ?? registration.id))}</span></p>` +
    `<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;color:#64748B;text-transform:uppercase;letter-spacing:0.5px;">Add to calendar</p>` +
    `<p style="margin:0 0 20px;">` +
    `<a href="${escapeHtml(googleCalendarUrl)}" style="display:inline-block;padding:10px 16px;margin-right:8px;background:#2563EB;color:#FFFFFF;font-family:Arial,sans-serif;font-size:13px;text-decoration:none;border-radius:4px;">Add to Google Calendar</a>` +
    `<a href="${escapeHtml(icsUrl)}" style="display:inline-block;padding:10px 16px;background:#FFFFFF;color:#2563EB;font-family:Arial,sans-serif;font-size:13px;text-decoration:none;border:1px solid #2563EB;border-radius:4px;">Download .ics</a>` +
    `</p>` +
    (contactPhone
      ? `<p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;color:#0F172A;">Questions? Contact the event coordinator: <a href="tel:${escapeHtml(contactPhone)}" style="color:#2563EB;">${escapeHtml(contactPhone)}</a></p>`
      : "") +
    `<p style="margin:24px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#64748B;">— The Dedal team</p>` +
    `${applicationConfig.frontendBaseUrl ? `<p style="margin:4px 0 0;font-family:Arial,sans-serif;font-size:12px;color:#64748B;"><a href="${escapeHtml(applicationConfig.frontendBaseUrl)}" style="color:#64748B;">${escapeHtml(applicationConfig.frontendBaseUrl)}</a></p>` : ""}` +
    `</div>`;

  return { subject, text: textLines.join("\n"), html };
}

module.exports = { buildRegistrationEmail, formatRupees, formatDateTimeRange };

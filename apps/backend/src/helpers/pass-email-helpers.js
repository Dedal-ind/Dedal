const qrImage = require("qr-image");

const { applicationConfig } = require("../config/application-config");
const { ENTITLEMENT_TYPES } = require("../constants/pass-constants");

/*
 * The pass email's body, built here so email-service stays a transport.
 *
 * Deliberately TABLE-BASED with inline attributes and no flex/grid/modern CSS:
 * Outlook web strips most of a <style> block and understands almost no layout
 * beyond tables, so anything cleverer renders as a stack of unstyled text in
 * the one client organisers most often use.
 *
 * The QR travels as a cid: attachment, NOT a data: URI — Gmail and Outlook both
 * strip data-URI <img> sources, which would leave the participant holding an
 * email with no scannable code.
 */

const QR_CONTENT_ID = "dedal-pass-qr";
const QR_PIXEL_SIZE = 10; // qr-image "size" is module px; 10 yields ~330px square

/* The one place the QR PNG is produced — the same qr-image dependency the
   certificate renderer already uses. No new library, no network call. */
function buildQrAttachment(qrToken) {
  const qrPngBuffer = qrImage.imageSync(qrToken, { type: "png", size: QR_PIXEL_SIZE, margin: 2 });
  return {
    filename: "dedal-pass-qr.png",
    content: qrPngBuffer.toString("base64"),
    content_id: QR_CONTENT_ID,
  };
}

function formatFestDateRange(startsOn, endsOn) {
  const options = { day: "numeric", month: "short", year: "numeric" };
  const start = new Date(startsOn).toLocaleDateString("en-IN", options);
  const end = new Date(endsOn).toLocaleDateString("en-IN", options);
  return start === end ? start : `${start} – ${end}`;
}

/* Escapes the handful of characters that could break out of the HTML body. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/*
 * The events this pass admits its holder to: the ACTIVE eventEntry entitlements,
 * whose referenceId the caller has already populated to the event document.
 * Anything else on the pass (gate access, offer claims) is not an "event".
 */
function readRegisteredEventNames(entitlements) {
  return (entitlements ?? [])
    .filter((entitlement) => entitlement.entitlementType === ENTITLEMENT_TYPES.EVENT_ENTRY)
    .map((entitlement) => entitlement.referenceId?.eventName)
    .filter(Boolean);
}

function buildPassEmailSubject(fest) {
  // No PII in the subject line — no name, phone, college or event. Deliberate:
  // subject lines are the part of an email most likely to be shoulder-surfed,
  // synced to a lock screen, or logged by a mail gateway.
  return `Your Dedal pass for ${fest.festName}`;
}

function buildDetailRow(label, value) {
  if (!value) {
    return "";
  }
  return `<tr>
      <td style="padding:4px 12px 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#666666;">${escapeHtml(label)}</td>
      <td style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;font-weight:bold;">${escapeHtml(value)}</td>
    </tr>`;
}

function buildPassEmailHtml({ user, fest, pass, eventNames, passUrl }) {
  const eventListHtml =
    eventNames.length > 0
      ? eventNames
          .map(
            (eventName) =>
              `<tr><td style="padding:3px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;">• ${escapeHtml(eventName)}</td></tr>`
          )
          .join("")
      : `<tr><td style="padding:3px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#666666;">Your registrations will appear here as you sign up.</td></tr>`;

  /*
   * A FRAGMENT, not a document. The outer shell — wrapper, header, footer —
   * now comes from wrapInBrandedTemplate so the pass email is framed like
   * every other email rather than carrying its own one-off chrome.
   */
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">

            <tr>
              <td style="padding:0 0 16px;text-align:center;border-bottom:2px solid #111111;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#111111;text-transform:uppercase;">${escapeHtml(fest.festName)}</div>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#666666;padding-top:6px;">${escapeHtml(formatFestDateRange(fest.startsOn, fest.endsOn))}</div>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  ${buildDetailRow("Name", user.fullName)}
                  ${buildDetailRow("Email", user.emailAddress)}
                  ${buildDetailRow("Contact", user.phoneNumber)}
                  ${buildDetailRow("College", user.collegeId?.collegeName || user.collegeId?.commonName)}
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:0 0 8px;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#666666;text-transform:uppercase;letter-spacing:1px;padding-bottom:6px;">Registered for</div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">${eventListHtml}</table>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:16px 0;">
                <img src="cid:${QR_CONTENT_ID}" alt="Your pass QR code" width="280" style="display:block;border:2px solid #111111;" />
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#666666;padding-top:10px;">Backup code: <strong style="color:#111111;letter-spacing:2px;">${escapeHtml(pass.backupCode)}</strong></div>
              </td>
            </tr>

            <tr>
              <td style="padding:0;">
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111111;line-height:20px;">
                  Show this pass at the gate and at each event's door. This pass covers everything you've registered for at ${escapeHtml(fest.festName)}.
                </div>
                <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#666666;line-height:18px;padding-top:12px;">
                  Save this email — it is your pass if you cannot open the app at the venue.
                  You can also view it any time at <a href="${escapeHtml(passUrl)}" style="color:#111111;">${escapeHtml(passUrl)}</a>.
                </div>
              </td>
            </tr>

          </table>`;
}

/* The plain-text fallback: everything essential, plus the in-app link. */
function buildPassEmailText({ user, fest, pass, eventNames, passUrl }) {
  const lines = [
    `Your Dedal pass for ${fest.festName}`,
    formatFestDateRange(fest.startsOn, fest.endsOn),
    "",
    `Name: ${user.fullName ?? "—"}`,
    `Email: ${user.emailAddress ?? "—"}`,
    `Contact: ${user.phoneNumber ?? "—"}`,
    `College: ${user.collegeId?.collegeName || user.collegeId?.commonName || "—"}`,
    "",
    "Registered for:",
    ...(eventNames.length > 0
      ? eventNames.map((eventName) => `  - ${eventName}`)
      : ["  (your registrations will appear here as you sign up)"]),
    "",
    `Backup code: ${pass.backupCode}`,
    "",
    `Show this pass at the gate and at each event's door. This pass covers everything you've registered for at ${fest.festName}.`,
    "The QR code is attached to this email.",
    "",
    `View your pass: ${passUrl}`,
  ];
  return lines.join("\n");
}

/* Everything the transport needs for one pass email, assembled in one call. */
function buildPassEmail({ user, fest, pass, entitlements }) {
  const eventNames = readRegisteredEventNames(entitlements);
  const passUrl = `${applicationConfig.frontendBaseUrl}/my-passes/${fest._id ?? fest.id}`;
  const payload = { user, fest, pass, eventNames, passUrl };

  return {
    subject: buildPassEmailSubject(fest),
    html: buildPassEmailHtml(payload),
    text: buildPassEmailText(payload),
    attachments: [buildQrAttachment(pass.qrToken)],
  };
}

module.exports = { buildPassEmail, readRegisteredEventNames, QR_CONTENT_ID };

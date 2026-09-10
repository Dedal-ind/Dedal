const { applicationConfig } = require("../config/application-config");
const { AUTHENTICATION_CONSTANTS } = require("../constants/authentication-constants");
const { buildPassEmail } = require("../helpers/pass-email-helpers");
const { buildRegistrationEmail } = require("../helpers/registration-email-helpers");
const { buildBrandedEmailBodies, wrapInBrandedTemplate } = require("../helpers/email-template");

const RESEND_ENDPOINT_URL = "https://api.resend.com/emails";

/*
 * A hung provider must not hold the HTTP request that triggered it. The old SMTP
 * transport bounded this with connection/greeting/socket timeouts; over HTTP one
 * abort deadline covers the same ground.
 */
const SEND_TIMEOUT_MS = 10000;

const EMAIL_DRIVERS = {
  RESEND: "resend",
  CONSOLE: "console",
  NONE: "none",
};

/*
 * The credential decides the transport, exactly as the upload driver is chosen
 * by the presence of its S3 keys. Read live rather than cached at import, so a
 * test or script can set the key and have the next send pick it up.
 *
 * Development without a key falls back to the console: a local install should
 * run with no mail provider at all, printing codes to the terminal. Production
 * without a key gets NONE, which fails every send loudly — silently pretending
 * to deliver is what let unusable credentials reach a live fest unnoticed.
 */
function getActiveEmailDriverName() {
  if (applicationConfig.resendApiKey) {
    return EMAIL_DRIVERS.RESEND;
  }
  return applicationConfig.isDevelopment ? EMAIL_DRIVERS.CONSOLE : EMAIL_DRIVERS.NONE;
}

/*
 * Resend accepts one RFC 5322 From. EMAIL_FROM_ADDRESS may already carry a
 * display name ("Dedal <a@b.com>"), in which case EMAIL_FROM_NAME would
 * produce a malformed nested name — so it is only applied to a bare address.
 */
function buildFromAddress() {
  const fromAddress = applicationConfig.emailFromAddress;
  if (!applicationConfig.emailFromName || fromAddress.includes("<")) {
    return fromAddress;
  }
  return `${applicationConfig.emailFromName} <${fromAddress}>`;
}

async function sendViaResend({ to, subject, text, html, attachments }) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), SEND_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_ENDPOINT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${applicationConfig.resendApiKey}`,
        "Content-Type": "application/json",
      },
      /*
       * html and attachments are OPTIONAL and omitted unless a caller supplies
       * them, so every existing text-only sender is byte-identical on the wire.
       * Attachments carry content_id so an inline <img src="cid:..."> resolves
       * (the pass QR); a client that ignores content_id still receives the
       * image as a normal attachment rather than a broken image.
       */
      body: JSON.stringify({
        from: buildFromAddress(),
        to: [to],
        subject,
        text,
        ...(html ? { html } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      }),
      signal: abortController.signal,
    });

    if (!response.ok) {
      /*
       * Resend answers 4xx with a JSON body naming the cause — an unverified
       * sending domain, a revoked key. That message is the whole diagnosis, so
       * it is surfaced rather than just the status code.
       */
      const failureDetail = await response.text().catch(() => "");
      throw new Error(`Resend responded ${response.status}: ${failureDetail.slice(0, 300)}`);
    }
    return true;
  } finally {
    clearTimeout(timeoutId);
  }
}

/*
 * Resolves true when the message left the process, false when delivery failed.
 * It deliberately does not throw: the caller has already persisted the OTP row,
 * and a dead provider must not invalidate a code the user may receive by
 * another channel. The boolean becomes the response warning field.
 */
async function sendMailQuietly({ to, subject, text, html, attachments }) {
  if (applicationConfig.isStaging) {
    const allowed = applicationConfig.stagingEmailAllowlist;
    if (!allowed.includes(to.toLowerCase())) {
      console.log(`[email:staging-suppressed] to=${to} subject=${subject}`);
      return true;
    }
  }

  const driverName = getActiveEmailDriverName();

  if (driverName === EMAIL_DRIVERS.CONSOLE) {
    console.log(`[email:console] to=${to} subject=${subject}\n${text}\n`);
    return true;
  }

  if (driverName === EMAIL_DRIVERS.NONE) {
    console.error(
      `Email delivery failed: no transport configured (RESEND_API_KEY is unset). Intended for ${to}.`
    );
    return false;
  }

  try {
    return await sendViaResend({ to, subject, text, html, attachments });
  } catch (error) {
    const reason = error.name === "AbortError" ? `timed out after ${SEND_TIMEOUT_MS}ms` : error.message;
    console.error(`Email delivery failed: ${reason}`);
    return false;
  }
}

/*
 * Printed once at boot, next to the upload driver, so which transport is live is
 * visible without reproducing a failed sign-in.
 */
function logActiveEmailDriver() {
  const driverName = getActiveEmailDriverName();
  if (driverName === EMAIL_DRIVERS.NONE) {
    console.warn(
      "WARNING: no email driver — RESEND_API_KEY is unset outside development. " +
        "Every OTP sign-in will fail until it is set."
    );
    return;
  }
  const stagingNote = applicationConfig.isStaging
    ? ` (staging: allowlist=${applicationConfig.stagingEmailAllowlist.length} addresses)`
    : "";
  console.log(`Using ${driverName} email driver${stagingNote}`);
}

/*
 * No development short-circuit here any more: the driver decides. Without a key
 * development uses the console driver and the code is printed to the terminal as
 * before; WITH a key, development delivers for real, which is what makes the
 * provider testable locally before it is trusted in production.
 */
async function sendOtpEmail(emailAddress, otpCode) {
  const messageBody =
    `Your Dedal code is ${otpCode}.\n\n` +
    `It expires in ${AUTHENTICATION_CONSTANTS.OTP_EXPIRY_MINUTES} minutes.\n\n` +
    `If you did not request this code, ignore this email.`;

  // No fest is involved in signing in, so this one always wears the Dedal mark.
  return sendMailQuietly({
    to: emailAddress,
    subject: "Your Dedal code",
    ...buildBrandedEmailBodies(messageBody),
  });
}

/*
 * Same contract as sendOtpEmail: resolves a boolean, never throws. The assignment
 * is already persisted by the time this runs, and a dead SMTP host must not undo
 * it — the coordinator can still be told in person.
 */
async function sendAssignmentInvitation({ emailAddress, role, festName, festBannerImageUrl }) {
  const messageBody =
    `You have been assigned as ${role} for ${festName}.\n\n` +
    `Sign in with this email address to see your assignment: ` +
    `${applicationConfig.frontendBaseUrl}\n\n` +
    `If you were not expecting this, you can ignore this email.`;

  return sendMailQuietly({
    to: emailAddress,
    subject: `You've been assigned as ${role} for ${festName}`,
    ...buildBrandedEmailBodies(messageBody, { festName, logoUrl: festBannerImageUrl }),
  });
}

async function sendAssignmentRevocation({
  emailAddress,
  role,
  festName,
  reason,
  festBannerImageUrl,
}) {
  const reasonLine = reason ? `\n\nReason: ${reason}` : "";
  const messageBody =
    `Your ${role} assignment for ${festName} has been revoked.` +
    `${reasonLine}\n\n` +
    `If you think this is a mistake, contact the fest organisers.`;

  return sendMailQuietly({
    to: emailAddress,
    subject: `Your ${role} assignment for ${festName} has been revoked`,
    ...buildBrandedEmailBodies(messageBody, { festName, logoUrl: festBannerImageUrl }),
  });
}

/*
 * Same silent-fail contract: the team and its registrations are already persisted
 * by the time this runs, so a dead SMTP host must not undo a confirmed team.
 */
async function sendTeamInvitationEmail({
  memberEmail,
  teamName,
  eventName,
  festName,
  leaderName,
  signInUrl,
  festBannerImageUrl,
}) {
  const messageBody =
    `${leaderName} added you to the team "${teamName}" for ${eventName} at ${festName}.\n\n` +
    `Sign in with this email address to see your registration: ${signInUrl}\n\n` +
    `If you were not expecting this, you can ignore this email.`;

  return sendMailQuietly({
    to: memberEmail,
    subject: `You're on team "${teamName}" for ${eventName}`,
    ...buildBrandedEmailBodies(messageBody, { festName, logoUrl: festBannerImageUrl }),
  });
}

const DEDAL_SIGN_IN_URL = "https://dedal.in";

/*
 * Cancellation notices. Same silent-fail contract as every sender above: the
 * cancellation is already committed when these run, and a dead provider must not
 * undo it - the boolean only reports whether the message left the process.
 */
async function sendEventCancelledEmail({
  emailAddress,
  fullName,
  eventName,
  festName,
  reason,
  isRefundPending,
  supportEmailAddress,
  festBannerImageUrl,
}) {
  const refundLine = isRefundPending
    ? "\n\nAny payment you made for this event is marked for refund. The organisers process refunds manually, so allow a few working days."
    : "";
  const supportLine = supportEmailAddress
    ? `\n\nQuestions about this event: ${supportEmailAddress}`
    : "";
  const reasonLine = reason ? `\n\nReason given: ${reason}` : "";

  const messageBody =
    `Hi ${fullName || "there"},\n\n` +
    `${eventName}${festName ? ` at ${festName}` : ""} has been cancelled by the organisers, ` +
    `so your registration for it has ended.${reasonLine}${refundLine}\n\n` +
    `Your pass still works for everything else you are registered for.${supportLine}\n\n` +
    `- The Dedal team`;

  return sendMailQuietly({
    to: emailAddress,
    subject: `${eventName} has been cancelled`,
    ...buildBrandedEmailBodies(messageBody, { festName, logoUrl: festBannerImageUrl }),
  });
}

/*
 * ONE email per participant for a whole cancelled fest, listing every event they
 * were in. A participant registered for five events of one fest must not receive
 * five separate notices.
 */
async function sendFestCancelledEmail({
  emailAddress,
  fullName,
  festName,
  eventNames,
  reason,
  refundPendingPaise,
  supportEmailAddress,
  festBannerImageUrl,
}) {
  const eventLines = (eventNames ?? []).map((eventName) => `  - ${eventName}`).join("\n");
  const refundLine =
    refundPendingPaise > 0
      ? `\n\nPayments totalling Rs ${(refundPendingPaise / 100).toLocaleString("en-IN")} are marked for refund. The organisers process refunds manually, so allow a few working days.`
      : "";
  const supportLine = supportEmailAddress ? `\n\nQuestions: ${supportEmailAddress}` : "";
  const reasonLine = reason ? `\n\nReason given: ${reason}` : "";

  const messageBody =
    `Hi ${fullName || "there"},\n\n` +
    `${festName} has been cancelled by the organisers. Your registrations for the ` +
    `following have ended:\n\n${eventLines}${reasonLine}${refundLine}\n\n` +
    `Nothing further is needed from you.${supportLine}\n\n` +
    `- The Dedal team`;

  return sendMailQuietly({
    to: emailAddress,
    subject: `${festName} has been cancelled`,
    ...buildBrandedEmailBodies(messageBody, { festName, logoUrl: festBannerImageUrl }),
  });
}

/*
 * College onboarding notifications. Same silent-fail contract as every sender
 * above: the application row is already persisted when these run, and a dead
 * provider must not undo a submission or a review decision. The boolean feeds
 * the response's warning field.
 */
async function sendCollegeApplicationReceivedEmail({ applicantEmail, applicantFullName, collegeName }) {
  const messageBody =
    `Hi ${applicantFullName},\n\n` +
    `We received your application to bring ${collegeName} onto Dedal.\n\n` +
    `Our team will review it and get back to you at this address. ` +
    `You do not need to do anything else right now.\n\n` +
    `— The Dedal team`;

  return sendMailQuietly({
    to: applicantEmail,
    subject: `We received your Dedal application for ${collegeName}`,
    ...buildBrandedEmailBodies(messageBody),
  });
}

async function sendCollegeApplicationApprovedEmail({ applicantEmail, applicantFullName, collegeName }) {
  const messageBody =
    `Hi ${applicantFullName},\n\n` +
    `Great news — your application for ${collegeName} has been approved.\n\n` +
    `Your college is now registered on Dedal and you are its administrator. ` +
    `Sign in with this email address to get started: ${DEDAL_SIGN_IN_URL}\n\n` +
    `— The Dedal team`;

  return sendMailQuietly({
    to: applicantEmail,
    subject: `Your Dedal application for ${collegeName} is approved`,
    ...buildBrandedEmailBodies(messageBody),
  });
}

async function sendCollegeApplicationRejectedEmail({
  applicantEmail,
  applicantFullName,
  collegeName,
  reason,
}) {
  const messageBody =
    `Hi ${applicantFullName},\n\n` +
    `We reviewed your application for ${collegeName} and cannot approve it at this time.\n\n` +
    `Reason: ${reason}\n\n` +
    `You are welcome to apply again once this is addressed: ${DEDAL_SIGN_IN_URL}\n\n` +
    `— The Dedal team`;

  return sendMailQuietly({
    to: applicantEmail,
    subject: `An update on your Dedal application for ${collegeName}`,
    ...buildBrandedEmailBodies(messageBody),
  });
}

/*
 * The participant's pass, delivered to their registered email so it survives a
 * dead phone battery, a bad venue signal, or a lost app session. The body and
 * the QR attachment are assembled in pass-email-helpers; this stays transport.
 *
 * Returns the transport's boolean — the caller (pass-service) decides what a
 * false means. It never throws: a pass whose email failed is still a valid pass.
 */
async function sendPassEmail(user, fest, pass, entitlements) {
  const { subject, html, text, attachments } = buildPassEmail({ user, fest, pass, entitlements });
  return sendMailQuietly({
    to: user.emailAddress,
    subject,
    text,
    // The fest's own poster at the top: a participant with passes to three
    // fests can tell which email is which before opening it.
    html: wrapInBrandedTemplate(html, {
      festName: fest.festName,
      logoUrl: fest.bannerImageUrl,
    }),
    attachments,
  });
}

/*
 * "Start scanning now" — one email per volunteer holding an active shift at a
 * checkpoint. Text-only and deliberately terse: it is read on a phone at a gate,
 * and the only thing that matters is which checkpoint and that it is time.
 */
async function sendCheckpointAlertEmail({
  emailAddress,
  checkpointName,
  festName,
  message,
  festBannerImageUrl,
}) {
  const messageBody =
    `${message}

` +
    `Checkpoint: ${checkpointName}
` +
    `Fest: ${festName}

` +
    `Open Dedal and go to Backstage to start scanning.

` +
    `— The Dedal team`;

  return sendMailQuietly({
    to: emailAddress,
    // No checkpoint or fest name in the subject: it is the one part most likely
    // to sit on a lock screen.
    subject: "Scanning is starting — check your Dedal backstage",
    ...buildBrandedEmailBodies(messageBody, { festName, logoUrl: festBannerImageUrl }),
  });
}

/*
 * The volunteer shift reminder. Sent twice per shift — see
 * shift-reminder-service for the timing and the idempotency stamps.
 *
 * Text-only and short on purpose: it is read on a phone, often early in the
 * morning, and the only things that matter are WHEN and WHERE. The "what to do"
 * line exists because the single most common support question from volunteers
 * is where the SCAN button is (it appears only once the shift window opens).
 */
async function sendShiftReminderEmail({
  emailAddress,
  fullName,
  festName,
  checkpointName,
  eventName,
  shiftStartsAt,
  shiftEndsAt,
  hoursUntilStart,
  festBannerImageUrl,
}) {
  const timeOptions = { hour: "numeric", minute: "2-digit", hour12: true };
  const dateOptions = { day: "numeric", month: "short" };
  const start = new Date(shiftStartsAt);
  const end = new Date(shiftEndsAt);
  const windowLabel =
    `${start.toLocaleDateString("en-IN", dateOptions)}, ` +
    `${start.toLocaleTimeString("en-IN", timeOptions)} – ${end.toLocaleTimeString("en-IN", timeOptions)}`;

  const hourWord = hoursUntilStart === 1 ? "hour" : "hours";
  const messageBody = [
    `Hi${fullName ? ` ${fullName}` : ""},`,
    "",
    `Your volunteer shift at ${festName} starts in ${hoursUntilStart} ${hourWord}.`,
    "",
    `When:       ${windowLabel}`,
    `Checkpoint: ${checkpointName}`,
    ...(eventName ? [`Event:      ${eventName}`] : []),
    `Fest:       ${festName}`,
    "",
    "What to do:",
    "Open the Dedal app → Backstage → your shift will show the SCAN button when it starts.",
    "",
    "— The Dedal team",
  ].join("\n");

  return sendMailQuietly({
    to: emailAddress,
    subject: `Reminder: your volunteer shift at ${festName} starts in ${hoursUntilStart} ${hourWord}`,
    ...buildBrandedEmailBodies(messageBody, { festName, logoUrl: festBannerImageUrl }),
  });
}

/*
 * "What you registered for" — the companion to the pass email, which carries the
 * QR. Body built in registration-email-helpers so this stays a transport.
 */
async function sendRegistrationConfirmationEmail({
  user,
  registration,
  event,
  fest,
  team,
  contactPhone,
}) {
  const { subject, text, html } = buildRegistrationEmail({
    user,
    registration,
    event,
    fest,
    team,
    contactPhone,
  });
  return sendMailQuietly({
    to: user.emailAddress,
    subject,
    text,
    html: wrapInBrandedTemplate(html, {
      festName: fest?.festName,
      logoUrl: fest?.bannerImageUrl,
    }),
  });
}

/*
 * A coordinator's message to everyone confirmed for one event. The coordinator
 * writes the subject and the body; everything around it is ours, so a
 * participant can tell at a glance that this came through Dedal rather than
 * from an address that happens to know their name.
 *
 * The message is inserted as PLAIN TEXT and escaped by renderPlainTextAsHtml —
 * a coordinator typing HTML into the box gets it shown, not rendered. This is
 * the one email whose body a semi-trusted user controls.
 */
async function sendEventParticipantNotificationEmail({
  emailAddress,
  fullName,
  subject,
  message,
  eventName,
  festName,
  festBannerImageUrl,
}) {
  const messageBody = [
    `Hi${fullName ? ` ${fullName}` : ""},`,
    "",
    message,
    "",
    `— The organisers of ${eventName}${festName ? `, ${festName}` : ""}`,
  ].join("\n");

  return sendMailQuietly({
    to: emailAddress,
    // The coordinator's subject verbatim: prefixing it would push their own
    // words out of a phone's notification preview.
    subject,
    ...buildBrandedEmailBodies(messageBody, { festName, logoUrl: festBannerImageUrl }),
  });
}

/*
 * "A place opened up." Sent the moment a waitlisted participant is promoted.
 *
 * The paid version leads with the deadline, because it IS the message: the seat
 * is held for thirty minutes and then goes to the next person. Burying that
 * under a congratulation is how someone loses a seat they were given.
 */
async function sendWaitlistPromotionEmail({
  emailAddress,
  fullName,
  eventName,
  festName,
  festBannerImageUrl,
  isPaid,
  paymentWindowMinutes,
}) {
  const messageBody = isPaid
    ? [
        `Hi${fullName ? ` ${fullName}` : ""},`,
        "",
        `A place has opened up in ${eventName}${festName ? ` at ${festName}` : ""} and it is yours.`,
        "",
        `COMPLETE PAYMENT WITHIN ${paymentWindowMinutes} MINUTES to keep it.`,
        "Open the Dedal app → My registrations → this event → pay.",
        "",
        "If payment is not completed in time the seat passes to the next person on the waitlist.",
        "",
        "— The Dedal team",
      ].join("\n")
    : [
        `Hi${fullName ? ` ${fullName}` : ""},`,
        "",
        `You're in. A place opened up in ${eventName}${festName ? ` at ${festName}` : ""} and your registration is now confirmed.`,
        "",
        "Your pass covers it — open the Dedal app to see it.",
        "",
        "— The Dedal team",
      ].join("\n");

  return sendMailQuietly({
    to: emailAddress,
    subject: isPaid
      ? `A place opened up in ${eventName} — pay within ${paymentWindowMinutes} minutes`
      : `You're in — ${eventName}`,
    ...buildBrandedEmailBodies(messageBody, { festName, logoUrl: festBannerImageUrl }),
  });
}


module.exports = {
  sendWaitlistPromotionEmail,
  sendEventParticipantNotificationEmail,
  sendCheckpointAlertEmail,
  sendShiftReminderEmail,
  sendRegistrationConfirmationEmail,
  sendPassEmail,
  sendOtpEmail,
  sendAssignmentInvitation,
  sendAssignmentRevocation,
  sendTeamInvitationEmail,
  sendEventCancelledEmail,
  sendFestCancelledEmail,
  sendCollegeApplicationReceivedEmail,
  sendCollegeApplicationApprovedEmail,
  sendCollegeApplicationRejectedEmail,
  sendMailQuietly,
  getActiveEmailDriverName,
  logActiveEmailDriver,
  EMAIL_DRIVERS,
};

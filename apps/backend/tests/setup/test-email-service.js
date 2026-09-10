import { createRequire } from "node:module";

/*
 * Stands in for services/email-service.js so no suite opens an SMTP connection.
 *
 * vi.mock cannot help here: src/ is CommonJS, and the services capture their
 * exports by destructuring a require() at load time. Vitest cannot intercept a
 * require that Node resolves itself. So the mock is seeded into Node's require
 * cache before the service graph is ever loaded, which is what
 * installEmailServiceMock does. Call it, THEN dynamic-import the service.
 *
 * Every sender resolves true to match the real service, which returns a boolean
 * rather than throwing on a dead host: a caller that branches on delivery still
 * branches the same way under the mock.
 */
const recordedEmails = [];

// Mirrors the real sender's boolean contract; tests flip it to simulate a dead
// SMTP host without the sender ever throwing. Reset to true by clearRecordedEmails.
let otpDeliveryResult = true;

export function setOtpDeliveryResult(value) {
  otpDeliveryResult = value;
}

export async function sendOtpEmail(emailAddress, otpCode) {
  recordedEmails.push({ kind: "otp", emailAddress, otpCode });
  return otpDeliveryResult;
}

export async function sendAssignmentInvitation({ emailAddress, role, festName }) {
  recordedEmails.push({ kind: "assignmentInvitation", emailAddress, role, festName });
  return true;
}

export async function sendAssignmentRevocation({ emailAddress, role, festName, reason }) {
  recordedEmails.push({ kind: "assignmentRevocation", emailAddress, role, festName, reason });
  return true;
}

export async function sendTeamInvitationEmail({ memberEmail, teamName, eventName, festName }) {
  recordedEmails.push({ kind: "teamInvitation", emailAddress: memberEmail, teamName, eventName, festName });
  return true;
}

/*
 * College-application senders. Same boolean contract; tests flip the shared
 * delivery result to simulate a dead provider without the sender throwing.
 */
export async function sendCollegeApplicationReceivedEmail({ applicantEmail, applicantFullName, collegeName }) {
  recordedEmails.push({ kind: "applicationReceived", emailAddress: applicantEmail, applicantFullName, collegeName });
  return otpDeliveryResult;
}

export async function sendCollegeApplicationApprovedEmail({ applicantEmail, applicantFullName, collegeName }) {
  recordedEmails.push({ kind: "applicationApproved", emailAddress: applicantEmail, applicantFullName, collegeName });
  return otpDeliveryResult;
}

export async function sendCollegeApplicationRejectedEmail({ applicantEmail, applicantFullName, collegeName, reason }) {
  recordedEmails.push({ kind: "applicationRejected", emailAddress: applicantEmail, applicantFullName, collegeName, reason });
  return otpDeliveryResult;
}

/*
 * The generic sender behind the contingent invite/cancellation emails. Recorded
 * with its subject so a test can assert one-invite-per-attendee semantics.
 */
export async function sendMailQuietly({ to, subject, text }) {
  recordedEmails.push({ kind: "generic", emailAddress: to, subject, text });
  return otpDeliveryResult;
}

/*
 * Cancellation notices. Recorded as "generic" with their subject and body, the
 * same shape sendMailQuietly records, so a test can assert one-email-per-person
 * and that the body names the events.
 */
export async function sendEventCancelledEmail({ emailAddress, eventName, reason, isRefundPending }) {
  recordedEmails.push({
    kind: "generic",
    emailAddress,
    subject: `${eventName} has been cancelled`,
    text: `${eventName}${reason ? ` reason: ${reason}` : ""}${isRefundPending ? " marked for refund" : ""}`,
  });
  return otpDeliveryResult;
}

export async function sendFestCancelledEmail({ emailAddress, festName, eventNames, reason }) {
  recordedEmails.push({
    kind: "generic",
    emailAddress,
    subject: `${festName} has been cancelled`,
    text: `${festName}: ${(eventNames ?? []).join(", ")}${reason ? ` reason: ${reason}` : ""}`,
  });
  return otpDeliveryResult;
}

/*
 * The pass email. Records the fields the assertions care about — who it went
 * to, which fest, the event names derived from the entitlements, and whether a
 * QR attachment rode along — rather than the whole rendered body.
 */
export async function sendPassEmail(user, fest, pass, entitlements) {
  recordedEmails.push({
    kind: "pass",
    emailAddress: user.emailAddress,
    fullName: user.fullName ?? null,
    phoneNumber: user.phoneNumber ?? null,
    collegeName: user.collegeId?.collegeName ?? user.collegeId?.commonName ?? null,
    festName: fest.festName,
    qrToken: pass.qrToken,
    eventNames: (entitlements ?? [])
      .filter((entitlement) => entitlement.entitlementType === "eventEntry")
      .map((entitlement) => entitlement.referenceId?.eventName)
      .filter(Boolean),
  });
  return passDeliveryResult;
}

// Lets a test simulate a dead provider so the release-the-claim path is covered.
let passDeliveryResult = true;
export function setPassDeliveryResult(value) {
  passDeliveryResult = value;
}

/*
 * The volunteer shift reminder. Records which window fired (12h vs 1h) so a test
 * can assert the two are distinct sends rather than one duplicated.
 */
export async function sendShiftReminderEmail({
  emailAddress,
  festName,
  checkpointName,
  eventName,
  shiftStartsAt,
  hoursUntilStart,
}) {
  recordedEmails.push({
    kind: "shiftReminder",
    emailAddress,
    festName,
    checkpointName,
    eventName: eventName ?? null,
    shiftStartsAt,
    hoursUntilStart,
  });
  return otpDeliveryResult;
}

/*
 * The "what you registered for" email — distinct from the pass email above,
 * which carries the QR. Records the calendar links and the resolved contact so
 * a test can assert they are present without re-rendering the body.
 */
export async function sendRegistrationConfirmationEmail({
  user,
  registration,
  event,
  fest,
  team,
  contactPhone,
}) {
  recordedEmails.push({
    kind: "registrationConfirmation",
    emailAddress: user.emailAddress,
    eventName: event?.eventName ?? null,
    festName: fest?.festName ?? null,
    teamName: team?.teamName ?? null,
    inviteCode: team?.inviteCode ?? null,
    totalFeePaise: registration?.totalFeePaise ?? 0,
    registrationId: String(registration?._id ?? registration?.id ?? ""),
    contactPhone: contactPhone ?? null,
  });
  return otpDeliveryResult;
}

/*
 * The coordinator's bulk message. Records one row per recipient so a test can
 * assert both who was mailed and what they were told.
 */
export async function sendEventParticipantNotificationEmail({
  emailAddress,
  fullName,
  subject,
  message,
  eventName,
  festName,
}) {
  recordedEmails.push({
    kind: "participantNotification",
    emailAddress,
    fullName: fullName ?? null,
    subject,
    message,
    eventName: eventName ?? null,
    festName: festName ?? null,
  });
  return otpDeliveryResult;
}

/* A place opened up on a waitlist. */
export async function sendWaitlistPromotionEmail({
  emailAddress,
  fullName,
  eventName,
  festName,
  isPaid,
  paymentWindowMinutes,
}) {
  recordedEmails.push({
    kind: "waitlistPromotion",
    emailAddress,
    fullName: fullName ?? null,
    eventName: eventName ?? null,
    festName: festName ?? null,
    isPaid: Boolean(isPaid),
    paymentWindowMinutes: paymentWindowMinutes ?? null,
  });
  return otpDeliveryResult;
}

export function getRecordedEmails() {
  return [...recordedEmails];
}

export function findRecordedEmailsOfKind(kind) {
  return recordedEmails.filter((email) => email.kind === kind);
}

export function clearRecordedEmails() {
  passDeliveryResult = true;
  recordedEmails.length = 0;
  otpDeliveryResult = true;
}

/* Returns the most recent code sent to an address, which is what a client would read. */
export function findLatestOtpCodeFor(emailAddress) {
  const matching = recordedEmails.filter(
    (email) => email.kind === "otp" && email.emailAddress === emailAddress
  );
  return matching.length === 0 ? null : matching[matching.length - 1].otpCode;
}

export function installEmailServiceMock() {
  const nodeRequire = createRequire(import.meta.url);
  const modulePath = nodeRequire.resolve("../../src/services/email-service.js");

  nodeRequire.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: {
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
      sendPassEmail,
      sendShiftReminderEmail,
      sendRegistrationConfirmationEmail,
      sendEventParticipantNotificationEmail,
      sendWaitlistPromotionEmail,
    },
  };
}

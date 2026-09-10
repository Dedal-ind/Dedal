// push-certificate-service.js
// Handles the coordinator's "Push Certificates" action:
// 1. Saves the uploaded template image to storage
// 2. Generates individual PDFs (name printed on template) for each recipient
// 3. Creates CertificateModel records (visible in user profile/certificates tab)
// 4. Emails each person their PDF as an attachment

const { renderCertificatePdf } = require("../helpers/certificate-pdf");
const { insertCertificate } = require("../helpers/certificate-insert-helpers");
const { CertificateModel } = require("../models/certificate-model");
const { UserModel } = require("../models/user-model");
const { CollegeModel } = require("../models/college-model");
const { EventModel } = require("../models/event-model");
const { FestModel } = require("../models/fest-model");
const { TeamModel } = require("../models/team-model");
const { RegistrationModel } = require("../models/registration-model");
const { getStorageDriver } = require("./upload-storage-service");
const { sendMailQuietly } = require("./email-service");
const { applicationConfig } = require("../config/application-config");
const { CERTIFICATE_TYPES, CERTIFICATE_STATUSES } = require("../constants/certificate-constants");
const { formatFestDates } = require("../helpers/certificate-candidate-helpers");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const mongoose = require("mongoose");

// Expand a userId to all team member userIds if this event has a team registration.
// For solo events returns [userId]. For team events returns all memberUserIds.
async function expandToTeamMembers(userId, eventId) {
  const registration = await RegistrationModel.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    eventId: new mongoose.Types.ObjectId(eventId),
  }).lean();

  if (!registration?.teamId) return [String(userId)];

  const team = await TeamModel.findById(registration.teamId).lean();
  if (!team?.memberUserIds?.length) return [String(userId)];

  return team.memberUserIds.map((id) => String(id));
}

const PLACE_TO_CERT_TYPE = {
  "1st": CERTIFICATE_TYPES.WINNER_1ST,
  "2nd": CERTIFICATE_TYPES.WINNER_2ND,
  "3rd": CERTIFICATE_TYPES.WINNER_3RD,
  "4th": CERTIFICATE_TYPES.WINNER_3RD, // fallback to winner
  "5th": CERTIFICATE_TYPES.WINNER_3RD,
  "6th": CERTIFICATE_TYPES.WINNER_3RD,
  "7th": CERTIFICATE_TYPES.WINNER_3RD,
  "8th": CERTIFICATE_TYPES.WINNER_3RD,
  "9th": CERTIFICATE_TYPES.WINNER_3RD,
  "10th": CERTIFICATE_TYPES.WINNER_3RD,
};

const PLACE_LABEL = {
  "1st": "1st Place",
  "2nd": "2nd Place",
  "3rd": "3rd Place",
  "4th": "4th Place",
  "5th": "5th Place",
  "6th": "6th Place",
  "7th": "7th Place",
  "8th": "8th Place",
  "9th": "9th Place",
  "10th": "10th Place",
};

function buildWinnerEmailHtml({ fullName, eventName, festName, collegeName, place, verificationCode, verifyUrl }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1B2E1B;">
      <h2 style="color: #556B2F;">Congratulations, ${fullName}! 🎉</h2>
      <p>Congratulations! 🎉 You have successfully won <strong>${eventName}</strong> at <strong>${festName}</strong>, <strong>${collegeName}</strong>. Your achievement is truly commendable, and we are proud to have you as one of the winners. We wish you continued success and hope to see you participate and achieve more in our future events.</p>
      <p>Your certificate of achievement is attached to this email as a PDF.</p>
      <a href="${verifyUrl}" style="background:#556B2F;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin:12px 0;">Verify Certificate</a>
      <p style="color:#666;font-size:13px;">Verification code: <strong>${verificationCode}</strong></p>
    </div>
  `;
}

function buildParticipationEmailHtml({ fullName, eventName, festName, collegeName, verificationCode, verifyUrl }) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1B2E1B;">
      <h2 style="color: #556B2F;">Certificate of Participation</h2>
      <p>Dear <strong>${fullName}</strong>,</p>
      <p>Thank you for participating in <strong>${eventName}</strong> at <strong>${festName}</strong>, <strong>${collegeName}</strong>. We truly appreciate your enthusiasm and participation. We wish you all the best for your future endeavours and look forward to welcoming you again next year to participate in the same event and make it even more memorable.</p>
      <p>Your certificate of participation is attached to this email as a PDF.</p>
      <a href="${verifyUrl}" style="background:#556B2F;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;margin:12px 0;">Verify Certificate</a>
      <p style="color:#666;font-size:13px;">Verification code: <strong>${verificationCode}</strong></p>
    </div>
  `;
}

async function loadUserWithCollege(userId) {
  const user = await UserModel.findById(userId).select("+phoneNumber").lean();
  if (!user) return null;
  const college = user.collegeId
    ? await CollegeModel.findById(user.collegeId).select("commonName collegeName").lean()
    : null;
  return {
    user,
    collegeName: college?.commonName ?? college?.collegeName ?? "",
  };
}

// Upload template buffer to storage and return the URL
async function uploadTemplateToStorage(templateBuffer, mimeType) {
  const driver = getStorageDriver();
  const { url } = await driver.upload(templateBuffer, mimeType, { folder: "certificate-templates" });
  return url;
}

// Save generated PDF to storage and return URL
async function savePdfToStorage(pdfBuffer, verificationCode) {
  const driver = getStorageDriver();
  const { url } = await driver.upload(pdfBuffer, "application/pdf", {
    folder: "certificates",
    key: `${verificationCode}.pdf`,
  });
  return url;
}

/**
 * Main entry point — called by the push-certificates controller.
 *
 * @param {object} params
 * @param {string} params.eventId
 * @param {Buffer}  params.templateBuffer  — raw uploaded template file
 * @param {string}  params.templateMimeType
 * @param {Array}   params.winners         — [{ userId, place }]
 * @param {Array}   params.participants    — [userId, ...] (participation certificates)
 */
async function pushCertificates({ eventId, templateBuffer, templateMimeType, winners = [], participants = [] }) {
  // Load event + fest
  const event = await EventModel.findById(eventId).lean();
  if (!event) throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.");
  const fest = await FestModel.findById(event.festId).lean();
  if (!fest) throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");

  const festDates = formatFestDates(fest.startsOn, fest.endsOn);

  // Upload template to storage once — reused for all certificates
  const templateUrl = await uploadTemplateToStorage(templateBuffer, templateMimeType);
  const templateObj = { documentTemplateUrl: templateUrl };

  const results = { pushed: 0, skipped: 0, failed: 0 };
  /* Collected so the feed can be written once at the end rather than a row at
   * a time inside the PDF loop, which would be one insert per person. */
  const notifiedUserIds = [];

  // ── Process winners ────────────────────────────────────────────────────────
  for (const { userId, place } of winners) {
    try {
      // Expand to all team members — for solo events returns [userId]
      const memberIds = await expandToTeamMembers(userId, eventId);

      for (const memberId of memberIds) {
        try {
          const { user, collegeName } = await loadUserWithCollege(memberId) ?? {};
          if (!user) { results.failed += 1; continue; }

          const certificateType = PLACE_TO_CERT_TYPE[place] ?? CERTIFICATE_TYPES.WINNER_3RD;
          const metadata = {
            fullName: user.fullName ?? "",
            collegeName,
            usn: user.usn ?? null,
            eventName: event.eventName,
            festName: fest.festName,
            festDates,
            place: PLACE_LABEL[place] ?? place,
          };

          const certificate = await insertCertificate({
            userId: user._id,
            festId: fest._id,
            eventId: event._id,
            certificateType,
            status: CERTIFICATE_STATUSES.RELEASED,
            releasedAt: new Date(),
            generatedAt: new Date(),
            metadata,
          });

          if (!certificate) { results.skipped += 1; continue; }

          const verifyUrl = `${applicationConfig.frontendBaseUrl}/verify/${certificate.verificationCode}`;

          const pdfBuffer = await renderCertificatePdf({
            certificateType,
            metadata,
            verificationCode: certificate.verificationCode,
            verifyUrl,
            template: templateObj,
          });

          const pdfUrl = await savePdfToStorage(pdfBuffer, certificate.verificationCode);
          await CertificateModel.findByIdAndUpdate(certificate._id, { pdfUrl });

          if (user.emailAddress) {
            await sendMailQuietly({
              to: user.emailAddress,
              subject: `🏆 Congratulations! You won ${event.eventName} at ${fest.festName}`,
              text: `Congratulations ${user.fullName}! You have successfully won ${event.eventName} at ${fest.festName}, ${collegeName}. Your certificate is attached.`,
              html: buildWinnerEmailHtml({
                fullName: user.fullName ?? "",
                eventName: event.eventName,
                festName: fest.festName,
                collegeName,
                place: PLACE_LABEL[place] ?? place,
                verificationCode: certificate.verificationCode,
                verifyUrl,
              }),
              attachments: [{ content: pdfBuffer.toString("base64"), filename: `certificate-${certificate.verificationCode}.pdf`, type: "application/pdf", disposition: "attachment" }],
            });
          }

          results.pushed += 1;
          notifiedUserIds.push(String(userId));
        } catch {
          results.failed += 1;
        }
      }
    } catch {
      results.failed += 1;
    }
  }

  // ── Process participation ───────────────────────────────────────────────────
  for (const userId of participants) {
    try {
      // Expand to all team members for team events
      const memberIds = await expandToTeamMembers(userId, eventId);

      for (const memberId of memberIds) {
        try {
          const { user, collegeName } = await loadUserWithCollege(memberId) ?? {};
          if (!user) { results.failed += 1; continue; }

          const metadata = {
            fullName: user.fullName ?? "",
            collegeName,
            usn: user.usn ?? null,
            eventName: event.eventName,
            festName: fest.festName,
            festDates,
          };

          const certificate = await insertCertificate({
            userId: user._id,
            festId: fest._id,
            eventId: event._id,
            certificateType: CERTIFICATE_TYPES.PARTICIPATION,
            status: CERTIFICATE_STATUSES.RELEASED,
            releasedAt: new Date(),
            generatedAt: new Date(),
            metadata,
          });

          if (!certificate) { results.skipped += 1; continue; }

          const verifyUrl = `${applicationConfig.frontendBaseUrl}/verify/${certificate.verificationCode}`;

          const pdfBuffer = await renderCertificatePdf({
            certificateType: CERTIFICATE_TYPES.PARTICIPATION,
            metadata,
            verificationCode: certificate.verificationCode,
            verifyUrl,
            template: templateObj,
          });

          const pdfUrl = await savePdfToStorage(pdfBuffer, certificate.verificationCode);
          await CertificateModel.findByIdAndUpdate(certificate._id, { pdfUrl });

          if (user.emailAddress) {
            await sendMailQuietly({
              to: user.emailAddress,
              subject: `🎓 Thank you for participating in ${event.eventName} at ${fest.festName}`,
              text: `Thank you for participating in ${event.eventName} at ${fest.festName}, ${collegeName}. Your certificate is attached.`,
              html: buildParticipationEmailHtml({
                fullName: user.fullName ?? "",
                eventName: event.eventName,
                festName: fest.festName,
                collegeName,
                verificationCode: certificate.verificationCode,
                verifyUrl,
              }),
              attachments: [{ content: pdfBuffer.toString("base64"), filename: `certificate-${certificate.verificationCode}.pdf`, type: "application/pdf", disposition: "attachment" }],
            });
          }

          results.pushed += 1;
          notifiedUserIds.push(String(userId));
        } catch {
          results.failed += 1;
        }
      }
    } catch {
      results.failed += 1;
    }
  }

  /*
   * One feed row per person who actually got a certificate. Written after the
   * loop so a notification failure cannot interrupt PDF generation, and so the
   * fan-out is a single insert regardless of how many certificates went out.
   */
  if (notifiedUserIds.length > 0) {
    const { notifyUsers, NOTIFICATION_TYPES } = require("./notification-service");
    await notifyUsers({
      userIds: notifiedUserIds,
      notificationType: NOTIFICATION_TYPES.CERTIFICATE_READY,
      title: "Your certificate is ready",
      body: `${event?.eventName ?? "Your event"} — open My Certificates to view or download it.`,
      linkPath: "/my-certificates",
      festId: event?.festId ?? null,
      eventId: event?._id ?? null,
    });
  }

  return results;
}

module.exports = { pushCertificates };

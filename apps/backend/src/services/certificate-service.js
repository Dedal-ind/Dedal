const fs = require("fs/promises");
const path = require("path");
const mongoose = require("mongoose");

const { CertificateModel } = require("../models/certificate-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { assertAdministratorOfFest, findFestOrThrow } = require("../helpers/assert-administrator-of-fest");
const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { assignmentCoversEvent } = require("../helpers/assignment-coverage-helpers");
const { renderCertificatePdf } = require("../helpers/certificate-pdf");
const { recordAuditLog } = require("./audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { CERTIFICATE_STATUSES } = require("../constants/certificate-constants");
const { applicationConfig } = require("../config/application-config");
const { formatFestDates } = require("../helpers/certificate-candidate-helpers");
const { buildCertificateCandidatesForFest } = require("../helpers/certificate-loading-helpers");
const { insertCertificate } = require("../helpers/certificate-insert-helpers");
const { notifyCertificateRelease } = require("../helpers/certificate-release-notify");

const GENERATED_CERTIFICATES_DIRECTORY = path.join(process.cwd(), "generated-certificates");

/*
 * Turns the caller's authority + requested eventIds into the event scope the
 * generate/release actions act over.
 *
 *   · null scope (legacy direct call) or an administrator with no eventIds →
 *     { scopeEventIds: null, isFestWide: true } — today's fest-wide behaviour.
 *   · An administrator naming eventIds → those events plus their descendants.
 *   · A coordinator → every named event must be covered by their assignment
 *     (hierarchy-aware via assignmentCoversEvent — the fourth copy of that logic
 *     is deliberately not written) or the call is PERMISSION_DENIED. With no
 *     eventIds they default to exactly their covered events, materialised to an
 *     explicit id list — NEVER isFestWide, so a fest-wide coordinator still gets
 *     no staff certificates and no fest release stamp.
 */
async function resolveCertificateScope(fest, scope) {
  if (!scope || (scope.isAdministrator && !(scope.requestedEventIds?.length > 0))) {
    return { scopeEventIds: null, isFestWide: true };
  }

  const requestedEventIds = scope.requestedEventIds ?? [];
  if (!scope.isAdministrator && requestedEventIds.length > 0) {
    for (const requestedEventId of requestedEventIds) {
      if (!(await assignmentCoversEvent(scope.staffAssignment, requestedEventId))) {
        throw new ApplicationError(
          403,
          ERROR_CODES.PERMISSION_DENIED,
          "Your assignment does not cover one of the named events."
        );
      }
    }
  }

  // Materialise the scope over the fest's events: requested ids act as a pseudo
  // assignment so a named vertical covers its sub-events, exactly as coverage does.
  const coverageSource =
    requestedEventIds.length > 0 ? { eventIds: requestedEventIds } : scope.staffAssignment;
  const festEvents = await EventModel.find({ festId: fest._id }).select("_id").lean();
  const scopeEventIds = [];
  for (const event of festEvents) {
    if (await assignmentCoversEvent(coverageSource, event._id)) {
      scopeEventIds.push(event._id);
    }
  }
  return { scopeEventIds, isFestWide: false };
}

/*
 * Generates the certificates owed inside the resolved scope. Idempotent: a second
 * run skips anyone who already has their certificate. `scope` is null on the
 * legacy admin path (fest-wide, staff included); an event-scoped run generates
 * participant/winner certificates for those events only — staff certificates are
 * fest-level and belong to the fest-wide run alone.
 */
async function generateCertificatesForFest(actorUserId, festId, context = {}, scope = null, userIds = null) {
  const fest = scope
    ? await findFestOrThrow(festId)
    : (await assertAdministratorOfFest(actorUserId, festId)).fest;
  const { scopeEventIds, isFestWide } = await resolveCertificateScope(fest, scope);
  const festDates = formatFestDates(fest.startsOn, fest.endsOn);
  let candidates = await buildCertificateCandidatesForFest(
    fest,
    festDates,
    isFestWide ? null : scopeEventIds
  );
  /*
   * The admin push's participant checklist: a non-empty userIds narrows the
   * candidates to EXACTLY those people, applied after the event scope so a
   * selection can never widen what the caller's authority already covers.
   */
  if (Array.isArray(userIds) && userIds.length > 0) {
    const selectedUserIds = new Set(userIds.map(String));
    candidates = candidates.filter((candidate) => selectedUserIds.has(String(candidate.userId)));
  }
  let generatedCount = 0;
  let skippedCount = 0;
  for (const candidate of candidates) {
    if (await insertCertificate(candidate)) generatedCount += 1;
    else skippedCount += 1;
  }
  await recordAuditLog({
    actorUserId, festId: fest._id,
    action: AUDIT_ACTIONS.CERTIFICATES_GENERATED, entityType: AUDIT_ENTITY_TYPES.CERTIFICATE,
    entityId: fest._id,
    afterState: isFestWide
      ? { generatedCount, skippedCount }
      : { generatedCount, skippedCount, scopedEventCount: scopeEventIds.length },
    ...context,
  });
  return { generatedCount, skippedCount };
}

/*
 * The closing-ceremony action. Fest-wide (admin, no eventIds): flips every
 * pending certificate and stamps the fest, once. Event-scoped (coordinator, or
 * admin naming events): flips only the scoped events' rows and deliberately does
 * NOT stamp certificatesReleasedAt — the stamp is the fest-wide once-guard, and
 * a coordinator's partial release must not block the admin's closing release.
 * Staff certificates carry no eventId, so a scoped release never touches them.
 */
async function releaseCertificatesForFest(actorUserId, festId, context = {}, scope = null, userIds = null) {
  const fest = scope
    ? await findFestOrThrow(festId)
    : (await assertAdministratorOfFest(actorUserId, festId)).fest;
  const { scopeEventIds, isFestWide } = await resolveCertificateScope(fest, scope);
  /*
   * The once-guard protects against a SECOND closing release, nothing more. It
   * used to sit before scope resolution and reject every call once the stamp
   * existed — which meant that after the fest's closing release, a winner push
   * or a late participant's release 409'd forever: the admin pressed Push, got
   * "already released", and the participant never received anything. Scoped and
   * subset releases only flip pending rows, so re-running them is harmless.
   */
  const isSubsetRequest = Array.isArray(userIds) && userIds.length > 0;
  if (fest.certificatesReleasedAt && isFestWide && !isSubsetRequest) {
    throw new ApplicationError(
      409, ERROR_CODES.CERTIFICATES_ALREADY_RELEASED,
      "This fest's certificates have already been released."
    );
  }
  const now = new Date();
  const releaseFilter = { festId: fest._id, status: CERTIFICATE_STATUSES.GENERATED_PENDING_RELEASE };
  if (!isFestWide) {
    releaseFilter.eventId = { $in: scopeEventIds };
  }
  /*
   * The participant checklist again: release EXACTLY the people passed in, and
   * only within the already-resolved scope. A subset release does NOT stamp
   * certificatesReleasedAt below (that stamp is the fest-wide once-guard).
   */
  if (isSubsetRequest) {
    releaseFilter.userId = { $in: userIds };
  }
  /*
   * Who is about to be released is read BEFORE the update — afterwards the
   * status filter matches nothing. Needed so the release notice (email + in-app,
   * see notifyCertificateRelease) reaches exactly the people whose certificates
   * just went live.
   */
  /* certificateType rides along because the release notice picks its wording
     from it (winner vs participant vs crew); without it every recipient would
     silently fall back to the participation message. */
  const releasedRows = await CertificateModel.find(releaseFilter)
    .select("userId certificateType metadata")
    .lean();

  const result = await CertificateModel.updateMany(releaseFilter, {
    $set: { status: CERTIFICATE_STATUSES.RELEASED, releasedAt: now },
  });

  // Fire-and-forget: never blocks or fails the release (see the helper).
  notifyCertificateRelease(releasedRows, { festId: fest._id });
  if (isFestWide && !isSubsetRequest) {
    fest.certificatesReleasedAt = now;
    await fest.save();
  }
  await recordAuditLog({
    actorUserId, festId: fest._id,
    action: AUDIT_ACTIONS.CERTIFICATES_RELEASED, entityType: AUDIT_ENTITY_TYPES.CERTIFICATE,
    entityId: fest._id,
    afterState: isFestWide
      ? { releasedCount: result.modifiedCount, releasedAt: now }
      : { releasedCount: result.modifiedCount, releasedAt: now, scopedEventCount: scopeEventIds.length },
    ...context,
  });
  return { releasedCount: result.modifiedCount };
}

/*
 * The organiser's alignment check: a sample certificate rendered through the
 * EXACT same code path a real one uses (same renderer, same template), with
 * placeholder holder data. Without it, misalignment is discovered only after
 * release. Administrator-only, like the template it previews.
 */
async function previewCertificatePdf(adminUserId, festId) {
  const { fest } = await assertAdministratorOfFest(adminUserId, festId);
  const festDates = formatFestDates(fest.startsOn, fest.endsOn);
  const sampleCode = "SAMPLE00";
  return renderCertificatePdf({
    certificateType: "participation",
    metadata: {
      fullName: "Sample Participant",
      collegeName: "Sample College of Engineering",
      usn: "1XX00XX000",
      eventName: "Sample Event",
      festName: fest.festName,
      festDates,
      position: null,
      role: null,
    },
    verificationCode: sampleCode,
    verifyUrl: `${applicationConfig.frontendBaseUrl}/verify/${sampleCode}`,
    template: fest.certificateTemplate ?? null,
  });
}

async function listMyCertificates(userId) {
  const certificates = await CertificateModel.find({ userId, status: CERTIFICATE_STATUSES.RELEASED })
    .sort({ generatedAt: -1 })
    .populate({ path: "festId", select: "festName startsOn endsOn" })
    .populate({ path: "eventId", select: "eventName category" });
  return certificates.map((certificate) => certificate.toJSON());
}

// The public verification lookup. An unreleased or missing certificate both read as
// not-found, so it cannot reveal an unreleased certificate exists. Only the snapshot
// a recruiter needs is returned — no ids.
async function getCertificateByVerificationCode(verificationCode) {
  const code = typeof verificationCode === "string" ? verificationCode.trim().toUpperCase() : "";
  const certificate = await CertificateModel.findOne({ verificationCode: code }).lean();
  if (!certificate || certificate.status !== CERTIFICATE_STATUSES.RELEASED) {
    throw new ApplicationError(404, ERROR_CODES.CERTIFICATE_NOT_FOUND, "Certificate not found.");
  }
  const { metadata } = certificate;
  return {
    fullName: metadata.fullName, collegeName: metadata.collegeName, usn: metadata.usn,
    eventName: metadata.eventName, festName: metadata.festName, festDates: metadata.festDates,
    position: metadata.position, role: metadata.role,
    certificateType: certificate.certificateType,
    verificationCode: certificate.verificationCode, isValid: true,
  };
}

async function loadOwnedCertificateOrThrow(certificateId, userId) {
  const certificate = mongoose.Types.ObjectId.isValid(certificateId)
    ? await CertificateModel.findById(certificateId)
    : null;
  if (
    !certificate ||
    String(certificate.userId) !== String(userId) ||
    certificate.status !== CERTIFICATE_STATUSES.RELEASED
  ) {
    throw new ApplicationError(404, ERROR_CODES.CERTIFICATE_NOT_FOUND, "Certificate not found.");
  }
  return certificate;
}

// Renders the owner's certificate PDF, caching it to a local file the first time.
// Real cloud storage is deferred; pdfUrl holds the relative path, streamed by the endpoint.
async function generateCertificatePdf(certificateId, userId) {
  const certificate = await loadOwnedCertificateOrThrow(certificateId, userId);
  const fileName = `${certificate.verificationCode}.pdf`;
  const absolutePath = path.join(GENERATED_CERTIFICATES_DIRECTORY, fileName);
  if (certificate.pdfUrl) {
    try {
      await fs.access(absolutePath);
      return { buffer: await fs.readFile(absolutePath), fileName };
    } catch {
      // Cached file is gone; fall through and regenerate it.
    }
  }
  const verifyUrl = `${applicationConfig.frontendBaseUrl}/verify/${certificate.verificationCode}`;
  // The fest's template rides along. A template edited AFTER a certificate was
  // cached does not regenerate the cached file — the preview endpoint exists so
  // alignment is settled before release, not after.
  const templateFest = await FestModel.findById(certificate.festId)
    .select("certificateTemplate")
    .lean();
  // Event-level template wins over the fest-wide one: a coordinator's uploaded
  // artwork for THIS event is more specific than the fest's default.
  const templateEvent = certificate.eventId
    ? await EventModel.findById(certificate.eventId).select("certificateTemplateUrl").lean()
    : null;
  const template = templateEvent?.certificateTemplateUrl
    ? { documentTemplateUrl: templateEvent.certificateTemplateUrl }
    : (templateFest?.certificateTemplate ?? null);
  const buffer = await renderCertificatePdf({
    certificateType: certificate.certificateType, metadata: certificate.metadata,
    verificationCode: certificate.verificationCode, verifyUrl,
    template,
  });
  await fs.mkdir(GENERATED_CERTIFICATES_DIRECTORY, { recursive: true });
  await fs.writeFile(absolutePath, buffer);
  certificate.pdfUrl = path.join("generated-certificates", fileName);
  await certificate.save();
  return { buffer, fileName };
}

module.exports = {
  generateCertificatesForFest, releaseCertificatesForFest, listMyCertificates,
  getCertificateByVerificationCode, generateCertificatePdf, previewCertificatePdf,
};

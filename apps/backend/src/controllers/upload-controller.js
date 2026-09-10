const multer = require("multer");

const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { getStorageDriver } = require("../services/upload-storage-service");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB — a banner, not a raw camera dump.

// Parses one `file` field into memory so the storage service owns where it lands.
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
}).single("file");

/*
 * Uploads exist to feed the admin forms, so only active staff who own one of
 * those forms may create a file — a signed-in participant cannot fill storage.
 *
 * PLATFORM_ADMIN IS INCLUDED DELIBERATELY. The platform owner's assignment
 * carries no college and no fest (see platform-admin-helpers): it is not "of"
 * anything, it is over everything. Matching on ADMINISTRATOR alone therefore
 * refused the one account that passes every other admin gate in the system —
 * which is how the Promotions screen, a platform-admin-only surface, answered
 * "Only administrators can upload images" to the platform owner.
 *
 * No fest scope is checked here on purpose: this endpoint stores bytes and
 * returns a URL, it does not attach the file to anything. The screen that
 * consumes the URL (fest banner, event poster, promotion image, certificate
 * artwork) is the one that carries the fest-scoped permission check.
 */
const UPLOADER_ROLES = [STAFF_ROLES.ADMINISTRATOR, STAFF_ROLES.PLATFORM_ADMIN];

async function assertUploader(userId) {
  const assignment = await StaffAssignmentModel.findOne({
    userId,
    role: { $in: UPLOADER_ROLES },
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).lean();
  if (!assignment) {
    throw new ApplicationError(
      403,
      ERROR_CODES.PERMISSION_DENIED,
      "Only administrators can upload images."
    );
  }
}

async function postUploadImage(request, response) {
  await assertUploader(request.authenticatedUser.userId);
  if (!request.file) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "No file was uploaded.", { file: "is required" });
  }
  // Unchanged response shape ({ data: { url } }) — the active driver (local or S3)
  // decides where the bytes land and what URL points at them.
  const { url } = await getStorageDriver().upload(
    request.file.buffer,
    request.file.mimetype,
    request.file.originalname
  );
  return response.status(201).json({ data: { url } });
}

/*
 * Participant-accessible upload for the profile's student ID card. Any signed-in
 * user may upload THEIR OWN ID image — the admin gate above exists to stop
 * storage abuse via the generic endpoint, so this one is image-only and shares
 * the same 5MB multer cap.
 */
const STUDENT_ID_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

async function postUploadStudentId(request, response) {
  if (!request.file) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "No file was uploaded.", { file: "is required" });
  }
  if (!STUDENT_ID_MIME_TYPES.has(request.file.mimetype)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Only JPEG or PNG images are accepted.", {
      file: "must be image/jpeg or image/png",
    });
  }
  const { url } = await getStorageDriver().upload(
    request.file.buffer,
    request.file.mimetype,
    request.file.originalname
  );
  return response.status(201).json({ data: { url } });
}

/*
 * COLLEGE APPLICATION DOCUMENTS — the one UNAUTHENTICATED upload in the system.
 *
 * It has to be. A college registering has no account yet (that is the point of
 * the application), so there is no identity to gate on, and every authenticated
 * alternative would mean asking for the proof documents only after the account
 * exists — which is after the reviewer has already had to decide without them.
 *
 * What limits abuse instead, since identity cannot:
 *   . the route carries publicRateLimiterMiddleware, per IP;
 *   . the MIME allowlist below is narrower than the generic endpoint's — PDF and
 *     two image types, nothing executable, nothing archived;
 *   . multer's existing 5MB cap applies unchanged.
 *
 * A stored URL is not a submitted application: the bytes are only referenced if
 * the applicant goes on to submit, and an unreferenced upload is orphaned rather
 * than attached to anything.
 */
const APPLICATION_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

async function postUploadApplicationDocument(request, response) {
  if (!request.file) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "No file was uploaded.", {
      file: "is required",
    });
  }
  if (!APPLICATION_DOCUMENT_MIME_TYPES.has(request.file.mimetype)) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "Only PDF, JPEG or PNG files are accepted.",
      { file: "must be application/pdf, image/jpeg or image/png" }
    );
  }
  const { url } = await getStorageDriver().upload(
    request.file.buffer,
    request.file.mimetype,
    request.file.originalname
  );
  return response.status(201).json({ data: { url } });
}

module.exports = {
  postUploadImage,
  postUploadStudentId,
  postUploadApplicationDocument,
  uploadMiddleware,
};

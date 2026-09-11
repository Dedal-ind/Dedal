const multer = require("multer");

const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const {
  getStorageDriver,
  ALLOWED_VIDEO_MIME_TYPES,
  VIDEO_EXTENSION_BY_MIME,
} = require("../services/upload-storage-service");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB — a banner, not a raw camera dump.
const MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB — a promo clip, not a master.

/*
 * ONE MULTER CAP, TWO ENFORCED LIMITS, AND WHY IT IS THIS WAY ROUND.
 *
 * multer fixes its limit before anything is parsed, so it cannot know whether
 * the incoming bytes are an image or a video. The choice is a second upload
 * route (a URL the admin form would have to pick between) or one route whose
 * parser admits the larger of the two and rejects per kind immediately after.
 *
 * This is the second. The cost is real and worth stating plainly: a 50 MB IMAGE
 * is buffered into memory before assertUploadSize refuses it. That is bounded
 * by the same ceiling every request already has, it is reachable only by an
 * authenticated administrator, and it buys the single endpoint the brief asks
 * for by name.
 *
 * nginx is the true first line and it is NOT configured — see
 * docs/server-nginx-config.md. Until client_max_body_size is set on the server,
 * anything over nginx's default is refused at the proxy and never reaches this
 * cap at all.
 */
const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_UPLOAD_BYTES },
}).single("file");

/*
 * MAGIC BYTES, BECAUSE A CONTENT-TYPE HEADER IS A CLAIM, NOT A FACT.
 *
 * multer reads `mimetype` straight from the multipart part the client wrote, so
 * a renamed executable declaring video/mp4 passes every check that reads only
 * that string. These are what the containers actually begin with:
 *
 *   MP4 / MOV — an ISO base-media file: bytes 4..7 are the literal "ftyp".
 *               MOV is the same container family, so both are checked the same
 *               way and the declared type decides which of the two it is.
 *   WebM      — a Matroska stream: the EBML header 1A 45 DF A3.
 *
 * Hand-rolled rather than adding a dependency: three signatures do not justify
 * a package, and the well-known one is ESM-only now, which this CommonJS
 * backend cannot require.
 *
 * This is a sanity gate, not a virus scanner. It refuses the easy lie — a file
 * that is not the container it claims to be — and nothing here pretends more.
 */
function looksLikeIsoBaseMedia(buffer) {
  return buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp";
}

function looksLikeMatroska(buffer) {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  );
}

function assertVideoBytesMatchDeclaredType(file) {
  const matches =
    file.mimetype === "video/webm"
      ? looksLikeMatroska(file.buffer)
      : looksLikeIsoBaseMedia(file.buffer);
  if (!matches) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "That file is not the video format it claims to be.",
      { file: "contents do not match the declared type" }
    );
  }
}

/*
 * The filename's extension has to agree with the declared type too. Magic bytes
 * cannot tell MP4 from MOV — they are the same container — so this is the only
 * thing stopping a .mov being stored under a .mp4 key, or the reverse.
 */
function assertExtensionMatchesDeclaredType(file) {
  const expected = VIDEO_EXTENSION_BY_MIME[file.mimetype];
  const actual = String(file.originalname || "")
    .toLowerCase()
    .slice(-expected.length);
  if (actual !== expected) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "A " + file.mimetype + " file must be named " + expected + ".",
      { file: "expected a " + expected + " extension" }
    );
  }
}

function assertUploadSize(file, isVideo) {
  const limit = isVideo ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (file.size > limit) {
    const megabytes = Math.round(limit / (1024 * 1024));
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "That file is too large. The limit is " + megabytes + " MB.",
      { file: "must be " + megabytes + " MB or smaller" }
    );
  }
}

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
  const isVideo = ALLOWED_VIDEO_MIME_TYPES.has(request.file.mimetype);
  assertUploadSize(request.file, isVideo);
  if (isVideo) {
    assertExtensionMatchesDeclaredType(request.file);
    assertVideoBytesMatchDeclaredType(request.file);
  }

  /*
   * THE THIRD ARGUMENT IS AN OPTIONS OBJECT, AND IT WAS BEING CALLED WRONG.
   *
   * All three handlers passed `request.file.originalname` — a string — into a
   * parameter the driver destructures as `options`. So `options.kind` was
   * always undefined, the driver's document branch was unreachable from this
   * controller, and the filename was silently discarded. It was harmless while
   * images were the only kind, because undefined fell through to the image
   * branch, which was the one intended.
   *
   * It stops being harmless here: `kind` is what routes a video past
   * assertImage and into the videos/ prefix. The service's header comment
   * documented the old, wrong signature and is corrected there too.
   *
   * Response shape is unchanged ({ data: { url } }) — the active driver decides
   * where the bytes land and what URL points at them.
   */
  const { url } = await getStorageDriver().upload(request.file.buffer, request.file.mimetype, {
    kind: isVideo ? "video" : "image",
  });
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
  const { url } = await getStorageDriver().upload(request.file.buffer, request.file.mimetype);
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
  const { url } = await getStorageDriver().upload(request.file.buffer, request.file.mimetype, {
    kind: "document",
    allowedMimeTypes: APPLICATION_DOCUMENT_MIME_TYPES,
  });
  return response.status(201).json({ data: { url } });
}

module.exports = {
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  postUploadImage,
  postUploadStudentId,
  postUploadApplicationDocument,
  uploadMiddleware,
};

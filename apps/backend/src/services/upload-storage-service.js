/*
 * The file-upload storage abstraction. One interface, two interchangeable drivers
 * chosen at call time from the environment:
 *
 *   local (DEFAULT) — writes to the uploads/ folder and returns an absolute URL
 *                     this server serves back over HTTP (see the /uploads static
 *                     mount in application.js). This is what development uses.
 *   s3    (opt-in)  — pushes the bytes to an S3 bucket and returns its public https
 *                     URL. Activated ONLY when the three S3 credentials are set, so
 *                     there is zero behaviour change until you opt in.
 *
 * Detection is by presence of the S3 env vars, read at call time (not cached at
 * boot) so tests can toggle them per case:
 *   S3_BUCKET_NAME && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY  → s3, else local.
 *
 * Driver interface:
 *   upload(fileBuffer, mimeType, options) → { url, key }
 *     options.kind             "image" (default) | "video" | "document"
 *     options.allowedMimeTypes narrows the document whitelist for a caller
 *
 *   The third argument is an OPTIONS OBJECT. It used to be documented here as
 *   `originalFilename`, and every call site in upload-controller passed exactly
 *   that — a string — so options.kind was always undefined and the document
 *   branch below was unreachable from there. Corrected in both places.
 *   delete(key)                                    → for cleanup on failure
 *   getPresignedUrl(key, expirySeconds)            → time-limited URL (future use)
 *
 * The `key` a driver returns is the identifier that SAME driver's delete/presign
 * accept, so a caller stores { url, key } and hands the key back later.
 */
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

const { applicationConfig } = require("../config/application-config");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");

// Both S3 keys and the local static mount live under this prefix, so the
// documented bucket policy (public read on uploads/*) and the /uploads route agree.
const UPLOAD_PREFIX = "uploads";
const DEFAULT_PRESIGN_EXPIRY_SECONDS = 3600;

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const EXTENSION_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

/*
 * VIDEO. Three containers, and only three: MP4, WebM and QuickTime are what
 * every current browser plays natively from a plain <video src>. Anything else
 * would upload happily and then fail to play for the participant, which is the
 * worst place to discover a codec problem.
 *
 * Kept as its own set rather than folded into ALLOWED_MIME_TYPES for the same
 * reason documents have their own: a fest banner must never be allowed to be a
 * video, and the image allowlist is what guards every other upload in the app.
 */
const ALLOWED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

const VIDEO_EXTENSION_BY_MIME = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
};

/*
 * A key prefix, so the bucket can be read by a human. Purely organisational —
 * same bucket, same credentials, same public-read policy on uploads/*, which
 * this stays inside so that policy still covers it.
 */
const VIDEO_KEY_PREFIX = "videos";

/*
 * Round briefs and coordinator-uploaded certificates are DOCUMENTS, not images,
 * so they get their own whitelist rather than widening the image one — a fest
 * banner must never be allowed to be a .docx.
 */
const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/vnd.ms-powerpoint", // .ppt
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
]);
const DOCUMENT_EXTENSION_BY_MIME = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

// A coordinator's certificate file is the artefact participants receive, so it
// is narrower again: a printable document or a flat image, nothing else.
const ALLOWED_CERTIFICATE_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

function assertDocument(mimeType, allowedMimeTypes = ALLOWED_DOCUMENT_MIME_TYPES) {
  if (!allowedMimeTypes.has(mimeType)) {
    throw new ApplicationError(
      400,
      ERROR_CODES.FILE_TYPE_NOT_ALLOWED,
      "That file type is not allowed. Upload a PDF, PPT/PPTX or DOC/DOCX.",
      { file: mimeType || "unknown type" }
    );
  }
}

function assertVideo(mimeType) {
  if (!ALLOWED_VIDEO_MIME_TYPES.has(mimeType)) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "Uploaded file must be an MP4, WebM or QuickTime video.",
      { file: "unsupported video type" }
    );
  }
}

function assertImage(mimeType) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "Uploaded file must be a JPEG, PNG, WebP, GIF, or AVIF image.",
      { file: "unsupported image type" }
    );
  }
}

// A collision-proof, unguessable object name: random bytes + the type's extension.
function buildFileName(mimeType) {
  const token = crypto.randomBytes(16).toString("hex");
  const extension =
    EXTENSION_BY_MIME[mimeType] ||
    VIDEO_EXTENSION_BY_MIME[mimeType] ||
    DOCUMENT_EXTENSION_BY_MIME[mimeType] ||
    "";
  return `${token}${extension}`;
}

// The absolute local uploads directory, resolved relative to the backend root
// (two levels up from src/services). Exported for the express.static mount.
function getLocalUploadDir() {
  return path.isAbsolute(applicationConfig.uploadLocalDir)
    ? applicationConfig.uploadLocalDir
    : path.join(__dirname, "..", "..", applicationConfig.uploadLocalDir);
}

// S3 is active only when all three credentials are present. Read live so tests
// (and a runtime env change) resolve correctly.
function isS3Configured() {
  return Boolean(
    process.env.S3_BUCKET_NAME &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY
  );
}

function getActiveDriverName() {
  return isS3Configured() ? "s3" : "local";
}

/* ── Local driver ─────────────────────────────────────────────────────────── */
function createLocalDriver() {
  const directory = getLocalUploadDir();

  async function upload(fileBuffer, mimeType, options = {}) {
    // kind "document" routes through the document whitelist instead of the
    // image one; everything else about the write is identical.
    if (options.kind === "document") {
      assertDocument(mimeType, options.allowedMimeTypes);
    } else if (options.kind === "video") {
      assertVideo(mimeType);
    } else {
      assertImage(mimeType);
    }
    /* Local disk is flat — the prefix only means something in the bucket, and
       inventing a subdirectory here would break the /uploads static mount. */
    const key = buildFileName(mimeType);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, key), fileBuffer);
    const url = `${applicationConfig.backendBaseUrl.replace(/\/$/, "")}/${UPLOAD_PREFIX}/${key}`;
    return { url, key };
  }

  async function remove(key) {
    // A missing file is already "deleted" — never fail cleanup over it.
    await fs.rm(path.join(directory, key), { force: true });
  }

  // Local files are already public via the static mount; the same URL "signs".
  async function getPresignedUrl(key) {
    return `${applicationConfig.backendBaseUrl.replace(/\/$/, "")}/${UPLOAD_PREFIX}/${key}`;
  }

  return { name: "local", upload, delete: remove, getPresignedUrl };
}

/* ── S3 driver ────────────────────────────────────────────────────────────── */
function s3Settings() {
  return {
    bucket: process.env.S3_BUCKET_NAME,
    region: process.env.AWS_REGION || "ap-south-1",
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    defaultExpiry:
      Number(process.env.S3_UPLOAD_URL_EXPIRY_SECONDS) || DEFAULT_PRESIGN_EXPIRY_SECONDS,
  };
}

function createS3Driver() {
  // Lazy-require the SDK so the local path never loads it.
  // eslint-disable-next-line global-require
  const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
  const settings = s3Settings();
  const client = new S3Client({
    region: settings.region,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  });
  const publicBase = `https://${settings.bucket}.s3.${settings.region}.amazonaws.com`;

  async function upload(fileBuffer, mimeType, options = {}) {
    if (options.kind === "document") {
      assertDocument(mimeType, options.allowedMimeTypes);
    } else if (options.kind === "video") {
      assertVideo(mimeType);
    } else {
      assertImage(mimeType);
    }
    /*
     * uploads/videos/<name> for video, uploads/<name> for everything else. It
     * stays under UPLOAD_PREFIX deliberately: the documented bucket policy
     * grants public read on uploads/*, and a sibling prefix would be private
     * and fail to play with no error the admin could see.
     *
     * ContentType below is what makes the browser STREAM the object rather
     * than download it, and it was already being set from the MIME type.
     */
    const key =
      options.kind === "video"
        ? `${UPLOAD_PREFIX}/${VIDEO_KEY_PREFIX}/${buildFileName(mimeType)}`
        : `${UPLOAD_PREFIX}/${buildFileName(mimeType)}`;
    await client.send(
      new PutObjectCommand({
        Bucket: settings.bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: mimeType,
      })
    );
    return { url: `${publicBase}/${key}`, key };
  }

  async function remove(key) {
    await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key }));
  }

  async function getPresignedUrl(key, expirySeconds) {
    // eslint-disable-next-line global-require
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
    return getSignedUrl(client, new GetObjectCommand({ Bucket: settings.bucket, Key: key }), {
      expiresIn: expirySeconds || settings.defaultExpiry,
    });
  }

  return { name: "s3", upload, delete: remove, getPresignedUrl };
}

// The one entry point: returns the active driver for this call.
function getStorageDriver() {
  return isS3Configured() ? createS3Driver() : createLocalDriver();
}

// Logged once at startup so it is obvious which backend is live.
function logActiveUploadDriver() {
  const label = getActiveDriverName() === "s3" ? "S3" : "local";
  console.log(`Using ${label} upload driver`);
}

module.exports = {
  assertDocument,
  assertVideo,
  ALLOWED_VIDEO_MIME_TYPES,
  VIDEO_EXTENSION_BY_MIME,
  ALLOWED_DOCUMENT_MIME_TYPES,
  ALLOWED_CERTIFICATE_MIME_TYPES,
  getStorageDriver,
  getActiveDriverName,
  getLocalUploadDir,
  logActiveUploadDriver,
  ALLOWED_MIME_TYPES,
};

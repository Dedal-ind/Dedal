const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  publicRateLimiterMiddleware,
} = require("../middleware/public-rate-limiter-middleware");
const {
  postUploadImage,
  postUploadStudentId,
  postUploadApplicationDocument,
  uploadMiddleware,
} = require("../controllers/upload-controller");

const uploadRouter = express.Router();

// multer parses the multipart body before the handler runs; asyncHandler forwards
// any storage/permission error to the shared error handler.
uploadRouter.post("/", authenticationMiddleware, uploadMiddleware, asyncHandler(postUploadImage));
// Participant student-ID upload — any signed-in user, image-only.
uploadRouter.post("/student-id", authenticationMiddleware, uploadMiddleware, asyncHandler(postUploadStudentId));
/*
 * Public — a college applying has no account yet. Rate-limited per IP and
 * restricted to PDF/JPEG/PNG; see the controller for why identity cannot gate it.
 */
uploadRouter.post(
  "/application-document",
  publicRateLimiterMiddleware,
  uploadMiddleware,
  asyncHandler(postUploadApplicationDocument)
);

module.exports = { uploadRouter };

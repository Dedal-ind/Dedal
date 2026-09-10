const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const {
  requireAdministratorMiddleware,
} = require("../middleware/require-administrator-middleware");
const {
  requireCoordinatorOrAdminMiddleware,
} = require("../middleware/require-coordinator-or-admin-middleware");
const {
  postGenerateCertificates,
  postReleaseCertificates,
  postPreviewCertificate,
  getMyCertificates,
  getMyCertificatePdf,
  getVerifyCertificate,
} = require("../controllers/certificate-controller");

/*
 * Generate/release are coordinator-or-admin: a coordinator is event-scoped by
 * their assignment (resolved in the service), an administrator stays fest-wide.
 * The TEMPLATE preview stays administrator-only, because the template itself is
 * fest-wide branding only an administrator may edit. mergeParams inherits :festId.
 */
const festCertificateRouter = express.Router({ mergeParams: true });

const administratorOnly = [authenticationMiddleware, requireAdministratorMiddleware];
const coordinatorOrAdmin = [authenticationMiddleware, requireCoordinatorOrAdminMiddleware];

festCertificateRouter.post("/generate", ...coordinatorOrAdmin, asyncHandler(postGenerateCertificates));
festCertificateRouter.post("/release", ...coordinatorOrAdmin, asyncHandler(postReleaseCertificates));
festCertificateRouter.post("/preview", ...administratorOnly, asyncHandler(postPreviewCertificate));

/*
 * The holder's own certificates and the public verify page. "/mine" is declared
 * before "/verify/:verificationCode", and neither can be mistaken for the other.
 * The verify route is deliberately unauthenticated — a recruiter has no account.
 */
const certificateRouter = express.Router();

certificateRouter.get("/mine", authenticationMiddleware, asyncHandler(getMyCertificates));
certificateRouter.get(
  "/mine/:certificateId/pdf",
  authenticationMiddleware,
  asyncHandler(getMyCertificatePdf)
);
certificateRouter.get("/verify/:verificationCode", asyncHandler(getVerifyCertificate));

module.exports = { festCertificateRouter, certificateRouter };

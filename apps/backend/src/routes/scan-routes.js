const express = require("express");

const { asyncHandler } = require("../middleware/async-handler");
const { authenticationMiddleware } = require("../middleware/authentication-middleware");
const { postQrScan, postBackupCodeScan, postPassScan, postScanPreview } = require("../controllers/scan-controller");

/*
 * Both scan endpoints require only authentication at the HTTP layer; the scan
 * service re-checks that the caller may operate the specific checkpoint (an
 * active coordinator/volunteer assignment covering it, or an administrator of
 * the fest's host college). "/qr" and "/manual" are two input methods onto the
 * same decision tree.
 */
const scanRouter = express.Router();

/* Read-only lookup for the scan-then-confirm flow; records nothing. */
scanRouter.post("/preview", authenticationMiddleware, asyncHandler(postScanPreview));
scanRouter.post("/qr", authenticationMiddleware, asyncHandler(postQrScan));
scanRouter.post("/manual", authenticationMiddleware, asyncHandler(postBackupCodeScan));
scanRouter.post("/by-pass", authenticationMiddleware, asyncHandler(postPassScan));

module.exports = { scanRouter };

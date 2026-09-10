const mongoose = require("mongoose");

const { ScanModel } = require("../models/scan-model");
const { PassModel } = require("../models/pass-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { SCAN_METHODS, SCAN_RESULTS } = require("../constants/scan-constants");
const {
  resolveScanAuthorization,
  SCAN_AUTHORIZATION_OUTCOMES,
} = require("../helpers/scan-authorization");
const { decideScanResult } = require("../helpers/scan-decision");
const { buildScanEnvelope } = require("../helpers/scan-response-helpers");

const DUPLICATE_KEY_ERROR_CODE = 11000;

async function loadActiveCheckpointOrThrow(checkpointId) {
  const checkpoint = mongoose.Types.ObjectId.isValid(checkpointId)
    ? await CheckpointModel.findById(checkpointId)
    : null;
  if (!checkpoint || !checkpoint.isActive) {
    throw new ApplicationError(400, ERROR_CODES.INVALID_CHECKPOINT, "This checkpoint is not valid.");
  }
  return checkpoint;
}

/* An earlier submission of this clientScanId already decided the outcome; replay it verbatim. */
async function replayEnvelopeFor(existingScan) {
  const pass = existingScan.passId ? await PassModel.findById(existingScan.passId) : null;
  const decision = { result: existingScan.result, entitlementId: existingScan.entitlementId };
  // The checkpoint rides along so an offer-counter replay still shows the balance.
  const checkpoint = await CheckpointModel.findById(existingScan.checkpointId);
  return buildScanEnvelope(decision, existingScan, pass, { replay: true, checkpoint });
}

function isDuplicateClientScanId(error) {
  return (
    error?.code === DUPLICATE_KEY_ERROR_CODE &&
    Object.keys(error.keyPattern || {}).includes("clientScanId")
  );
}

async function recordScan(context) {
  const { scannerUserId, payload, scanMethod, checkpoint, pass, decision } = context;
  return ScanModel.create({
    clientScanId: payload.clientScanId,
    passId: pass ? pass._id : null,
    checkpointId: checkpoint._id,
    entitlementId: decision.entitlementId || null,
    scannedByUserId: scannerUserId,
    scanMethod,
    direction: payload.direction,
    result: decision.result,
    scannedAt: payload.scannedAt,
    deviceInfo: payload.deviceInfo || null,
  });
}

/*
 * The shared spine of both scan methods. findPass differs by method — qrToken or
 * backupCode — everything else is identical. Idempotency is checked first, and a
 * concurrent duplicate that races past that check is caught on the unique index
 * and replayed rather than surfaced as a 500.
 */
async function processScan(scannerUserId, payload, scanMethod, findPass) {
  const existing = await ScanModel.findOne({ clientScanId: payload.clientScanId });
  if (existing) {
    return replayEnvelopeFor(existing);
  }

  const now = new Date();
  const checkpoint = await loadActiveCheckpointOrThrow(payload.checkpointId);
  const authorization = await resolveScanAuthorization(scannerUserId, checkpoint, now);

  const pass = await findPass();
  // A scheduled volunteer with no active shift here is a recorded rejection, not a 403.
  const decision =
    authorization === SCAN_AUTHORIZATION_OUTCOMES.NO_ACTIVE_SHIFT
      ? { result: SCAN_RESULTS.REJECTED_NO_ACTIVE_SHIFT }
      : /*
         * direction and scanner ride along because the GATE branch records the
         * day's attendance row: only an inbound scan is an arrival, and the row
         * names the volunteer who waved the person through.
         */
        await decideScanResult(pass, checkpoint, now, {
          direction: payload.direction,
          scannedByUserId: scannerUserId,
        });

  try {
    const scan = await recordScan({ scannerUserId, payload, scanMethod, checkpoint, pass, decision });
    return buildScanEnvelope(decision, scan, pass, { replay: false, checkpoint });
  } catch (error) {
    if (!isDuplicateClientScanId(error)) {
      throw error;
    }
    return replayEnvelopeFor(await ScanModel.findOne({ clientScanId: payload.clientScanId }));
  }
}

function processQrScan(scannerUserId, payload) {
  return processScan(scannerUserId, payload, SCAN_METHODS.QR, () =>
    PassModel.findOne({ qrToken: payload.qrToken })
  );
}

function processBackupCodeScan(scannerUserId, payload) {
  return processScan(scannerUserId, payload, SCAN_METHODS.BACKUP_CODE, () =>
    PassModel.findOne({ backupCode: payload.backupCode })
  );
}

/*
 * The name-search fallback resolves a participant to their passId on the server
 * and scans that pass directly, so the backupCode never travels to the device.
 * Recorded as a backupCode scan: it is a keyed manual entry by another route.
 */
function processPassLookupScan(scannerUserId, payload) {
  return processScan(scannerUserId, payload, SCAN_METHODS.BACKUP_CODE, () =>
    mongoose.Types.ObjectId.isValid(payload.passId) ? PassModel.findById(payload.passId) : null
  );
}


/*
 * Read-only scan preview: who is this pass, are they inside, what directions
 * does this door support. Nothing is recorded — the volunteer sees the person
 * and confirms with CHECK IN / CHECK OUT before anything is written.
 */
async function previewScan(scannerUserId, payload) {
  const checkpoint = await loadActiveCheckpointOrThrow(payload.checkpointId);
  const authorization = await resolveScanAuthorization(scannerUserId, checkpoint, new Date());

  const pass = payload.qrToken
    ? await PassModel.findOne({ qrToken: payload.qrToken })
    : payload.backupCode
      ? await PassModel.findOne({ backupCode: payload.backupCode })
      : null;

  const checkpointInfo = {
    checkpointName: checkpoint.checkpointName,
    directionMode: checkpoint.directionMode,
  };
  const noActiveShift = authorization === SCAN_AUTHORIZATION_OUTCOMES.NO_ACTIVE_SHIFT;

  if (!pass) {
    return { passFound: false, noActiveShift, checkpoint: checkpointInfo };
  }

  const { UserModel } = require("../models/user-model");
  const user = await UserModel.findById(pass.userId)
    .select("fullName usn collegeId profilePictureUrl")
    .populate({ path: "collegeId", select: "commonName", model: "College" })
    .lean();

  const lastAccepted = await ScanModel.findOne({
    passId: pass._id,
    checkpointId: checkpoint._id,
    result: SCAN_RESULTS.ACCEPTED,
  })
    .sort({ scannedAt: -1 })
    .select("direction")
    .lean();

  return {
    passFound: true,
    noActiveShift,
    participant: {
      fullName: user?.fullName ?? null,
      usn: user?.usn ?? null,
      collegeName: user?.collegeId?.commonName ?? null,
      profilePictureUrl: user?.profilePictureUrl ?? null,
    },
    lastAcceptedDirection: lastAccepted?.direction ?? null,
    checkpoint: checkpointInfo,
  };
}

module.exports = { processQrScan, processBackupCodeScan, processPassLookupScan, previewScan };

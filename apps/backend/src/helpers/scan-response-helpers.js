const { UserModel } = require("../models/user-model");
const { CollegeModel } = require("../models/college-model");
const { EntitlementModel } = require("../models/entitlement-model");
const { SCAN_RESULTS, CHECKPOINT_TYPES } = require("../constants/scan-constants");

/*
 * The face a volunteer needs to eyeball against the person at the gate. Built
 * only for an accepted scan — a rejection reveals no participant identity, so a
 * mistyped code cannot be used to fish for who holds a pass.
 */
async function buildParticipantSummary(pass) {
  if (!pass) {
    return null;
  }
  /*
   * Four fields, named. This runs in a volunteer's request: whatever is loaded
   * here sits in reach of the code that builds their response, and the whole
   * user document is far more than a face-check needs. photoUrl is not on the
   * model yet and resolves to null below either way.
   */
  const user = await UserModel.findById(pass.userId).select("fullName usn collegeId").lean();
  if (!user) {
    return null;
  }
  const college = user.collegeId
    ? await CollegeModel.findById(user.collegeId).select("commonName").lean()
    : null;

  return {
    fullName: user.fullName || null,
    photoUrl: user.photoUrl || null,
    usn: user.usn || null,
    collegeName: college ? college.commonName : null,
  };
}

/*
 * The envelope both scan endpoints return. It never carries the qrToken or the
 * backupCode — those stay on the owner's own pass endpoint — only the outcome,
 * the scan's id for the audit trail, and the participant on an accept.
 */
async function buildScanEnvelope(decision, scan, pass, options = {}) {
  const envelope = {
    result: decision.result,
    scanId: scan.id,
    scanMethod: scan.scanMethod,
    direction: scan.direction,
    idempotentReplay: Boolean(options.replay),
  };

  if (decision.result === SCAN_RESULTS.ACCEPTED) {
    envelope.participant = await buildParticipantSummary(pass);

    /*
     * A gate accept says WHICH kind of accept it was. "Checked in" and "already
     * here since 09:41" are two different things for the volunteer holding the
     * queue: the first means wave them through, the second means this person has
     * been through before and the scanner is working, not stuck. Present only on
     * an inbound gate scan — decideScanResult attaches it nowhere else.
     */
    if (decision.gateEntry) {
      envelope.gateEntry = {
        isReEntry: Boolean(decision.gateEntry.isReEntry),
        checkInDate: decision.gateEntry.checkInDate ?? null,
        firstCheckedInAt: decision.gateEntry.firstCheckedInAt ?? null,
      };
    }

    /*
     * A multi-use offer claim must report its balance, or a bare green tick at
     * the food counter produces arguments in the queue. remainingUses is read
     * AFTER the consume, so "3 of 4 remaining" is the truth post-scan; null on
     * an unlimited claim.
     */
    const checkpoint = options.checkpoint;
    if (checkpoint?.checkpointType === CHECKPOINT_TYPES.OFFER && decision.entitlementId) {
      const claim = await EntitlementModel.findById(decision.entitlementId)
        .select("maximumUses usedCount")
        .lean();
      envelope.offer = {
        offerName: checkpoint.checkpointName,
        remainingUses:
          claim && claim.maximumUses !== null ? claim.maximumUses - claim.usedCount : null,
        maximumUses: claim ? claim.maximumUses : null,
      };
    }
  }

  return envelope;
}

module.exports = { buildScanEnvelope };

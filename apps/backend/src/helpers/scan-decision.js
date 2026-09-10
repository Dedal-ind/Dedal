const { FestModel } = require("../models/fest-model");
const { EntitlementModel } = require("../models/entitlement-model");
const { PASS_STATUSES, ENTITLEMENT_TYPES, ENTITLEMENT_STATUSES } = require("../constants/pass-constants");
const { FEST_STATUSES } = require("../constants/fest-constants");
const {
  SCAN_RESULTS,
  CHECKPOINT_TYPES,
  SCAN_DIRECTIONS,
} = require("../constants/scan-constants");
const gateAccessService = require("../services/gate-access-service");

/*
 * A fest has no "ongoing" status of its own — that is a date-derived view of a
 * published fest — so published is the one state a pass may be scanned in. Draft,
 * archived (and, when it lands, completed) are refused.
 */
const SCANNABLE_FEST_STATUSES = [FEST_STATUSES.PUBLISHED];

/*
 * gateAccess at a GATE, offerClaim at an OFFER counter (keyed on the
 * checkpoint's offerId → the fest.offers subdocument _id), eventEntry (keyed on
 * checkpoint.eventId) everywhere else.
 */
async function findMatchingEntitlement(pass, checkpoint) {
  const base = { passId: pass._id, status: ENTITLEMENT_STATUSES.ACTIVE };
  if (checkpoint.checkpointType === CHECKPOINT_TYPES.GATE) {
    return EntitlementModel.findOne({ ...base, entitlementType: ENTITLEMENT_TYPES.GATE_ACCESS });
  }
  if (checkpoint.checkpointType === CHECKPOINT_TYPES.OFFER) {
    return EntitlementModel.findOne({
      ...base,
      entitlementType: ENTITLEMENT_TYPES.OFFER_CLAIM,
      referenceId: checkpoint.offerId,
    });
  }
  return EntitlementModel.findOne({
    ...base,
    entitlementType: ENTITLEMENT_TYPES.EVENT_ENTRY,
    referenceId: checkpoint.eventId,
  });
}

/*
 * The consume step is the race guard. An unlimited entitlement (maximumUses null,
 * e.g. gate access) always increments. A capped one increments only while the
 * server still sees room, so two concurrent scans for a last remaining use cannot
 * both win: the loser's conditional update matches nothing.
 */
async function consumeEntitlement(entitlement) {
  if (entitlement.maximumUses === null) {
    await EntitlementModel.updateOne({ _id: entitlement._id }, { $inc: { usedCount: 1 } });
    return true;
  }
  const updated = await EntitlementModel.findOneAndUpdate(
    { _id: entitlement._id, $expr: { $lt: ["$usedCount", "$maximumUses"] } },
    { $inc: { usedCount: 1 } },
    { new: true }
  );
  return Boolean(updated);
}

/*
 * Whether this checkpoint sits INSIDE the campus and therefore requires that its
 * holder has already crossed the Main Gate today.
 *
 * The gate itself is excluded for the obvious reason — it cannot require itself —
 * and so is anything an admin has flagged exempt. TRAVEL is the case that flag
 * exists for: a shuttle desk scans people onto the bus that BRINGS them to
 * campus, so demanding a gate check-in first would refuse precisely the people
 * the service exists to carry. See checkpoint-model.isExemptFromGateCheck for why
 * that is a stored flag rather than a name match evaluated here.
 */
function requiresMainGateCheckIn(checkpoint) {
  if (checkpoint.checkpointType === CHECKPOINT_TYPES.GATE) {
    return false;
  }
  return checkpoint.isExemptFromGateCheck !== true;
}

/*
 * Steps 5–10 of the scan decision, shared by both scan methods. Returns the
 * outcome and, on accept, the entitlement whose use was consumed. Never throws —
 * a rejection is a recorded result, not an error.
 *
 * `direction` and `scannedByUserId` are taken because the GATE branch writes an
 * attendance row: only an inbound scan is an arrival, and the row records who
 * waved the person through.
 */
async function decideScanResult(pass, checkpoint, now, { direction, scannedByUserId } = {}) {
  if (!pass) {
    return { result: SCAN_RESULTS.REJECTED_PASS_NOT_FOUND };
  }
  if (pass.status !== PASS_STATUSES.ACTIVE) {
    return { result: SCAN_RESULTS.REJECTED_PASS_INACTIVE };
  }

  const fest = await FestModel.findById(pass.festId).select("status").lean();
  if (!fest || !SCANNABLE_FEST_STATUSES.includes(fest.status)) {
    return { result: SCAN_RESULTS.REJECTED_FEST_NOT_ONGOING };
  }
  if (String(pass.festId) !== String(checkpoint.festId)) {
    return { result: SCAN_RESULTS.REJECTED_WRONG_CHECKPOINT };
  }

  /*
   * CAMPUS ENTRY FIRST. Placed BEFORE the entitlement lookup deliberately: the
   * refusal here is about where the person is, not about what they hold, and
   * running the entitlement check first would consume a use (consumeEntitlement
   * increments) on a scan that is then refused anyway — a participant would lose
   * one of four meal claims to a door they never got through.
   */
  if (requiresMainGateCheckIn(checkpoint)) {
    const hasEntered = await gateAccessService.hasCheckedInToday(pass._id, pass.festId, now);
    if (!hasEntered) {
      return { result: SCAN_RESULTS.REJECTED_MAIN_GATE_REQUIRED };
    }
  }

  const entitlement = await findMatchingEntitlement(pass, checkpoint);
  if (!entitlement) {
    return { result: SCAN_RESULTS.REJECTED_NO_ENTITLEMENT };
  }
  if (entitlement.maximumUses !== null && entitlement.usedCount >= entitlement.maximumUses) {
    return { result: SCAN_RESULTS.REJECTED_ALREADY_USED };
  }
  if (entitlement.validFrom && now < entitlement.validFrom) {
    return { result: SCAN_RESULTS.REJECTED_EXPIRED, details: { validFrom: entitlement.validFrom } };
  }
  if (entitlement.validTo && now > entitlement.validTo) {
    return { result: SCAN_RESULTS.REJECTED_EXPIRED, details: { validTo: entitlement.validTo } };
  }

  const consumed = await consumeEntitlement(entitlement);
  if (!consumed) {
    return { result: SCAN_RESULTS.REJECTED_ALREADY_USED };
  }

  /*
   * ATTENDANCE, recorded after the entitlement said yes and only at the gate.
   *
   * Only on the way IN: the gate is the one inAndOut checkpoint in the system, and
   * an exit is not an arrival. Recording on OUT as well would mean anyone who left
   * campus without ever entering it — which happens, because the gate is also the
   * way out of a building someone was already inside — would be marked present.
   *
   * recordGateEntry never throws: a failure to write the attendance row must not
   * turn a valid scan into a refusal at a physical entrance with a queue behind it.
   */
  if (checkpoint.checkpointType === CHECKPOINT_TYPES.GATE && direction === SCAN_DIRECTIONS.IN) {
    const entry = await gateAccessService.recordGateEntry({
      pass,
      checkpoint,
      scannedByUserId,
      at: now,
    });
    return {
      result: SCAN_RESULTS.ACCEPTED,
      entitlementId: entitlement._id,
      gateEntry: entry,
    };
  }

  return { result: SCAN_RESULTS.ACCEPTED, entitlementId: entitlement._id };
}

module.exports = { decideScanResult, requiresMainGateCheckIn };

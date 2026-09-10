import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PassModel } from "../../../src/models/pass-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import { EntitlementModel } from "../../../src/models/entitlement-model.js";
import { ScanModel } from "../../../src/models/scan-model.js";
import scanService from "../../../src/services/scan-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestOutsider,
  createTestFest,
  createTestEvent,
  createTestParticipant,
  createTestStaffMember,
  createTestPass,
  createTestGateEntitlement,
  createTestEventEntitlement,
  createTestGateCheckpoint,
  createTestEventCheckpoint,
  createTestGateCheckIn,
} from "../../setup/create-test-fixtures.js";

let college;
let admin;
let fest;
let event;
let participant;
let pass;
let gateEntitlement;
let gateCheckpoint;
let volunteer;

let scanCounter = 0;
function nextClientScanId() {
  scanCounter += 1;
  return `client-scan-${String(scanCounter).padStart(4, "0")}`;
}

function qrPayload(overrides = {}) {
  return {
    qrToken: pass.qrToken,
    checkpointId: gateCheckpoint.id,
    clientScanId: nextClientScanId(),
    direction: "in",
    scannedAt: new Date(),
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    PassModel.createIndexes(),
    EntitlementModel.createIndexes(),
    ScanModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  scanCounter = 0;
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user, { status: "published" });
  participant = await createTestParticipant(college);
  pass = await createTestPass(fest, participant.user);
  gateEntitlement = await createTestGateEntitlement(pass);
  /*
   * Inside-the-campus checkpoints (event doors, offer counters) now refuse a
   * pass that has not crossed the Main Gate today, so the default fixture puts
   * this participant on campus. The gate tests below are unaffected — the gate
   * never requires itself — and the one test that asserts the refusal clears
   * this row first.
   */
  await createTestGateCheckIn(pass);
  gateCheckpoint = await createTestGateCheckpoint(fest);
  volunteer = await createTestStaffMember(fest, "volunteer");
});

afterAll(teardownTestDatabase);

describe("processQrScan", () => {
  it("accepts a valid gate scan and increments the entitlement use count", async () => {
    const result = await scanService.processQrScan(volunteer.user._id, qrPayload());

    expect(result.result).toBe("accepted");
    expect(result.participant.fullName).toBe("Test Participant");
    expect(result.idempotentReplay).toBe(false);

    const reloaded = await EntitlementModel.findById(gateEntitlement._id);
    expect(reloaded.usedCount).toBe(1);
  });

  it("replays the same clientScanId idempotently without double-incrementing", async () => {
    const payload = qrPayload();
    const first = await scanService.processQrScan(volunteer.user._id, payload);
    const second = await scanService.processQrScan(volunteer.user._id, payload);

    expect(first.result).toBe("accepted");
    expect(second.result).toBe("accepted");
    expect(second.idempotentReplay).toBe(true);

    const reloaded = await EntitlementModel.findById(gateEntitlement._id);
    expect(reloaded.usedCount).toBe(1);
    expect(await ScanModel.countDocuments()).toBe(1);
  });

  it("rejects a suspended pass", async () => {
    await PassModel.updateOne({ _id: pass._id }, { status: "suspended" });
    const result = await scanService.processQrScan(volunteer.user._id, qrPayload());
    expect(result.result).toBe("rejectedPassInactive");
  });

  it("rejects when the fest is not in a scannable state", async () => {
    await FestModel.updateOne({ _id: fest._id }, { status: "draft" });
    const result = await scanService.processQrScan(volunteer.user._id, qrPayload());
    expect(result.result).toBe("rejectedFestNotOngoing");
  });

  it("rejects an unknown qrToken as pass-not-found and still records the attempt", async () => {
    const result = await scanService.processQrScan(
      volunteer.user._id,
      qrPayload({ qrToken: "z".repeat(32) })
    );
    expect(result.result).toBe("rejectedPassNotFound");
    expect(await ScanModel.countDocuments()).toBe(1);
  });

  it("rejects an event door the pass holds no entitlement for", async () => {
    const eventCheckpoint = await createTestEventCheckpoint(fest, event._id);
    const result = await scanService.processQrScan(
      volunteer.user._id,
      qrPayload({ checkpointId: eventCheckpoint.id })
    );
    expect(result.result).toBe("rejectedNoEntitlement");
  });

  it("rejects an expired entitlement", async () => {
    await EntitlementModel.updateOne(
      { _id: gateEntitlement._id },
      { validFrom: new Date("2099-01-01T00:00:00.000Z") }
    );
    const result = await scanService.processQrScan(volunteer.user._id, qrPayload());
    expect(result.result).toBe("rejectedExpired");
  });

  it("rejects a single-use event entitlement that is already spent", async () => {
    const eventCheckpoint = await createTestEventCheckpoint(fest, event._id);
    await createTestEventEntitlement(pass, event._id, { maximumUses: 1, usedCount: 1 });

    const result = await scanService.processQrScan(
      volunteer.user._id,
      qrPayload({ checkpointId: eventCheckpoint.id })
    );
    expect(result.result).toBe("rejectedAlreadyUsed");
  });

  it("lets only one of two concurrent scans consume a single-use entitlement", async () => {
    const eventCheckpoint = await createTestEventCheckpoint(fest, event._id);
    await createTestEventEntitlement(pass, event._id, { maximumUses: 1 });

    const [first, second] = await Promise.all([
      scanService.processQrScan(volunteer.user._id, qrPayload({ checkpointId: eventCheckpoint.id })),
      scanService.processQrScan(volunteer.user._id, qrPayload({ checkpointId: eventCheckpoint.id })),
    ]);

    const outcomes = [first.result, second.result].sort();
    expect(outcomes).toEqual(["accepted", "rejectedAlreadyUsed"]);
  });

  it("refuses a scanner with no assignment covering the checkpoint", async () => {
    const outsider = await createTestOutsider();
    await expect(
      scanService.processQrScan(outsider.user._id, qrPayload())
    ).rejects.toMatchObject({ statusCode: 403, errorCode: "PERMISSION_DENIED" });
  });

  it("refuses a scanner whose assignment window has closed", async () => {
    const expired = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "expired@example.com",
      assignment: {
        validFrom: new Date("2020-01-01T00:00:00.000Z"),
        validTo: new Date("2020-02-01T00:00:00.000Z"),
      },
    });
    await expect(
      scanService.processQrScan(expired.user._id, qrPayload())
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("lets an administrator scan without a staff assignment", async () => {
    const result = await scanService.processQrScan(admin.user._id, qrPayload());
    expect(result.result).toBe("accepted");
  });

  it("rejects an inactive checkpoint", async () => {
    const inactiveGate = await createTestGateCheckpoint(fest, { isActive: false });
    await expect(
      scanService.processQrScan(volunteer.user._id, qrPayload({ checkpointId: inactiveGate.id }))
    ).rejects.toMatchObject({ statusCode: 400, errorCode: "INVALID_CHECKPOINT" });
  });
});

describe("processBackupCodeScan", () => {
  it("accepts a valid gate scan by backup code", async () => {
    const result = await scanService.processBackupCodeScan(volunteer.user._id, {
      backupCode: pass.backupCode,
      checkpointId: gateCheckpoint.id,
      clientScanId: nextClientScanId(),
      direction: "in",
      scannedAt: new Date(),
    });

    expect(result.result).toBe("accepted");
    expect(result.scanMethod).toBe("backupCode");
    const reloaded = await EntitlementModel.findById(gateEntitlement._id);
    expect(reloaded.usedCount).toBe(1);
  });

  it("rejects an unknown backup code as pass-not-found", async () => {
    const result = await scanService.processBackupCodeScan(volunteer.user._id, {
      backupCode: "000001",
      checkpointId: gateCheckpoint.id,
      clientScanId: nextClientScanId(),
      direction: "in",
      scannedAt: new Date(),
    });
    expect(result.result).toBe("rejectedPassNotFound");
  });
});

describe("offer-counter scans", () => {
  const FOOD_OFFER = { offerName: "Food", offerKey: "food", requiresQuantity: true, isActive: true };
  let offerFest;
  let offerId;
  let offerCheckpoint;
  let offerPass;
  let offerVolunteer;

  async function createOfferSetup(maximumUses) {
    offerFest = await createTestFest(college, admin.user, {
      festName: "Offer Fest",
      festSlug: "offer-fest",
      status: "published",
      offers: [FOOD_OFFER],
    });
    const reloaded = await FestModel.findById(offerFest._id);
    offerId = reloaded.offers[0]._id;
    offerCheckpoint = await (await import("../../../src/models/checkpoint-model.js")).CheckpointModel.create({
      festId: offerFest._id,
      eventId: null,
      offerId,
      checkpointName: "Food",
      checkpointType: "offer",
      directionMode: "inOnly",
      isActive: true,
    });
    offerVolunteer = await createTestStaffMember(offerFest, "volunteer", { emailAddress: "offer-volunteer@example.com" });
    offerPass = await createTestPass(offerFest, participant.user);
    // A different fest, so a different pass — and campus entry is per fest.
    await createTestGateCheckIn(offerPass);
    await EntitlementModel.create({
      passId: offerPass._id,
      entitlementType: "offerClaim",
      referenceId: offerId,
      maximumUses,
      // Window is not under test here; the fest fixture's dates need not span now.
      validFrom: null,
      validTo: null,
      source: "registration",
    });
  }

  function offerPayload(overrides = {}) {
    return {
      qrToken: offerPass.qrToken,
      checkpointId: offerCheckpoint.id,
      clientScanId: nextClientScanId(),
      direction: "in",
      scannedAt: new Date(),
      ...overrides,
    };
  }

  it("accepts a 4-use claim and reports 3 remaining with the offer name", async () => {
    await createOfferSetup(4);
    const envelope = await scanService.processQrScan(offerVolunteer.user._id, offerPayload());

    expect(envelope.result).toBe("accepted");
    expect(envelope.offer).toEqual({ offerName: "Food", remainingUses: 3, maximumUses: 4 });
  });

  it("rejects the fifth scan of a 4-use claim as rejectedAlreadyUsed", async () => {
    await createOfferSetup(4);
    for (let scanIndex = 0; scanIndex < 4; scanIndex += 1) {
      const accepted = await scanService.processQrScan(offerVolunteer.user._id, offerPayload());
      expect(accepted.result).toBe("accepted");
    }
    const fifth = await scanService.processQrScan(offerVolunteer.user._id, offerPayload());
    expect(fifth.result).toBe("rejectedAlreadyUsed");
  });

  it("lets exactly one of two concurrent scans win the last remaining use", async () => {
    await createOfferSetup(1);
    const [first, second] = await Promise.all([
      scanService.processQrScan(offerVolunteer.user._id, offerPayload()),
      scanService.processQrScan(offerVolunteer.user._id, offerPayload()),
    ]);
    const results = [first.result, second.result].sort();
    expect(results).toEqual(["accepted", "rejectedAlreadyUsed"]);
  });

  it("rejects a pass scanned at an offer counter of a DIFFERENT fest as rejectedWrongCheckpoint", async () => {
    await createOfferSetup(4);
    // The beforeEach pass belongs to `fest`, not offerFest.
    const envelope = await scanService.processQrScan(
      offerVolunteer.user._id,
      offerPayload({ qrToken: pass.qrToken })
    );
    expect(envelope.result).toBe("rejectedWrongCheckpoint");
  });
});

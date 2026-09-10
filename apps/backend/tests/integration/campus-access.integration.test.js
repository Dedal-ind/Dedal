import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";

import { application } from "../../src/application.js";
import { PassModel } from "../../src/models/pass-model.js";
import { CheckpointModel } from "../../src/models/checkpoint-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { DailyGateCheckInModel } from "../../src/models/daily-gate-checkin-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestEvent,
  createTestParticipant,
  createTestStaffMember,
  createTestPass,
  createTestGateEntitlement,
  createTestEventEntitlement,
  createTestGateCheckpoint,
} from "../setup/create-test-fixtures.js";
import { ensureGateCheckpoint } from "../../src/helpers/checkpoint-helpers.js";
import { resolveTodayFestDayKey } from "../../src/helpers/fest-day-helpers.js";

installEmailServiceMock();

/*
 * CAMPUS ACCESS, end to end.
 *
 * The rule this file pins down: the Main Gate is the precondition for everything
 * inside the campus. It is a genuine behaviour change to every event door and
 * offer counter in the product, so each half of it is asserted explicitly —
 * refused without a gate check-in, accepted with one — rather than inferred from
 * one happy path.
 */

let college;
let admin;
let fest;
let event;
let participant;
let volunteer;
let pass;
let gateCheckpoint;
let eventCheckpoint;
let scanCounter = 0;

function nextClientScanId() {
  scanCounter += 1;
  return `campus-access-${scanCounter}-${Date.now()}`;
}

function scanAt(checkpoint, scannerToken, { direction = "in" } = {}) {
  return request(application)
    .post("/api/v1/scans/qr")
    .set("Authorization", `Bearer ${scannerToken}`)
    .send({
      qrToken: pass.qrToken,
      checkpointId: String(checkpoint._id ?? checkpoint.id),
      clientScanId: nextClientScanId(),
      direction,
      scannedAt: new Date().toISOString(),
    });
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([PassModel.createIndexes(), DailyGateCheckInModel.createIndexes()]);
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
  await createTestGateEntitlement(pass);
  await createTestEventEntitlement(pass, event._id);
  gateCheckpoint = await createTestGateCheckpoint(fest);
  eventCheckpoint = await CheckpointModel.create({
    festId: fest._id,
    eventId: event._id,
    checkpointName: `${event.eventName} Entry`,
    checkpointType: "eventEntry",
    directionMode: "inOnly",
    isActive: true,
  });
  volunteer = await createTestStaffMember(fest, "volunteer");
});

afterAll(teardownTestDatabase);

describe("Main Gate auto-creation", () => {
  it("is idempotent — publishing twice yields exactly one gate", async () => {
    await CheckpointModel.deleteMany({ festId: fest._id, checkpointType: "gate" });

    const first = await ensureGateCheckpoint(fest._id);
    const second = await ensureGateCheckpoint(fest._id);

    expect(String(first._id)).toBe(String(second._id));
    expect(await CheckpointModel.countDocuments({ festId: fest._id, checkpointType: "gate" })).toBe(1);
  });

  /*
   * Belt and braces. requiresMainGateCheckIn already returns false for the GATE
   * type whatever this flag says — the gate structurally cannot require itself —
   * so this asserts the stored default, not the behaviour the rule depends on.
   * The gate is deleted first because the flag is set on INSERT only ($setOnInsert),
   * and the fixture in beforeEach has already created one without it.
   */
  it("marks a freshly created gate as exempt from its own check-in rule", async () => {
    await CheckpointModel.deleteMany({ festId: fest._id, checkpointType: "gate" });

    const gate = await ensureGateCheckpoint(fest._id);
    expect(gate.isExemptFromGateCheck).toBe(true);
  });
});

describe("daily gate check-in", () => {
  it("records a check-in on the first inbound gate scan", async () => {
    const response = await scanAt(gateCheckpoint, volunteer.authenticationToken);

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe("accepted");
    expect(response.body.data.gateEntry.isReEntry).toBe(false);

    const rows = await DailyGateCheckInModel.find({ passId: pass._id });
    expect(rows).toHaveLength(1);
    expect(rows[0].checkInDate).toBe(resolveTodayFestDayKey());
  });

  it("accepts a second gate scan the same day as a RE-ENTRY, without a second row", async () => {
    await scanAt(gateCheckpoint, volunteer.authenticationToken);
    const second = await scanAt(gateCheckpoint, volunteer.authenticationToken);

    expect(second.body.data.result).toBe("accepted");
    expect(second.body.data.gateEntry.isReEntry).toBe(true);
    expect(second.body.data.gateEntry.firstCheckedInAt).toBeTruthy();
    expect(await DailyGateCheckInModel.countDocuments({ passId: pass._id })).toBe(1);
  });

  it("does not record an arrival on an OUTBOUND gate scan", async () => {
    const response = await scanAt(gateCheckpoint, volunteer.authenticationToken, {
      direction: "out",
    });

    expect(response.body.data.result).toBe("accepted");
    expect(await DailyGateCheckInModel.countDocuments({ passId: pass._id })).toBe(0);
  });

  /*
   * The daily reset, without waiting a day. Yesterday's row is written directly
   * because that is exactly what the clock would leave behind: the rule is that a
   * DIFFERENT date string no longer matches, and nothing has to run at midnight
   * for that to be true.
   */
  it("does not count yesterday's check-in as today's", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await DailyGateCheckInModel.create({
      passId: pass._id,
      festId: fest._id,
      checkInDate: yesterday.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
      checkedInAt: yesterday,
    });

    const response = await scanAt(eventCheckpoint, volunteer.authenticationToken);
    expect(response.body.data.result).toBe("rejectedMainGateRequired");
  });
});

describe("Main Gate as a precondition", () => {
  it("refuses an event door when the holder has not entered the campus today", async () => {
    const response = await scanAt(eventCheckpoint, volunteer.authenticationToken);

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe("rejectedMainGateRequired");
  });

  it("does NOT consume an entitlement use on that refusal", async () => {
    await scanAt(eventCheckpoint, volunteer.authenticationToken);

    const entitlement = await EntitlementModel.findOne({
      passId: pass._id,
      entitlementType: "eventEntry",
    });
    expect(entitlement.usedCount).toBe(0);
  });

  it("admits the same person at the event door once they have passed the gate", async () => {
    await scanAt(gateCheckpoint, volunteer.authenticationToken);
    const response = await scanAt(eventCheckpoint, volunteer.authenticationToken);

    expect(response.body.data.result).toBe("accepted");
  });

  it("exempts a travel counter from the rule", async () => {
    const travelCounter = await CheckpointModel.create({
      festId: fest._id,
      eventId: null,
      offerId: pass._id, // any id; the claim below points at the same one
      checkpointName: "Travel",
      checkpointType: "offer",
      directionMode: "inOnly",
      isActive: true,
      isExemptFromGateCheck: true,
    });
    await EntitlementModel.create({
      passId: pass._id,
      entitlementType: "offerClaim",
      referenceId: travelCounter.offerId,
      maximumUses: 2,
      source: "registration",
    });

    const response = await scanAt(travelCounter, volunteer.authenticationToken);

    // No gate check-in exists — the shuttle brings them TO the campus.
    expect(await DailyGateCheckInModel.countDocuments({ passId: pass._id })).toBe(0);
    expect(response.body.data.result).toBe("accepted");
  });
});

describe("Main Gate staff scoping", () => {
  it("refuses an EVENT-scoped volunteer at the Main Gate", async () => {
    await StaffAssignmentModel.updateOne(
      { userId: volunteer.user._id, festId: fest._id },
      { $set: { eventIds: [event._id], allowedCheckpointTypes: [] } }
    );

    const response = await scanAt(gateCheckpoint, volunteer.authenticationToken);
    expect(response.status).toBe(403);
  });

  it("refuses a GATE-scoped volunteer at an event door", async () => {
    await StaffAssignmentModel.updateOne(
      { userId: volunteer.user._id, festId: fest._id },
      { $set: { eventIds: [], allowedCheckpointTypes: ["gate"] } }
    );

    const response = await scanAt(eventCheckpoint, volunteer.authenticationToken);
    expect(response.status).toBe(403);
  });

  it("admits a GATE-scoped volunteer at the Main Gate", async () => {
    await StaffAssignmentModel.updateOne(
      { userId: volunteer.user._id, festId: fest._id },
      { $set: { eventIds: [], allowedCheckpointTypes: ["gate"] } }
    );

    const response = await scanAt(gateCheckpoint, volunteer.authenticationToken);
    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe("accepted");
  });
});

describe("gate status and stats endpoints", () => {
  it("reports the owner's own campus status", async () => {
    await scanAt(gateCheckpoint, volunteer.authenticationToken);

    const response = await request(application)
      .get(`/api/v1/passes/mine/${pass._id}/gate-status`)
      .set("Authorization", `Bearer ${participant.authenticationToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.today.checkedIn).toBe(true);
    expect(response.body.data.history).toHaveLength(1);
  });

  it("refuses another user's pass", async () => {
    const stranger = await createTestParticipant(college, {
      emailAddress: "stranger@example.com",
      usn: "1AA00ZZ999",
    });

    const response = await request(application)
      .get(`/api/v1/passes/mine/${pass._id}/gate-status`)
      .set("Authorization", `Bearer ${stranger.authenticationToken}`);

    expect(response.status).toBe(403);
  });

  it("counts today's entrants and who is still on campus", async () => {
    await scanAt(gateCheckpoint, volunteer.authenticationToken);

    const response = await request(application)
      .get(`/api/v1/fests/${fest._id}/gate-stats`)
      .set("Authorization", `Bearer ${admin.authenticationToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.uniqueEntrantCount).toBe(1);
    expect(response.body.data.currentlyOnCampus).toBe(1);
  });

  it("stops counting someone whose last gate scan was outbound", async () => {
    await scanAt(gateCheckpoint, volunteer.authenticationToken);
    await scanAt(gateCheckpoint, volunteer.authenticationToken, { direction: "out" });

    const response = await request(application)
      .get(`/api/v1/fests/${fest._id}/gate-stats`)
      .set("Authorization", `Bearer ${admin.authenticationToken}`);

    // They arrived today (so they are an entrant) but have since left.
    expect(response.body.data.uniqueEntrantCount).toBe(1);
    expect(response.body.data.currentlyOnCampus).toBe(0);
  });
});

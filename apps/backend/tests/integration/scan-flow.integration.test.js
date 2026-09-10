import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { PassModel } from "../../src/models/pass-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { ScanModel } from "../../src/models/scan-model.js";
import { CheckpointModel } from "../../src/models/checkpoint-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
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
  createTestParticipant,
  createTestStaffMember,
  createTestOutsider,
  createTestPass,
  createTestGateEntitlement,
  createTestGateCheckpoint,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const QR_SCAN_PATH = "/api/v1/scans/qr";
const MANUAL_SCAN_PATH = "/api/v1/scans/manual";

let volunteer;
let outsider;
let pass;
let gateCheckpoint;
let scanCounter = 0;

function nextClientScanId() {
  scanCounter += 1;
  return `integration-scan-${String(scanCounter).padStart(4, "0")}`;
}

function asVolunteer(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${volunteer.authenticationToken}`);
}

function qrBody(overrides = {}) {
  return {
    qrToken: pass.qrToken,
    checkpointId: gateCheckpoint.id,
    clientScanId: nextClientScanId(),
    direction: "in",
    scannedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    PassModel.createIndexes(),
    EntitlementModel.createIndexes(),
    ScanModel.createIndexes(),
    CheckpointModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  scanCounter = 0;
  const college = await createTestCollege();
  const admin = await createTestAdministrator(college);
  const fest = await createTestFest(college, admin.user, { status: "published" });
  const participant = await createTestParticipant(college);
  volunteer = await createTestStaffMember(fest, "volunteer");
  outsider = await createTestOutsider();
  pass = await createTestPass(fest, participant.user);
  await createTestGateEntitlement(pass);
  gateCheckpoint = await createTestGateCheckpoint(fest);
});

afterAll(teardownTestDatabase);

describe("POST /api/v1/scans/qr", () => {
  it("accepts a valid gate scan", async () => {
    const response = await asVolunteer(request(application).post(QR_SCAN_PATH)).send(qrBody());

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe("accepted");
    expect(response.body.data.participant.fullName).toBe("Test Participant");
  });

  it("never echoes the qrToken or backupCode back to the scanner", async () => {
    const response = await asVolunteer(request(application).post(QR_SCAN_PATH)).send(qrBody());
    const serialised = JSON.stringify(response.body);

    expect(serialised).not.toContain(pass.qrToken);
    expect(serialised).not.toContain(pass.backupCode);
  });

  it("replays the same clientScanId idempotently", async () => {
    const body = qrBody();
    await asVolunteer(request(application).post(QR_SCAN_PATH)).send(body);
    const second = await asVolunteer(request(application).post(QR_SCAN_PATH)).send(body);

    expect(second.status).toBe(200);
    expect(second.body.data.idempotentReplay).toBe(true);
    expect(await ScanModel.countDocuments()).toBe(1);
  });

  it("refuses a scanner with no assignment covering the checkpoint", async () => {
    const response = await request(application)
      .post(QR_SCAN_PATH)
      .set("Authorization", `Bearer ${outsider.authenticationToken}`)
      .send(qrBody());

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("surfaces a rejected result for an unknown qrToken", async () => {
    const response = await asVolunteer(request(application).post(QR_SCAN_PATH)).send(
      qrBody({ qrToken: "z".repeat(32) })
    );

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe("rejectedPassNotFound");
  });

  it("rejects a malformed payload with a validation error", async () => {
    const response = await asVolunteer(request(application).post(QR_SCAN_PATH)).send(
      qrBody({ direction: "sideways" })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("POST /api/v1/scans/manual", () => {
  it("accepts a valid backup-code scan", async () => {
    const response = await asVolunteer(request(application).post(MANUAL_SCAN_PATH)).send({
      backupCode: pass.backupCode,
      checkpointId: gateCheckpoint.id,
      clientScanId: nextClientScanId(),
      direction: "in",
      scannedAt: new Date().toISOString(),
    });

    expect(response.status).toBe(200);
    expect(response.body.data.result).toBe("accepted");
    expect(response.body.data.scanMethod).toBe("backupCode");
  });

  it("requires authentication", async () => {
    const response = await request(application).post(MANUAL_SCAN_PATH).send({
      backupCode: pass.backupCode,
      checkpointId: gateCheckpoint.id,
      clientScanId: nextClientScanId(),
      direction: "in",
      scannedAt: new Date().toISOString(),
    });

    expect(response.status).toBe(401);
  });
});

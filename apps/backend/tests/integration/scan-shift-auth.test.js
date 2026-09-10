import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { ScanModel } from "../../src/models/scan-model.js";
import { VolunteerShiftModel } from "../../src/models/volunteer-shift-model.js";
import { processQrScan } from "../../src/services/scan-service.js";
import { SHIFT_STATUSES } from "../../src/constants/shift-constants.js";
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
  createTestGateCheckpoint,
  createTestEventCheckpoint,
  createTestEvent,
  createTestPass,
  createTestGateEntitlement,
} from "../setup/create-test-fixtures.js";

const HOUR = 60 * 60 * 1000;
let world;
let scanCounter = 0;

async function buildWorld() {
  const college = await createTestCollege();
  const admin = await createTestAdministrator(college);
  const fest = await createTestFest(college, admin.user, { status: "published" });
  const event = await createTestEvent(fest, admin.user);
  const gate = await createTestGateCheckpoint(fest);
  const otherCheckpoint = await createTestEventCheckpoint(fest, event._id, { checkpointName: "Door A" });

  const participant = await createTestParticipant(college);
  const pass = await createTestPass(fest, participant.user, { status: "active" });
  await createTestGateEntitlement(pass);

  const volunteer = await createTestStaffMember(fest, "volunteer", { emailAddress: "vol@example.com" });
  const coordinator = await createTestStaffMember(fest, "coordinator", { emailAddress: "coord@example.com" });

  return { fest, gate, otherCheckpoint, pass, volunteer, coordinator };
}

function scanGateAs(scannerUserId) {
  scanCounter += 1;
  return processQrScan(scannerUserId, {
    clientScanId: `client-scan-${scanCounter}`,
    checkpointId: String(world.gate._id),
    qrToken: world.pass.qrToken,
    direction: "in",
    scannedAt: new Date(),
    deviceInfo: null,
  });
}

async function recordedResult(scannerUserId) {
  await scanGateAs(scannerUserId);
  const scan = await ScanModel.findOne({ clientScanId: `client-scan-${scanCounter}` });
  return scan.result;
}

function shiftAttributes(userId, checkpointId, { startsAt, endsAt, status = SHIFT_STATUSES.SCHEDULED }) {
  return {
    festId: world.fest._id,
    userId,
    checkpointId,
    assignedByUserId: world.fest.createdByUserId,
    startsAt,
    endsAt,
    status,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
});
beforeEach(async () => {
  await clearAllCollections();
  scanCounter = 0;
  world = await buildWorld();
});
afterAll(teardownTestDatabase);

describe("scanner authorization with volunteer shifts", () => {
  it("accepts a volunteer with zero shifts via the staffAssignment fallback", async () => {
    const result = await recordedResult(world.volunteer.user._id);
    expect(result).toBe("accepted");
  });

  it("accepts a volunteer with an active shift on this checkpoint now", async () => {
    await VolunteerShiftModel.create(
      shiftAttributes(world.volunteer.user._id, world.gate._id, {
        startsAt: new Date(Date.now() - HOUR),
        endsAt: new Date(Date.now() + HOUR),
      })
    );
    const result = await recordedResult(world.volunteer.user._id);
    expect(result).toBe("accepted");
  });

  it("rejects a volunteer whose shift here has not started yet", async () => {
    await VolunteerShiftModel.create(
      shiftAttributes(world.volunteer.user._id, world.gate._id, {
        startsAt: new Date(Date.now() + HOUR),
        endsAt: new Date(Date.now() + 2 * HOUR),
      })
    );
    const result = await recordedResult(world.volunteer.user._id);
    expect(result).toBe("rejectedNoActiveShift");
  });

  it("rejects a volunteer whose only active shift is on a different checkpoint", async () => {
    await VolunteerShiftModel.create(
      shiftAttributes(world.volunteer.user._id, world.otherCheckpoint._id, {
        startsAt: new Date(Date.now() - HOUR),
        endsAt: new Date(Date.now() + HOUR),
      })
    );
    const result = await recordedResult(world.volunteer.user._id);
    expect(result).toBe("rejectedNoActiveShift");
  });

  it("ignores a cancelled shift and falls back to the staffAssignment", async () => {
    await VolunteerShiftModel.create(
      shiftAttributes(world.volunteer.user._id, world.gate._id, {
        startsAt: new Date(Date.now() - HOUR),
        endsAt: new Date(Date.now() + HOUR),
        status: SHIFT_STATUSES.CANCELLED,
      })
    );
    const result = await recordedResult(world.volunteer.user._id);
    expect(result).toBe("accepted");
  });

  it("leaves coordinator authorization unchanged regardless of shifts", async () => {
    await VolunteerShiftModel.create(
      shiftAttributes(world.coordinator.user._id, world.otherCheckpoint._id, {
        startsAt: new Date(Date.now() + HOUR),
        endsAt: new Date(Date.now() + 2 * HOUR),
      })
    );
    const result = await recordedResult(world.coordinator.user._id);
    expect(result).toBe("accepted");
  });
});

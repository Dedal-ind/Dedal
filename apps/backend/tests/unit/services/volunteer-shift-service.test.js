import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { AuditLogModel } from "../../../src/models/audit-log-model.js";
import volunteerShiftService from "../../../src/services/volunteer-shift-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestEvent,
  createTestGateCheckpoint,
  createTestEventCheckpoint,
  createTestStaffMember,
} from "../../setup/create-test-fixtures.js";

const START = "2027-03-01T14:00:00.000Z";
const END = "2027-03-01T17:00:00.000Z";

let scene;

async function buildScene() {
  const college = await createTestCollege();
  const admin = await createTestAdministrator(college);
  const fest = await createTestFest(college, admin.user);
  const eventA = await createTestEvent(fest, admin.user);
  const eventB = await createTestEvent(fest, admin.user, {
    eventName: "Event B",
    eventSlug: "event-b",
  });
  const gate = await createTestGateCheckpoint(fest);
  const doorA = await createTestEventCheckpoint(fest, eventA._id, { checkpointName: "Door A" });
  const doorB = await createTestEventCheckpoint(fest, eventB._id, { checkpointName: "Door B" });
  const volunteer = await createTestStaffMember(fest, "volunteer", { emailAddress: "vol@example.com" });
  const coordinator = await createTestStaffMember(fest, "coordinator", {
    emailAddress: "coord@example.com",
    assignment: { eventIds: [eventA._id] },
  });
  return {
    college,
    fest,
    eventA,
    eventB,
    gate,
    doorA,
    doorB,
    volunteerId: String(volunteer.user._id),
    adminActor: { userId: String(admin.user._id), isAdministrator: true, assignment: admin.staffAssignment },
    coordinatorActor: {
      userId: String(coordinator.user._id),
      isAdministrator: false,
      assignment: coordinator.staffAssignment.toObject(),
    },
  };
}

function createInput(overrides = {}) {
  return {
    festId: String(scene.fest._id),
    userId: scene.volunteerId,
    checkpointId: String(scene.gate._id),
    startsAt: START,
    endsAt: END,
    actor: scene.adminActor,
    ...overrides,
  };
}

async function seedShift(overrides = {}) {
  const { shift } = await volunteerShiftService.createShift(createInput(overrides));
  return shift;
}

async function errorCodeFrom(promise) {
  return promise.then(() => null).catch((error) => error.errorCode);
}

beforeAll(async () => {
  await setupTestDatabase();
});
beforeEach(async () => {
  await clearAllCollections();
  scene = await buildScene();
});
afterAll(teardownTestDatabase);

describe("createShift", () => {
  it("creates a scheduled shift with the documented DTO shape", async () => {
    const { shift } = await volunteerShiftService.createShift(createInput());
    expect(shift).toMatchObject({
      festId: String(scene.fest._id),
      userId: scene.volunteerId,
      checkpointId: String(scene.gate._id),
      status: "scheduled",
      assignedByUserId: scene.adminActor.userId,
    });
    expect(shift.shiftId).toBeDefined();
    expect(shift.startsAt).toBe(new Date(START).toISOString());
    expect(shift.checkpointName).toBe("Main Gate");
    expect(shift).toHaveProperty("cancelledAt", null);
  });

  it("rejects a user with no active volunteer assignment", async () => {
    const code = await errorCodeFrom(
      volunteerShiftService.createShift(createInput({ userId: scene.adminActor.userId }))
    );
    expect(code).toBe("SHIFT_USER_NOT_VOLUNTEER");
  });

  it("rejects a checkpoint from a different fest", async () => {
    const otherFest = await createTestFest(scene.college, { _id: scene.adminActor.userId }, {
      festSlug: "other-fest",
    });
    const otherCheckpoint = await createTestGateCheckpoint(otherFest);
    const code = await errorCodeFrom(
      volunteerShiftService.createShift(createInput({ checkpointId: String(otherCheckpoint._id) }))
    );
    expect(code).toBe("SHIFT_CHECKPOINT_NOT_IN_FEST");
  });

  it("rejects an invalid window", async () => {
    const code = await errorCodeFrom(
      volunteerShiftService.createShift(createInput({ startsAt: END, endsAt: START }))
    );
    expect(code).toBe("SHIFT_INVALID_WINDOW");
  });

  it("writes a shift.created audit row", async () => {
    await volunteerShiftService.createShift(createInput());
    const logs = await AuditLogModel.find({ action: "shift.created" });
    expect(logs).toHaveLength(1);
  });
});

describe("listShiftsForFest", () => {
  beforeEach(async () => {
    await seedShift({ checkpointId: String(scene.gate._id) });
    await seedShift({ checkpointId: String(scene.doorA._id) });
    await seedShift({ checkpointId: String(scene.doorB._id) });
  });

  it("shows an administrator every shift in the fest", async () => {
    const { shifts } = await volunteerShiftService.listShiftsForFest({
      festId: String(scene.fest._id),
      actor: scene.adminActor,
      filters: {},
    });
    expect(shifts).toHaveLength(3);
  });

  it("shows a coordinator only shifts on the checkpoints they cover", async () => {
    const { shifts } = await volunteerShiftService.listShiftsForFest({
      festId: String(scene.fest._id),
      actor: scene.coordinatorActor,
      filters: {},
    });
    const names = shifts.map((shift) => shift.checkpointName).sort();
    expect(names).toEqual(["Door A", "Main Gate"]);
  });

  it("defaults to scheduled only, and status=all includes cancelled", async () => {
    const cancelled = await seedShift({ checkpointId: String(scene.gate._id) });
    await volunteerShiftService.cancelShift({
      festId: String(scene.fest._id),
      shiftId: cancelled.shiftId,
      actor: scene.adminActor,
      cancellationReason: "not needed",
    });

    const scheduledOnly = await volunteerShiftService.listShiftsForFest({
      festId: String(scene.fest._id),
      actor: scene.adminActor,
      filters: {},
    });
    expect(scheduledOnly.shifts.every((shift) => shift.status === "scheduled")).toBe(true);

    const all = await volunteerShiftService.listShiftsForFest({
      festId: String(scene.fest._id),
      actor: scene.adminActor,
      filters: { status: "all" },
    });
    expect(all.shifts.some((shift) => shift.status === "cancelled")).toBe(true);
  });

  it("includes a shift that merely overlaps the from/to window", async () => {
    const { shifts } = await volunteerShiftService.listShiftsForFest({
      festId: String(scene.fest._id),
      actor: scene.adminActor,
      filters: { from: "2027-03-01T15:00:00.000Z", to: "2027-03-01T15:30:00.000Z" },
    });
    expect(shifts.length).toBeGreaterThan(0);
  });
});

describe("updateShift", () => {
  it("persists a new window and audits before + after", async () => {
    const shift = await seedShift();
    const newEnd = "2027-03-01T18:00:00.000Z";
    const { shift: updated } = await volunteerShiftService.updateShift({
      festId: String(scene.fest._id),
      shiftId: shift.shiftId,
      actor: scene.adminActor,
      updates: { endsAt: newEnd },
    });
    expect(updated.endsAt).toBe(new Date(newEnd).toISOString());

    const log = await AuditLogModel.findOne({ action: "shift.updated" });
    expect(log.beforeState).toBeTruthy();
    expect(log.afterState).toBeTruthy();
  });

  it("rejects editing a cancelled shift", async () => {
    const shift = await seedShift();
    await volunteerShiftService.cancelShift({
      festId: String(scene.fest._id),
      shiftId: shift.shiftId,
      actor: scene.adminActor,
      cancellationReason: "",
    });
    const code = await errorCodeFrom(
      volunteerShiftService.updateShift({
        festId: String(scene.fest._id),
        shiftId: shift.shiftId,
        actor: scene.adminActor,
        updates: { endsAt: "2027-03-01T19:00:00.000Z" },
      })
    );
    expect(code).toBe("SHIFT_ALREADY_CANCELLED");
  });

  it("forbids a coordinator moving a shift to a checkpoint they do not cover", async () => {
    const shift = await seedShift({ checkpointId: String(scene.doorA._id) });
    const code = await errorCodeFrom(
      volunteerShiftService.updateShift({
        festId: String(scene.fest._id),
        shiftId: shift.shiftId,
        actor: scene.coordinatorActor,
        updates: { checkpointId: String(scene.doorB._id) },
      })
    );
    expect(code).toBe("FORBIDDEN");
  });
});

describe("cancelShift", () => {
  it("cancels once and is idempotent on a second call", async () => {
    const shift = await seedShift();
    const first = await volunteerShiftService.cancelShift({
      festId: String(scene.fest._id),
      shiftId: shift.shiftId,
      actor: scene.adminActor,
      cancellationReason: "weather",
    });
    expect(first.shift.status).toBe("cancelled");
    expect(first.shift.cancellationReason).toBe("weather");

    const second = await volunteerShiftService.cancelShift({
      festId: String(scene.fest._id),
      shiftId: shift.shiftId,
      actor: scene.adminActor,
      cancellationReason: "different reason",
    });
    expect(second.shift.cancellationReason).toBe("weather");

    const cancelledAudits = await AuditLogModel.countDocuments({ action: "shift.cancelled" });
    expect(cancelledAudits).toBe(1);
  });
});

describe("listMyShifts", () => {
  it("returns only the caller's shifts, enriched with fest fields", async () => {
    await seedShift();
    const { shifts } = await volunteerShiftService.listMyShifts({
      actor: { userId: scene.volunteerId },
      filters: {},
    });
    expect(shifts).toHaveLength(1);
    expect(shifts[0].festName).toBe(scene.fest.festName);
    expect(shifts[0].festStartsOn).toBe(scene.fest.startsOn.toISOString());
    expect(shifts[0].festEndsOn).toBe(scene.fest.endsOn.toISOString());

    const other = await volunteerShiftService.listMyShifts({
      actor: { userId: scene.adminActor.userId },
      filters: {},
    });
    expect(other.shifts).toHaveLength(0);
  });
});

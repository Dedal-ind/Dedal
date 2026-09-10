import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { CheckpointModel } from "../../../src/models/checkpoint-model.js";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import checkpointService from "../../../src/services/checkpoint-service.js";
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
  createTestStaffMember,
  createTestGateCheckpoint,
  createTestEventCheckpoint,
} from "../../setup/create-test-fixtures.js";

let college;
let admin;
let fest;
let event;

beforeAll(async () => {
  await setupTestDatabase();
  await StaffAssignmentModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user, { status: "published" });
  await createTestGateCheckpoint(fest);
  await createTestEventCheckpoint(fest, event._id);
});

afterAll(teardownTestDatabase);

describe("listMyActiveCheckpoints", () => {
  it("returns every checkpoint in a whole-fest volunteer's fest, with names populated", async () => {
    const volunteer = await createTestStaffMember(fest, "volunteer");
    const checkpoints = await checkpointService.listMyActiveCheckpoints(volunteer.user._id);

    expect(checkpoints).toHaveLength(2);
    const gate = checkpoints.find((checkpoint) => checkpoint.checkpointType === "gate");
    expect(gate.festName).toBe("Alliance ONE 2027");
    const door = checkpoints.find((checkpoint) => checkpoint.checkpointType === "eventEntry");
    expect(door.eventName).toBe("Robowars 2027");
  });

  it("excludes checkpoints when the assignment window has closed", async () => {
    const expired = await createTestStaffMember(fest, "volunteer", {
      assignment: {
        validFrom: new Date("2020-01-01T00:00:00.000Z"),
        validTo: new Date("2020-02-01T00:00:00.000Z"),
      },
    });
    const checkpoints = await checkpointService.listMyActiveCheckpoints(expired.user._id);
    expect(checkpoints).toEqual([]);
  });

  it("gives an administrator every checkpoint under their college's fests", async () => {
    const checkpoints = await checkpointService.listMyActiveCheckpoints(admin.user._id);
    expect(checkpoints).toHaveLength(2);
  });

  it("returns nothing for a user with no assignment", async () => {
    const outsider = await createTestOutsider();
    const checkpoints = await checkpointService.listMyActiveCheckpoints(outsider.user._id);
    expect(checkpoints).toEqual([]);
  });

  it("restricts an event-scoped volunteer to that event door plus the fest gate", async () => {
    const otherEvent = await createTestEvent(fest, admin.user, {
      status: "published",
      eventSlug: "another-event",
      eventName: "Another Event",
    });
    await createTestEventCheckpoint(fest, otherEvent._id, { checkpointName: "Another Event Entry" });

    const scoped = await createTestStaffMember(fest, "coordinator", {
      assignment: { eventIds: [event._id] },
    });
    const checkpoints = await checkpointService.listMyActiveCheckpoints(scoped.user._id);

    const names = checkpoints.map((checkpoint) => checkpoint.checkpointName).sort();
    expect(names).toEqual(["Main Gate", "Robowars 2027 Entry"]);
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { CheckpointModel } from "../../src/models/checkpoint-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestOutsider,
  createTestFest,
  createTestEvent,
  createTestStaffMember,
  createTestGateCheckpoint,
  createTestEventCheckpoint,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const CHECKPOINTS_PATH = "/api/v1/checkpoints/mine";

let volunteer;
let outsider;

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    CheckpointModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  const college = await createTestCollege();
  const admin = await createTestAdministrator(college);
  const fest = await createTestFest(college, admin.user, { status: "published" });
  const event = await createTestEvent(fest, admin.user, { status: "published" });
  await createTestGateCheckpoint(fest);
  await createTestEventCheckpoint(fest, event._id);
  volunteer = await createTestStaffMember(fest, "volunteer");
  outsider = await createTestOutsider();
});

afterAll(teardownTestDatabase);

describe("GET /api/v1/checkpoints/mine", () => {
  it("returns the checkpoints the volunteer may operate", async () => {
    const response = await request(application)
      .get(CHECKPOINTS_PATH)
      .set("Authorization", `Bearer ${volunteer.authenticationToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.map((checkpoint) => checkpoint.checkpointType).sort()).toEqual([
      "eventEntry",
      "gate",
    ]);
  });

  it("returns an empty list for a user with no assignment", async () => {
    const response = await request(application)
      .get(CHECKPOINTS_PATH)
      .set("Authorization", `Bearer ${outsider.authenticationToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("requires authentication", async () => {
    const response = await request(application).get(CHECKPOINTS_PATH);
    expect(response.status).toBe(401);
  });
});

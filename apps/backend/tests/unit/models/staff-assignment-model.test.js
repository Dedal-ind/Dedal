import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

const userId = new mongoose.Types.ObjectId();
const collegeId = new mongoose.Types.ObjectId();
const festId = new mongoose.Types.ObjectId();

function buildAssignment(overrides = {}) {
  return { userId, assignedByUserId: userId, role: "administrator", collegeId, ...overrides };
}

beforeAll(async () => {
  await setupTestDatabase();
  await StaffAssignmentModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

describe("StaffAssignmentModel schema", () => {
  it("requires userId, role and assignedByUserId", async () => {
    await expect(StaffAssignmentModel.create({})).rejects.toThrow(
      /userId|role|assignedByUserId/
    );
  });

  it("rejects a role outside the enum", async () => {
    await expect(StaffAssignmentModel.create(buildAssignment({ role: "wizard" }))).rejects.toThrow(
      /role/
    );
  });

  it("rejects a status outside the enum", async () => {
    await expect(
      StaffAssignmentModel.create(buildAssignment({ status: "paused" }))
    ).rejects.toThrow(/status/);
  });

  it("defaults status to active", async () => {
    const assignment = await StaffAssignmentModel.create(buildAssignment());
    expect(assignment.status).toBe("active");
  });
});

describe("StaffAssignmentModel scope hook", () => {
  it("accepts a college-scoped administrator", async () => {
    await expect(StaffAssignmentModel.create(buildAssignment())).resolves.toBeDefined();
  });

  it("invalidates an administrator with no collegeId", async () => {
    await expect(
      StaffAssignmentModel.create(buildAssignment({ collegeId: null }))
    ).rejects.toThrow(/An administrator assignment requires collegeId/);
  });

  it("invalidates an administrator that carries a festId", async () => {
    await expect(StaffAssignmentModel.create(buildAssignment({ festId }))).rejects.toThrow(
      /An administrator assignment must not carry festId/
    );
  });

  it("accepts a fest-scoped coordinator and volunteer", async () => {
    for (const role of ["coordinator", "volunteer"]) {
      const assignment = await StaffAssignmentModel.create(
        buildAssignment({ role, collegeId: null, festId })
      );
      expect(assignment.role).toBe(role);
      await clearAllCollections();
    }
  });

  it("invalidates a coordinator with no festId, naming the role", async () => {
    await expect(
      StaffAssignmentModel.create(buildAssignment({ role: "coordinator", collegeId: null }))
    ).rejects.toThrow(/A coordinator assignment requires festId/);
  });

  it("lets a fest-scoped role also carry a collegeId", async () => {
    await expect(
      StaffAssignmentModel.create(buildAssignment({ role: "volunteer", festId }))
    ).resolves.toBeDefined();
  });
});

describe("StaffAssignmentModel indexes", () => {
  it("declares the compound unique index with an active-only partial filter", async () => {
    const indexes = await StaffAssignmentModel.collection.indexes();
    const uniqueIndex = indexes.find(
      (index) => index.name === "index_staffAssignments_userId_festId_collegeId_role"
    );

    expect(uniqueIndex.unique).toBe(true);
    expect(uniqueIndex.partialFilterExpression).toEqual({ status: "active" });
    expect(indexes.some((index) => index.name === "index_staffAssignments_userId_status")).toBe(
      true
    );
  });

  it("rejects a duplicate active administrator grant", async () => {
    await StaffAssignmentModel.create(buildAssignment());
    await expect(StaffAssignmentModel.create(buildAssignment())).rejects.toMatchObject({
      code: 11000,
    });
  });

  /* The partial filter is what lets a revoked grant be re-granted later. */
  it("allows re-granting a role that was previously revoked", async () => {
    await StaffAssignmentModel.create(buildAssignment({ status: "revoked" }));
    await expect(StaffAssignmentModel.create(buildAssignment())).resolves.toBeDefined();
  });
});

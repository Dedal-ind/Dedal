import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

beforeAll(async () => {
  await setupTestDatabase();
  await StaffAssignmentModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

async function createAssignment() {
  return StaffAssignmentModel.create({
    userId: new mongoose.Types.ObjectId(),
    festId: new mongoose.Types.ObjectId(),
    role: "coordinator",
    eventIds: [new mongoose.Types.ObjectId()],
    assignedByUserId: new mongoose.Types.ObjectId(),
  });
}

describe("StaffAssignmentModel deletion guard (accountability invariant)", () => {
  it("blocks Model.deleteOne", async () => {
    const assignment = await createAssignment();
    await expect(StaffAssignmentModel.deleteOne({ _id: assignment._id })).rejects.toThrow(
      /permanent history/
    );
    expect(await StaffAssignmentModel.countDocuments()).toBe(1);
  });

  it("blocks Model.deleteMany", async () => {
    await createAssignment();
    await expect(StaffAssignmentModel.deleteMany({})).rejects.toThrow(/permanent history/);
    expect(await StaffAssignmentModel.countDocuments()).toBe(1);
  });

  it("blocks Model.findOneAndDelete", async () => {
    const assignment = await createAssignment();
    await expect(StaffAssignmentModel.findOneAndDelete({ _id: assignment._id })).rejects.toThrow(
      /permanent history/
    );
    expect(await StaffAssignmentModel.countDocuments()).toBe(1);
  });

  it("blocks document.deleteOne()", async () => {
    const assignment = await createAssignment();
    await expect(assignment.deleteOne()).rejects.toThrow(/permanent history/);
    expect(await StaffAssignmentModel.countDocuments()).toBe(1);
  });
});

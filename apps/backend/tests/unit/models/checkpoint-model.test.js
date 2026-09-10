import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { CheckpointModel } from "../../../src/models/checkpoint-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

beforeAll(async () => {
  await setupTestDatabase();
  await CheckpointModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

function buildCheckpoint(overrides = {}) {
  return {
    festId: new mongoose.Types.ObjectId(),
    eventId: null,
    checkpointName: "Main Gate",
    checkpointType: "gate",
    directionMode: "inAndOut",
    ...overrides,
  };
}

describe("CheckpointModel schema", () => {
  it("requires festId", async () => {
    await expect(CheckpointModel.create(buildCheckpoint({ festId: undefined }))).rejects.toThrow(
      /festId/
    );
  });

  it("rejects a checkpointType outside the enum", async () => {
    await expect(
      CheckpointModel.create(buildCheckpoint({ checkpointType: "turnstile" }))
    ).rejects.toThrow(/checkpointType/);
  });

  it("rejects a directionMode outside the enum", async () => {
    await expect(
      CheckpointModel.create(buildCheckpoint({ directionMode: "sideways" }))
    ).rejects.toThrow(/directionMode/);
  });

  it("defaults isActive to true and allows a null eventId gate", async () => {
    const checkpoint = await CheckpointModel.create(buildCheckpoint());
    expect(checkpoint.isActive).toBe(true);
    expect(checkpoint.eventId).toBeNull();
  });

  it("drops _id from the JSON view", async () => {
    const checkpoint = await CheckpointModel.create(buildCheckpoint());
    expect(checkpoint.toJSON()._id).toBeUndefined();
    expect(checkpoint.toJSON().id).toBeDefined();
  });
});

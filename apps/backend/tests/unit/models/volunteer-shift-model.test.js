import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { VolunteerShiftModel } from "../../../src/models/volunteer-shift-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

beforeAll(async () => {
  await setupTestDatabase();
  await VolunteerShiftModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

function buildShift(overrides = {}) {
  return {
    festId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    checkpointId: new mongoose.Types.ObjectId(),
    assignedByUserId: new mongoose.Types.ObjectId(),
    startsAt: new Date("2027-03-01T14:00:00.000Z"),
    endsAt: new Date("2027-03-01T17:00:00.000Z"),
    ...overrides,
  };
}

describe("VolunteerShiftModel schema", () => {
  it("rejects a window where startsAt is at or after endsAt", async () => {
    const error = await VolunteerShiftModel.create(
      buildShift({
        startsAt: new Date("2027-03-01T17:00:00.000Z"),
        endsAt: new Date("2027-03-01T14:00:00.000Z"),
      })
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
    expect(error.errors.endsAt).toBeDefined();
  });

  it("rejects an equal start and end (zero-length window)", async () => {
    const sameInstant = new Date("2027-03-01T14:00:00.000Z");
    await expect(
      VolunteerShiftModel.create(buildShift({ startsAt: sameInstant, endsAt: sameInstant }))
    ).rejects.toThrow(mongoose.Error.ValidationError);
  });

  it("accepts a valid window", async () => {
    const shift = await VolunteerShiftModel.create(buildShift());
    expect(shift.startsAt.getTime()).toBeLessThan(shift.endsAt.getTime());
  });

  it("defaults status to scheduled", async () => {
    const shift = await VolunteerShiftModel.create(buildShift());
    expect(shift.status).toBe("scheduled");
  });

  it("trims the cancellationReason", async () => {
    const shift = await VolunteerShiftModel.create(
      buildShift({ cancellationReason: "  no longer needed  " })
    );
    expect(shift.cancellationReason).toBe("no longer needed");
  });

  it("requires festId, userId, checkpointId and assignedByUserId", async () => {
    await expect(VolunteerShiftModel.create(buildShift({ festId: undefined }))).rejects.toThrow(/festId/);
    await expect(VolunteerShiftModel.create(buildShift({ userId: undefined }))).rejects.toThrow(/userId/);
    await expect(
      VolunteerShiftModel.create(buildShift({ checkpointId: undefined }))
    ).rejects.toThrow(/checkpointId/);
    await expect(
      VolunteerShiftModel.create(buildShift({ assignedByUserId: undefined }))
    ).rejects.toThrow(/assignedByUserId/);
  });
});

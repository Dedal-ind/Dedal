import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { FestModel } from "../../../src/models/fest-model.js";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import festService from "../../../src/services/fest-service.js";
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
} from "../../setup/create-test-fixtures.js";

const MISSING_ID = "000000000000000000000000";

let college;
let admin;
let outsider;

function buildFestAttributes(overrides = {}) {
  return {
    festName: "Alliance ONE 2027",
    hostCollegeId: college._id,
    startsOn: new Date("2027-03-01T00:00:00.000Z"),
    endsOn: new Date("2027-03-05T00:00:00.000Z"),
    visibility: "intraCollege",
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  await FestModel.createIndexes();
  await StaffAssignmentModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  outsider = await createTestOutsider();
});

afterAll(teardownTestDatabase);

/* Split from fest-service.test.js to stay within the per-file line budget. */
describe("fest status transitions", () => {
  it("publishes a draft fest", async () => {
    const fest = await createTestFest(college, admin.user);
    const published = await festService.publishFest(admin.user._id, fest.id);

    expect(published.status).toBe("published");
    expect(published.archivedAt).toBe(null);
  });

  it("refuses to publish anything that is not a draft", async () => {
    const fest = await createTestFest(college, admin.user, { status: "published" });
    const error = await festService.publishFest(admin.user._id, fest.id).catch((e) => e);

    expect(error.errorCode).toBe("INVALID_FEST_STATE");
    expect(error.details).toEqual({
      currentStatus: "published",
      attemptedTransition: "published",
    });
  });

  it("archives a fest and stamps archivedAt", async () => {
    const fest = await createTestFest(college, admin.user, { status: "published" });
    const archived = await festService.archiveFest(admin.user._id, fest.id);

    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBeInstanceOf(Date);
  });

  it("refuses to archive an already-archived fest", async () => {
    const fest = await createTestFest(college, admin.user, { status: "archived" });

    await expect(festService.archiveFest(admin.user._id, fest.id)).rejects.toMatchObject({
      errorCode: "INVALID_FEST_STATE",
    });
  });

  /* Unarchiving clears the stamp that archiving set. */
  it("unarchives back to draft and clears archivedAt", async () => {
    const fest = await createTestFest(college, admin.user, {
      status: "archived",
      archivedAt: new Date(),
    });
    const unarchived = await festService.unarchiveFest(admin.user._id, fest.id);

    expect(unarchived.status).toBe("draft");
    expect(unarchived.archivedAt).toBe(null);
  });

  it("refuses to unarchive a fest that is not archived", async () => {
    const fest = await createTestFest(college, admin.user);

    await expect(festService.unarchiveFest(admin.user._id, fest.id)).rejects.toMatchObject({
      errorCode: "INVALID_FEST_STATE",
    });
  });

  it("refuses every transition for a non-administrator", async () => {
    const fest = await createTestFest(college, admin.user);

    for (const transition of ["publishFest", "archiveFest", "unarchiveFest"]) {
      await expect(festService[transition](outsider.user._id, fest.id)).rejects.toMatchObject({
        errorCode: "PERMISSION_DENIED",
      });
    }
  });

  it("returns 404 for a transition on a fest that does not exist", async () => {
    await expect(
      festService.publishFest(admin.user._id, new mongoose.Types.ObjectId().toString())
    ).rejects.toMatchObject({ errorCode: "FEST_NOT_FOUND" });
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { CollegeModel } from "../../../src/models/college-model.js";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import {
  listCollegesUserAdministers,
  listVerifiedColleges,
} from "../../../src/services/college-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import { createTestCollege, createTestUser } from "../../setup/create-test-fixtures.js";

async function grantRole(user, college, overrides = {}) {
  return StaffAssignmentModel.create({
    userId: user._id,
    collegeId: college?._id ?? null,
    role: "administrator",
    assignedByUserId: user._id,
    ...overrides,
  });
}

beforeAll(async () => {
  await setupTestDatabase();
  await StaffAssignmentModel.createIndexes();
  await CollegeModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

describe("listCollegesUserAdministers", () => {
  it("returns the college a user administers", async () => {
    const college = await createTestCollege();
    const user = await createTestUser();
    await grantRole(user, college);

    const colleges = await listCollegesUserAdministers(user._id);

    expect(colleges).toHaveLength(1);
    expect(colleges[0].commonName).toBe("Alliance");
    expect(colleges[0].id).toBe(college._id.toString());
  });

  it("returns an empty list for a user with no assignments", async () => {
    const user = await createTestUser();
    expect(await listCollegesUserAdministers(user._id)).toEqual([]);
  });

  it("sorts the colleges by common name", async () => {
    const user = await createTestUser();
    const zebra = await createTestCollege({ commonName: "Zebra", aisheCode: "C-1" });
    const alpha = await createTestCollege({ commonName: "Alpha", aisheCode: "C-2" });
    await grantRole(user, zebra);
    await grantRole(user, alpha);

    const colleges = await listCollegesUserAdministers(user._id);
    expect(colleges.map((college) => college.commonName)).toEqual(["Alpha", "Zebra"]);
  });

  it("ignores a revoked assignment", async () => {
    const college = await createTestCollege();
    const user = await createTestUser();
    await grantRole(user, college, { status: "revoked" });

    expect(await listCollegesUserAdministers(user._id)).toEqual([]);
  });

  it("ignores a non-administrator assignment", async () => {
    const college = await createTestCollege();
    const user = await createTestUser();
    await grantRole(user, college, {
      role: "coordinator",
      festId: new mongoose.Types.ObjectId(),
    });

    expect(await listCollegesUserAdministers(user._id)).toEqual([]);
  });

  it("ignores another user's assignment", async () => {
    const college = await createTestCollege();
    const owner = await createTestUser({ emailAddress: "owner@example.com" });
    const stranger = await createTestUser({ emailAddress: "stranger@example.com" });
    await grantRole(owner, college);

    expect(await listCollegesUserAdministers(stranger._id)).toEqual([]);
  });

  /* Nothing cascades on delete, so an assignment can outlive its college. */
  it("contributes no college for an assignment that dangles", async () => {
    const college = await createTestCollege();
    const user = await createTestUser();
    await grantRole(user, college);
    await CollegeModel.deleteOne({ _id: college._id });

    expect(await listCollegesUserAdministers(user._id)).toEqual([]);
  });
});

describe("listVerifiedColleges", () => {
  it("returns reference and active colleges, active sorted first, inactive hidden", async () => {
    await createTestCollege({ commonName: "Ref Beta", isVerified: true, status: "reference" });
    await createTestCollege({ commonName: "Active Zulu", isVerified: true, status: "active" });
    await createTestCollege({ commonName: "Ref Alpha", isVerified: true, status: "reference" });
    await createTestCollege({ commonName: "Active Echo", isVerified: true, status: "active" });
    await createTestCollege({ commonName: "Gone", isVerified: true, status: "inactive" });
    await createTestCollege({ commonName: "Unverified", isVerified: false, status: "reference" });

    const colleges = await listVerifiedColleges();

    expect(colleges.map((college) => college.commonName)).toEqual([
      "Active Echo",
      "Active Zulu",
      "Ref Alpha",
      "Ref Beta",
    ]);
    expect(colleges[0].status).toBe("active");
    expect(colleges[2].status).toBe("reference");
  });
});

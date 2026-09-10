import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import userService from "../../../src/services/user-service.js";
import { UserModel } from "../../../src/models/user-model.js";
import { CollegeModel } from "../../../src/models/college-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import { createTestCollege, createTestUser } from "../../setup/create-test-fixtures.js";

const MISSING_ID = "000000000000000000000000";

let verifiedCollege;
let user;

function buildPayload(overrides = {}) {
  return {
    fullName: "Asha Rao",
    collegeId: verifiedCollege.id,
    usn: "1AA22CS001",
    phoneNumber: "9876543210",
    ...overrides,
  };
}

async function expectError(promise, errorCode, statusCode) {
  await expect(promise).rejects.toMatchObject({ errorCode, statusCode });
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([UserModel.createIndexes(), CollegeModel.createIndexes()]);
});

beforeEach(async () => {
  await clearAllCollections();
  verifiedCollege = await createTestCollege({ isVerified: true });
  user = await createTestUser({ emailAddress: "participant@example.com" });
});

afterAll(teardownTestDatabase);

describe("updateUserProfile", () => {
  it("applies the patch and flips isProfileComplete to true", async () => {
    expect(user.isProfileComplete).toBe(false);
    const updated = await userService.updateUserProfile(user._id, buildPayload({ department: "CSE", yearOfStudy: 2 }));

    expect(updated.fullName).toBe("Asha Rao");
    expect(updated.usn).toBe("1AA22CS001");
    expect(updated.department).toBe("CSE");
    expect(updated.yearOfStudy).toBe(2);
    expect(updated.isProfileComplete).toBe(true);
  });

  it("generates the participantId from a first and surname plus the last 4 phone digits", async () => {
    const updated = await userService.updateUserProfile(
      user._id,
      buildPayload({ fullName: "Rahul Kumar", phoneNumber: "9876543210" })
    );

    expect(updated.participantId).toBe("RAHULK3210");
  });

  it("omits the surname initial for a single-word name and ignores non-digit phone characters", async () => {
    const updated = await userService.updateUserProfile(
      user._id,
      buildPayload({ fullName: "Priya", phoneNumber: "+91-8877112233" })
    );

    expect(updated.participantId).toBe("PRIYA2233");
  });

  it("uses whatever digits exist when the phone number is shorter than 4", async () => {
    const updated = await userService.updateUserProfile(
      user._id,
      buildPayload({ fullName: "Amit Singh", phoneNumber: "5542" })
    );

    expect(updated.participantId).toBe("AMITS5542");
  });

  it("rejects a college that is not verified", async () => {
    const unverified = await createTestCollege({ commonName: "Unverified", isVerified: false });
    await expectError(
      userService.updateUserProfile(user._id, buildPayload({ collegeId: unverified.id })),
      "PROFILE_COLLEGE_NOT_FOUND",
      400
    );
  });

  it("rejects a college id that maps to nothing", async () => {
    await expectError(
      userService.updateUserProfile(user._id, buildPayload({ collegeId: MISSING_ID })),
      "PROFILE_COLLEGE_NOT_FOUND",
      400
    );
  });

  it("refuses a blocked account", async () => {
    const blocked = await createTestUser({ emailAddress: "blocked@example.com", isBlocked: true });
    await expectError(userService.updateUserProfile(blocked._id, buildPayload()), "USER_BLOCKED", 403);
  });

  it("404s a user that does not exist", async () => {
    await expectError(userService.updateUserProfile(MISSING_ID, buildPayload()), "USER_NOT_FOUND", 404);
  });
});

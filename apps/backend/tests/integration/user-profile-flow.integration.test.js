import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { application } from "../../src/application.js";
import { UserModel } from "../../src/models/user-model.js";
import { CollegeModel } from "../../src/models/college-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import { createTestCollege, createTestOutsider } from "../setup/create-test-fixtures.js";

const PROFILE_PATH = "/api/v1/users/me";
const COLLEGES_PATH = "/api/v1/colleges";

let verifiedCollege;
let participant;

function asParticipant(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${participant.authenticationToken}`);
}
function buildBody(overrides = {}) {
  return {
    fullName: "Asha Rao",
    collegeId: verifiedCollege.id,
    usn: "1AA22CS001",
    phoneNumber: "9876543210",
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([UserModel.createIndexes(), CollegeModel.createIndexes()]);
});

beforeEach(async () => {
  await clearAllCollections();
  verifiedCollege = await createTestCollege({ isVerified: true });
  participant = await createTestOutsider();
});

afterAll(teardownTestDatabase);

describe("GET /api/v1/colleges", () => {
  it("returns only verified colleges without auth, projected", async () => {
    await createTestCollege({ commonName: "Hidden", isVerified: false });
    const response = await request(application).get(COLLEGES_PATH);

    expect(response.status).toBe(200);
    expect(response.body.data.colleges).toHaveLength(1);
    expect(response.body.data.colleges[0].commonName).toBe("Alliance");
    expect(response.body.data.colleges[0]).toHaveProperty("collegeName");
  });
});

describe("PATCH /api/v1/users/me", () => {
  it("completes the profile and flips isProfileComplete", async () => {
    const before = await UserModel.findById(participant.user._id);
    expect(before.isProfileComplete).toBe(false);

    const response = await asParticipant(request(application).patch(PROFILE_PATH)).send(buildBody());

    expect(response.status).toBe(200);
    expect(response.body.data.isProfileComplete).toBe(true);
    expect(response.body.data.usn).toBe("1AA22CS001");
  });

  it("refuses an unauthenticated caller", async () => {
    const response = await request(application).patch(PROFILE_PATH).send(buildBody());
    expect(response.status).toBe(401);
  });

  it("rejects an unverified college", async () => {
    const unverified = await createTestCollege({ commonName: "Unverified", isVerified: false });
    const response = await asParticipant(request(application).patch(PROFILE_PATH)).send(
      buildBody({ collegeId: unverified.id })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("PROFILE_COLLEGE_NOT_FOUND");
  });

  it("rejects a blocked account", async () => {
    await UserModel.findByIdAndUpdate(participant.user._id, { isBlocked: true });
    const response = await asParticipant(request(application).patch(PROFILE_PATH)).send(buildBody());

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("USER_BLOCKED");
  });

  it("silently drops emergency contact fields an old client still sends — the removed field cannot resurrect", async () => {
    const response = await asParticipant(request(application).patch(PROFILE_PATH)).send(
      buildBody({
        emergencyContactName: "Ghost Contact",
        emergencyContactPhone: "9999999999",
      })
    );

    expect(response.status).toBe(200);
    const stored = await UserModel.collection.findOne({ _id: participant.user._id });
    expect(stored).not.toHaveProperty("emergencyContactName");
    expect(stored).not.toHaveProperty("emergencyContactPhone");
  });

  it("rejects a too-short full name with a field detail", async () => {
    const response = await asParticipant(request(application).patch(PROFILE_PATH)).send(
      buildBody({ fullName: "A" })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.fullName).toBeDefined();
  });
});

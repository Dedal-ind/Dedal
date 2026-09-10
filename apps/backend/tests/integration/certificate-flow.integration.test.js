import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { CertificateModel } from "../../src/models/certificate-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { CollegeModel } from "../../src/models/college-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestEvent,
  createTestParticipant,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let event;
let participant;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    CertificateModel.createIndexes(),
    RegistrationModel.createIndexes(),
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
    CollegeModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user, { status: "completed" });
  participant = await createTestParticipant(college);
  await RegistrationModel.create({
    eventId: event._id,
    userId: participant.user._id,
    status: "confirmed",
    feeAmountSnapshotPaise: 0,
  });
});

afterAll(teardownTestDatabase);

describe("certificate lifecycle over HTTP", () => {
  it("generates, releases, lists, and publicly verifies a certificate", async () => {
    const festCertificatePath = `/api/v1/fests/${fest.id}/certificates`;

    const generateResponse = await withToken(
      request(application).post(`${festCertificatePath}/generate`),
      admin.authenticationToken
    );
    expect(generateResponse.status).toBe(200);
    expect(generateResponse.body.data.generatedCount).toBe(1);

    // Not visible before release.
    const beforeRelease = await withToken(
      request(application).get("/api/v1/certificates/mine"),
      participant.authenticationToken
    );
    expect(beforeRelease.body.data).toHaveLength(0);

    const releaseResponse = await withToken(
      request(application).post(`${festCertificatePath}/release`),
      admin.authenticationToken
    );
    expect(releaseResponse.status).toBe(200);
    expect(releaseResponse.body.data.releasedCount).toBe(1);

    const mineResponse = await withToken(
      request(application).get("/api/v1/certificates/mine"),
      participant.authenticationToken
    );
    expect(mineResponse.status).toBe(200);
    expect(mineResponse.body.data).toHaveLength(1);
    const { verificationCode } = mineResponse.body.data[0];

    // Public verify — deliberately no Authorization header.
    const verifyResponse = await request(application).get(
      `/api/v1/certificates/verify/${verificationCode}`
    );
    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body.data.isValid).toBe(true);
    expect(verifyResponse.body.data.festName).toBe("Alliance ONE 2027");
    expect(verifyResponse.body.data).not.toHaveProperty("userId");
  });

  it("refuses generation to a non-administrator", async () => {
    const response = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/certificates/generate`),
      participant.authenticationToken
    );
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });
});

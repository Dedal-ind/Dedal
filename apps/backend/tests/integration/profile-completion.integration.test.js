import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";

import { application } from "../../src/application.js";
import { UserModel } from "../../src/models/user-model.js";
import { ConsentRecordModel } from "../../src/models/consent-record-model.js";
import consentService from "../../src/services/consent-service.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import { createTestCollege, createTestParticipant } from "../setup/create-test-fixtures.js";

installEmailServiceMock();

/*
 * PROFILE COMPLETION, end to end over HTTP.
 *
 * The payload below is COPIED FROM ProfileCompletionScreen.handleSubmit, field
 * for field, including the two it omits by sending `undefined` (JSON.stringify
 * drops those keys, so the server sees them absent). The point of this file is
 * to answer one question without guessing: does the exact request the live form
 * sends turn isProfileComplete true?
 */

let college;
let participant;
/* The effective version ids the form displays and sends with each tick. */
let termsPolicyVersionId;
let privacyPolicyVersionId;

/* Exactly what the form builds. Nothing added, nothing renamed. */
function formPayload(overrides = {}) {
  return {
    fullName: "Pranav G Kashyap",
    phoneNumber: "9876543210",
    collegeId: String(college._id),
    usn: "1RV21CS001",
    // department / yearOfStudy: the form sends undefined, which JSON drops.
    hasAcceptedTerms: true,
    hasAcceptedPrivacyPolicy: true,
    termsPolicyVersionId,
    privacyPolicyVersionId,
    ...overrides,
  };
}

function patchProfile(body, token) {
  return request(application)
    .patch("/api/v1/users/me")
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

beforeAll(async () => {
  await setupTestDatabase();
  // The registry is seeded by the test bootstrap; these are the ids the form
  // would fetch from the public policy endpoint before rendering.
  termsPolicyVersionId = String((await consentService.getEffectivePolicyVersion("termsOfService"))._id);
  privacyPolicyVersionId = String(
    (await consentService.getEffectivePolicyVersion("privacyPolicy"))._id
  );
});

beforeEach(async () => {
  await clearAllCollections();
  /* The profile endpoint only accepts a VERIFIED college; the default
   * fixture leaves isVerified unset, which the service treats as unverified. */
  college = await createTestCollege({ isVerified: true });
  participant = await createTestParticipant(college);
  /* A NEW user: nothing filled in, exactly as they arrive at the screen. */
  await UserModel.updateOne(
    { _id: participant.user._id },
    {
      $set: { isProfileComplete: false },
      $unset: { usn: "", phoneNumber: "", collegeId: "", participantId: "" },
    }
  );
});

afterAll(teardownTestDatabase);

describe("the payload the live form actually sends", () => {
  it("is accepted and completes the profile", async () => {
    const response = await patchProfile(formPayload(), participant.authenticationToken);

    expect(response.status).toBe(200);
    expect(response.body.data.isProfileComplete).toBe(true);
  });

  it("returns isProfileComplete in the response the frontend feeds to updateUser", async () => {
    const response = await patchProfile(formPayload(), participant.authenticationToken);

    // The screen does updateUser(savedProfile.user ?? savedProfile); apiClient
    // has already unwrapped { data }, so `savedProfile` IS this object.
    const savedProfile = response.body.data;
    expect(savedProfile.user ?? savedProfile).toMatchObject({ isProfileComplete: true });
  });

  it("mints a participantId at completion", async () => {
    const response = await patchProfile(formPayload(), participant.authenticationToken);
    expect(response.body.data.participantId).toBeTruthy();
  });

  it("writes a consent record per document and leaves the deprecated stamps untouched", async () => {
    // The test bootstrap seeded a real, hashed version per kind (see test-database.js).
    await patchProfile(formPayload(), participant.authenticationToken);

    const records = await ConsentRecordModel.find({ userId: participant.user._id }).lean();
    expect(records.map((record) => record.documentKind).sort()).toEqual([
      "privacyPolicy",
      "termsOfService",
    ]);
    expect(records.every((record) => record.action === "accepted")).toBe(true);
    expect(records.every((record) => /^[a-f0-9]{64}$/.test(record.contentHash))).toBe(true);
    expect(records.every((record) => record.source === "profileCompletion")).toBe(true);

    const stored = await UserModel.findById(participant.user._id);
    expect(stored.termsOfServiceConsentedAt).toBeNull();
    expect(stored.privacyPolicyConsentedAt).toBeNull();
  });

  it("persists it — a re-read still says complete", async () => {
    await patchProfile(formPayload(), participant.authenticationToken);
    const stored = await UserModel.findById(participant.user._id);
    expect(stored.isProfileComplete).toBe(true);
  });
});

describe("the optional academic fields the form does not render", () => {
  it("accepts yearOfStudy as a Number, the type the form coerces to", async () => {
    const response = await patchProfile(
      formPayload({ yearOfStudy: 3 }),
      participant.authenticationToken
    );
    expect(response.status).toBe(200);
    expect(response.body.data.yearOfStudy).toBe(3);
  });

  /* The bug this guards against: a select returns a STRING, and if the form
   * ever stopped coercing, the server would refuse the whole request and the
   * user would be stranded on a form that looks correctly filled in. */
  it("REFUSES yearOfStudy as a String — the coercion in the form is load-bearing", async () => {
    const response = await patchProfile(
      formPayload({ yearOfStudy: "3" }),
      participant.authenticationToken
    );
    expect(response.status).toBe(400);
    expect(response.body.error.details.yearOfStudy).toBeTruthy();
  });

  it("completes the profile even with both optional fields absent", async () => {
    const response = await patchProfile(formPayload(), participant.authenticationToken);
    expect(response.body.data.isProfileComplete).toBe(true);
    expect(response.body.data.yearOfStudy).toBeNull();
  });
});

describe("what a stuck user would look like", () => {
  it("refuses a USN under 5 characters, naming the field", async () => {
    const response = await patchProfile(
      formPayload({ usn: "AB1" }),
      participant.authenticationToken
    );
    expect(response.status).toBe(400);
    expect(response.body.error.details.usn).toBeTruthy();
  });

  it("refuses an unverified college, naming the field", async () => {
    const unverified = await createTestCollege({ commonName: "Unverified", isVerified: false });
    const response = await patchProfile(
      formPayload({ collegeId: String(unverified._id) }),
      participant.authenticationToken
    );
    expect(response.status).toBe(400);
  });

  it("leaves isProfileComplete false when a required field is missing", async () => {
    const { usn, ...withoutUsn } = formPayload();
    const response = await patchProfile(withoutUsn, participant.authenticationToken);
    expect(response.status).toBe(400);
    const stored = await UserModel.findById(participant.user._id);
    expect(stored.isProfileComplete).toBe(false);
  });
});

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
  resetPolicyRegistry,
} from "../setup/test-database.js";
import { createTestCollege, createTestParticipant } from "../setup/create-test-fixtures.js";

installEmailServiceMock();

/*
 * THE VERSION ID BESIDE THE TICK, end to end over HTTP.
 *
 * The profile form fetches the effective version of each document, shows it,
 * and sends its id with the tick. The server must record consent against
 * THAT version — and refuse the tick if the version has since been
 * superseded, if it names nothing, or if it names the wrong document.
 */

const TERMS = "termsOfService";
const PRIVACY = "privacyPolicy";

let college;
let participant;
let termsV1;
let privacyV1;

async function publish(kind, label, text) {
  return consentService.publishPolicyVersion({ kind, versionLabel: label, text });
}

function formPayload(overrides = {}) {
  return {
    fullName: "Pranav G Kashyap",
    phoneNumber: "9876543210",
    collegeId: String(college._id),
    usn: "1RV21CS001",
    hasAcceptedTerms: true,
    hasAcceptedPrivacyPolicy: true,
    termsPolicyVersionId: String(termsV1._id),
    privacyPolicyVersionId: String(privacyV1._id),
    ...overrides,
  };
}

function patchProfile(body) {
  return request(application)
    .patch("/api/v1/users/me")
    .set("Authorization", `Bearer ${participant.authenticationToken}`)
    .send(body);
}

async function recordsFor(kind) {
  return ConsentRecordModel.find({ userId: participant.user._id, documentKind: kind }).lean();
}

beforeAll(setupTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  // A registry this suite controls: one known version per kind.
  await resetPolicyRegistry();
  termsV1 = await publish(TERMS, "t1", "Terms, first wording.");
  privacyV1 = await publish(PRIVACY, "p1", "Privacy, first wording.");

  college = await createTestCollege({ isVerified: true });
  participant = await createTestParticipant(college);
  await UserModel.updateOne(
    { _id: participant.user._id },
    {
      $set: { isProfileComplete: false },
      $unset: { usn: "", phoneNumber: "", collegeId: "", participantId: "" },
    }
  );
});

afterAll(teardownTestDatabase);

describe("a matching version id", () => {
  it("records consent normally, against the submitted version and its hash", async () => {
    const response = await patchProfile(formPayload());

    expect(response.status).toBe(200);
    expect(response.body.data.isProfileComplete).toBe(true);

    const [termsRecord] = await recordsFor(TERMS);
    const [privacyRecord] = await recordsFor(PRIVACY);
    expect(String(termsRecord.policyVersionId)).toBe(String(termsV1._id));
    expect(termsRecord.contentHash).toBe(termsV1.contentHash);
    expect(String(privacyRecord.policyVersionId)).toBe(String(privacyV1._id));
    expect(privacyRecord.contentHash).toBe(privacyV1.contentHash);
  });
});

describe("a stale version id", () => {
  it("is refused with POLICY_VERSION_STALE, naming the document, and records nothing", async () => {
    // The form was open on t1; meanwhile new terms went live.
    const termsV2 = await publish(TERMS, "t2", "Terms, second wording.");

    const response = await patchProfile(formPayload());

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("POLICY_VERSION_STALE");
    expect(response.body.error.details).toMatchObject({
      documentKind: TERMS,
      submittedVersionId: String(termsV1._id),
      submittedVersionLabel: "t1",
      effectiveVersionId: String(termsV2._id),
      effectiveVersionLabel: "t2",
    });
    expect(response.body.error.message).toMatch(/termsOfService/);

    // Nothing was silently recorded against t2 — or against anything.
    expect(await recordsFor(TERMS)).toHaveLength(0);
    // The profile save is refused as a whole: the privacy tick was not written either.
    expect(await recordsFor(PRIVACY)).toHaveLength(0);
    expect((await UserModel.findById(participant.user._id)).isProfileComplete).toBe(false);
  });

  it("accepts the same form once it sends the new version's id", async () => {
    const termsV2 = await publish(TERMS, "t2", "Terms, second wording.");

    const response = await patchProfile(formPayload({ termsPolicyVersionId: String(termsV2._id) }));

    expect(response.status).toBe(200);
    const [termsRecord] = await recordsFor(TERMS);
    expect(String(termsRecord.policyVersionId)).toBe(String(termsV2._id));
    expect(termsRecord.contentHash).toBe(termsV2.contentHash);
  });
});

describe("a tick that cannot name its text", () => {
  it("is refused when the tick carries no version id", async () => {
    const response = await patchProfile(formPayload({ termsPolicyVersionId: undefined }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.termsPolicyVersionId).toMatch(/required/);
    expect(await recordsFor(TERMS)).toHaveLength(0);
    expect(await recordsFor(PRIVACY)).toHaveLength(0);
  });

  it("is refused when the version id names nothing", async () => {
    const response = await patchProfile(
      formPayload({ privacyPolicyVersionId: "000000000000000000000000" })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("POLICY_VERSION_NOT_FOUND");
    expect(response.body.error.details).toMatchObject({
      documentKind: PRIVACY,
      submittedVersionId: "000000000000000000000000",
    });
    expect(await recordsFor(PRIVACY)).toHaveLength(0);
  });

  it("is refused when the version id belongs to the other document kind", async () => {
    // The privacy tick names the TERMS version.
    const response = await patchProfile(formPayload({ privacyPolicyVersionId: String(termsV1._id) }));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("POLICY_VERSION_NOT_FOUND");
    expect(response.body.error.details.documentKind).toBe(PRIVACY);
    expect(await recordsFor(PRIVACY)).toHaveLength(0);
  });
});

describe("a version id without its tick", () => {
  it("is ignored rather than refused, even when stale or nonsense-but-well-formed", async () => {
    await publish(PRIVACY, "p2", "Privacy, second wording.");

    // Terms ticked with a good id; privacy NOT ticked but carrying the stale p1 id.
    const response = await patchProfile(formPayload({ hasAcceptedPrivacyPolicy: false }));

    expect(response.status).toBe(200);
    expect(await recordsFor(TERMS)).toHaveLength(1);
    expect(await recordsFor(PRIVACY)).toHaveLength(0);
  });
});

describe("what the record describes", () => {
  it("copies version and hash from the submitted version, not from a re-read at write time", async () => {
    const response = await patchProfile(formPayload());
    expect(response.status).toBe(200);
    const [termsRecord] = await recordsFor(TERMS);

    // Publishing afterwards changes nothing about the record: it names t1
    // and t1's hash, which is what the person saw.
    const termsV2 = await publish(TERMS, "t2", "Terms, second wording.");
    const unchanged = await ConsentRecordModel.findById(termsRecord._id).lean();
    expect(String(unchanged.policyVersionId)).toBe(String(termsV1._id));
    expect(unchanged.contentHash).toBe(termsV1.contentHash);
    expect(unchanged.contentHash).not.toBe(termsV2.contentHash);
    // And the hash really is t1's text.
    expect(consentService.hashPolicyText("Terms, first wording.")).toBe(unchanged.contentHash);
  });
});

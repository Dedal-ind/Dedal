import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import fs from "node:fs";

import { application } from "../../../src/application.js";
import { PolicyDocumentVersionModel } from "../../../src/models/policy-document-version-model.js";
import { ConsentRecordModel } from "../../../src/models/consent-record-model.js";
import consentService from "../../../src/services/consent-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
  resetPolicyRegistry,
  seedPolicyRegistry,
} from "../../setup/test-database.js";
import { createTestUser } from "../../setup/create-test-fixtures.js";

const TERMS = "termsOfService";
const PRIVACY = "privacyPolicy";

beforeAll(async () => {
  await setupTestDatabase();
  await PolicyDocumentVersionModel.createIndexes();
  await ConsentRecordModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  await resetPolicyRegistry();
});

afterAll(teardownTestDatabase);

async function publish(kind, label, text) {
  return consentService.publishPolicyVersion({ kind, versionLabel: label, text });
}

describe("the boot check (assertPolicyRegistryReady)", () => {
  it("refuses boot when a kind has no effective version, naming the kind and the command", async () => {
    await publish(TERMS, "v1", "Terms text.");

    await expect(consentService.assertPolicyRegistryReady()).rejects.toThrow(
      /privacyPolicy: no effective version[\s\S]*publish:policy-version -- --kind privacyPolicy[\s\S]*migrate:consent-records/
    );
  });

  it("refuses boot when the only effective version is a hash-less legacy placeholder", async () => {
    await publish(TERMS, "v1", "Terms text.");
    // A legacy row can never be effective: the model refuses it outright.
    await expect(
      PolicyDocumentVersionModel.create({
        kind: PRIVACY,
        versionLabel: "legacy",
        effectiveAt: new Date(),
        isLegacy: true,
        isEffective: true,
      })
    ).rejects.toThrow(/can never be effective/);
    await expect(consentService.assertPolicyRegistryReady()).rejects.toThrow(
      /privacyPolicy: no effective version/
    );
  });

  it("permits boot when every kind has exactly one effective, hashed version", async () => {
    await publish(TERMS, "v1", "Terms text.");
    await publish(PRIVACY, "v1", "Privacy text.");

    await expect(consentService.assertPolicyRegistryReady()).resolves.toBeUndefined();
  });

  it("the bundled-text seeding satisfies the check from an empty registry", async () => {
    const seeded = await seedPolicyRegistry();
    expect(seeded.map((version) => version.kind).sort()).toEqual([PRIVACY, TERMS]);
    await expect(consentService.assertPolicyRegistryReady()).resolves.toBeUndefined();
    // And is idempotent: a second run publishes nothing.
    expect(await seedPolicyRegistry()).toEqual([]);
  });
});

describe("the recording path with a version missing at runtime", () => {
  it("errors rather than minting anything", async () => {
    const user = await createTestUser();
    await publish(TERMS, "v1", "Terms text.");
    const versionsBefore = await PolicyDocumentVersionModel.countDocuments();

    // Withdrawal reads the effective version directly, so it is the path that
    // meets the runtime "missing" error head-on.
    await expect(
      consentService.recordWithdrawal({ userId: user._id, documentKind: PRIVACY })
    ).rejects.toMatchObject({ statusCode: 500, errorCode: "POLICY_VERSION_MISSING" });

    expect(await PolicyDocumentVersionModel.countDocuments()).toBe(versionsBefore);
    expect(await ConsentRecordModel.countDocuments()).toBe(0);
  });

  it("also refuses to record against a legacy placeholder even if one exists", async () => {
    const user = await createTestUser();

    const legacy = await consentService.ensureLegacyPolicyVersion(PRIVACY);
    await expect(
      consentService.recordAcceptance({
        userId: user._id,
        documentKind: PRIVACY,
        submittedVersionId: String(legacy.version._id),
      })
    ).rejects.toMatchObject({ errorCode: "POLICY_VERSION_MISSING" });
    expect(await ConsentRecordModel.countDocuments()).toBe(0);
  });
});

describe("the public policy reads", () => {
  it("returns the effective version with text and a hash that matches that text", async () => {
    const text = "These are the terms.\r\nWith a Windows line ending.";
    const version = await publish(TERMS, "v1", text);

    const response = await request(application).get(`/api/v1/public/policies/${TERMS}/effective`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: String(version._id),
      kind: TERMS,
      versionLabel: "v1",
      isEffective: true,
      isLegacy: false,
      contentHash: version.contentHash,
    });
    // The served text is the stored (normalised) text, and hashing it back
    // reproduces the stored hash — the server's claim is checkable by anyone.
    expect(response.body.data.text).toBe("These are the terms.\nWith a Windows line ending.");
    expect(consentService.hashPolicyText(response.body.data.text)).toBe(version.contentHash);
  });

  it("keeps a past version readable by id, verbatim, after a newer one takes effect", async () => {
    const v1 = await publish(TERMS, "v1", "Old wording.");
    const v2 = await publish(TERMS, "v2", "New wording.");

    const effective = await request(application).get(`/api/v1/public/policies/${TERMS}/effective`);
    expect(effective.body.data.id).toBe(String(v2._id));

    const past = await request(application).get(`/api/v1/public/policies/versions/${v1._id}`);
    expect(past.status).toBe(200);
    expect(past.body.data).toMatchObject({
      id: String(v1._id),
      versionLabel: "v1",
      isEffective: false,
      text: "Old wording.",
      contentHash: consentService.hashPolicyText("Old wording."),
    });
  });

  it("404s for an unknown kind, a missing effective version, and an unknown id", async () => {
    expect((await request(application).get("/api/v1/public/policies/nonsense/effective")).status).toBe(400);
    expect((await request(application).get(`/api/v1/public/policies/${PRIVACY}/effective`)).status).toBe(404);
    expect(
      (await request(application).get("/api/v1/public/policies/versions/000000000000000000000000")).status
    ).toBe(404);
  });
});

describe("the stored text and its hash", () => {
  it("re-hashing the stored text of every bundled document reproduces its stored hash", async () => {
    await seedPolicyRegistry();
    const versions = await PolicyDocumentVersionModel.find({ isEffective: true }).lean();
    expect(versions).toHaveLength(2);
    for (const version of versions) {
      expect(consentService.hashPolicyText(version.text)).toBe(version.contentHash);
      // And the bundled file on disk is what was published.
      const onDisk = fs.readFileSync(consentService.bundledPolicyPath(version.kind), "utf8");
      expect(consentService.hashPolicyText(onDisk)).toBe(version.contentHash);
    }
  });
});

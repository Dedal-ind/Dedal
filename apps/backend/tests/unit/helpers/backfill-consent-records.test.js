import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { UserModel } from "../../../src/models/user-model.js";
import { PolicyDocumentVersionModel } from "../../../src/models/policy-document-version-model.js";
import { ConsentRecordModel } from "../../../src/models/consent-record-model.js";
import { backfillConsentRecords } from "../../../src/helpers/backfill-consent-records.js";
import consentService from "../../../src/services/consent-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
  resetPolicyRegistry,
} from "../../setup/test-database.js";

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

/* Pre-migration users: the deprecated stamps written straight to the collection. */
async function legacyUser(emailAddress, stamps) {
  const user = await UserModel.create({ emailAddress });
  await UserModel.collection.updateOne({ _id: user._id }, { $set: stamps });
  return user;
}

describe("backfillConsentRecords", () => {
  it("mints legacy versions and one legacy record per stamp, and a second run is a no-op", async () => {
    const both = await legacyUser("both@example.com", {
      termsOfServiceConsentedAt: new Date("2026-03-01T10:00:00Z"),
      privacyPolicyConsentedAt: new Date("2026-03-01T10:00:00Z"),
    });
    const termsOnly = await legacyUser("terms@example.com", {
      termsOfServiceConsentedAt: new Date("2026-02-01T10:00:00Z"),
    });
    await UserModel.create({ emailAddress: "never@example.com" });

    const first = await backfillConsentRecords();

    expect(first).toEqual({
      legacyVersionsCreated: 2,
      usersSeen: 2,
      recordsCreated: 3,
      recordsSkipped: 0,
    });

    const versions = await PolicyDocumentVersionModel.find().lean();
    expect(versions).toHaveLength(2);
    for (const version of versions) {
      expect(version.isLegacy).toBe(true);
      expect(version.contentHash).toBeNull();
      expect(version.text).toBeNull();
      // History only: a hash-less row is never the version new consent is recorded against.
      expect(version.isEffective).toBe(false);
      expect(version.versionLabel).toBe("legacy");
    }
    const termsVersion = versions.find((row) => row.kind === "termsOfService");
    expect(termsVersion.effectiveAt).toEqual(new Date("2026-02-01T10:00:00Z"));

    const termsRecord = await ConsentRecordModel.findOne({
      userId: termsOnly._id,
      documentKind: "termsOfService",
    }).lean();
    expect(termsRecord).toMatchObject({
      action: "accepted",
      source: "legacyBackfill",
      isLegacy: true,
      contentHash: null,
      ipAddress: null,
      userAgent: null,
      consentedAt: new Date("2026-02-01T10:00:00Z"),
    });
    expect(String(termsRecord.policyVersionId)).toBe(String(termsVersion._id));
    expect(await ConsentRecordModel.countDocuments({ userId: both._id })).toBe(2);

    const recordsAfterFirst = await ConsentRecordModel.find().sort({ _id: 1 }).lean();
    const second = await backfillConsentRecords();

    expect(second).toEqual({
      legacyVersionsCreated: 0,
      usersSeen: 2,
      recordsCreated: 0,
      recordsSkipped: 3,
    });
    expect(await ConsentRecordModel.find().sort({ _id: 1 }).lean()).toEqual(recordsAfterFirst);
    expect(await PolicyDocumentVersionModel.countDocuments()).toBe(2);

    // The stamps are left exactly as they were.
    const stored = await UserModel.findById(termsOnly._id).lean();
    expect(stored.termsOfServiceConsentedAt).toEqual(new Date("2026-02-01T10:00:00Z"));
  });

  it("leaves a real effective version in place and points legacy records at the legacy row", async () => {
    const real = await consentService.publishPolicyVersion({
      kind: "termsOfService",
      versionLabel: "v1",
      text: "Real terms.",
    });
    await legacyUser("old@example.com", { termsOfServiceConsentedAt: new Date("2026-01-01") });

    await backfillConsentRecords();

    const legacy = await PolicyDocumentVersionModel.findOne({
      kind: "termsOfService",
      versionLabel: "legacy",
    }).lean();
    expect(legacy.isEffective).toBe(false);
    expect((await consentService.getEffectivePolicyVersion("termsOfService"))._id).toEqual(real._id);
    // The legacy record still points at the legacy version, not the real one.
    const record = await ConsentRecordModel.findOne({ documentKind: "termsOfService" }).lean();
    expect(String(record.policyVersionId)).toBe(String(legacy._id));
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PolicyDocumentVersionModel } from "../../../src/models/policy-document-version-model.js";
import { ConsentRecordModel } from "../../../src/models/consent-record-model.js";
import { AuditLogModel } from "../../../src/models/audit-log-model.js";
import consentService from "../../../src/services/consent-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
  resetPolicyRegistry,
} from "../../setup/test-database.js";
import { createTestUser } from "../../setup/create-test-fixtures.js";

const TERMS = "termsOfService";
const PRIVACY = "privacyPolicy";
const TERMS_TEXT_V1 = "These are the terms.\nBe kind.";
const TERMS_TEXT_V2 = "These are the terms.\nBe kind.\nAlso, be punctual.";
const CONTEXT = { ipAddress: "203.0.113.7", userAgent: "vitest/1.0" };

let user;

beforeAll(async () => {
  await setupTestDatabase();
  await PolicyDocumentVersionModel.createIndexes();
  await ConsentRecordModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  await resetPolicyRegistry();
  user = await createTestUser();
});

afterAll(teardownTestDatabase);

async function publishTerms(label, text) {
  return consentService.publishPolicyVersion({ kind: TERMS, versionLabel: label, text });
}

/* The id the form would display for a kind: its effective version, if any. */
async function effectiveId(kind) {
  const version = await consentService.getEffectivePolicyVersion(kind);
  return version ? String(version._id) : "000000000000000000000000";
}

describe("publishPolicyVersion", () => {
  it("keeps exactly one effective version per kind, superseding the previous one", async () => {
    const first = await publishTerms("v1", TERMS_TEXT_V1);
    const second = await publishTerms("v2", TERMS_TEXT_V2);

    const effective = await PolicyDocumentVersionModel.find({ kind: TERMS, isEffective: true });
    expect(effective.map((row) => String(row._id))).toEqual([String(second._id)]);
    expect((await PolicyDocumentVersionModel.findById(first._id)).isEffective).toBe(false);
    expect(first.contentHash).toBe(consentService.hashPolicyText(TERMS_TEXT_V1));
    expect(second.contentHash).not.toBe(first.contentHash);
  });

  it("hashes identically across line-ending styles and differently for any wording change", () => {
    expect(consentService.hashPolicyText("a\r\nb")).toBe(consentService.hashPolicyText("a\nb"));
    expect(consentService.hashPolicyText("a\nb")).not.toBe(consentService.hashPolicyText("a\nb."));
  });

  it("refuses to edit or delete a version once published", async () => {
    const version = await publishTerms("v1", TERMS_TEXT_V1);
    version.versionLabel = "v1-edited";
    await expect(version.save()).rejects.toThrow(/immutable/);
    await expect(PolicyDocumentVersionModel.deleteOne({ _id: version._id })).rejects.toThrow(
      /never deleted/
    );
    expect(await PolicyDocumentVersionModel.countDocuments()).toBe(1);
  });
});

describe("recordAcceptance", () => {
  it("stamps the effective version, its content hash and the request context, and audits it", async () => {
    const version = await publishTerms("v1", TERMS_TEXT_V1);

    const { record, written } = await consentService.recordAcceptance(
      { userId: user._id, documentKind: TERMS, submittedVersionId: await effectiveId(TERMS) },
      CONTEXT
    );

    expect(written).toBe(true);
    expect(String(record.policyVersionId)).toBe(String(version._id));
    expect(record.contentHash).toBe(consentService.hashPolicyText(TERMS_TEXT_V1));
    expect(record.action).toBe("accepted");
    expect(record.source).toBe("profileCompletion");
    expect(record.ipAddress).toBe(CONTEXT.ipAddress);
    expect(record.userAgent).toBe(CONTEXT.userAgent);

    const audit = await AuditLogModel.findOne({ action: "consent.accepted" }).lean();
    expect(audit).toBeTruthy();
    expect(String(audit.entityId)).toBe(String(record._id));
    expect(audit.afterState.contentHash).toBe(record.contentHash);
  });

  it("does not write a second record when the person already stands on the effective version", async () => {
    await publishTerms("v1", TERMS_TEXT_V1);
    await consentService.recordAcceptance(
      { userId: user._id, documentKind: TERMS, submittedVersionId: await effectiveId(TERMS) },
      CONTEXT
    );
    const again = await consentService.recordAcceptance(
      { userId: user._id, documentKind: TERMS, submittedVersionId: await effectiveId(TERMS) },
      CONTEXT
    );

    expect(again.written).toBe(false);
    expect(await ConsentRecordModel.countDocuments({ userId: user._id })).toBe(1);
  });

  it("errors, minting nothing, when no effective version exists", async () => {
    await expect(
      consentService.recordAcceptance(
        { userId: user._id, documentKind: PRIVACY, submittedVersionId: "000000000000000000000000" },
        CONTEXT
      )
    ).rejects.toMatchObject({ statusCode: 400, errorCode: "POLICY_VERSION_NOT_FOUND" });
    expect(await PolicyDocumentVersionModel.countDocuments()).toBe(0);
    expect(await ConsentRecordModel.countDocuments()).toBe(0);
  });

  it("stores the text with the hash, and the hash is derived from that text", async () => {
    const version = await publishTerms("v1", "Line one.\r\nLine two.");
    expect(version.text).toBe("Line one.\nLine two.");
    expect(consentService.hashPolicyText(version.text)).toBe(version.contentHash);
  });
});

describe("publishing a new version after acceptance", () => {
  it("leaves the old record untouched and marks the person as standing on a superseded version", async () => {
    const v1 = await publishTerms("v1", TERMS_TEXT_V1);
    const { record } = await consentService.recordAcceptance(
      { userId: user._id, documentKind: TERMS, submittedVersionId: await effectiveId(TERMS) },
      CONTEXT
    );
    const before = await ConsentRecordModel.findById(record._id).lean();

    const v2 = await publishTerms("v2", TERMS_TEXT_V2);

    const after = await ConsentRecordModel.findById(record._id).lean();
    expect(after).toEqual(before);
    expect(String(after.policyVersionId)).toBe(String(v1._id));
    expect(after.contentHash).toBe(v1.contentHash);

    const standing = await consentService.getConsentStanding(user._id);
    expect(standing[TERMS]).toMatchObject({
      status: "accepted",
      policyVersionId: String(v1._id),
      versionLabel: "v1",
      contentHash: v1.contentHash,
      effectiveVersionId: String(v2._id),
      isCurrentVersion: false,
    });
    expect(standing[PRIVACY]).toMatchObject({ status: "none", isCurrentVersion: false });

    // Accepting again is a re-prompt record, and standing becomes current.
    const reaccept = await consentService.recordAcceptance(
      { userId: user._id, documentKind: TERMS, submittedVersionId: await effectiveId(TERMS) },
      CONTEXT
    );
    expect(reaccept.written).toBe(true);
    expect(reaccept.record.source).toBe("reprompt");
    expect((await consentService.getConsentStanding(user._id))[TERMS].isCurrentVersion).toBe(true);
  });
});

describe("recordWithdrawal", () => {
  it("appends a withdrawal record rather than mutating the acceptance, and the store refuses mutation", async () => {
    await publishTerms("v1", TERMS_TEXT_V1);
    const { record: acceptance } = await consentService.recordAcceptance(
      { userId: user._id, documentKind: TERMS, submittedVersionId: await effectiveId(TERMS) },
      CONTEXT
    );
    const acceptanceBefore = await ConsentRecordModel.findById(acceptance._id).lean();

    const withdrawal = await consentService.recordWithdrawal(
      { userId: user._id, documentKind: TERMS },
      CONTEXT
    );

    expect(String(withdrawal._id)).not.toBe(String(acceptance._id));
    expect(withdrawal.action).toBe("withdrawn");
    expect(withdrawal.source).toBe("withdrawal");
    expect(await ConsentRecordModel.countDocuments({ userId: user._id, documentKind: TERMS })).toBe(2);
    expect(await ConsentRecordModel.findById(acceptance._id).lean()).toEqual(acceptanceBefore);

    const standing = await consentService.getConsentStanding(user._id);
    expect(standing[TERMS]).toMatchObject({ status: "withdrawn", isCurrentVersion: false });
    expect(await AuditLogModel.countDocuments({ action: "consent.withdrawn" })).toBe(1);

    // APPEND-ONLY, ENFORCED: every route to changing or removing a record is refused.
    const loaded = await ConsentRecordModel.findById(acceptance._id);
    loaded.action = "withdrawn";
    await expect(loaded.save()).rejects.toThrow(/append-only/);
    await expect(
      ConsentRecordModel.updateOne({ _id: acceptance._id }, { $set: { action: "withdrawn" } })
    ).rejects.toThrow(/append-only/);
    await expect(ConsentRecordModel.deleteOne({ _id: acceptance._id })).rejects.toThrow(
      /never deleted/
    );
    await expect(ConsentRecordModel.deleteMany({ userId: user._id })).rejects.toThrow(
      /never deleted/
    );
    expect(await ConsentRecordModel.findById(acceptance._id).lean()).toEqual(acceptanceBefore);
  });
});

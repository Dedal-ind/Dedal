import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { OtpCodeModel } from "../../../src/models/otp-code-model.js";
import { AUTHENTICATION_CONSTANTS } from "../../../src/constants/authentication-constants.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

const FUTURE_DATE = new Date("2099-01-01T00:00:00.000Z");

beforeAll(async () => {
  await setupTestDatabase();
  await OtpCodeModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

describe("OtpCodeModel schema", () => {
  it("requires emailAddress, codeHash and expiresAt", async () => {
    await expect(OtpCodeModel.create({})).rejects.toThrow(/emailAddress|codeHash|expiresAt/);
  });

  it("lowercases and trims the email address", async () => {
    const otpCode = await OtpCodeModel.create({
      emailAddress: "  Person@Example.COM ",
      codeHash: "hash",
      expiresAt: FUTURE_DATE,
    });
    expect(otpCode.emailAddress).toBe("person@example.com");
  });

  it("defaults consumedAt to null and attemptCount to zero", async () => {
    const otpCode = await OtpCodeModel.create({
      emailAddress: "a@example.com",
      codeHash: "hash",
      expiresAt: FUTURE_DATE,
    });
    expect(otpCode.consumedAt).toBe(null);
    expect(otpCode.attemptCount).toBe(0);
  });

  /* The digest must never travel with an ordinary read. */
  it("omits codeHash unless it is explicitly selected", async () => {
    await OtpCodeModel.create({
      emailAddress: "a@example.com",
      codeHash: "secret-hash",
      expiresAt: FUTURE_DATE,
    });

    const withoutHash = await OtpCodeModel.findOne({ emailAddress: "a@example.com" });
    expect(withoutHash.codeHash).toBeUndefined();

    const withHash = await OtpCodeModel.findOne({ emailAddress: "a@example.com" }).select(
      "+codeHash"
    );
    expect(withHash.codeHash).toBe("secret-hash");
  });

  it("allows many outstanding codes for one address", async () => {
    const attributes = { emailAddress: "a@example.com", codeHash: "h", expiresAt: FUTURE_DATE };
    await OtpCodeModel.create(attributes);
    await expect(OtpCodeModel.create(attributes)).resolves.toBeDefined();
  });
});

describe("OtpCodeModel indexes", () => {
  it("declares the lookup index on emailAddress and createdAt", async () => {
    const indexes = await OtpCodeModel.collection.indexes();
    const lookupIndex = indexes.find(
      (index) => index.name === "index_otpCodes_emailAddress_createdAt"
    );

    expect(lookupIndex).toBeDefined();
    expect(lookupIndex.key).toEqual({ emailAddress: 1, createdAt: -1 });
    expect(lookupIndex.unique).toBeUndefined();
  });

  /* The row outlives the code: Mongo removes it long after it stops verifying. */
  it("declares the expiry index as a TTL index with the retention window", async () => {
    const indexes = await OtpCodeModel.collection.indexes();
    const expiryIndex = indexes.find((index) => index.name === "index_otpCodes_expiresAt");

    expect(expiryIndex).toBeDefined();
    expect(expiryIndex.expireAfterSeconds).toBe(AUTHENTICATION_CONSTANTS.OTP_RETENTION_SECONDS);
    expect(expiryIndex.expireAfterSeconds).toBeGreaterThan(
      AUTHENTICATION_CONSTANTS.OTP_EXPIRY_MINUTES * 60
    );
  });
});

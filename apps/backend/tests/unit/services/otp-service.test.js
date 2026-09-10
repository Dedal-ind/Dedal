import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { applicationConfig } from "../../../src/config/application-config.js";
import { OtpCodeModel } from "../../../src/models/otp-code-model.js";
import { AUTHENTICATION_CONSTANTS } from "../../../src/constants/authentication-constants.js";
import { createOtpCode, consumeOtpCode } from "../../../src/services/otp-service.js";
import {
  MAXIMUM_ATTEMPT_COUNT,
  countRecentFailedAttempts,
} from "../../../src/services/otp-attempt-helpers.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

const EMAIL_ADDRESS = "person@example.com";

/*
 * The cooldown blocks a second code within 60 seconds, so back-date the first
 * row. createdAt is immutable on a document, so this writes through the driver.
 */
async function backdateNewestOtpCode(seconds = 120) {
  const newest = await OtpCodeModel.findOne({ emailAddress: EMAIL_ADDRESS })
    .sort({ createdAt: -1 })
    .lean();

  if (!newest) {
    return;
  }

  await OtpCodeModel.collection.updateOne(
    { _id: newest._id },
    { $set: { createdAt: new Date(Date.now() - seconds * 1000) } }
  );
}

beforeAll(async () => {
  await setupTestDatabase();
  await OtpCodeModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

describe("createOtpCode", () => {
  it("returns a zero-padded code of the configured length", async () => {
    const otpCode = await createOtpCode(EMAIL_ADDRESS);

    expect(otpCode).toHaveLength(AUTHENTICATION_CONSTANTS.OTP_CODE_LENGTH);
    expect(otpCode).toMatch(/^\d{6}$/);
  });

  it("persists a bcrypt digest rather than the plaintext code", async () => {
    const otpCode = await createOtpCode(EMAIL_ADDRESS);
    const stored = await OtpCodeModel.findOne({ emailAddress: EMAIL_ADDRESS }).select("+codeHash");

    expect(stored.codeHash).not.toBe(otpCode);
    expect(await bcrypt.compare(otpCode, stored.codeHash)).toBe(true);
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses a second code inside the resend cooldown, naming the retry delay", async () => {
    await createOtpCode(EMAIL_ADDRESS);
    const error = await createOtpCode(EMAIL_ADDRESS).catch((caughtError) => caughtError);

    expect(error.statusCode).toBe(429);
    expect(error.errorCode).toBe("OTP_SEND_RATE_LIMITED");
    expect(error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  /* An older code must never be simultaneously unconsumed and unreachable. */
  it("retires every outstanding code before issuing a new one", async () => {
    await createOtpCode(EMAIL_ADDRESS);
    await backdateNewestOtpCode();
    await createOtpCode(EMAIL_ADDRESS);

    const outstanding = await OtpCodeModel.countDocuments({
      emailAddress: EMAIL_ADDRESS,
      consumedAt: null,
    });
    expect(outstanding).toBe(1);
    expect(await OtpCodeModel.countDocuments({ emailAddress: EMAIL_ADDRESS })).toBe(2);
  });
});

describe("consumeOtpCode", () => {
  it("consumes a correct code exactly once", async () => {
    const otpCode = await createOtpCode(EMAIL_ADDRESS);
    await expect(consumeOtpCode(EMAIL_ADDRESS, otpCode)).resolves.toBeUndefined();

    const stored = await OtpCodeModel.findOne({ emailAddress: EMAIL_ADDRESS });
    expect(stored.consumedAt).toBeInstanceOf(Date);
  });

  it("rejects a replay of an already-consumed code as invalid, not as used", async () => {
    const otpCode = await createOtpCode(EMAIL_ADDRESS);
    await consumeOtpCode(EMAIL_ADDRESS, otpCode);

    const error = await consumeOtpCode(EMAIL_ADDRESS, otpCode).catch((caughtError) => caughtError);
    expect(error.errorCode).toBe("OTP_INVALID");
  });

  /* A never-requested address and a consumed code are indistinguishable to a client. */
  it("rejects a code for an address that never requested one", async () => {
    const error = await consumeOtpCode("nobody@example.com", "123456").catch(
      (caughtError) => caughtError
    );
    expect(error.errorCode).toBe("OTP_INVALID");
    expect(error.statusCode).toBe(400);
  });

  it("rejects an expired code", async () => {
    const otpCode = await createOtpCode(EMAIL_ADDRESS);
    await OtpCodeModel.updateOne(
      { emailAddress: EMAIL_ADDRESS },
      { expiresAt: new Date(Date.now() - 1000) }
    );

    const error = await consumeOtpCode(EMAIL_ADDRESS, otpCode).catch((caughtError) => caughtError);
    expect(error.errorCode).toBe("OTP_EXPIRED");
  });

  it("increments the attempt count on a wrong guess", async () => {
    const otpCode = await createOtpCode(EMAIL_ADDRESS);
    const wrongCode = otpCode === "000000" ? "111111" : "000000";

    await expect(consumeOtpCode(EMAIL_ADDRESS, wrongCode)).rejects.toMatchObject({
      errorCode: "OTP_INVALID",
    });
    const stored = await OtpCodeModel.findOne({ emailAddress: EMAIL_ADDRESS });
    expect(stored.attemptCount).toBe(1);
  });

  it("locks the code out once the attempt cap is reached", async () => {
    const otpCode = await createOtpCode(EMAIL_ADDRESS);
    await OtpCodeModel.updateOne(
      { emailAddress: EMAIL_ADDRESS },
      { attemptCount: AUTHENTICATION_CONSTANTS.OTP_MAXIMUM_VERIFY_ATTEMPTS }
    );

    const error = await consumeOtpCode(EMAIL_ADDRESS, otpCode).catch((caughtError) => caughtError);
    expect(error.errorCode).toBe("OTP_ATTEMPTS_EXCEEDED");
  });

  it("rejects the development master code outside development", async () => {
    await createOtpCode(EMAIL_ADDRESS);
    const error = await consumeOtpCode(
      EMAIL_ADDRESS,
      AUTHENTICATION_CONSTANTS.DEVELOPMENT_MASTER_OTP_CODE
    ).catch((caughtError) => caughtError);

    expect(error.errorCode).toBe("OTP_INVALID");
  });
});

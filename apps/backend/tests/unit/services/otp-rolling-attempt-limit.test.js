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

/* Split from otp-service.test.js to stay within the per-file line budget. */
/*
 * B12: the per-code cap is reset by requesting a new code, so on its own it
 * bounds nothing. These cover the rolling per-address budget that sits on top.
 */
describe("consumeOtpCode rolling attempt limit", () => {
  const MAXIMUM_ROLLING_ATTEMPTS = AUTHENTICATION_CONSTANTS.OTP_ROLLING_MAXIMUM_ATTEMPTS;

  async function spendWrongGuess(otpCode) {
    const wrongCode = otpCode === "999999" ? "888888" : "999999";
    return consumeOtpCode(EMAIL_ADDRESS, wrongCode).catch((caughtError) => caughtError);
  }

  /* Request a fresh code, spend the per-code budget, repeat: the old bypass. */
  async function spendGuesses(totalGuesses) {
    let spent = 0;
    while (spent < totalGuesses) {
      await backdateNewestOtpCode();
      const otpCode = await createOtpCode(EMAIL_ADDRESS);

      for (let guess = 0; guess < MAXIMUM_ATTEMPT_COUNT && spent < totalGuesses; guess += 1) {
        const error = await spendWrongGuess(otpCode);
        if (error.errorCode !== "OTP_INVALID") {
          return error;
        }
        spent += 1;
      }
    }
    return null;
  }

  it("counts failed attempts across every code the address holds", async () => {
    await spendGuesses(MAXIMUM_ROLLING_ATTEMPTS - 1);
    expect(await countRecentFailedAttempts(EMAIL_ADDRESS)).toBe(MAXIMUM_ROLLING_ATTEMPTS - 1);
  });

  it("locks the address out once the rolling budget is spent, despite a fresh code", async () => {
    await spendGuesses(MAXIMUM_ROLLING_ATTEMPTS);

    await backdateNewestOtpCode();
    const freshCode = await createOtpCode(EMAIL_ADDRESS);
    const error = await spendWrongGuess(freshCode);

    expect(error.errorCode).toBe("OTP_ATTEMPT_LIMIT_EXCEEDED");
    expect(error.statusCode).toBe(429);
  });

  /* The refusal must not publish the window length or the remaining budget. */
  it("carries no details that would reveal the rolling budget", async () => {
    await spendGuesses(MAXIMUM_ROLLING_ATTEMPTS);

    await backdateNewestOtpCode();
    const freshCode = await createOtpCode(EMAIL_ADDRESS);
    const error = await spendWrongGuess(freshCode);

    expect(error.details).toBeUndefined();
    expect(error.message).not.toMatch(/\d/);
  });

  it("refuses even the correct code while the address is locked out", async () => {
    await spendGuesses(MAXIMUM_ROLLING_ATTEMPTS);

    await backdateNewestOtpCode();
    const correctCode = await createOtpCode(EMAIL_ADDRESS);

    await expect(consumeOtpCode(EMAIL_ADDRESS, correctCode)).rejects.toMatchObject({
      errorCode: "OTP_ATTEMPT_LIMIT_EXCEEDED",
    });
  });

  it("ignores attempts made outside the rolling window", async () => {
    await spendGuesses(MAXIMUM_ROLLING_ATTEMPTS);

    const windowMinutes = AUTHENTICATION_CONSTANTS.OTP_ROLLING_ATTEMPT_WINDOW_MINUTES;
    await OtpCodeModel.collection.updateMany(
      { emailAddress: EMAIL_ADDRESS },
      { $set: { createdAt: new Date(Date.now() - (windowMinutes + 1) * 60 * 1000) } }
    );

    expect(await countRecentFailedAttempts(EMAIL_ADDRESS)).toBe(0);

    const freshCode = await createOtpCode(EMAIL_ADDRESS);
    await expect(consumeOtpCode(EMAIL_ADDRESS, freshCode)).resolves.toBeUndefined();
  });

  it("does not count another address's failed attempts", async () => {
    await spendGuesses(MAXIMUM_ROLLING_ATTEMPTS);
    expect(await countRecentFailedAttempts("someone-else@example.com")).toBe(0);
  });
});

/*
 * applicationConfig.isDevelopment is derived at boot, but read at call time, so
 * the branch is reachable by flipping the exported singleton. Re-importing the
 * module graph instead would re-register the mongoose models and throw.
 */
describe("consumeOtpCode in development", () => {
  afterEach(() => {
    applicationConfig.isDevelopment = false;
  });

  it("accepts the master code in place of the real one", async () => {
    await createOtpCode(EMAIL_ADDRESS);
    applicationConfig.isDevelopment = true;

    await expect(
      consumeOtpCode(EMAIL_ADDRESS, AUTHENTICATION_CONSTANTS.DEVELOPMENT_MASTER_OTP_CODE)
    ).resolves.toBeUndefined();
  });

  it("still consumes the row, so the master code cannot be replayed", async () => {
    await createOtpCode(EMAIL_ADDRESS);
    applicationConfig.isDevelopment = true;
    const masterCode = AUTHENTICATION_CONSTANTS.DEVELOPMENT_MASTER_OTP_CODE;

    await consumeOtpCode(EMAIL_ADDRESS, masterCode);
    await expect(consumeOtpCode(EMAIL_ADDRESS, masterCode)).rejects.toMatchObject({
      errorCode: "OTP_INVALID",
    });
  });
});

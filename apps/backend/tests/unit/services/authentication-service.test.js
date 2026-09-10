import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import jsonwebtoken from "jsonwebtoken";
import { UserModel } from "../../../src/models/user-model.js";
import { OtpCodeModel } from "../../../src/models/otp-code-model.js";
import { SignInLogModel } from "../../../src/models/sign-in-log-model.js";
import { createOtpCode } from "../../../src/services/otp-service.js";
import {
  installEmailServiceMock,
  getRecordedEmails,
  clearRecordedEmails,
  setOtpDeliveryResult,
} from "../../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

// Seeded into the require cache before authentication-service pulls the real one in.
installEmailServiceMock();
const { requestOtp, verifyOtp } = await import("../../../src/services/authentication-service.js");

const EMAIL_ADDRESS = "person@example.com";

beforeAll(async () => {
  await setupTestDatabase();
  await UserModel.createIndexes();
  await OtpCodeModel.createIndexes();
  await SignInLogModel.createIndexes();
});
beforeEach(async () => {
  await clearAllCollections();
  clearRecordedEmails();
});
afterAll(teardownTestDatabase);

describe("requestOtp", () => {
  it("sends the generated code to the address and reports it as sent", async () => {
    const responseData = await requestOtp(EMAIL_ADDRESS);

    expect(responseData).toEqual({ sent: true });
    expect(getRecordedEmails()).toHaveLength(1);
    expect(getRecordedEmails()[0].emailAddress).toBe(EMAIL_ADDRESS);
    expect(getRecordedEmails()[0].otpCode).toMatch(/^\d{6}$/);
  });

  it("reports sent true with no warning when delivery succeeds", async () => {
    setOtpDeliveryResult(true);
    const responseData = await requestOtp(EMAIL_ADDRESS);

    expect(responseData.sent).toBe(true);
    expect(responseData.warning).toBeUndefined();
  });

  it("reports sent false with the delivery-failed warning when delivery fails", async () => {
    setOtpDeliveryResult(false);
    const responseData = await requestOtp(EMAIL_ADDRESS);

    expect(responseData.sent).toBe(false);
    expect(responseData.warning).toBe("email_delivery_failed");
  });

  /* Any branch on user existence here would turn the endpoint into an account oracle. */
  it("responds identically whether or not the address has a user", async () => {
    await UserModel.create({ emailAddress: "known@example.com" });

    const forKnownAddress = await requestOtp("known@example.com");
    const forUnknownAddress = await requestOtp("unknown@example.com");

    expect(forKnownAddress).toEqual(forUnknownAddress);
  });

  it("creates no user as a side effect of requesting a code", async () => {
    await requestOtp(EMAIL_ADDRESS);
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it("propagates the resend cooldown rather than swallowing it", async () => {
    await requestOtp(EMAIL_ADDRESS);
    await expect(requestOtp(EMAIL_ADDRESS)).rejects.toMatchObject({
      errorCode: "OTP_SEND_RATE_LIMITED",
    });
  });
});

describe("verifyOtp", () => {
  async function requestCodeFor(emailAddress) {
    return createOtpCode(emailAddress);
  }

  it("creates the user on first verification and reports them as new", async () => {
    const otpCode = await requestCodeFor(EMAIL_ADDRESS);
    const result = await verifyOtp(EMAIL_ADDRESS, otpCode);

    expect(result.isNewUser).toBe(true);
    expect(result.user.emailAddress).toBe(EMAIL_ADDRESS);
    expect(await UserModel.countDocuments()).toBe(1);
  });

  it("reuses the existing user on a later verification", async () => {
    await UserModel.create({ emailAddress: EMAIL_ADDRESS });
    const otpCode = await requestCodeFor(EMAIL_ADDRESS);

    const result = await verifyOtp(EMAIL_ADDRESS, otpCode);

    expect(result.isNewUser).toBe(false);
    expect(await UserModel.countDocuments()).toBe(1);
  });

  it("returns a token that carries the user id and address", async () => {
    const otpCode = await requestCodeFor(EMAIL_ADDRESS);
    const result = await verifyOtp(EMAIL_ADDRESS, otpCode);

    const payload = jsonwebtoken.verify(result.authenticationToken, process.env.JWT_SECRET);
    expect(payload.userId).toBe(result.user.id);
    expect(payload.emailAddress).toBe(EMAIL_ADDRESS);
  });

  /* Verifying an OTP proves control of the mailbox; record it once. */
  it("stamps emailVerifiedAt on first verification and leaves it alone after", async () => {
    const firstCode = await requestCodeFor(EMAIL_ADDRESS);
    const firstResult = await verifyOtp(EMAIL_ADDRESS, firstCode);
    expect(firstResult.user.emailVerifiedAt).not.toBe(null);

    await OtpCodeModel.deleteMany({});
    const secondCode = await requestCodeFor(EMAIL_ADDRESS);
    const secondResult = await verifyOtp(EMAIL_ADDRESS, secondCode);

    expect(new Date(secondResult.user.emailVerifiedAt).getTime()).toBe(
      new Date(firstResult.user.emailVerifiedAt).getTime()
    );
  });

  it("records the sign-in with the email OTP method", async () => {
    const otpCode = await requestCodeFor(EMAIL_ADDRESS);
    const result = await verifyOtp(EMAIL_ADDRESS, otpCode);

    const newest = await SignInLogModel.findOne({ userId: result.user.id }).sort({ signedInAt: -1 });
    expect(newest.signInMethod).toBe("emailOtp");
  });

  it("reports an incomplete profile for a freshly created user", async () => {
    const otpCode = await requestCodeFor(EMAIL_ADDRESS);
    const result = await verifyOtp(EMAIL_ADDRESS, otpCode);

    expect(result.user.isProfileComplete).toBe(false);
  });

  it("never returns the internal _id", async () => {
    const otpCode = await requestCodeFor(EMAIL_ADDRESS);
    const result = await verifyOtp(EMAIL_ADDRESS, otpCode);

    expect(result.user._id).toBeUndefined();
    expect(result.user.id).toBeDefined();
  });

  it("rejects a wrong code and creates no user", async () => {
    const otpCode = await requestCodeFor(EMAIL_ADDRESS);
    const wrongCode = otpCode === "111111" ? "222222" : "111111";

    await expect(verifyOtp(EMAIL_ADDRESS, wrongCode)).rejects.toMatchObject({
      errorCode: "OTP_INVALID",
    });
    expect(await UserModel.countDocuments()).toBe(0);
  });
});

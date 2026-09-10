import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { SignInLogModel } from "../../../src/models/sign-in-log-model.js";
import { UserModel } from "../../../src/models/user-model.js";
import signInLogService from "../../../src/services/sign-in-log-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import { createTestUser } from "../../setup/create-test-fixtures.js";

let user;

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([SignInLogModel.createIndexes(), UserModel.createIndexes()]);
});

beforeEach(async () => {
  await clearAllCollections();
  user = await createTestUser({ emailAddress: "signin@example.com" });
});

afterAll(teardownTestDatabase);

describe("recordSignIn", () => {
  it("writes a sign-in log row with the caller's fields", async () => {
    await signInLogService.recordSignIn(user._id, user.emailAddress, "203.0.113.7", "Mozilla/5.0");

    const logs = await SignInLogModel.find({ userId: user._id });
    expect(logs).toHaveLength(1);
    expect(logs[0].emailAddress).toBe("signin@example.com");
    expect(logs[0].ipAddress).toBe("203.0.113.7");
    expect(logs[0].userAgent).toBe("Mozilla/5.0");
    expect(logs[0].signInMethod).toBe("emailOtp");
  });

  it("falls back to a placeholder IP when none is supplied", async () => {
    await signInLogService.recordSignIn(user._id, user.emailAddress, null, null);
    const log = await SignInLogModel.findOne({ userId: user._id });
    expect(log.ipAddress).toBe("unknown");
    expect(log.userAgent).toBeNull();
  });

  it("advances lastSignedInAt and signInCount on every sign-in", async () => {
    await signInLogService.recordSignIn(user._id, user.emailAddress, "203.0.113.7", null);
    await signInLogService.recordSignIn(user._id, user.emailAddress, "203.0.113.8", null);

    const reloaded = await UserModel.findById(user._id);
    expect(reloaded.signInCount).toBe(2);
    expect(reloaded.lastSignedInAt).toBeInstanceOf(Date);
  });

  it("stamps signedUpAt only on the first sign-in", async () => {
    await signInLogService.recordSignIn(user._id, user.emailAddress, "203.0.113.7", null);
    const afterFirst = await UserModel.findById(user._id);
    const firstSignedUpAt = afterFirst.signedUpAt.getTime();

    await signInLogService.recordSignIn(user._id, user.emailAddress, "203.0.113.8", null);
    const afterSecond = await UserModel.findById(user._id);

    expect(afterSecond.signedUpAt.getTime()).toBe(firstSignedUpAt);
  });
});

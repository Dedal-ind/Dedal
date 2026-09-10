import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createRequire } from "node:module";
import { UserModel } from "../../../src/models/user-model.js";
import { SignInLogModel } from "../../../src/models/sign-in-log-model.js";
import { installEmailServiceMock } from "../../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

/*
 * src/ is CommonJS and the auth service destructures verifyGoogleIdToken out of a
 * require() at load time, so — exactly as with the email service — the only way
 * to control it is to seed the require cache before the service graph loads. The
 * mock lets each test set the identity Google "returns" without any network or a
 * real Client ID.
 */
let nextIdentity = null;
let nextError = null;

function installGoogleAuthMock() {
  const nodeRequire = createRequire(import.meta.url);
  const modulePath = nodeRequire.resolve("../../../src/helpers/google-auth-helpers.js");
  nodeRequire.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: {
      async verifyGoogleIdToken() {
        if (nextError) {
          throw nextError;
        }
        return nextIdentity;
      },
      isGoogleSignInConfigured: () => true,
    },
  };
}

installEmailServiceMock();
installGoogleAuthMock();
const { signInWithGoogle } = await import("../../../src/services/authentication-service.js");

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([UserModel.createIndexes(), SignInLogModel.createIndexes()]);
});
beforeEach(async () => {
  await clearAllCollections();
  nextIdentity = null;
  nextError = null;
});
afterAll(teardownTestDatabase);

describe("signInWithGoogle", () => {
  it("creates a new user, prefilling the name Google gives and marking the email verified", async () => {
    nextIdentity = { emailAddress: "new@example.com", fullName: "New Person", googleSubject: "sub-1" };

    const result = await signInWithGoogle("valid-id-token");

    expect(result.isNewUser).toBe(true);
    expect(typeof result.authenticationToken).toBe("string");
    expect(result.user.emailAddress).toBe("new@example.com");
    expect(result.user.fullName).toBe("New Person");

    const stored = await UserModel.findOne({ emailAddress: "new@example.com" });
    expect(stored.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("signs an existing user in without overwriting a name they already set", async () => {
    await UserModel.create({ emailAddress: "known@example.com", fullName: "Chosen Name" });
    nextIdentity = { emailAddress: "known@example.com", fullName: "Google Name", googleSubject: "sub-2" };

    const result = await signInWithGoogle("valid-id-token");

    expect(result.isNewUser).toBe(false);
    expect(result.user.fullName).toBe("Chosen Name");
  });

  it("fills the name only when the account has none yet", async () => {
    await UserModel.create({ emailAddress: "noname@example.com" });
    nextIdentity = { emailAddress: "noname@example.com", fullName: "From Google", googleSubject: "sub-3" };

    const result = await signInWithGoogle("valid-id-token");

    expect(result.user.fullName).toBe("From Google");
  });

  it("records the sign-in with the Google method, not email OTP", async () => {
    nextIdentity = { emailAddress: "logged@example.com", fullName: "Logged In", googleSubject: "sub-log" };

    await signInWithGoogle("valid-id-token");

    const user = await UserModel.findOne({ emailAddress: "logged@example.com" });
    const newest = await SignInLogModel.findOne({ userId: user._id }).sort({ signedInAt: -1 });
    expect(newest.signInMethod).toBe("google");
  });

  it("propagates a verification failure rather than creating a user", async () => {
    nextError = new Error("token invalid");

    await expect(signInWithGoogle("bad-token")).rejects.toThrow("token invalid");
    expect(await UserModel.countDocuments()).toBe(0);
  });
});

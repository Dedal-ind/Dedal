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
 * Account resolution for Google Sign-In: match by googleId, else link to the
 * existing email account, else create. The Google verification is stubbed in the
 * require cache (same technique as authentication-google.test.js) so each test
 * sets the identity Google "returns" with no network or real Client ID.
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

describe("signInWithGoogle — account linking", () => {
  it("creates a new account and stores the Google subject as googleId", async () => {
    nextIdentity = { emailAddress: "fresh@example.com", fullName: "Fresh User", googleSubject: "google-sub-new" };

    const result = await signInWithGoogle("valid-id-token");

    expect(result.isNewUser).toBe(true);
    // The client-facing user object never leaks the googleId...
    expect(result.user.googleId).toBeUndefined();
    // ...but it is persisted on the row.
    const stored = await UserModel.findOne({ emailAddress: "fresh@example.com" });
    expect(stored.googleId).toBe("google-sub-new");
    expect(stored.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("links Google to an existing email-only account, preserving its id and profile data", async () => {
    // An OTP user who already has a participant id, a name, and a completed profile.
    const existing = await UserModel.create({
      emailAddress: "member@example.com",
      fullName: "Long-Time Member",
      participantId: "FESTX0007",
      emailVerifiedAt: new Date("2020-01-01T00:00:00Z"),
    });

    nextIdentity = { emailAddress: "member@example.com", fullName: "Google Display Name", googleSubject: "google-sub-link" };
    const result = await signInWithGoogle("valid-id-token");

    // Same person — not a new account.
    expect(result.isNewUser).toBe(false);
    expect(result.user.id).toBe(String(existing._id));
    expect(result.user.participantId).toBe("FESTX0007");
    // Their chosen name is untouched by the name Google supplied.
    expect(result.user.fullName).toBe("Long-Time Member");

    // Exactly one account exists, now carrying the linked googleId.
    expect(await UserModel.countDocuments({ emailAddress: "member@example.com" })).toBe(1);
    const stored = await UserModel.findById(existing._id);
    expect(stored.googleId).toBe("google-sub-link");
  });

  it("signs an already-linked Google account in by googleId, not by email", async () => {
    const existing = await UserModel.create({
      emailAddress: "original@example.com",
      fullName: "Linked User",
      googleId: "google-sub-stable",
      emailVerifiedAt: new Date(),
    });

    // Token carries the same subject but (hypothetically) a different email: the
    // match is on the stable googleId, so it resolves to the same account and the
    // stored email is left as-is.
    nextIdentity = { emailAddress: "changed@example.com", fullName: "Linked User", googleSubject: "google-sub-stable" };
    const result = await signInWithGoogle("valid-id-token");

    expect(result.isNewUser).toBe(false);
    expect(result.user.id).toBe(String(existing._id));
    expect(result.user.emailAddress).toBe("original@example.com");
    expect(await UserModel.countDocuments()).toBe(1);
  });

  it("signing in twice with the same Google account never creates a duplicate", async () => {
    nextIdentity = { emailAddress: "twice@example.com", fullName: "Twice", googleSubject: "google-sub-twice" };

    const first = await signInWithGoogle("valid-id-token");
    const second = await signInWithGoogle("valid-id-token");

    expect(first.isNewUser).toBe(true);
    expect(second.isNewUser).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(await UserModel.countDocuments()).toBe(1);
  });

  it("stores the Google photo on a new account and refreshes it when Google's changes", async () => {
    nextIdentity = {
      emailAddress: "photo@example.com",
      fullName: "Photo User",
      googleSubject: "google-sub-photo",
      profilePictureUrl: "https://lh3.googleusercontent.com/first=s96-c",
    };
    const created = await signInWithGoogle("valid-id-token");
    expect(created.user.profilePictureUrl).toBe("https://lh3.googleusercontent.com/first=s96-c");

    // They change their Google photo; the next sign-in picks the new one up.
    nextIdentity = { ...nextIdentity, profilePictureUrl: "https://lh3.googleusercontent.com/second=s96-c" };
    await signInWithGoogle("valid-id-token");
    const stored = await UserModel.findOne({ emailAddress: "photo@example.com" });
    expect(stored.profilePictureUrl).toBe("https://lh3.googleusercontent.com/second=s96-c");
  });

  it("gives an existing email-only account the Google photo when it links", async () => {
    const existing = await UserModel.create({ emailAddress: "otp@example.com", fullName: "OTP User" });
    expect(existing.profilePictureUrl).toBeNull();

    nextIdentity = {
      emailAddress: "otp@example.com",
      fullName: "OTP User",
      googleSubject: "google-sub-linkphoto",
      profilePictureUrl: "https://lh3.googleusercontent.com/linked=s96-c",
    };
    await signInWithGoogle("valid-id-token");

    const stored = await UserModel.findById(existing._id);
    expect(stored.profilePictureUrl).toBe("https://lh3.googleusercontent.com/linked=s96-c");
  });

  it("leaves a stored photo alone when the token carries none", async () => {
    const existing = await UserModel.create({
      emailAddress: "nopic@example.com",
      googleId: "google-sub-nopic",
      profilePictureUrl: "https://lh3.googleusercontent.com/kept=s96-c",
    });

    nextIdentity = {
      emailAddress: "nopic@example.com",
      fullName: "No Pic",
      googleSubject: "google-sub-nopic",
      profilePictureUrl: null,
    };
    await signInWithGoogle("valid-id-token");

    const stored = await UserModel.findById(existing._id);
    expect(stored.profilePictureUrl).toBe("https://lh3.googleusercontent.com/kept=s96-c");
  });

  it("propagates an invalid-token error and creates no account", async () => {
    const invalid = new Error("Could not verify this Google sign-in.");
    invalid.statusCode = 401;
    invalid.errorCode = "GOOGLE_TOKEN_INVALID";
    nextError = invalid;

    await expect(signInWithGoogle("bad-token")).rejects.toMatchObject({
      statusCode: 401,
      errorCode: "GOOGLE_TOKEN_INVALID",
    });
    expect(await UserModel.countDocuments()).toBe(0);
  });
});

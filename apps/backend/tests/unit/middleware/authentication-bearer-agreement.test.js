import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { authenticationMiddleware } from "../../../src/middleware/authentication-middleware.js";
import { alreadySignedInMiddleware } from "../../../src/middleware/already-signed-in-middleware.js";
import { UserModel } from "../../../src/models/user-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import { createTestCollege, createTestParticipant } from "../../setup/create-test-fixtures.js";

/*
 * The real regression guard for the extraction: both middlewares parse the
 * Authorization header through the same shared helper, so a header one refuses
 * the other must also refuse (or, here, pass through). A wrong-scheme "Basic"
 * header is not a Bearer credential for either — the authentication middleware
 * treats it as missing (401), the already-signed-in guard treats it as no
 * credential and passes through. (Lowercase "bearer" is now well-formed per
 * RFC 6750, so it can no longer serve as the malformed example.)
 */
function run(middleware, authorizationHeader) {
  const request = { headers: { authorization: authorizationHeader } };
  const next = vi.fn();
  middleware(request, {}, next);
  return { request, next };
}

describe("the two auth middlewares agree on a malformed Bearer header", () => {
  it("treats a wrong-scheme 'Basic' header the same on both sides", () => {
    const header = "Basic some-token-value";

    const auth = run(authenticationMiddleware, header);
    expect(auth.next).toHaveBeenCalledTimes(1);
    const authError = auth.next.mock.calls[0][0];
    expect(authError).toBeInstanceOf(Error);
    expect(authError.statusCode).toBe(401);
    expect(authError.errorCode).toBe("AUTHENTICATION_TOKEN_MISSING");
    expect(auth.request.authenticatedUser).toBeUndefined();

    const guard = run(alreadySignedInMiddleware, header);
    expect(guard.next).toHaveBeenCalledTimes(1);
    // Passed through with no argument — a bad credential is no credential here.
    expect(guard.next.mock.calls[0][0]).toBeUndefined();
  });
});

/*
 * A blocked account must be inert everywhere the moment moderation flips the
 * flag, so the middleware now reloads the user each request rather than trusting
 * the token. These lock that in — cases two and three return 200 under the old
 * token-is-the-assertion middleware.
 */
describe("authenticationMiddleware rechecks the live user on every request", () => {
  async function callWith(authenticationToken) {
    const request = { headers: { authorization: `Bearer ${authenticationToken}` } };
    const next = vi.fn();
    await authenticationMiddleware(request, {}, next);
    return { request, next };
  }

  beforeAll(async () => {
    await setupTestDatabase();
    await UserModel.createIndexes();
  });
  beforeEach(clearAllCollections);
  afterAll(teardownTestDatabase);

  it("lets a normal user through with the current DB emailAddress attached", async () => {
    const college = await createTestCollege();
    const participant = await createTestParticipant(college);
    // The DB email moves after the token was minted; the request must read the DB, not the token.
    await UserModel.updateOne({ _id: participant.user._id }, { emailAddress: "changed@example.com" });

    const { request, next } = await callWith(participant.authenticationToken);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeUndefined();
    expect(request.authenticatedUser.userId).toBe(participant.user.id);
    expect(request.authenticatedUser.emailAddress).toBe("changed@example.com");
  });

  it("refuses a user blocked after the token was minted with 403 USER_BLOCKED", async () => {
    const college = await createTestCollege();
    const participant = await createTestParticipant(college);
    await UserModel.updateOne({ _id: participant.user._id }, { isBlocked: true });

    const { request, next } = await callWith(participant.authenticationToken);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(403);
    expect(error.errorCode).toBe("USER_BLOCKED");
    // The handler is never reached: next got an error, not a clean pass-through.
    expect(request.authenticatedUser).toBeUndefined();
  });

  it("refuses a deleted user with a still-valid token with 401 USER_NOT_FOUND", async () => {
    const college = await createTestCollege();
    const participant = await createTestParticipant(college);
    await UserModel.deleteOne({ _id: participant.user._id });

    const { request, next } = await callWith(participant.authenticationToken);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(401);
    expect(error.errorCode).toBe("USER_NOT_FOUND");
    expect(request.authenticatedUser).toBeUndefined();
  });
});

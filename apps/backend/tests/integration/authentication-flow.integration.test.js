import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { UserModel } from "../../src/models/user-model.js";
import { OtpCodeModel } from "../../src/models/otp-code-model.js";
import { createAuthenticationToken } from "../../src/helpers/token-helpers.js";
import {
  installEmailServiceMock,
  clearRecordedEmails,
  findLatestOtpCodeFor,
} from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";

// The mock must be in the require cache before application.js pulls the real one in.
installEmailServiceMock();
const { application } = await import("../../src/application.js");

const REQUEST_OTP_PATH = "/api/v1/authentication/request-otp";
const VERIFY_OTP_PATH = "/api/v1/authentication/verify-otp";

/*
 * The per-IP limiter allows five requests per window and the per-email cooldown
 * blocks a second code for sixty seconds, so each test presents a fresh address
 * and a fresh client address. TRUST_PROXY_HOPS is 1 under test, which is what
 * makes X-Forwarded-For the key the limiter counts.
 */
let clientCounter = 0;
function nextClient() {
  clientCounter += 1;
  return {
    emailAddress: `person${clientCounter}@example.com`,
    clientIp: `203.0.113.${clientCounter}`,
  };
}

function postRequestOtp(clientIp, body) {
  return request(application)
    .post(REQUEST_OTP_PATH)
    .set("X-Forwarded-For", clientIp)
    .send(body);
}

beforeAll(async () => {
  await setupTestDatabase();
  await UserModel.createIndexes();
  await OtpCodeModel.createIndexes();
});
beforeEach(async () => {
  await clearAllCollections();
  clearRecordedEmails();
});
afterAll(teardownTestDatabase);

describe("POST /api/v1/authentication/request-otp", () => {
  it("accepts a valid address and sends a code", async () => {
    const { emailAddress, clientIp } = nextClient();
    const response = await postRequestOtp(clientIp, { emailAddress });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ sent: true });
    expect(findLatestOtpCodeFor(emailAddress)).toMatch(/^\d{6}$/);
  });

  it("rejects a malformed address with a validation error", async () => {
    const response = await postRequestOtp(nextClient().clientIp, {
      emailAddress: "not-an-email",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.field).toBe("emailAddress");
  });

  it("rejects a missing address", async () => {
    const response = await postRequestOtp(nextClient().clientIp, {});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a second code for the same address inside the cooldown", async () => {
    const { emailAddress, clientIp } = nextClient();
    await postRequestOtp(clientIp, { emailAddress });

    const response = await postRequestOtp(clientIp, { emailAddress });

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("OTP_SEND_RATE_LIMITED");
    expect(response.headers["retry-after"]).toBeDefined();
  });
});

describe("POST /api/v1/authentication/verify-otp", () => {
  async function requestCodeFor(emailAddress, clientIp) {
    const response = await postRequestOtp(clientIp, { emailAddress });
    expect(response.status).toBe(200);
    return findLatestOtpCodeFor(emailAddress);
  }

  it("issues a token and creates the user on the happy path", async () => {
    const { emailAddress, clientIp } = nextClient();
    const code = await requestCodeFor(emailAddress, clientIp);

    const response = await request(application).post(VERIFY_OTP_PATH).send({ emailAddress, code });

    expect(response.status).toBe(200);
    expect(response.body.data.authenticationToken).toEqual(expect.any(String));
    expect(response.body.data.isNewUser).toBe(true);
    expect(response.body.data.user.emailAddress).toBe(emailAddress);
    expect(response.body.data.user._id).toBeUndefined();
  });

  it("rejects a wrong code without creating a user", async () => {
    const { emailAddress, clientIp } = nextClient();
    const code = await requestCodeFor(emailAddress, clientIp);
    const wrongCode = code === "111111" ? "222222" : "111111";

    const response = await request(application)
      .post(VERIFY_OTP_PATH)
      .send({ emailAddress, code: wrongCode });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("OTP_INVALID");
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it("rejects a code of the wrong shape before it reaches the database", async () => {
    const response = await request(application)
      .post(VERIFY_OTP_PATH)
      .send({ emailAddress: nextClient().emailAddress, code: "12ab34" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.field).toBe("code");
  });

  it("refuses to replay a consumed code", async () => {
    const { emailAddress, clientIp } = nextClient();
    const code = await requestCodeFor(emailAddress, clientIp);
    await request(application).post(VERIFY_OTP_PATH).send({ emailAddress, code });

    const response = await request(application).post(VERIFY_OTP_PATH).send({ emailAddress, code });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("OTP_INVALID");
  });
});

describe("already-signed-in guard on auth entry points", () => {
  async function tokenForNewUser(emailAddress) {
    const user = await UserModel.create({ emailAddress });
    return createAuthenticationToken(user);
  }

  it("lets request-OTP through when no Authorization header is present", async () => {
    const { emailAddress, clientIp } = nextClient();
    const response = await postRequestOtp(clientIp, { emailAddress });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ sent: true });
  });

  it("refuses request-OTP with 400 when a valid Bearer token is presented", async () => {
    const { emailAddress, clientIp } = nextClient();
    const token = await tokenForNewUser("holder@example.com");

    const response = await postRequestOtp(clientIp, { emailAddress }).set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("USER_ALREADY_SIGNED_IN");
  });

  it("refuses verify-OTP with 400 before any OTP work runs, leaving the code unconsumed", async () => {
    const { emailAddress, clientIp } = nextClient();
    const response = await postRequestOtp(clientIp, { emailAddress });
    expect(response.status).toBe(200);
    const code = findLatestOtpCodeFor(emailAddress);
    const before = await OtpCodeModel.findOne({ emailAddress });

    const token = await tokenForNewUser("holder2@example.com");
    const guarded = await request(application)
      .post(VERIFY_OTP_PATH)
      .set("Authorization", `Bearer ${token}`)
      .send({ emailAddress, code });

    expect(guarded.status).toBe(400);
    expect(guarded.body.error.code).toBe("USER_ALREADY_SIGNED_IN");

    // The row survives untouched: guard runs ahead of the handler, so no consume.
    const after = await OtpCodeModel.findOne({ emailAddress });
    expect(after).not.toBeNull();
    expect(after.attemptCount).toBe(before.attemptCount);
  });

  it("lets request-OTP through when the Bearer token is malformed or expired", async () => {
    const { emailAddress, clientIp } = nextClient();

    const response = await postRequestOtp(clientIp, { emailAddress }).set(
      "Authorization",
      "Bearer not.a.valid.token"
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ sent: true });
  });
});

describe("unknown routes", () => {
  it("returns the standard envelope for a route that does not exist", async () => {
    const response = await request(application).get("/api/v1/nope");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { UserModel } from "../../src/models/user-model.js";
import { OtpCodeModel } from "../../src/models/otp-code-model.js";
import { AUTHENTICATION_CONSTANTS } from "../../src/constants/authentication-constants.js";
import { installEmailServiceMock, clearRecordedEmails } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const REQUEST_OTP_PATH = "/api/v1/authentication/request-otp";
const VERIFY_OTP_PATH = "/api/v1/authentication/verify-otp";

/*
 * The express-rate-limit per-IP OTP request limiter was removed
 * (STEP-D12-HOTFIX-RATE-LIMIT); its per-IP request-burst tests went with it.
 * What remains here is the rolling per-address attempt budget, which is a
 * separate service-level (email-keyed) control that was NOT removed.
 *
 * TRUST_PROXY_HOPS is 1 under test, so X-Forwarded-For sets request.ip.
 */
function postRequestOtp(clientIp, emailAddress) {
  return request(application)
    .post(REQUEST_OTP_PATH)
    .set("X-Forwarded-For", clientIp)
    .send({ emailAddress });
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

/*
 * The rolling per-address budget must refuse without publishing how long the
 * window is or how much budget was left.
 */
describe("rolling OTP attempt limit over HTTP", () => {
  const ROLLING_MAXIMUM = 10;

  async function backdateCodesFor(emailAddress) {
    await OtpCodeModel.collection.updateMany(
      { emailAddress },
      { $set: { createdAt: new Date(Date.now() - 120 * 1000) } }
    );
  }

  async function spendRollingBudget(emailAddress, clientIp) {
    let spent = 0;
    while (spent < ROLLING_MAXIMUM) {
      await backdateCodesFor(emailAddress);
      await postRequestOtp(clientIp, emailAddress);

      for (let guess = 0; guess < 5 && spent < ROLLING_MAXIMUM; guess += 1) {
        await request(application).post(VERIFY_OTP_PATH).send({ emailAddress, code: "999999" });
        spent += 1;
      }
    }
  }

  it("returns 429 with no details once the address has spent its budget", async () => {
    const emailAddress = "rolling@example.com";
    const clientIp = "198.51.100.20";
    await spendRollingBudget(emailAddress, clientIp);

    // A fresh code, so the per-code cap cannot answer first with its own 400.
    await backdateCodesFor(emailAddress);
    await postRequestOtp(clientIp, emailAddress);

    const response = await request(application)
      .post(VERIFY_OTP_PATH)
      .send({ emailAddress, code: "999999" });

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("OTP_ATTEMPT_LIMIT_EXCEEDED");
    expect(response.body.error.details).toBeUndefined();
    expect(response.body.error.message).not.toMatch(/\d/);
    expect(response.headers["retry-after"]).toBeUndefined();
  });
});

/*
 * Per-IP send throttle. One IP must not spray codes at unlimited distinct
 * addresses; the counter is the OTP collection grouped by IP.
 */
describe("per-IP OTP send limit over HTTP", () => {
  // Read from the constants rather than restated here: the ceilings are sized
  // for shared NAT and are expected to be retuned, and a hardcoded copy would
  // fail the suite every time they are.
  const IP_ROLLING_MAXIMUM = AUTHENTICATION_CONSTANTS.OTP_IP_ROLLING_MAXIMUM_SENDS;
  const IP_BURST_MAXIMUM = AUTHENTICATION_CONSTANTS.OTP_IP_BURST_MAXIMUM_SENDS;

  // Push an IP's existing rows out of the burst window but keep them inside the
  // hourly rolling window, so the rolling ceiling can be reached without the
  // burst ceiling answering first.
  async function agePastBurstWindow(clientIp) {
    await OtpCodeModel.collection.updateMany(
      { ipAddress: clientIp },
      { $set: { createdAt: new Date(Date.now() - 120 * 1000) } }
    );
  }

  it("returns 429 once one IP passes the hourly rolling ceiling", async () => {
    const clientIp = "198.51.100.30";
    for (let sent = 0; sent < IP_ROLLING_MAXIMUM; sent += 1) {
      const response = await postRequestOtp(clientIp, `rolling-ip-${sent}@example.com`);
      expect(response.status).toBe(200);
      await agePastBurstWindow(clientIp);
    }

    const overflow = await postRequestOtp(clientIp, "rolling-ip-overflow@example.com");
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe("OTP_SEND_RATE_LIMITED");
  });

  it("returns 429 once one IP passes the burst ceiling inside the burst window", async () => {
    const clientIp = "198.51.100.31";
    for (let sent = 0; sent < IP_BURST_MAXIMUM; sent += 1) {
      const response = await postRequestOtp(clientIp, `burst-ip-${sent}@example.com`);
      expect(response.status).toBe(200);
    }

    const overflow = await postRequestOtp(clientIp, "burst-ip-overflow@example.com");
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe("OTP_SEND_RATE_LIMITED");
  });

  it("counts per IP, not globally: two IPs each under the ceiling both succeed", async () => {
    const firstIp = "198.51.100.40";
    const secondIp = "198.51.100.41";

    for (let sent = 0; sent < IP_BURST_MAXIMUM - 1; sent += 1) {
      expect((await postRequestOtp(firstIp, `first-${sent}@example.com`)).status).toBe(200);
      expect((await postRequestOtp(secondIp, `second-${sent}@example.com`)).status).toBe(200);
    }
  });
});

/*
 * Per-address send ceiling. This is the control that survives shared NAT: the
 * per-IP buckets above are sized so a whole campus can sign in from one public
 * address, which leaves this as the bound on how many codes one inbox can be
 * sent. Keyed on the address, so the requesting IP is irrelevant to it.
 */
describe("per-address OTP send limit over HTTP", () => {
  const ADDRESS_MAXIMUM = AUTHENTICATION_CONSTANTS.OTP_ADDRESS_ROLLING_MAXIMUM_SENDS;

  // The 60-second resend cooldown would answer long before the hourly ceiling,
  // so each accepted row is aged past it while staying inside the hour.
  async function agePastResendCooldown(emailAddress) {
    await OtpCodeModel.collection.updateMany(
      { emailAddress },
      { $set: { createdAt: new Date(Date.now() - 120 * 1000) } }
    );
  }

  it("returns 429 once one address passes its hourly ceiling", async () => {
    const emailAddress = "address-ceiling@example.com";

    for (let sent = 0; sent < ADDRESS_MAXIMUM; sent += 1) {
      // A different IP each time, proving the ceiling is not the per-IP bucket.
      const response = await postRequestOtp(`198.51.100.${100 + sent}`, emailAddress);
      expect(response.status).toBe(200);
      await agePastResendCooldown(emailAddress);
    }

    const overflow = await postRequestOtp("198.51.100.200", emailAddress);
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe("OTP_SEND_RATE_LIMITED");
    // No retryAfterSeconds: it would publish the rolling window length.
    expect(overflow.body.error.details).toBeUndefined();
  });

  it("counts per address, not globally: a second address is unaffected", async () => {
    const exhausted = "exhausted@example.com";
    for (let sent = 0; sent < ADDRESS_MAXIMUM; sent += 1) {
      expect((await postRequestOtp("198.51.100.210", exhausted)).status).toBe(200);
      await agePastResendCooldown(exhausted);
    }
    expect((await postRequestOtp("198.51.100.210", exhausted)).status).toBe(429);

    // Same IP, different inbox: still accepted.
    expect((await postRequestOtp("198.51.100.210", "fresh@example.com")).status).toBe(200);
  });
});

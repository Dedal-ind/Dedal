/*
 * Sections B and C: the public rate limiter and client error reporting.
 *
 * The limiter is exercised through real HTTP against the mounted app rather
 * than by unit-testing the middleware config — the thing that breaks in
 * practice is the MOUNT (a route added outside the namespace, or the limiter
 * placed after the router), and only a real request finds that.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { ClientErrorLogModel } from "../../src/models/client-error-log-model.js";
import {
  MESSAGE_MAXIMUM_LENGTH,
  RETENTION_SECONDS,
} from "../../src/models/client-error-log-model.js";
import {
  PUBLIC_MAXIMUM_REQUESTS_PER_WINDOW,
  CLIENT_ERROR_MAXIMUM_REPORTS_PER_WINDOW,
} from "../../src/middleware/public-rate-limiter-middleware.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import { installRazorpayClientMock } from "../setup/test-razorpay-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
});

describe("(B) the public rate limiter", () => {
  /*
   * Each test uses a distinct source IP. express-rate-limit keys on the client
   * address and its store persists for the whole process, so a shared IP would
   * leak one test's budget into the next.
   */
  function publicRequest(path, sourceIp) {
    return request(application).get(path).set("X-Forwarded-For", sourceIp);
  }

  it(`allows ${PUBLIC_MAXIMUM_REQUESTS_PER_WINDOW} requests then answers 429 with Retry-After`, async () => {
    const sourceIp = "203.0.113.10";

    // Burn the whole budget. The responses themselves are not under test here —
    // only that none of them is a 429.
    for (let index = 0; index < PUBLIC_MAXIMUM_REQUESTS_PER_WINDOW; index += 1) {
      const allowed = await publicRequest("/api/v1/public/fests", sourceIp);
      expect(allowed.status).not.toBe(429);
    }

    const refused = await publicRequest("/api/v1/public/fests", sourceIp);
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe("RATE_LIMITED");
    // The client needs to know how long to wait, not just that it failed.
    expect(refused.headers["retry-after"]).toBeDefined();
  });

  it("counts per IP, so one caller cannot exhaust another's budget", async () => {
    const noisyIp = "203.0.113.20";
    for (let index = 0; index < PUBLIC_MAXIMUM_REQUESTS_PER_WINDOW + 1; index += 1) {
      await publicRequest("/api/v1/public/fests", noisyIp);
    }
    expect((await publicRequest("/api/v1/public/fests", noisyIp)).status).toBe(429);

    // A different address is unaffected.
    const quietIp = "203.0.113.21";
    expect((await publicRequest("/api/v1/public/fests", quietIp)).status).not.toBe(429);
  });

  it("covers the whole /public namespace, not just one router", async () => {
    const sourceIp = "203.0.113.30";
    for (let index = 0; index < PUBLIC_MAXIMUM_REQUESTS_PER_WINDOW + 1; index += 1) {
      await publicRequest("/api/v1/public/promotions", sourceIp);
    }
    const refused = await publicRequest("/api/v1/public/promotions", sourceIp);
    expect(refused.status).toBe(429);
  });

  it("leaves authenticated routes alone", async () => {
    const sourceIp = "203.0.113.40";
    for (let index = 0; index < PUBLIC_MAXIMUM_REQUESTS_PER_WINDOW + 1; index += 1) {
      await publicRequest("/api/v1/public/fests", sourceIp);
    }
    expect((await publicRequest("/api/v1/public/fests", sourceIp)).status).toBe(429);

    /*
     * The same IP on an authenticated route: still 401 (no token), NOT 429.
     * If the limiter had been mounted globally this would be a 429 and the
     * whole console would go down with one noisy visitor.
     */
    const authenticated = await request(application)
      .get("/api/v1/registrations/mine")
      .set("X-Forwarded-For", sourceIp);
    expect(authenticated.status).toBe(401);
  });
});

describe("(C) client error reporting", () => {
  function reportError(body, sourceIp = "198.51.100.10") {
    return request(application)
      .post("/api/v1/errors/client")
      .set("X-Forwarded-For", sourceIp)
      .send(body);
  }

  it("stores a report from an UNAUTHENTICATED caller", async () => {
    const accepted = await reportError({
      message: "Cannot read properties of undefined (reading 'map')",
      stack: "at ScannerScreen (index-abc123.js:1:2345)",
      url: "https://dedal.in/backstage/scanner",
      userAgent: "Mozilla/5.0 (Linux; Android 10)",
      timestamp: new Date().toISOString(),
    });
    expect(accepted.status).toBe(202);

    const [stored] = await ClientErrorLogModel.find({}).lean();
    expect(stored.message).toContain("Cannot read properties of undefined");
    expect(stored.url).toBe("https://dedal.in/backstage/scanner");
    // No token was sent, so there is nobody to attribute it to.
    expect(stored.userId).toBeNull();
  });

  it("truncates an oversized message instead of rejecting the report", async () => {
    await reportError({ message: "x".repeat(MESSAGE_MAXIMUM_LENGTH + 500) });
    const [stored] = await ClientErrorLogModel.find({}).lean();
    expect(stored.message).toHaveLength(MESSAGE_MAXIMUM_LENGTH);
  });

  it("answers 202 and stores nothing when there is no usable message", async () => {
    const accepted = await reportError({ stack: "no message at all" });
    // Still 202: the client is already broken and can do nothing with a failure.
    expect(accepted.status).toBe(202);
    expect(await ClientErrorLogModel.countDocuments({})).toBe(0);
  });

  it(`caps a crash loop at ${CLIENT_ERROR_MAXIMUM_REPORTS_PER_WINDOW} reports per minute`, async () => {
    const loopingIp = "198.51.100.50";
    for (let index = 0; index < CLIENT_ERROR_MAXIMUM_REPORTS_PER_WINDOW; index += 1) {
      const accepted = await reportError({ message: `crash ${index}` }, loopingIp);
      expect(accepted.status).toBe(202);
    }
    const refused = await reportError({ message: "one too many" }, loopingIp);
    expect(refused.status).toBe(429);

    // The collection holds only what the limiter let through.
    expect(await ClientErrorLogModel.countDocuments({})).toBe(
      CLIENT_ERROR_MAXIMUM_REPORTS_PER_WINDOW
    );
  });

  it("expires its rows after 30 days", async () => {
    expect(RETENTION_SECONDS).toBe(30 * 24 * 60 * 60);
    const indexes = await ClientErrorLogModel.collection.indexes();
    const ttlIndex = indexes.find((index) => index.name === "index_clientErrorLogs_createdAt_ttl");
    expect(ttlIndex).toBeDefined();
    expect(ttlIndex.expireAfterSeconds).toBe(RETENTION_SECONDS);
  });
});

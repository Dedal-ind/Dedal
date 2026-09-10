import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import request from "supertest";
import { installEmailServiceMock } from "../../setup/test-email-service.js";
import { setupTestDatabase, teardownTestDatabase } from "../../setup/test-database.js";

installEmailServiceMock();
const { application } = await import("../../../src/application.js");
const { applicationConfig } = await import("../../../src/config/application-config.js");

const CONFIG_PATH = "/api/v1/authentication/google/config";
const originalGoogleClientId = applicationConfig.googleClientId;

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);
afterEach(() => {
  applicationConfig.googleClientId = originalGoogleClientId;
});

describe("GET /api/v1/authentication/google/config", () => {
  it("returns the configured client id with no authentication and never a secret", async () => {
    applicationConfig.googleClientId = "test-client-id.apps.googleusercontent.com";

    // Deliberately no Authorization header: the sign-in screen has no session.
    const response = await request(application).get(CONFIG_PATH);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ clientId: "test-client-id.apps.googleusercontent.com" });
    // The whole payload is exactly one public field — nothing secret rides along.
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/secret/i);
    expect(Object.keys(response.body.data)).toEqual(["clientId"]);
  });

  it("returns clientId null — not an error — when GOOGLE_CLIENT_ID is unset", async () => {
    applicationConfig.googleClientId = null;

    const response = await request(application).get(CONFIG_PATH);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ clientId: null });
  });
});

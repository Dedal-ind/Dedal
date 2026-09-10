/*
 * The event category stopped being an enum and became free text.
 *
 * The old model carried `enum: [...Object.values(EVENT_CATEGORIES), null]`, which
 * meant a college running "Robotics" or "Culinary Arts" could not save the event
 * at all — the category had to be one of ten words chosen in advance. These tests
 * pin the three things that had to stay true through that change: any category
 * saves, every category written under the old enum still works, and the length
 * cap is the only thing that can reject.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { EventModel } from "../../src/models/event-model.js";
import { EVENT_CATEGORY_MAX_LENGTH } from "../../src/constants/event-constants.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import { installRazorpayClientMock } from "../setup/test-razorpay-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestEvent,
  buildEventAttributes,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

function createEventThroughApi(overrides) {
  return withToken(
    request(application).post(`/api/v1/fests/${fest.id}/events`),
    admin.authenticationToken
  ).send({ ...buildEventAttributes(), ...overrides });
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
});

describe("free-text event category", () => {
  it("saves and reads back a category that is not on the suggestion list", async () => {
    const response = await createEventThroughApi({ category: "Fintech Summit" });

    expect(response.status).toBe(201);
    expect(response.body.data.category).toBe("Fintech Summit");

    // Round-trips through Mongo unchanged — not lowercased, not coerced.
    const storedEvent = await EventModel.findById(response.body.data.id).lean();
    expect(storedEvent.category).toBe("Fintech Summit");
  });

  it("still accepts the legacy lowercase enum values written before the change", async () => {
    const response = await createEventThroughApi({ category: "technical" });

    expect(response.status).toBe(201);
    expect(response.body.data.category).toBe("technical");
  });

  it(`rejects a category longer than ${EVENT_CATEGORY_MAX_LENGTH} characters`, async () => {
    const overlongCategory = "a".repeat(EVENT_CATEGORY_MAX_LENGTH + 1);
    const response = await createEventThroughApi({ category: overlongCategory });

    expect(response.status).toBe(400);
    expect(response.body.error.details.category).toMatch(/at most/);
  });

  it(`accepts a category of exactly ${EVENT_CATEGORY_MAX_LENGTH} characters`, async () => {
    const response = await createEventThroughApi({
      category: "a".repeat(EVENT_CATEGORY_MAX_LENGTH),
    });

    expect(response.status).toBe(201);
  });

  it("collapses internal whitespace runs so one category cannot become two", async () => {
    const response = await createEventThroughApi({ category: "  Culinary   Arts  " });

    expect(response.status).toBe(201);
    expect(response.body.data.category).toBe("Culinary Arts");
  });

  it("treats an empty-string category as null — a container event has none", async () => {
    const response = await createEventThroughApi({ category: "   " });

    expect(response.status).toBe(201);
    expect(response.body.data.category).toBeNull();
  });
});

describe("public browse filter over free-text categories", () => {
  /*
   * The filter has to bridge a genuine mismatch: a quick-filter chip sends the
   * lowercase suggestion value ("robotics"), while an organiser who typed the
   * category stored it as typed ("Robotics"). Before free text both sides were
   * always lowercase and an exact match sufficed.
   */
  it("matches a typed category case-insensitively from a lowercase chip value", async () => {
    await createTestEvent(fest, admin.user, { category: "Robotics", status: "published" });

    const response = await request(application).get("/api/v1/public/fests?category=robotics");

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].festName).toBe(fest.festName);
  });

  it("returns no fests for a category no event uses, rather than erroring", async () => {
    await createTestEvent(fest, admin.user, { category: "Robotics", status: "published" });

    const response = await request(application).get("/api/v1/public/fests?category=Underwater%20Basketry");

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(0);
  });

  it("ignores a blank category instead of filtering everything out", async () => {
    await createTestEvent(fest, admin.user, { category: "Robotics", status: "published" });

    const response = await request(application).get("/api/v1/public/fests?category=%20");

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
  });

  it("does not let regex metacharacters in the category act as a pattern", async () => {
    await createTestEvent(fest, admin.user, { category: "Robotics", status: "published" });

    // Unescaped, ".*" would match every category and return the fest.
    const response = await request(application).get("/api/v1/public/fests?category=.*");

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(0);
  });
});

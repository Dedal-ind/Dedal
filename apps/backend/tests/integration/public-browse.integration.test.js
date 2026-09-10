import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { application } from "../../src/application.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
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
} from "../setup/create-test-fixtures.js";

const PUBLIC_PATH = "/api/v1/public/fests";
const MISSING_ID = "000000000000000000000000";

let college;
let admin;
let publishedFest;

beforeAll(async () => {
  await setupTestDatabase();
  await FestModel.createIndexes();
  await EventModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  publishedFest = await createTestFest(college, admin.user, { status: "published" });
});

afterAll(teardownTestDatabase);

describe("GET /api/v1/public/fests", () => {
  it("returns published fests and hides draft and archived, without auth", async () => {
    await createTestFest(college, admin.user, { festSlug: "d", festName: "Draft One" });
    await createTestFest(college, admin.user, {
      festSlug: "a",
      festName: "Archived One",
      status: "archived",
    });

    const response = await request(application).get(PUBLIC_PATH);

    expect(response.status).toBe(200);
    const names = response.body.data.map((fest) => fest.festName);
    expect(names).toContain("Alliance ONE 2027");
    expect(names).not.toContain("Draft One");
    expect(names).not.toContain("Archived One");
  });

  it("populates the host college name and never leaks contactPhone", async () => {
    const response = await request(application).get(PUBLIC_PATH);

    expect(response.body.data[0].hostCollegeId.commonName).toBe("Alliance");
    expect(response.body.data[0].contactPhone).toBeUndefined();
  });
});

describe("GET /api/v1/public/fests/:festId", () => {
  it("returns 200 for a published fest, without auth", async () => {
    const response = await request(application).get(`${PUBLIC_PATH}/${publishedFest.id}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(publishedFest.id);
    expect(response.body.data.contactPhone).toBeUndefined();
  });

  it("returns 404 for a draft fest", async () => {
    const draft = await createTestFest(college, admin.user, { festSlug: "draft-detail" });
    const response = await request(application).get(`${PUBLIC_PATH}/${draft.id}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("FEST_NOT_FOUND");
  });

  it("returns 404 for an archived fest", async () => {
    const archived = await createTestFest(college, admin.user, {
      festSlug: "arch-detail",
      status: "archived",
    });
    const response = await request(application).get(`${PUBLIC_PATH}/${archived.id}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("FEST_NOT_FOUND");
  });
});

describe("slug-based public lookup for shareable QR links", () => {
  let slugFest;

  beforeEach(async () => {
    slugFest = await createTestFest(college, admin.user, {
      festSlug: "alliance-one-2026",
      festName: "Alliance ONE 2026",
      status: "published",
    });
  });

  it("resolves a published fest by slug and includes a shareableUrl", async () => {
    const response = await request(application).get(`${PUBLIC_PATH}/alliance-one-2026`);

    expect(response.status).toBe(200);
    expect(response.body.data.festSlug).toBe("alliance-one-2026");
    expect(response.body.data.shareableUrl).toEqual(expect.any(String));
    expect(response.body.data.shareableUrl).toContain("/fests/alliance-one-2026");
  });

  it("resolves a published event by fest slug + event slug with a shareableUrl", async () => {
    await createTestEvent(slugFest, admin.user, {
      eventSlug: "codesangram",
      eventName: "CodeSangram",
      status: "published",
    });

    const response = await request(application).get(
      `${PUBLIC_PATH}/alliance-one-2026/events/codesangram`
    );

    expect(response.status).toBe(200);
    expect(response.body.data.eventSlug).toBe("codesangram");
    expect(response.body.data.shareableUrl).toContain(
      "/fests/alliance-one-2026/events/codesangram"
    );
  });

  it("returns 404 FEST_NOT_FOUND for an unknown fest slug", async () => {
    const response = await request(application).get(`${PUBLIC_PATH}/nonexistent-slug`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("FEST_NOT_FOUND");
  });

  it("does not advertise a shareableUrl for a sub-event (has parentEventId)", async () => {
    const parent = await createTestEvent(slugFest, admin.user, {
      eventSlug: "arena",
      eventName: "AstraArena",
      status: "published",
    });
    await createTestEvent(slugFest, admin.user, {
      eventSlug: "valorant",
      eventName: "Valorant",
      status: "published",
      parentEventId: parent._id,
    });

    const response = await request(application).get(
      `${PUBLIC_PATH}/alliance-one-2026/events/valorant`
    );

    expect(response.status).toBe(200);
    expect(response.body.data.eventSlug).toBe("valorant");
    expect(response.body.data.shareableUrl).toBeUndefined();
  });
});

describe("GET /api/v1/public/fests/:festId/events", () => {
  it("returns publicly visible events and excludes drafts, without auth", async () => {
    await createTestEvent(publishedFest, admin.user, {
      eventSlug: "published-event",
      eventName: "Published Event",
      status: "published",
    });
    await createTestEvent(publishedFest, admin.user, {
      eventSlug: "draft-event",
      eventName: "Draft Event",
      status: "draft",
    });

    const response = await request(application).get(`${PUBLIC_PATH}/${publishedFest.id}/events`);

    expect(response.status).toBe(200);
    const names = response.body.data.map((event) => event.eventName);
    expect(names).toContain("Published Event");
    expect(names).not.toContain("Draft Event");
  });

  it("returns 404 for a non-public fest's events", async () => {
    const draft = await createTestFest(college, admin.user, { festSlug: "draft-events" });
    const response = await request(application).get(`${PUBLIC_PATH}/${draft.id}/events`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("FEST_NOT_FOUND");
  });

  it("returns 404 for a missing fest's events", async () => {
    const response = await request(application).get(`${PUBLIC_PATH}/${MISSING_ID}/events`);
    expect(response.status).toBe(404);
  });
});

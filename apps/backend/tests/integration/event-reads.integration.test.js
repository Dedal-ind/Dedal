import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { application } from "../../src/application.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { UserModel } from "../../src/models/user-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestOutsider,
  createTestFest,
  createTestEvent,
} from "../setup/create-test-fixtures.js";

const MISSING_ID = "000000000000000000000000";

let college;
let admin;
let outsider;
let fest;
let eventsPath;

function asAdmin(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${admin.authenticationToken}`);
}

function asOutsider(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${outsider.authenticationToken}`);
}

function buildEventBody(overrides = {}) {
  return {
    eventName: "Robowars 2027",
    description: "Robotics combat, single elimination.",
    category: "technical",
    eventType: "team",
    minimumTeamSize: 2,
    maximumTeamSize: 4,
    scoringFormat: "bracketSingleElimination",
    venue: "Robotics Lab",
    registrationOpensAt: "2027-01-01T00:00:00.000Z",
    registrationClosesAt: "2027-02-01T00:00:00.000Z",
    startsAt: "2027-03-01T10:00:00.000Z",
    endsAt: "2027-03-01T18:00:00.000Z",
    capacity: 32,
    feeType: "perTeam",
    feeAmountPaise: 50000,
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  await EventModel.createIndexes();
  await FestModel.createIndexes();
  await StaffAssignmentModel.createIndexes();
  await UserModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  outsider = await createTestOutsider();
  fest = await createTestFest(college, admin.user, { status: "published" });
  eventsPath = `/api/v1/fests/${fest.id}/events`;
});

afterAll(teardownTestDatabase);

/* Split from event-crud.integration.test.js to stay within the per-file line budget. */
describe("GET /api/v1/fests/:festId/events", () => {
  it("is public and hides events that are not published", async () => {
    await createTestEvent(fest, admin.user, { status: "draft", eventSlug: "draft-event" });
    await createTestEvent(fest, admin.user, {
      status: "published",
      eventSlug: "published-event",
    });

    const response = await request(application).get(eventsPath);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].eventSlug).toBe("published-event");
  });

  it("returns a 404 envelope for a fest that does not exist", async () => {
    const response = await request(application).get(`/api/v1/fests/${MISSING_ID}/events`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("FEST_NOT_FOUND");
  });
});

describe("GET /api/v1/fests/:festId/events/all", () => {
  it("returns every status for an administrator", async () => {
    await createTestEvent(fest, admin.user, { status: "draft", eventSlug: "a" });
    await createTestEvent(fest, admin.user, { status: "cancelled", eventSlug: "b" });

    const response = await asAdmin(request(application).get(`${eventsPath}/all`));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
  });

  it("refuses a caller who is not an administrator", async () => {
    const response = await asOutsider(request(application).get(`${eventsPath}/all`));
    expect(response.status).toBe(403);
  });

  /* "all" is declared before "/:eventId", or it would be read as an event id. */
  it("is not shadowed by the event detail route", async () => {
    const response = await asAdmin(request(application).get(`${eventsPath}/all`));
    expect(response.body.data).toEqual([]);
  });
});

describe("GET /api/v1/fests/:festId/events/:eventId", () => {
  it("returns the event for an administrator", async () => {
    const event = await createTestEvent(fest, admin.user);
    const response = await asAdmin(request(application).get(`${eventsPath}/${event.id}`));

    expect(response.status).toBe(200);
    expect(response.body.data.eventName).toBe("Robowars 2027");
  });

  it("refuses a caller who is not an administrator", async () => {
    const event = await createTestEvent(fest, admin.user);
    const response = await asOutsider(request(application).get(`${eventsPath}/${event.id}`));

    expect(response.status).toBe(403);
  });

  it("returns a 404 envelope for a missing event", async () => {
    const response = await asAdmin(request(application).get(`${eventsPath}/${MISSING_ID}`));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
  });

  it("hides an event that belongs to another fest", async () => {
    const otherFest = await createTestFest(college, admin.user, { festSlug: "other-fest" });
    const event = await createTestEvent(otherFest, admin.user);

    const response = await asAdmin(request(application).get(`${eventsPath}/${event.id}`));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
  });
});

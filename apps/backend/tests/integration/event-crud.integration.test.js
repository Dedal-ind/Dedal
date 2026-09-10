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

describe("POST /api/v1/fests/:festId/events", () => {
  it("creates a draft event for an administrator", async () => {
    const response = await asAdmin(request(application).post(eventsPath)).send(buildEventBody());

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe("draft");
    expect(response.body.data.eventSlug).toBe("robowars-2027");
    expect(response.body.data.registeredCount).toBe(0);
  });

  it("refuses an unauthenticated caller", async () => {
    const response = await request(application).post(eventsPath).send(buildEventBody());

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_TOKEN_MISSING");
  });

  it("refuses a caller who does not administer the fest's college", async () => {
    const response = await asOutsider(request(application).post(eventsPath)).send(buildEventBody());

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("rejects a payload missing required fields", async () => {
    const response = await asAdmin(request(application).post(eventsPath)).send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.eventName).toBe("is required");
  });

  /* The model's four invariants must surface as a 400 with the offending field. */
  it("rejects a solo event whose team sizes are above one", async () => {
    const response = await asAdmin(request(application).post(eventsPath)).send(
      buildEventBody({ eventType: "solo", minimumTeamSize: 3, maximumTeamSize: 3 })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
    expect(response.body.error.details.minimumTeamSize).toMatch(/solo event/);
  });

  it("rejects registration that closes after the event starts", async () => {
    const response = await asAdmin(request(application).post(eventsPath)).send(
      buildEventBody({ registrationClosesAt: "2027-06-01T00:00:00.000Z" })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details.registrationClosesAt).toMatch(/close before the event/);
  });

  it("ignores client-supplied status, slug and registeredCount", async () => {
    const response = await asAdmin(request(application).post(eventsPath)).send(
      buildEventBody({ status: "published", eventSlug: "hacked", registeredCount: 999 })
    );

    expect(response.body.data.status).toBe("draft");
    expect(response.body.data.eventSlug).toBe("robowars-2027");
    expect(response.body.data.registeredCount).toBe(0);
  });

  it("refuses to add an event to an archived fest", async () => {
    const archivedFest = await createTestFest(college, admin.user, {
      festSlug: "archived-fest",
      status: "archived",
    });

    const response = await asAdmin(
      request(application).post(`/api/v1/fests/${archivedFest.id}/events`)
    ).send(buildEventBody());

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_FEST_STATE");
  });
});

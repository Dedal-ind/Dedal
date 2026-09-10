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
describe("PATCH and event status transitions", () => {
  it("updates only the fields sent", async () => {
    const event = await createTestEvent(fest, admin.user);
    const response = await asAdmin(request(application).patch(`${eventsPath}/${event.id}`)).send({
      venue: "Hall B",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.venue).toBe("Hall B");
    expect(response.body.data.eventName).toBe("Robowars 2027");
  });

  it("publishes a draft event and then cancels it", async () => {
    const event = await createTestEvent(fest, admin.user);

    const published = await asAdmin(request(application).post(`${eventsPath}/${event.id}/publish`));
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe("published");

    const cancelled = await asAdmin(request(application).post(`${eventsPath}/${event.id}/cancel`));
    expect(cancelled.body.data.status).toBe("cancelled");
  });

  it("reports a second cancel with its own error code", async () => {
    const event = await createTestEvent(fest, admin.user, { status: "cancelled" });
    const response = await asAdmin(request(application).post(`${eventsPath}/${event.id}/cancel`));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("EVENT_ALREADY_CANCELLED");
  });

  it("refuses to edit a cancelled event", async () => {
    const event = await createTestEvent(fest, admin.user, { status: "cancelled" });
    const response = await asAdmin(request(application).patch(`${eventsPath}/${event.id}`)).send({
      venue: "Hall B",
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_EVENT_STATE");
  });

  it("refuses to publish an event inside a draft fest", async () => {
    const draftFest = await createTestFest(college, admin.user, { festSlug: "draft-fest" });
    const event = await createTestEvent(draftFest, admin.user);

    const response = await asAdmin(
      request(application).post(`/api/v1/fests/${draftFest.id}/events/${event.id}/publish`)
    );

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("INVALID_FEST_STATE");
    expect(response.body.error.details.currentFestStatus).toBe("draft");
  });

  it("refuses every write from a caller who is not an administrator", async () => {
    const event = await createTestEvent(fest, admin.user);

    for (const path of [`${eventsPath}/${event.id}/publish`, `${eventsPath}/${event.id}/cancel`]) {
      const response = await asOutsider(request(application).post(path));
      expect(response.status).toBe(403);
    }
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
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
  createTestParticipant,
  createTestStaffMember,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let firstEvent;
let secondEvent;

function dashboardPath() {
  return `/api/v1/fests/${fest.id}/dashboard`;
}

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
    RegistrationModel.createIndexes(),
    UserModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  firstEvent = await createTestEvent(fest, admin.user, { eventSlug: "first" });
  secondEvent = await createTestEvent(fest, admin.user, { eventSlug: "second" });
});

afterAll(teardownTestDatabase);

describe("GET /api/v1/fests/:festId/dashboard", () => {
  it("returns the whole-fest dashboard for an administrator", async () => {
    const response = await withToken(
      request(application).get(dashboardPath()),
      admin.authenticationToken
    );

    expect(response.status).toBe(200);
    expect(response.body.data.fest.festName).toBe("Alliance ONE 2027");
    expect(response.body.data.events).toHaveLength(2);
    expect(response.body.data.totals).toHaveProperty("currentHeadcount");
    expect(response.body.data).toHaveProperty("staffOnDuty");
    expect(Array.isArray(response.body.data.recentScans)).toBe(true);
  });

  it("scopes a coordinator to their assigned events", async () => {
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      assignment: { eventIds: [firstEvent._id] },
    });

    const response = await withToken(
      request(application).get(dashboardPath()),
      coordinator.authenticationToken
    );

    expect(response.status).toBe(200);
    expect(response.body.data.events).toHaveLength(1);
    expect(response.body.data.events[0].eventId).toBe(String(firstEvent._id));
  });

  /*
   * An assignment naming no event covers the whole fest — the same rule
   * assignmentCoversEvent applies everywhere else. Reading eventIds straight off
   * the assignment used to hand the service an empty array, and an empty $in
   * matches nothing, so the coordinator with the widest remit saw the least.
   */
  it("shows a fest-wide coordinator every event, not none", async () => {
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      assignment: { eventIds: [] },
    });

    const response = await withToken(
      request(application).get(dashboardPath()),
      coordinator.authenticationToken
    );

    expect(response.status).toBe(200);
    expect(response.body.data.events).toHaveLength(2);
  });

  it("refuses a participant with no assignment", async () => {
    const participant = await createTestParticipant(college);

    const response = await withToken(
      request(application).get(dashboardPath()),
      participant.authenticationToken
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });
});

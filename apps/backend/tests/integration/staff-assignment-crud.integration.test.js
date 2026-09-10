import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { createAuthenticationToken } from "../../src/helpers/token-helpers.js";
import { installEmailServiceMock, clearRecordedEmails } from "../setup/test-email-service.js";
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

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const MINE_PATH = "/api/v1/staff-assignments/mine";
const MISSING_ID = "000000000000000000000000";
const INVITEE_EMAIL = "coordinator@example.com";

let college;
let admin;
let outsider;
let fest;
let staffPath;

function asAdmin(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${admin.authenticationToken}`);
}
function asOutsider(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${outsider.authenticationToken}`);
}
function buildBody(overrides = {}) {
  return { emailAddress: INVITEE_EMAIL, role: "coordinator", ...overrides };
}

beforeAll(async () => {
  await setupTestDatabase();
  await StaffAssignmentModel.createIndexes();
  await UserModel.createIndexes();
  await EventModel.createIndexes();
  await FestModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  clearRecordedEmails();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  outsider = await createTestOutsider();
  fest = await createTestFest(college, admin.user, { status: "published" });
  staffPath = `/api/v1/fests/${fest.id}/staff-assignments`;
});

afterAll(teardownTestDatabase);

describe("POST /api/v1/fests/:festId/staff-assignments", () => {
  it("creates the assignment and returns it in the envelope", async () => {
    const response = await asAdmin(request(application).post(staffPath)).send(buildBody());

    expect(response.status).toBe(201);
    expect(response.body.data.role).toBe("coordinator");
    expect(response.body.data.status).toBe("active");
    expect(response.body.data._id).toBeUndefined();
    // Populated on insert so the client renders the new card without a refetch.
    expect(response.body.data.userId.emailAddress).toBe(INVITEE_EMAIL);
  });

  it("refuses an unauthenticated caller", async () => {
    const response = await request(application).post(staffPath).send(buildBody());

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTHENTICATION_TOKEN_MISSING");
  });

  it("refuses a caller who does not administer the fest's college", async () => {
    const response = await asOutsider(request(application).post(staffPath)).send(buildBody());

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("rejects a missing or malformed email address", async () => {
    const missing = await asAdmin(request(application).post(staffPath)).send({
      role: "coordinator",
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.emailAddress).toBe("is required");

    const malformed = await asAdmin(request(application).post(staffPath)).send(
      buildBody({ emailAddress: "not-an-email" })
    );
    expect(malformed.body.error.details.emailAddress).toBe("must be a valid email address");
  });

  /* Administrator is not an invitable role: it is granted at the college level. */
  it("rejects a role outside coordinator and volunteer", async () => {
    const response = await asAdmin(request(application).post(staffPath)).send(
      buildBody({ role: "administrator" })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details.role).toContain("coordinator, volunteer");
  });

  it("rejects an eventIds entry that is not an ObjectId", async () => {
    const response = await asAdmin(request(application).post(staffPath)).send(
      buildBody({ eventIds: ["nope"] })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.details.eventIds).toContain("every entry");
  });

  it("refuses to assign the administrator to their own fest", async () => {
    const response = await asAdmin(request(application).post(staffPath)).send(
      buildBody({ emailAddress: admin.user.emailAddress })
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CANNOT_ASSIGN_SELF");
  });

  it("reports a duplicate active grant as a conflict, naming the blocking row", async () => {
    const existing = await asAdmin(request(application).post(staffPath)).send(buildBody());
    const response = await asAdmin(request(application).post(staffPath)).send(buildBody());

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ASSIGNMENT_ALREADY_EXISTS");
    expect(response.body.error.details.existingAssignmentId).toBe(existing.body.data.id);
  });

  /* A revoked row is history: it must not block the same person being re-invited. */
  it("re-invites a revoked member over HTTP without a conflict", async () => {
    const first = await asAdmin(request(application).post(staffPath)).send(buildBody());
    await asAdmin(
      request(application).post(`${staffPath}/${first.body.data.id}/revoke`)
    ).send({ reason: "Left the college" });

    const second = await asAdmin(request(application).post(staffPath)).send(buildBody());

    expect(second.status).toBe(201);
    expect(second.body.data.status).toBe("active");
    expect(second.body.data.id).not.toBe(first.body.data.id);

    const team = await asAdmin(request(application).get(staffPath));
    expect(team.body.data).toHaveLength(2);
    expect(team.body.data.map((assignment) => assignment.status)).toEqual(["active", "revoked"]);
  });

  it("scopes the assignment to named events and derives the window", async () => {
    const event = await createTestEvent(fest, admin.user, {
      startsAt: new Date("2027-03-02T10:00:00.000Z"),
      endsAt: new Date("2027-03-02T18:00:00.000Z"),
    });

    const response = await asAdmin(request(application).post(staffPath)).send(
      buildBody({ eventIds: [event.id] })
    );

    expect(response.status).toBe(201);
    // eventIds is populated to summaries so the UI can name the events.
    expect(response.body.data.eventIds).toHaveLength(1);
    expect(response.body.data.eventIds[0].id).toBe(event.id);
    expect(response.body.data.eventIds[0].eventName).toBe(event.eventName);
    // Coordinator window: opens two days ahead, closes when the event does.
    expect(response.body.data.validFrom).toBe("2027-02-28T10:00:00.000Z");
    expect(response.body.data.validTo).toBe("2027-03-02T18:00:00.000Z");
  });

  it("reports an event from another fest as missing", async () => {
    const otherFest = await createTestFest(college, admin.user, { festSlug: "other-fest" });
    const foreignEvent = await createTestEvent(otherFest, admin.user);

    const response = await asAdmin(request(application).post(staffPath)).send(
      buildBody({ eventIds: [foreignEvent.id] })
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
  });
});

describe("GET /api/v1/fests/:festId/staff-assignments", () => {
  it("lists the fest's team", async () => {
    await asAdmin(request(application).post(staffPath)).send(buildBody());

    const response = await asAdmin(request(application).get(staffPath));

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].role).toBe("coordinator");
    // The invitee is populated by name so the team list can show it without a lookup.
    expect(response.body.data[0].userId.emailAddress).toBe(INVITEE_EMAIL);
    expect(response.body.data[0].userId).toHaveProperty("isProfileComplete");
  });

  it("refuses a caller who is not an administrator", async () => {
    expect((await asOutsider(request(application).get(staffPath))).status).toBe(403);
  });
});

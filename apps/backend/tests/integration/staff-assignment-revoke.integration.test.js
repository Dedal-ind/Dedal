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

/* Split from staff-assignment-crud.integration.test.js to stay within the per-file line budget. */
describe("POST /api/v1/fests/:festId/staff-assignments/:assignmentId/revoke", () => {
  async function createAssignment() {
    const response = await asAdmin(request(application).post(staffPath)).send(buildBody());
    return response.body.data;
  }

  it("revokes the assignment and records the reason", async () => {
    const assignment = await createAssignment();

    const response = await asAdmin(
      request(application).post(`${staffPath}/${assignment.id}/revoke`)
    ).send({ reason: "Left the college" });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("revoked");
    expect(response.body.data.revocationReason).toBe("Left the college");
  });

  it("is idempotent", async () => {
    const assignment = await createAssignment();
    await asAdmin(request(application).post(`${staffPath}/${assignment.id}/revoke`)).send({});

    const response = await asAdmin(
      request(application).post(`${staffPath}/${assignment.id}/revoke`)
    ).send({});

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("revoked");
  });

  it("returns a 404 envelope for an assignment that does not exist", async () => {
    const response = await asAdmin(
      request(application).post(`${staffPath}/${MISSING_ID}/revoke`)
    ).send({});

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ASSIGNMENT_NOT_FOUND");
  });

  it("rejects a non-string reason", async () => {
    const assignment = await createAssignment();
    const response = await asAdmin(
      request(application).post(`${staffPath}/${assignment.id}/revoke`)
    ).send({ reason: 42 });

    expect(response.status).toBe(400);
    expect(response.body.error.details.reason).toBe("must be a string");
  });

  it("refuses a caller who is not an administrator", async () => {
    const assignment = await createAssignment();
    const response = await asOutsider(
      request(application).post(`${staffPath}/${assignment.id}/revoke`)
    ).send({});

    expect(response.status).toBe(403);
  });
});

describe("GET /api/v1/staff-assignments/mine", () => {
  async function tokenForInvitee() {
    const invitee = await UserModel.findOne({ emailAddress: INVITEE_EMAIL });
    return createAuthenticationToken({ id: invitee.id, emailAddress: invitee.emailAddress });
  }

  it("returns the caller's own active assignments", async () => {
    await asAdmin(request(application).post(staffPath)).send(buildBody());

    const response = await request(application)
      .get(MINE_PATH)
      .set("Authorization", `Bearer ${await tokenForInvitee()}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    // festId is populated to a summary so "my assignments" can show the fest name.
    expect(response.body.data[0].festId.id).toBe(fest.id);
    expect(response.body.data[0].festId.festName).toBe(fest.festName);
  });

  it("hides an assignment once it is revoked", async () => {
    const created = await asAdmin(request(application).post(staffPath)).send(buildBody());
    const token = await tokenForInvitee();
    await asAdmin(request(application).post(`${staffPath}/${created.body.data.id}/revoke`)).send({});

    const response = await request(application)
      .get(MINE_PATH)
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("returns 200 and an empty array for a user with no assignments", async () => {
    const response = await request(application)
      .get(MINE_PATH)
      .set("Authorization", `Bearer ${outsider.authenticationToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it("refuses an unauthenticated caller", async () => {
    expect((await request(application).get(MINE_PATH)).status).toBe(401);
  });
});

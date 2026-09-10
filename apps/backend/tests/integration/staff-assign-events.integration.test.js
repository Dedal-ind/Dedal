import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
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

const NEW_EMAIL = "new-coordinator@example.com";
let college;
let admin;
let outsider;
let fest;
let eventA;
let eventB;
let assignPath;

function post(body, token) {
  return request(application)
    .post(assignPath)
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

beforeAll(async () => {
  await setupTestDatabase();
  await StaffAssignmentModel.createIndexes();
  await UserModel.createIndexes();
});
beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  outsider = await createTestOutsider();
  fest = await createTestFest(college, admin.user);
  eventA = await createTestEvent(fest, admin.user);
  eventB = await createTestEvent(fest, admin.user, { eventName: "Event B", eventSlug: "event-b" });
  assignPath = `/api/v1/fests/${fest._id}/staff/assign`;
});
afterAll(teardownTestDatabase);

describe("POST /fests/:festId/staff/assign", () => {
  it("assigns a coordinator to one event", async () => {
    const response = await post(
      { emailAddress: NEW_EMAIL, role: "coordinator", eventIds: [String(eventA._id)] },
      admin.authenticationToken
    );
    expect(response.status).toBe(201);
    expect(response.body.data.role).toBe("coordinator");
    expect(response.body.data.eventIds).toHaveLength(1);
  });

  it("assigns across multiple events in one call", async () => {
    const response = await post(
      { emailAddress: NEW_EMAIL, role: "coordinator", eventIds: [String(eventA._id), String(eventB._id)] },
      admin.authenticationToken
    );
    expect(response.status).toBe(201);
    expect(response.body.data.eventIds).toHaveLength(2);
  });

  it("merges into the existing active assignment for the same user and role", async () => {
    await post({ emailAddress: NEW_EMAIL, role: "coordinator", eventIds: [String(eventA._id)] }, admin.authenticationToken);
    await post({ emailAddress: NEW_EMAIL, role: "coordinator", eventIds: [String(eventB._id)] }, admin.authenticationToken);

    const user = await UserModel.findOne({ emailAddress: NEW_EMAIL });
    const active = await StaffAssignmentModel.find({
      userId: user._id,
      festId: fest._id,
      role: "coordinator",
      status: "active",
    });
    expect(active).toHaveLength(1);
    expect(active[0].eventIds).toHaveLength(2);
  });

  it("rejects an event that belongs to a different fest", async () => {
    const otherFest = await createTestFest(college, admin.user, { festSlug: "other-fest" });
    const otherEvent = await createTestEvent(otherFest, admin.user, { eventSlug: "other-event" });
    const response = await post(
      { emailAddress: NEW_EMAIL, role: "coordinator", eventIds: [String(otherEvent._id)] },
      admin.authenticationToken
    );
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
  });

  it("rejects a caller who is not an administrator of the host college", async () => {
    const response = await post(
      { emailAddress: NEW_EMAIL, role: "coordinator", eventIds: [String(eventA._id)] },
      outsider.authenticationToken
    );
    expect(response.status).toBe(403);
  });

  it("creates a pending user when the email is new", async () => {
    await post({ emailAddress: NEW_EMAIL, role: "volunteer", eventIds: [String(eventA._id)] }, admin.authenticationToken);
    const user = await UserModel.findOne({ emailAddress: NEW_EMAIL });
    expect(user).not.toBeNull();
    expect(user.emailVerifiedAt).toBeNull();
  });

  it("writes a STAFF_ASSIGNED audit log on success", async () => {
    await post({ emailAddress: NEW_EMAIL, role: "coordinator", eventIds: [String(eventA._id)] }, admin.authenticationToken);
    const logs = await AuditLogModel.find({ action: "staff.assigned" });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
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
  createTestStaffMember,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const PAST = new Date(Date.now() - 3_600_000);
const FUTURE = new Date(Date.now() + 3_600_000);
const EARLIER_PAST = new Date(Date.now() - 7_200_000);

let admin;
let fest;
let event;
let eventPath;

async function coordinator(assignmentOverrides, emailAddress) {
  return createTestStaffMember(fest, "coordinator", {
    emailAddress,
    assignment: { eventIds: [event._id], ...assignmentOverrides },
  });
}

function editEvent(token) {
  return request(application)
    .patch(eventPath)
    .set("Authorization", `Bearer ${token}`)
    .send({ venue: "Ring B" });
}
function readEvent(token) {
  return request(application).get(eventPath).set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  await setupTestDatabase();
  await StaffAssignmentModel.createIndexes();
});
beforeEach(async () => {
  await clearAllCollections();
  const college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user);
  event = await createTestEvent(fest, admin.user, { status: "draft" });
  eventPath = `/api/v1/fests/${fest._id}/events/${event._id}`;
});
afterAll(teardownTestDatabase);

describe("access-expiry enforcement on coordinator writes", () => {
  it("blocks a write when the coordinator's window has passed (ASSIGNMENT_EXPIRED)", async () => {
    const staff = await coordinator({ validFrom: EARLIER_PAST, validTo: PAST }, "expired@example.com");
    const response = await editEvent(staff.authenticationToken);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ASSIGNMENT_EXPIRED");
  });

  it("blocks a write when the coordinator's assignment was revoked (ASSIGNMENT_REVOKED)", async () => {
    const staff = await coordinator(
      { validFrom: PAST, validTo: FUTURE, status: "revoked", revokedAt: PAST },
      "revoked@example.com"
    );
    const response = await editEvent(staff.authenticationToken);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("ASSIGNMENT_REVOKED");
  });

  it("allows a write when the coordinator is inside their window", async () => {
    const staff = await coordinator({ validFrom: PAST, validTo: FUTURE }, "active@example.com");
    const response = await editEvent(staff.authenticationToken);
    expect(response.status).toBe(200);
    expect(response.body.data.venue).toBe("Ring B");
  });

  it("always allows an administrator regardless of any window", async () => {
    const response = await editEvent(admin.authenticationToken);
    expect(response.status).toBe(200);
  });

  it("keeps read access open for a coordinator whose window has passed", async () => {
    const staff = await coordinator({ validFrom: EARLIER_PAST, validTo: PAST }, "reader@example.com");
    const response = await readEvent(staff.authenticationToken);
    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(String(event._id));
  });
});

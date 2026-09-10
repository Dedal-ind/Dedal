import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import { UserModel } from "../../../src/models/user-model.js";
import { EventModel } from "../../../src/models/event-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import {
  installEmailServiceMock,
  getRecordedEmails,
  clearRecordedEmails,
} from "../../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestOutsider,
  createTestFest,
  createTestEvent,
} from "../../setup/create-test-fixtures.js";

// Seeded before the service graph requires the real email service.
installEmailServiceMock();
const staffAssignmentService = await import("../../../src/services/staff-assignment-service.js");

const INVITEE_EMAIL = "coordinator@example.com";
const MISSING_ID = "000000000000000000000000";

let college;
let admin;
let outsider;
let fest;

function buildPayload(overrides = {}) {
  return { emailAddress: INVITEE_EMAIL, role: "coordinator", eventIds: [], ...overrides };
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
});

afterAll(teardownTestDatabase);

/* Split from staff-assignment-service.test.js to stay within the per-file line budget. */
describe("assignStaffMember event scoping", () => {
  it("stores the named events and derives the validity window from them", async () => {
    const firstEvent = await createTestEvent(fest, admin.user, {
      eventSlug: "first",
      startsAt: new Date("2027-03-02T10:00:00.000Z"),
      endsAt: new Date("2027-03-02T18:00:00.000Z"),
    });
    const secondEvent = await createTestEvent(fest, admin.user, {
      eventSlug: "second",
      startsAt: new Date("2027-03-04T10:00:00.000Z"),
      endsAt: new Date("2027-03-04T20:00:00.000Z"),
    });

    const assignment = await staffAssignmentService.assignStaffMember(
      admin.user._id,
      fest.id,
      buildPayload({ eventIds: [secondEvent.id, firstEvent.id] })
    );

    expect(assignment.eventIds).toHaveLength(2);
    // A COORDINATOR's window: 48 hours before the earliest start, closing with
    // the latest end. (A volunteer keeps the 24-hours-before / 2-hours-after
    // window — see the case below.)
    expect(assignment.validFrom.toISOString()).toBe("2027-02-28T10:00:00.000Z");
    expect(assignment.validTo.toISOString()).toBe("2027-03-04T20:00:00.000Z");
  });

  it("gives a volunteer the shorter default window", async () => {
    const event = await createTestEvent(fest, admin.user, {
      eventSlug: "volunteer-window",
      startsAt: new Date("2027-03-02T10:00:00.000Z"),
      endsAt: new Date("2027-03-02T18:00:00.000Z"),
    });

    const assignment = await staffAssignmentService.assignStaffMember(
      admin.user._id,
      fest.id,
      buildPayload({ role: "volunteer", eventIds: [event.id] })
    );

    expect(assignment.validFrom.toISOString()).toBe("2027-03-01T10:00:00.000Z");
    expect(assignment.validTo.toISOString()).toBe("2027-03-02T20:00:00.000Z");
  });

  /* An assignment naming no event covers the whole fest and has nothing to derive from. */
  it("leaves the window null when no event is named", async () => {
    const assignment = await staffAssignmentService.assignStaffMember(
      admin.user._id,
      fest.id,
      buildPayload({ eventIds: [] })
    );

    expect(assignment.eventIds).toEqual([]);
    expect(assignment.validFrom).toBe(null);
    expect(assignment.validTo).toBe(null);
  });

  it("reports an event from another fest as missing, not as forbidden", async () => {
    const otherFest = await createTestFest(college, admin.user, { festSlug: "other-fest" });
    const foreignEvent = await createTestEvent(otherFest, admin.user);

    await expect(
      staffAssignmentService.assignStaffMember(
        admin.user._id,
        fest.id,
        buildPayload({ eventIds: [foreignEvent.id] })
      )
    ).rejects.toMatchObject({ errorCode: "EVENT_NOT_FOUND", statusCode: 404 });
  });

  it("reports an event id that exists nowhere as missing", async () => {
    await expect(
      staffAssignmentService.assignStaffMember(
        admin.user._id,
        fest.id,
        buildPayload({ eventIds: [new mongoose.Types.ObjectId().toString()] })
      )
    ).rejects.toMatchObject({ errorCode: "EVENT_NOT_FOUND" });
  });

  it("creates no assignment when an event id is rejected", async () => {
    await staffAssignmentService
      .assignStaffMember(
        admin.user._id,
        fest.id,
        buildPayload({ eventIds: [new mongoose.Types.ObjectId().toString()] })
      )
      .catch(() => null);

    expect(await StaffAssignmentModel.countDocuments({ festId: fest._id })).toBe(0);
  });
});

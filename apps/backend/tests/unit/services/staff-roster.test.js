import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import festStaffService from "../../../src/services/fest-staff-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestEvent,
  createTestUser,
} from "../../setup/create-test-fixtures.js";

const PAST = new Date(Date.now() - 3_600_000);
const FUTURE = new Date(Date.now() + 3_600_000);

let fest;
let eventA;
let eventB;
let assignerId;

async function assignment(user, overrides) {
  return StaffAssignmentModel.create({
    userId: user._id,
    festId: fest._id,
    assignedByUserId: assignerId,
    ...overrides,
  });
}

beforeAll(async () => {
  await setupTestDatabase();
  await StaffAssignmentModel.createIndexes();
});
beforeEach(async () => {
  await clearAllCollections();
  const college = await createTestCollege();
  const admin = await createTestAdministrator(college);
  assignerId = admin.user._id;
  fest = await createTestFest(college, admin.user);
  eventA = await createTestEvent(fest, admin.user);
  eventB = await createTestEvent(fest, admin.user, { eventName: "Event B", eventSlug: "event-b" });
});
afterAll(teardownTestDatabase);

describe("getFestStaffRoster", () => {
  it("groups by user, keeps revoked + expired history, and derives the most permissive status", async () => {
    const revoker = await createTestUser({ emailAddress: "revoker@example.com", fullName: "Revoker" });
    const mixed = await createTestUser({ emailAddress: "mixed@example.com", fullName: "Mixed Person" });
    // Same person: a revoked coordinator row AND an active in-window volunteer row.
    await assignment(mixed, {
      role: "coordinator",
      eventIds: [eventA._id],
      status: "revoked",
      revokedAt: PAST,
      revokedByUserId: revoker._id,
      revocationReason: "reassigned",
      validFrom: PAST,
      validTo: FUTURE,
    });
    await assignment(mixed, {
      role: "volunteer",
      eventIds: [eventB._id],
      validFrom: PAST,
      validTo: FUTURE,
    });
    const expiredUser = await createTestUser({ emailAddress: "expired@example.com", fullName: "Expired Person" });
    await assignment(expiredUser, { role: "coordinator", eventIds: [eventA._id], validFrom: PAST, validTo: PAST });

    const { staff } = await festStaffService.getFestStaffRoster(fest._id);

    const mixedEntry = staff.find((person) => person.userId === String(mixed._id));
    expect(mixedEntry.assignments).toHaveLength(2);
    expect(mixedEntry.currentStatus).toBe("active");
    const revokedAssignment = mixedEntry.assignments.find((row) => row.status === "revoked");
    expect(revokedAssignment.revokedByName).toBe("Revoker");
    expect(revokedAssignment.revocationReason).toBe("reassigned");

    const expiredEntry = staff.find((person) => person.userId === String(expiredUser._id));
    expect(expiredEntry.currentStatus).toBe("expired");
  });
});

describe("getEventStaffRoster", () => {
  it("includes fest-wide (empty eventIds) assignments alongside event-named ones, and excludes other events", async () => {
    const named = await createTestUser({ emailAddress: "named@example.com", fullName: "Named A" });
    const festWide = await createTestUser({ emailAddress: "wide@example.com", fullName: "Fest Wide" });
    const otherEvent = await createTestUser({ emailAddress: "other@example.com", fullName: "Other Event" });
    await assignment(named, { role: "coordinator", eventIds: [eventA._id], validFrom: PAST, validTo: FUTURE });
    await assignment(festWide, { role: "volunteer", eventIds: [], validFrom: null, validTo: null });
    await assignment(otherEvent, { role: "coordinator", eventIds: [eventB._id], validFrom: PAST, validTo: FUTURE });

    const { staff } = await festStaffService.getEventStaffRoster(fest._id, eventA._id);
    const userIds = staff.map((person) => person.userId);

    expect(userIds).toContain(String(named._id));
    expect(userIds).toContain(String(festWide._id));
    expect(userIds).not.toContain(String(otherEvent._id));

    const wideEntry = staff.find((person) => person.userId === String(festWide._id));
    expect(wideEntry.assignments[0].isFestWide).toBe(true);
  });
});

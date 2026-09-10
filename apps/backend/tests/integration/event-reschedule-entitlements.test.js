import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
import { PassModel } from "../../src/models/pass-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { CollegeModel } from "../../src/models/college-model.js";
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
  createTestParticipant,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const registrationService = await import("../../src/services/registration-service.js");
const eventService = await import("../../src/services/event-service.js");
const passService = await import("../../src/services/pass-service.js");

const HOUR_MS = 60 * 60 * 1000;
const GRACE_MS = passService.EVENT_ENTITLEMENT_TRAILING_GRACE_MINUTES * 60 * 1000;

let college;
let admin;
let fest;
let event;
let participant;

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * HOUR_MS);
}

async function eventEntitlement() {
  return EntitlementModel.findOne({ entitlementType: "eventEntry", referenceId: event._id });
}

/* The window production would cut for this event, right now. */
function expectedValidTo(endsAt) {
  return new Date(endsAt.getTime() + GRACE_MS).getTime();
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    EntitlementModel.createIndexes(),
    EventModel.createIndexes(),
    AuditLogModel.createIndexes(),
    PassModel.createIndexes(),
    RegistrationModel.createIndexes(),
    UserModel.createIndexes(),
    FestModel.createIndexes(),
    CollegeModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, {
    status: "published",
    startsOn: hoursFromNow(-24),
    endsOn: hoursFromNow(72),
  });
  /*
   * Set explicitly rather than through openRegistrationOverrides: that helper
   * holds registration open for years, and the model rightly refuses an event
   * that starts before its own registration closes.
   */
  event = await createTestEvent(fest, admin.user, {
    status: "published",
    registrationOpensAt: hoursFromNow(-12),
    registrationClosesAt: hoursFromNow(5),
    startsAt: hoursFromNow(6),
    endsAt: hoursFromNow(9),
  });
  participant = await createTestParticipant(college);
  await registrationService.registerParticipantSolo(participant.user._id, String(event._id));
});

afterAll(teardownTestDatabase);

describe("an event that moves takes its door windows with it", () => {
  it("cuts the window from the event's end plus the grace at registration time", async () => {
    const entitlement = await eventEntitlement();

    expect(entitlement.validFrom).toBeNull();
    expect(entitlement.validTo.getTime()).toBe(expectedValidTo(event.endsAt));
  });

  /*
   * The bug: without the refresh this entitlement keeps expiring at the old end
   * time, so a door pushed a day later starts turning people away on the strength
   * of a schedule nobody is running to any more.
   */
  it("re-cuts existing entitlements when the event is rescheduled later", async () => {
    const newEndsAt = hoursFromNow(33);
    await eventService.updateEvent(admin.user._id, String(fest._id), String(event._id), {
      startsAt: hoursFromNow(30),
      endsAt: newEndsAt,
    });

    const entitlement = await eventEntitlement();
    expect(entitlement.validTo.getTime()).toBe(expectedValidTo(newEndsAt));
  });

  it("leaves validFrom open-ended after a reschedule", async () => {
    await eventService.updateEvent(admin.user._id, String(fest._id), String(event._id), {
      endsAt: hoursFromNow(33),
    });

    const entitlement = await eventEntitlement();
    expect(entitlement.validFrom).toBeNull();
  });

  it("records what moved and how many windows it re-cut", async () => {
    const oldEndsAt = event.endsAt;
    const newEndsAt = hoursFromNow(33);
    await eventService.updateEvent(admin.user._id, String(fest._id), String(event._id), {
      endsAt: newEndsAt,
    });

    const entry = await AuditLogModel.findOne({ action: "entitlement.windowsRefreshed" }).lean();
    expect(entry).toBeTruthy();
    expect(entry.afterState.refreshedCount).toBe(1);
    expect(new Date(entry.afterState.oldEndsAt).getTime()).toBe(oldEndsAt.getTime());
    expect(new Date(entry.afterState.newEndsAt).getTime()).toBe(newEndsAt.getTime());
  });

  it("does not touch a revoked entitlement", async () => {
    await registrationService.cancelMyRegistration(participant.user._id, String(event._id));
    const revoked = await EntitlementModel.findOne({ entitlementType: "eventEntry" });
    const windowBefore = revoked.validTo.getTime();

    await eventService.updateEvent(admin.user._id, String(fest._id), String(event._id), {
      endsAt: hoursFromNow(33),
    });

    const after = await EntitlementModel.findOne({ _id: revoked._id });
    expect(after.status).toBe("revoked");
    expect(after.validTo.getTime()).toBe(windowBefore);
  });
});

describe("an edit that is not a reschedule", () => {
  it("leaves the windows alone when only the name changes", async () => {
    const before = await eventEntitlement();

    await eventService.updateEvent(admin.user._id, String(fest._id), String(event._id), {
      eventName: "Renamed Event",
    });

    const after = await eventEntitlement();
    expect(after.validTo.getTime()).toBe(before.validTo.getTime());
  });

  it("writes no refresh audit line for a rename", async () => {
    await eventService.updateEvent(admin.user._id, String(fest._id), String(event._id), {
      eventName: "Renamed Event",
    });

    expect(await AuditLogModel.countDocuments({ action: "entitlement.windowsRefreshed" })).toBe(0);
  });

  /*
   * Re-sending the same timestamp is not a move. Trusting the request's key list
   * rather than the stored value would log a reschedule that never happened.
   */
  it("writes no refresh audit line when the dates are re-sent unchanged", async () => {
    await eventService.updateEvent(admin.user._id, String(fest._id), String(event._id), {
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    });

    expect(await AuditLogModel.countDocuments({ action: "entitlement.windowsRefreshed" })).toBe(0);
  });
});

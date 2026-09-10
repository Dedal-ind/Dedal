import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
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
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const HOUR = 60 * 60 * 1000;
const GOOD_REASON = "No-showed at the gate and did not answer messages.";

let college;
let admin;
let fest;
let event;
let otherEvent;
let participant;

function cancelPath(registrationId) {
  return `/api/v1/registrations/${registrationId}/cancel`;
}

function cancelAs(registrationId, token, body = {}) {
  return request(application)
    .post(cancelPath(registrationId))
    .set("Authorization", `Bearer ${token}`)
    .send(body);
}

/*
 * The event's own start is what the freeze is measured from, so a test moves the
 * event rather than the clock. registrationClosesAt trails it to stay valid.
 */
async function setEventStart(targetEvent, millisecondsFromNow) {
  const startsAt = new Date(Date.now() + millisecondsFromNow);
  await EventModel.updateOne(
    { _id: targetEvent._id },
    {
      $set: {
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * HOUR),
        registrationClosesAt: startsAt,
      },
    }
  );
}

async function registerFor(targetEvent, who) {
  const response = await request(application)
    .post(`/api/v1/events/${targetEvent._id}/registrations/solo`)
    .set("Authorization", `Bearer ${who.authenticationToken}`)
    .send({});
  return response.body.data.registration;
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    RegistrationModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user, openRegistrationOverrides());
  otherEvent = await createTestEvent(fest, admin.user, {
    ...openRegistrationOverrides(),
    eventName: "Other Event",
    eventSlug: "other-event",
  });
  participant = await createTestParticipant(college);
});

afterAll(teardownTestDatabase);

describe("self-cancellation inside the window", () => {
  it("cancels a confirmed registration", async () => {
    const registration = await registerFor(event, participant);
    const response = await cancelAs(registration.id, participant.authenticationToken);

    expect(response.status).toBe(200);
    const stored = await RegistrationModel.findById(registration.id);
    expect(stored.status).toBe("cancelled");
    expect(stored.cancelledByRole).toBe("self");
  });

  it("cancels a waitlisted registration", async () => {
    const fullEvent = await createTestEvent(fest, admin.user, {
      ...openRegistrationOverrides(),
      eventSlug: "waitlist-event",
      capacity: 1,
      waitlistEnabled: true,
    });
    const first = await createTestParticipant(college, {
      emailAddress: "first@example.com",
      usn: "1AA00AA001",
    });
    await registerFor(fullEvent, first);
    const waitlisted = await registerFor(fullEvent, participant);
    expect(waitlisted.status).toBe("waitlisted");

    const response = await cancelAs(waitlisted.id, participant.authenticationToken);
    expect(response.status).toBe(200);
    expect((await RegistrationModel.findById(waitlisted.id)).status).toBe("cancelled");
  });

  it("cancels three hours before the event starts", async () => {
    const registration = await registerFor(event, participant);
    await setEventStart(event, 3 * HOUR);

    const response = await cancelAs(registration.id, participant.authenticationToken);
    expect(response.status).toBe(200);
  });

  it("records a default reason when the participant gives none", async () => {
    const registration = await registerFor(event, participant);
    await cancelAs(registration.id, participant.authenticationToken);

    const stored = await RegistrationModel.findById(registration.id);
    expect(stored.cancellationReason).toBe("Cancelled by participant.");
  });
});

describe("self-cancellation refused", () => {
  it("refuses ninety minutes before the event starts", async () => {
    const registration = await registerFor(event, participant);
    await setEventStart(event, 1.5 * HOUR);

    const response = await cancelAs(registration.id, participant.authenticationToken);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("REGISTRATION_CANCELLATION_WINDOW_CLOSED");
    expect((await RegistrationModel.findById(registration.id)).status).toBe("confirmed");
  });

  /* A row that has advanced into a bracket cannot be withdrawn without breaking it. */
  it("refuses a status that has advanced past confirmed, naming the status", async () => {
    const registration = await registerFor(event, participant);
    await RegistrationModel.updateOne({ _id: registration.id }, { $set: { status: "winner1st" } });

    const response = await cancelAs(registration.id, participant.authenticationToken);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("REGISTRATION_CANCELLATION_STATUS_LOCKED");
    expect(response.body.error.details.currentStatus).toBe("winner1st");
  });

  it("refuses a stranger's registration outright", async () => {
    const registration = await registerFor(event, participant);
    const outsider = await createTestParticipant(college, {
      emailAddress: "outsider@example.com",
      usn: "1AA00AA002",
    });

    const response = await cancelAs(registration.id, outsider.authenticationToken);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });
});

describe("a team registration", () => {
  let teamEvent;
  let leader;
  let member;

  beforeEach(async () => {
    teamEvent = await createTestEvent(fest, admin.user, {
      ...openRegistrationOverrides(),
      eventSlug: "team-cancel-event",
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 4,
    });
    leader = participant;
    member = await createTestParticipant(college, {
      emailAddress: "member@example.com",
      usn: "1AA00AA003",
    });

    await request(application)
      .post(`/api/v1/events/${teamEvent._id}/registrations/team`)
      .set("Authorization", `Bearer ${leader.authenticationToken}`)
      .send({ teamName: "The Team", memberEmails: [member.user.emailAddress] });
  });

  it("refuses a non-leader member cancelling their own row", async () => {
    const memberRow = await RegistrationModel.findOne({ userId: member.user._id });
    const response = await cancelAs(memberRow._id, member.authenticationToken);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("TEAM_CANCEL_LEADER_ONLY");
    expect((await RegistrationModel.findById(memberRow._id)).status).toBe("confirmed");
  });

  it("cancels every member's row when the leader cancels", async () => {
    const leaderRow = await RegistrationModel.findOne({ userId: leader.user._id });
    const response = await cancelAs(leaderRow._id, leader.authenticationToken);

    expect(response.status).toBe(200);
    const rows = await RegistrationModel.find({ eventId: teamEvent._id });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("cancelled");
    }
  });
});

describe("coordinator force-cancel", () => {
  async function createCoordinator(overrides = {}) {
    return createTestStaffMember(fest, "coordinator", {
      emailAddress: "coord@example.com",
      assignment: { eventIds: [event._id] },
      ...overrides,
    });
  }

  it("cancels with a reason", async () => {
    const registration = await registerFor(event, participant);
    const coordinator = await createCoordinator();

    const response = await cancelAs(registration.id, coordinator.authenticationToken, {
      cancellationReason: GOOD_REASON,
    });

    expect(response.status).toBe(200);
    const stored = await RegistrationModel.findById(registration.id);
    expect(stored.status).toBe("cancelled");
    expect(stored.cancelledByRole).toBe("coordinator");
    expect(stored.cancellationReason).toBe(GOOD_REASON);
  });

  /* No status lock for staff: a winner who never showed must still be strikeable. */
  it("cancels a winner after the event has run", async () => {
    const registration = await registerFor(event, participant);
    await RegistrationModel.updateOne({ _id: registration.id }, { $set: { status: "winner1st" } });
    await setEventStart(event, -24 * HOUR);
    const coordinator = await createCoordinator();

    const response = await cancelAs(registration.id, coordinator.authenticationToken, {
      cancellationReason: GOOD_REASON,
    });
    expect(response.status).toBe(200);
  });

  it("refuses a coordinator whose assignment window has ended", async () => {
    const registration = await registerFor(event, participant);
    const expired = await createCoordinator({
      emailAddress: "expired@example.com",
      assignment: {
        eventIds: [event._id],
        validFrom: new Date("2020-01-01T00:00:00.000Z"),
        validTo: new Date("2020-01-02T00:00:00.000Z"),
      },
    });

    const response = await cancelAs(registration.id, expired.authenticationToken, {
      cancellationReason: GOOD_REASON,
    });
    expect([403]).toContain(response.status);
    expect(["PERMISSION_DENIED", "ASSIGNMENT_EXPIRED"]).toContain(response.body.error.code);
  });

  it("refuses a coordinator of a different event in the same fest", async () => {
    const registration = await registerFor(event, participant);
    const otherCoordinator = await createCoordinator({
      emailAddress: "other-coord@example.com",
      assignment: { eventIds: [otherEvent._id] },
    });

    const response = await cancelAs(registration.id, otherCoordinator.authenticationToken, {
      cancellationReason: GOOD_REASON,
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("refuses a missing reason", async () => {
    const registration = await registerFor(event, participant);
    const coordinator = await createCoordinator();

    const response = await cancelAs(registration.id, coordinator.authenticationToken);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CANCELLATION_REASON_REQUIRED");
  });

  it("refuses a reason under ten characters", async () => {
    const registration = await registerFor(event, participant);
    const coordinator = await createCoordinator();

    const response = await cancelAs(registration.id, coordinator.authenticationToken, {
      cancellationReason: "no show",
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CANCELLATION_REASON_REQUIRED");
  });

  it("refuses a reason over five hundred characters", async () => {
    const registration = await registerFor(event, participant);
    const coordinator = await createCoordinator();

    const response = await cancelAs(registration.id, coordinator.authenticationToken, {
      cancellationReason: "x".repeat(501),
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CANCELLATION_REASON_REQUIRED");
  });
});

describe("administrator force-cancel", () => {
  it("cancels a winner after the event, with a reason", async () => {
    const registration = await registerFor(event, participant);
    await RegistrationModel.updateOne({ _id: registration.id }, { $set: { status: "winner1st" } });
    await setEventStart(event, -24 * HOUR);

    const response = await cancelAs(registration.id, admin.authenticationToken, {
      cancellationReason: "Disqualified after a rules review by the panel.",
    });

    expect(response.status).toBe(200);
    const stored = await RegistrationModel.findById(registration.id);
    expect(stored.status).toBe("cancelled");
    expect(stored.cancelledByRole).toBe("admin");
  });

  it("refuses a missing reason", async () => {
    const registration = await registerFor(event, participant);
    const response = await cancelAs(registration.id, admin.authenticationToken);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("CANCELLATION_REASON_REQUIRED");
  });
});

describe("side effects of a cancellation", () => {
  it("writes exactly one audit row naming the actor's role", async () => {
    const registration = await registerFor(event, participant);
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "audit-coord@example.com",
      assignment: { eventIds: [event._id] },
    });

    await cancelAs(registration.id, coordinator.authenticationToken, {
      cancellationReason: GOOD_REASON,
    });

    const rows = await AuditLogModel.find({
      entityId: registration.id,
      action: { $regex: "^registration.cancelled" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("registration.cancelled.byCoordinator");
    expect(String(rows[0].actorUserId)).toBe(String(coordinator.user._id));
  });

  /* Entitlements are history: a cancelled seat revokes them, never deletes them. */
  it("revokes the event entitlement rather than deleting it", async () => {
    const registration = await registerFor(event, participant);
    expect(await EntitlementModel.countDocuments({ entitlementType: "eventEntry" })).toBe(1);

    await cancelAs(registration.id, participant.authenticationToken);

    const entitlement = await EntitlementModel.findOne({ entitlementType: "eventEntry" });
    expect(entitlement).not.toBeNull();
    expect(entitlement.status).toBe("revoked");
  });

  /* A counted seat is one on a capped event: an unlimited event counts nothing. */
  it("frees the seat it held on a capped event", async () => {
    const cappedEvent = await createTestEvent(fest, admin.user, {
      ...openRegistrationOverrides(),
      eventSlug: "capped-event",
      capacity: 5,
    });
    const registration = await registerFor(cappedEvent, participant);
    expect((await EventModel.findById(cappedEvent._id)).registeredCount).toBe(1);

    await cancelAs(registration.id, participant.authenticationToken);
    expect((await EventModel.findById(cappedEvent._id)).registeredCount).toBe(0);
  });

  /*
   * An unlimited event never increments the count on registration, so cancelling
   * one must not decrement it either — that mismatch drove the count negative.
   */
  it("does not drive an uncapped event's count below zero", async () => {
    const registration = await registerFor(event, participant);
    expect(event.capacity).toBeNull();
    expect((await EventModel.findById(event._id)).registeredCount).toBe(0);

    await cancelAs(registration.id, participant.authenticationToken);
    expect((await EventModel.findById(event._id)).registeredCount).toBe(0);
  });
});

/*
 * Cancelling twice is the same request arriving twice. The row is already in the
 * state the caller asked for, so it answers 200 — and writes no second audit row,
 * because nothing happened the second time.
 */
describe("cancelling an already-cancelled registration", () => {
  it("is idempotent and does not audit again", async () => {
    const registration = await registerFor(event, participant);
    await cancelAs(registration.id, participant.authenticationToken);

    const second = await cancelAs(registration.id, participant.authenticationToken);
    expect(second.status).toBe(200);
    expect(second.body.data.alreadyCancelled).toBe(true);

    const rows = await AuditLogModel.find({
      entityId: registration.id,
      action: { $regex: "^registration.cancelled" },
    });
    expect(rows).toHaveLength(1);
  });

  it("does not decrement the seat count twice", async () => {
    const cappedEvent = await createTestEvent(fest, admin.user, {
      ...openRegistrationOverrides(),
      eventSlug: "capped-twice",
      capacity: 5,
    });
    const registration = await registerFor(cappedEvent, participant);
    await cancelAs(registration.id, participant.authenticationToken);
    await cancelAs(registration.id, participant.authenticationToken);

    expect((await EventModel.findById(cappedEvent._id)).registeredCount).toBe(0);
  });
});

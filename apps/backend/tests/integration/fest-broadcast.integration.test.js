/*
 * fest-broadcast.integration.test.js
 *
 * The fest-wide broadcast: one message to everyone in a fest, resolved once.
 *
 * THE TEST THAT MATTERS IS THE DEDUP ONE. Everything else here is ordinary
 * coverage; "a participant registered for three events is messaged once" is the
 * entire reason this endpoint exists rather than the console looping over the
 * per-event verb. If that assertion ever goes green while the loop comes back,
 * the feature has been reverted without anyone noticing.
 *
 * Dedup is asserted by USER ID rather than by counting notifications, because
 * the failure mode is duplicates and a count of "at least one per person" would
 * pass while three copies sat in the feed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { NotificationModel } from "../../src/models/notification-model.js";
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
  createTestFest,
  createTestEvent,
  createTestParticipant,
  createTestStaffMember,
  createTestOutsider,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let eventA;
let eventB;
let eventC;
let participantCounter = 0;

function asAdmin(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${admin.authenticationToken}`);
}

async function createParticipantIn(events) {
  participantCounter += 1;
  const participant = await createTestParticipant(college, {
    emailAddress: `festcast${participantCounter}@example.com`,
    usn: `1AN00BB${participantCounter.toString().padStart(3, "0")}`,
  });
  for (const event of events) {
    await RegistrationModel.create({
      eventId: event._id,
      userId: participant.user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
      totalFeePaise: 0,
      registeredAt: new Date(),
    });
  }
  return participant;
}

function sendFestBroadcast(body) {
  return asAdmin(request(application).post(`/api/v1/fests/${fest._id}/broadcast`)).send(body);
}

beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await clearAllCollections();
  participantCounter = 0;
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user);
  eventA = await createTestEvent(fest, admin.user, { eventName: "Battle of Bands", eventSlug: "battle-of-bands" });
  eventB = await createTestEvent(fest, admin.user, { eventName: "Street Play", eventSlug: "street-play" });
  eventC = await createTestEvent(fest, admin.user, { eventName: "Quiz", eventSlug: "quiz" });
});

describe("fest-wide broadcast", () => {
  it("messages a participant registered in three events exactly once", async () => {
    const overlapping = await createParticipantIn([eventA, eventB, eventC]);

    const response = await sendFestBroadcast({
      recipientType: "participants",
      message: "Gates open at 9am.",
    });

    expect(response.status).toBe(200);
    const notifications = await NotificationModel.find({
      userId: overlapping.user._id,
    }).lean();
    expect(notifications).toHaveLength(1);
    expect(response.body.data.recipientCount).toBe(1);
  });

  it("reaches participants of every event in the fest, not just one", async () => {
    const inA = await createParticipantIn([eventA]);
    const inB = await createParticipantIn([eventB]);
    const inC = await createParticipantIn([eventC]);

    const response = await sendFestBroadcast({
      recipientType: "participants",
      message: "Gates open at 9am.",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.recipientCount).toBe(3);

    const reached = await NotificationModel.find({}).select("userId").lean();
    const reachedIds = new Set(reached.map((row) => String(row.userId)));
    for (const participant of [inA, inB, inC]) {
      expect(reachedIds.has(String(participant.user._id))).toBe(true);
    }
  });

  it("excludes registrations that are not confirmed", async () => {
    const confirmed = await createParticipantIn([eventA]);
    participantCounter += 1;
    const cancelled = await createTestParticipant(college, {
      emailAddress: "cancelled@example.com",
      usn: "1AN00CC001",
    });
    await RegistrationModel.create({
      eventId: eventA._id,
      userId: cancelled.user._id,
      status: "cancelled",
      feeAmountSnapshotPaise: 0,
      totalFeePaise: 0,
      registeredAt: new Date(),
    });

    const response = await sendFestBroadcast({
      recipientType: "participants",
      message: "Gates open at 9am.",
    });

    expect(response.body.data.recipientCount).toBe(1);
    const reached = await NotificationModel.find({}).select("userId").lean();
    expect(reached.map((row) => String(row.userId))).toEqual([String(confirmed.user._id)]);
  });

  it("reaches a coordinator scoped to one event, whose event was not selected", async () => {
    /*
     * The per-event loader narrows staff to assignments covering that event.
     * Fest-wide must NOT: a coordinator of the Quiz is still a coordinator of
     * the fest, and a fest-wide notice that skips them is the same partial
     * delivery this endpoint exists to prevent.
     */
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "quizcoord@example.com",
      assignment: { eventIds: [eventC._id] },
    });

    const response = await sendFestBroadcast({
      recipientType: "coordinators",
      message: "Briefing at 8am.",
    });

    expect(response.status).toBe(200);
    const reached = await NotificationModel.find({ userId: coordinator.user._id }).lean();
    expect(reached).toHaveLength(1);
  });

  it("deduplicates a coordinator who is also a participant under recipientType all", async () => {
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "playercoach@example.com",
      assignment: { eventIds: [] },
    });
    await RegistrationModel.create({
      eventId: eventA._id,
      userId: coordinator.user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
      totalFeePaise: 0,
      registeredAt: new Date(),
    });

    const response = await sendFestBroadcast({
      recipientType: "all",
      message: "See you at the ground.",
    });

    expect(response.body.data.recipientCount).toBe(1);
    const reached = await NotificationModel.find({ userId: coordinator.user._id }).lean();
    expect(reached).toHaveLength(1);
  });

  it("files one audit row against the fest, not against an event", async () => {
    await createParticipantIn([eventA, eventB]);

    await sendFestBroadcast({ recipientType: "participants", message: "Gates open at 9am." });

    const rows = await AuditLogModel.find({ action: "event.bulkEmailSent" }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].entityType).toBe("fest");
    expect(String(rows[0].entityId)).toBe(String(fest._id));
    expect(rows[0].afterState.scope).toBe("fest");
  });

  it("succeeds with zero recipients rather than failing", async () => {
    const response = await sendFestBroadcast({
      recipientType: "participants",
      message: "Gates open at 9am.",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.recipientCount).toBe(0);
  });

  it("rejects an unknown recipient type", async () => {
    const response = await sendFestBroadcast({ recipientType: "everyone", message: "Hello." });

    expect(response.status).toBe(400);
  });

  it("rejects an empty message", async () => {
    const response = await sendFestBroadcast({ recipientType: "participants", message: "   " });

    expect(response.status).toBe(400);
  });

  it("refuses a user who is not an administrator", async () => {
    const outsider = await createTestOutsider();

    const response = await request(application)
      .post(`/api/v1/fests/${fest._id}/broadcast`)
      .set("Authorization", `Bearer ${outsider.authenticationToken}`)
      .send({ recipientType: "participants", message: "Hello." });

    expect(response.status).toBe(403);
  });
});

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { RegistrationModel } from "../../../src/models/registration-model.js";
import { TeamModel } from "../../../src/models/team-model.js";
import { EventModel } from "../../../src/models/event-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import { UserModel } from "../../../src/models/user-model.js";
import { CollegeModel } from "../../../src/models/college-model.js";
import { installEmailServiceMock, clearRecordedEmails } from "../../setup/test-email-service.js";
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
  createTestParticipant,
  createTestUser,
  openRegistrationOverrides,
} from "../../setup/create-test-fixtures.js";

import { installRazorpayClientMock } from "../../setup/test-razorpay-service.js";
installEmailServiceMock();
installRazorpayClientMock();
const service = await import("../../../src/services/registration-service.js");

const MISSING_ID = "000000000000000000000000";

let college;
let admin;
let fest;
let participant;

async function expectError(promise, errorCode, statusCode) {
  await expect(promise).rejects.toMatchObject({ errorCode, statusCode });
}

function makeSoloEvent(overrides = {}) {
  return createTestEvent(fest, admin.user, openRegistrationOverrides({ eventType: "solo", ...overrides }));
}

function makeTeamEvent(festForEvent, overrides = {}) {
  return createTestEvent(
    festForEvent,
    admin.user,
    openRegistrationOverrides({
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 4,
      eventSlug: overrides.eventSlug || "team-event",
      ...overrides,
    })
  );
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    RegistrationModel.createIndexes(),
    TeamModel.createIndexes(),
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  clearRecordedEmails();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  participant = await createTestParticipant(college);
});

afterAll(teardownTestDatabase);

describe("registerParticipantSolo", () => {
  it("snapshots the fee and increments the count on a paid event", async () => {
    const event = await makeSoloEvent({ capacity: 10, feeType: "perPerson", feeAmountPaise: 50000 });
    const { registration, event: updated } = await service.registerParticipantSolo(participant.user._id, event.id);

    // A paid event holds the seat under pendingPayment until confirmation.
    expect(registration.status).toBe("pendingPayment");
    expect(registration.feeAmountSnapshotPaise).toBe(50000);
    expect(updated.registeredCount).toBe(1);
  });

  it("keeps the fee snapshot even after the event fee later changes", async () => {
    const event = await makeSoloEvent({ feeType: "perPerson", feeAmountPaise: 12345 });
    const { registration } = await service.registerParticipantSolo(participant.user._id, event.id);

    event.feeAmountPaise = 99999;
    await event.save();
    const reloaded = await RegistrationModel.findById(registration.id);
    expect(reloaded.feeAmountSnapshotPaise).toBe(12345);
  });

  it("rejects a blocked user", async () => {
    const blocked = await createTestParticipant(college, { emailAddress: "blocked@example.com", isBlocked: true });
    const event = await makeSoloEvent();
    await expectError(service.registerParticipantSolo(blocked.user._id, event.id), "USER_BLOCKED", 403);
  });

  it("rejects an incomplete profile", async () => {
    const incomplete = await createTestParticipant(college, { emailAddress: "inc@example.com", isProfileComplete: false });
    const event = await makeSoloEvent();
    await expectError(service.registerParticipantSolo(incomplete.user._id, event.id), "PROFILE_INCOMPLETE", 403);
  });

  it("404s a missing event", async () => {
    await expectError(service.registerParticipantSolo(participant.user._id, MISSING_ID), "EVENT_NOT_FOUND", 404);
  });

  it("rejects a draft event and a draft fest", async () => {
    const draftEvent = await makeSoloEvent({ status: "draft", eventSlug: "draft-e" });
    await expectError(service.registerParticipantSolo(participant.user._id, draftEvent.id), "EVENT_NOT_REGISTERABLE", 409);

    const draftFest = await createTestFest(college, admin.user, { festSlug: "df", status: "draft" });
    const eventUnderDraft = await createTestEvent(draftFest, admin.user, openRegistrationOverrides({ eventType: "solo", eventSlug: "e2" }));
    await expectError(service.registerParticipantSolo(participant.user._id, eventUnderDraft.id), "FEST_NOT_REGISTERABLE", 409);
  });

  it("rejects a team event with TEAM_REGISTRATION_REQUIRED", async () => {
    const event = await makeTeamEvent(fest);
    await expectError(service.registerParticipantSolo(participant.user._id, event.id), "TEAM_REGISTRATION_REQUIRED", 400);
  });

  it("enforces the registration window at both ends", async () => {
    const notOpen = await makeSoloEvent({
      eventSlug: "not-open",
      registrationOpensAt: new Date("2034-01-01T00:00:00.000Z"),
      registrationClosesAt: new Date("2034-06-01T00:00:00.000Z"),
      startsAt: new Date("2034-12-01T00:00:00.000Z"),
      endsAt: new Date("2034-12-02T00:00:00.000Z"),
    });
    await expectError(service.registerParticipantSolo(participant.user._id, notOpen.id), "REGISTRATION_NOT_OPEN_YET", 409);

    /*
     * A past registrationClosesAt, a past startsAt and a past endsAt together
     * close nothing: walk-ups register at the venue after the event has begun.
     * Only an administrator's explicit close shuts the door.
     */
    const started = await makeSoloEvent({
      eventSlug: "started-but-open",
      registrationOpensAt: new Date("2020-01-01T00:00:00.000Z"),
      registrationClosesAt: new Date("2021-01-01T00:00:00.000Z"),
      startsAt: new Date("2021-06-01T00:00:00.000Z"),
      endsAt: new Date("2021-06-02T00:00:00.000Z"),
    });
    await expect(
      service.registerParticipantSolo(participant.user._id, started.id)
    ).resolves.toMatchObject({ registration: expect.any(Object) });

    const closed = await makeSoloEvent({
      eventSlug: "closed",
      registrationOpensAt: new Date("2020-01-01T00:00:00.000Z"),
      registrationClosesAt: new Date("2021-01-01T00:00:00.000Z"),
      startsAt: new Date("2021-06-01T00:00:00.000Z"),
      endsAt: new Date("2021-06-02T00:00:00.000Z"),
      registrationManuallyClosedAt: new Date("2021-02-01T00:00:00.000Z"),
    });
    await expectError(service.registerParticipantSolo(participant.user._id, closed.id), "REGISTRATION_CLOSED", 409);
  });

  it("rejects a participant from outside an intra-college fest", async () => {
    const otherCollege = await createTestCollege({ commonName: "Other" });
    const outsider = await createTestParticipant(otherCollege, { emailAddress: "other@example.com" });
    const event = await makeSoloEvent();
    await expectError(service.registerParticipantSolo(outsider.user._id, event.id), "WRONG_COLLEGE", 403);
  });

  it("rejects a duplicate active registration", async () => {
    const event = await makeSoloEvent();
    await service.registerParticipantSolo(participant.user._id, event.id);
    await expectError(service.registerParticipantSolo(participant.user._id, event.id), "ALREADY_REGISTERED", 409);
  });

  it("waitlists when full and waitlist is enabled", async () => {
    const event = await makeSoloEvent({ capacity: 1, waitlistEnabled: true });
    const second = await createTestParticipant(college, { emailAddress: "p2@example.com" });
    await service.registerParticipantSolo(participant.user._id, event.id);
    const { registration } = await service.registerParticipantSolo(second.user._id, event.id);
    expect(registration.status).toBe("waitlisted");
  });

  it("throws EVENT_FULL when full without a waitlist", async () => {
    const event = await makeSoloEvent({ capacity: 1, waitlistEnabled: false });
    const second = await createTestParticipant(college, { emailAddress: "p3@example.com" });
    await service.registerParticipantSolo(participant.user._id, event.id);
    await expectError(service.registerParticipantSolo(second.user._id, event.id), "EVENT_FULL", 409);
  });

  it("confirms without touching the count for unlimited capacity", async () => {
    const event = await makeSoloEvent({ capacity: null });
    const { registration, event: updated } = await service.registerParticipantSolo(participant.user._id, event.id);
    expect(registration.status).toBe("confirmed");
    expect(updated.registeredCount).toBe(0);
  });

  it("gives the loser's seat back when two of the same user's registrations race", async () => {
    // TOCTOU: both pass the plain-findOne pre-check, both claim a seat (capacity
    // spare), then one wins the (eventId, userId) partial unique index and the
    // other's create hits E11000. Pre-fix the loser strands its claimed seat and
    // the count sticks at 2.
    const event = await makeSoloEvent({ capacity: 2 });
    const outcomes = await Promise.allSettled([
      service.registerParticipantSolo(participant.user._id, event.id),
      service.registerParticipantSolo(participant.user._id, event.id),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.errorCode).toBe("ALREADY_REGISTERED");

    const activeRows = await RegistrationModel.countDocuments({
      eventId: event._id,
      userId: participant.user._id,
      status: "confirmed",
    });
    expect(activeRows).toBe(1);

    const reloaded = await EventModel.findById(event.id);
    expect(reloaded.registeredCount).toBe(1);
  });

  it("releases the claimed seat when the registration create fails for any reason", async () => {
    const event = await makeSoloEvent({ capacity: 2 });
    const before = (await EventModel.findById(event.id)).registeredCount;

    const realCreate = RegistrationModel.create.bind(RegistrationModel);
    let createCalls = 0;
    const createSpy = vi.spyOn(RegistrationModel, "create").mockImplementation((...args) => {
      createCalls += 1;
      // Throw only on the first call; let the second through to prove the count
      // was restored, not merely frozen.
      if (createCalls === 1) {
        return Promise.reject(new Error("synthetic create failure"));
      }
      return realCreate(...args);
    });

    try {
      await expect(
        service.registerParticipantSolo(participant.user._id, event.id)
      ).rejects.toThrow("synthetic create failure");

      const afterFailure = (await EventModel.findById(event.id)).registeredCount;
      expect(afterFailure).toBe(before);

      const second = await service.registerParticipantSolo(participant.user._id, event.id);
      expect(second.event.registeredCount).toBe(1);
    } finally {
      createSpy.mockRestore();
    }
  });

  it("lets only one of two racing registrations take the last seat", async () => {
    const event = await makeSoloEvent({ capacity: 1, waitlistEnabled: false });
    const second = await createTestParticipant(college, { emailAddress: "race@example.com" });
    const outcomes = await Promise.allSettled([
      service.registerParticipantSolo(participant.user._id, event.id),
      service.registerParticipantSolo(second.user._id, event.id),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected[0].reason.errorCode).toBe("EVENT_FULL");
    const reloaded = await EventModel.findById(event.id);
    expect(reloaded.registeredCount).toBe(1);
  });
});


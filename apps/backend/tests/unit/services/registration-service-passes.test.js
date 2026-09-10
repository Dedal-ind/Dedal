import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PassModel } from "../../../src/models/pass-model.js";
import { EntitlementModel } from "../../../src/models/entitlement-model.js";
import { EventModel } from "../../../src/models/event-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import { UserModel } from "../../../src/models/user-model.js";
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
  openRegistrationOverrides,
} from "../../setup/create-test-fixtures.js";

installEmailServiceMock();
const service = await import("../../../src/services/registration-service.js");

let college;
let admin;
let fest;
let participant;

function activeEventEntries(eventId) {
  return EntitlementModel.countDocuments({ entitlementType: "eventEntry", referenceId: eventId, status: "active" });
}
function activeGateAccess() {
  return EntitlementModel.countDocuments({ entitlementType: "gateAccess", status: "active" });
}
function makeSoloEvent(overrides = {}) {
  return createTestEvent(fest, admin.user, openRegistrationOverrides({ eventType: "solo", ...overrides }));
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    PassModel.createIndexes(),
    EntitlementModel.createIndexes(),
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

describe("registration issues and revokes pass entitlements", () => {
  it("gives a confirmed solo registration a pass and an active eventEntry", async () => {
    const event = await makeSoloEvent();
    await service.registerParticipantSolo(participant.user._id, event.id);

    const pass = await PassModel.findOne({ userId: participant.user._id, festId: fest._id });
    expect(pass).not.toBeNull();
    expect(await activeEventEntries(event._id)).toBe(1);
  });

  it("gives a waitlisted solo registration a pass but no eventEntry", async () => {
    const event = await makeSoloEvent({ capacity: 1, waitlistEnabled: true });
    const second = await createTestParticipant(college, { emailAddress: "wl@example.com" });
    await service.registerParticipantSolo(participant.user._id, event.id);
    await service.registerParticipantSolo(second.user._id, event.id);

    const pass = await PassModel.findOne({ userId: second.user._id, festId: fest._id });
    expect(pass).not.toBeNull();
    const waitlistedEntries = await EntitlementModel.countDocuments({ passId: pass._id, entitlementType: "eventEntry" });
    expect(waitlistedEntries).toBe(0);
  });

  it("gives every team member an eventEntry", async () => {
    const publicFest = await createTestFest(college, admin.user, { festSlug: "pub", visibility: "public", status: "published" });
    const event = await createTestEvent(publicFest, admin.user, openRegistrationOverrides({ eventType: "team", minimumTeamSize: 2, maximumTeamSize: 4, eventSlug: "team-e" }));
    await service.registerParticipantTeam(participant.user._id, event.id, {
      teamName: "Byte Force",
      memberEmails: ["m1@example.com", "m2@example.com"],
    });

    expect(await activeEventEntries(event._id)).toBe(3);
  });

  it("revokes the eventEntry on solo cancel but keeps gate access", async () => {
    const event = await makeSoloEvent({ capacity: 5 });
    await service.registerParticipantSolo(participant.user._id, event.id);
    await service.cancelMyRegistration(participant.user._id, event.id);

    expect(await activeEventEntries(event._id)).toBe(0);
    expect(await activeGateAccess()).toBe(1);
  });

  it("revokes every member's eventEntry on team cancel", async () => {
    const publicFest = await createTestFest(college, admin.user, { festSlug: "pc", visibility: "public", status: "published" });
    const event = await createTestEvent(publicFest, admin.user, openRegistrationOverrides({ eventType: "team", minimumTeamSize: 2, maximumTeamSize: 4, eventSlug: "team-c", capacity: 10 }));
    await service.registerParticipantTeam(participant.user._id, event.id, {
      teamName: "Cancellers",
      memberEmails: ["c1@example.com", "c2@example.com"],
    });
    await service.cancelMyRegistration(participant.user._id, event.id);

    expect(await activeEventEntries(event._id)).toBe(0);
    // Each of the three members still holds their gate access.
    expect(await activeGateAccess()).toBe(3);
  });

  it("stays consistent across a register-then-cancel-then-reregister cycle", async () => {
    const event = await makeSoloEvent({ capacity: 5 });
    await service.registerParticipantSolo(participant.user._id, event.id);
    await service.cancelMyRegistration(participant.user._id, event.id);
    await service.registerParticipantSolo(participant.user._id, event.id);

    expect(await activeEventEntries(event._id)).toBe(1);
    expect(await PassModel.countDocuments({ userId: participant.user._id })).toBe(1);
  });
});

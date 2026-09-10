import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
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

installEmailServiceMock();
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

describe("registerParticipantTeam", () => {
  let publicFest;

  beforeEach(async () => {
    publicFest = await createTestFest(college, admin.user, { festSlug: "pub", visibility: "public", status: "published" });
  });

  it("registers a team of new members, creating placeholders and a code", async () => {
    const event = await makeTeamEvent(publicFest);
    const { team, registrations } = await service.registerParticipantTeam(participant.user._id, event.id, {
      teamName: "Byte Force",
      memberEmails: ["new1@example.com", "new2@example.com"],
    });

    expect(registrations).toHaveLength(3);
    expect(registrations.every((registration) => registration.status === "confirmed")).toBe(true);
    expect(team.inviteCode).toHaveLength(8);
    const placeholder = await UserModel.findOne({ emailAddress: "new1@example.com" });
    expect(placeholder.isProfileComplete).toBe(false);
  });

  it("registers a team of existing host-college members in an intra-college fest", async () => {
    const memberA = await createTestParticipant(college, { emailAddress: "ma@example.com" });
    const memberB = await createTestParticipant(college, { emailAddress: "mb@example.com" });
    const event = await makeTeamEvent(fest);
    const { registrations } = await service.registerParticipantTeam(participant.user._id, event.id, {
      teamName: "Alliance A",
      memberEmails: [memberA.user.emailAddress, memberB.user.emailAddress],
    });
    expect(registrations).toHaveLength(3);
  });

  it("auto-adds the leader when absent from memberEmails", async () => {
    const memberA = await createTestParticipant(college, { emailAddress: "solo-mate@example.com" });
    const event = await makeTeamEvent(fest);
    const { team } = await service.registerParticipantTeam(participant.user._id, event.id, {
      teamName: "Duo",
      memberEmails: [memberA.user.emailAddress],
    });
    expect(team.memberUserIds.map(String)).toContain(String(participant.user._id));
    expect(String(team.leaderUserId)).toBe(String(participant.user._id));
  });

  it("rejects a solo event with SOLO_REGISTRATION_REQUIRED", async () => {
    const event = await makeSoloEvent();
    await expectError(
      service.registerParticipantTeam(participant.user._id, event.id, { teamName: "X", memberEmails: [] }),
      "SOLO_REGISTRATION_REQUIRED",
      400
    );
  });

  it("rejects a team that is too small or too large", async () => {
    const event = await makeTeamEvent(publicFest, { minimumTeamSize: 2, maximumTeamSize: 3 });
    await expectError(
      service.registerParticipantTeam(participant.user._id, event.id, { teamName: "Tiny", memberEmails: [] }),
      "INVALID_TEAM_SIZE",
      400
    );
    await expectError(
      service.registerParticipantTeam(participant.user._id, event.id, {
        teamName: "Huge",
        memberEmails: ["a@example.com", "b@example.com", "c@example.com"],
      }),
      "INVALID_TEAM_SIZE",
      400
    );
  });

  it("rejects a blocked member", async () => {
    await createTestUser({ emailAddress: "bad@example.com", isBlocked: true });
    const event = await makeTeamEvent(publicFest);
    await expectError(
      service.registerParticipantTeam(participant.user._id, event.id, {
        teamName: "Team",
        memberEmails: ["bad@example.com", "ok@example.com"],
      }),
      /* Not USER_BLOCKED: the leader is fine, a teammate is not. */
      "TEAM_MEMBER_BLOCKED",
      403
    );
  });

  it("rejects a member already on another team for the event", async () => {
    const event = await makeTeamEvent(publicFest);
    await service.registerParticipantTeam(participant.user._id, event.id, {
      teamName: "First",
      memberEmails: ["shared@example.com"],
    });
    const otherLeader = await createTestParticipant(college, { emailAddress: "lead2@example.com" });
    await expectError(
      service.registerParticipantTeam(otherLeader.user._id, event.id, {
        teamName: "Second",
        memberEmails: ["shared@example.com"],
      }),
      "MEMBER_ALREADY_IN_TEAM",
      409
    );
  });

  it("rejects a member who already holds an active registration", async () => {
    const event = await makeTeamEvent(publicFest);
    const mate = await createTestParticipant(college, { emailAddress: "busy@example.com" });
    await RegistrationModel.create({
      eventId: event._id,
      userId: mate.user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
      registeredAt: new Date(),
    });
    await expectError(
      service.registerParticipantTeam(participant.user._id, event.id, {
        teamName: "Team",
        memberEmails: [mate.user.emailAddress],
      }),
      "ALREADY_REGISTERED",
      409
    );
  });

  it("rejects a member from another college in an intra-college fest", async () => {
    const otherCollege = await createTestCollege({ commonName: "Elsewhere" });
    const outsider = await createTestParticipant(otherCollege, { emailAddress: "far@example.com" });
    const event = await makeTeamEvent(fest);
    await expectError(
      service.registerParticipantTeam(participant.user._id, event.id, {
        teamName: "Mixed",
        memberEmails: [outsider.user.emailAddress],
      }),
      "WRONG_COLLEGE",
      403
    );
  });

  it("rejects a team that does not fit the remaining capacity", async () => {
    const event = await makeTeamEvent(publicFest, { capacity: 2 });
    await expectError(
      service.registerParticipantTeam(participant.user._id, event.id, {
        teamName: "TooBig",
        memberEmails: ["x@example.com", "y@example.com"],
      }),
      "EVENT_FULL",
      409
    );
  });
});

describe("cancelMyRegistration", () => {
  it("cancels a solo registration and decrements the count", async () => {
    const event = await makeSoloEvent({ capacity: 5 });
    await service.registerParticipantSolo(participant.user._id, event.id);
    const { cancelledCount, event: updated } = await service.cancelMyRegistration(participant.user._id, event.id);
    expect(cancelledCount).toBe(1);
    expect(updated.registeredCount).toBe(0);
  });

  it("lets the leader cancel the whole team and disqualifies it", async () => {
    const publicFest = await createTestFest(college, admin.user, { festSlug: "pc", visibility: "public", status: "published" });
    const event = await makeTeamEvent(publicFest, { capacity: 10 });
    await service.registerParticipantTeam(participant.user._id, event.id, {
      teamName: "Cancellers",
      memberEmails: ["c1@example.com", "c2@example.com"],
    });
    const { cancelledCount, event: updated } = await service.cancelMyRegistration(participant.user._id, event.id);
    expect(cancelledCount).toBe(3);
    expect(updated.registeredCount).toBe(0);
    const team = await TeamModel.findOne({ eventId: event._id });
    expect(team.status).toBe("disqualified");
  });

  it("rejects a non-leader trying to cancel a team", async () => {
    const publicFest = await createTestFest(college, admin.user, { festSlug: "pn", visibility: "public", status: "published" });
    const event = await makeTeamEvent(publicFest);
    await service.registerParticipantTeam(participant.user._id, event.id, {
      teamName: "Locked",
      memberEmails: ["m@example.com"],
    });
    const member = await UserModel.findOne({ emailAddress: "m@example.com" });
    await expectError(service.cancelMyRegistration(member._id, event.id), "TEAM_CANCEL_LEADER_ONLY", 403);
  });

  it("404s when there is no active registration", async () => {
    const event = await makeSoloEvent();
    await expectError(service.cancelMyRegistration(participant.user._id, event.id), "REGISTRATION_NOT_FOUND", 404);
  });
});

describe("listMyRegistrations and getRegistrationDetail", () => {
  it("populates the event and fest on the list", async () => {
    const event = await makeSoloEvent();
    await service.registerParticipantSolo(participant.user._id, event.id);
    const registrations = await service.listMyRegistrations(participant.user._id);
    expect(registrations).toHaveLength(1);
    expect(registrations[0].eventId.eventName).toBe("Robowars 2027");
    expect(registrations[0].eventId.festId.festName).toBe("Alliance ONE 2027");
  });

  it("populates the team on the detail view", async () => {
    const publicFest = await createTestFest(college, admin.user, { festSlug: "pd", visibility: "public", status: "published" });
    const event = await makeTeamEvent(publicFest);
    const { registrations } = await service.registerParticipantTeam(participant.user._id, event.id, {
      teamName: "Detail Team",
      memberEmails: ["d1@example.com"],
    });
    const detail = await service.getRegistrationDetail(participant.user._id, registrations[0].id);
    expect(detail.teamId.teamName).toBe("Detail Team");
    expect(detail.teamId.memberUserIds[0]).toHaveProperty("emailAddress");
  });

  it("refuses someone else's registration with PERMISSION_DENIED", async () => {
    const event = await makeSoloEvent();
    const { registration } = await service.registerParticipantSolo(participant.user._id, event.id);
    const other = await createTestParticipant(college, { emailAddress: "nosy@example.com" });
    await expectError(service.getRegistrationDetail(other.user._id, registration.id), "PERMISSION_DENIED", 403);
  });
});

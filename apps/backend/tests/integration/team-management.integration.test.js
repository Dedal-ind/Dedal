import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { TeamModel } from "../../src/models/team-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { PassModel } from "../../src/models/pass-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
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
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let teamEvent;
let soloEvent;
let leader;
let joiner;
let extra;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    TeamModel.createIndexes(),
    RegistrationModel.createIndexes(),
    PassModel.createIndexes(),
    EntitlementModel.createIndexes(),
  ]);
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  teamEvent = await createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({
      eventSlug: "team-clash",
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 2,
      category: "technical",
      feeType: "free",
      feeAmountPaise: 0,
    })
  );
  soloEvent = await createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({ eventSlug: "solo-sprint", category: "technical", feeType: "free", feeAmountPaise: 0 })
  );
  leader = await createTestParticipant(college, { emailAddress: "leader@example.com", usn: "1AA00AA001" });
  joiner = await createTestParticipant(college, { emailAddress: "joiner@example.com", usn: "1AA00AA002" });
  extra = await createTestParticipant(college, { emailAddress: "extra@example.com", usn: "1AA00AA003" });
});

describe("POST /api/v1/teams", () => {
  it("creates a forming team with the leader as sole member and an invite code", async () => {
    const response = await withToken(
      request(application).post("/api/v1/teams"),
      leader.authenticationToken
    ).send({ eventId: String(teamEvent._id), teamName: "The Mind Benders" });

    expect(response.status).toBe(201);
    expect(response.body.data.team.status).toBe("forming");
    expect(response.body.data.team.teamName).toBe("The Mind Benders");
    expect(response.body.data.team.inviteCode).toHaveLength(8);
    expect(response.body.data.team.memberUserIds).toHaveLength(1);

    const registration = await RegistrationModel.findOne({
      eventId: teamEvent._id,
      userId: leader.user._id,
    });
    expect(registration.status).toBe("confirmed");
    expect(String(registration.teamId)).toBe(response.body.data.team.id);
  });

  it("rejects creating a team for a solo event", async () => {
    const response = await withToken(
      request(application).post("/api/v1/teams"),
      leader.authenticationToken
    ).send({ eventId: String(soloEvent._id), teamName: "Not A Team" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("SOLO_REGISTRATION_REQUIRED");
  });

  it("rejects a second team for an event the caller already holds a seat on", async () => {
    await withToken(request(application).post("/api/v1/teams"), leader.authenticationToken).send({
      eventId: String(teamEvent._id),
      teamName: "First Team",
    });
    const response = await withToken(
      request(application).post("/api/v1/teams"),
      leader.authenticationToken
    ).send({ eventId: String(teamEvent._id), teamName: "Second Team" });

    expect(response.status).toBe(409);
    expect(["ALREADY_REGISTERED", "MEMBER_ALREADY_IN_TEAM"]).toContain(response.body.error.code);
  });
});

describe("GET /api/v1/teams/mine", () => {
  it("lists the teams the caller belongs to", async () => {
    await withToken(request(application).post("/api/v1/teams"), leader.authenticationToken).send({
      eventId: String(teamEvent._id),
      teamName: "The Mind Benders",
    });

    const response = await withToken(
      request(application).get("/api/v1/teams/mine"),
      leader.authenticationToken
    );
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].teamName).toBe("The Mind Benders");
    expect(response.body.data[0].eventId.eventName).toBeTruthy();
  });
});

describe("POST /api/v1/registrations/mine/join-team", () => {
  async function createTeamAsLeader() {
    const response = await withToken(
      request(application).post("/api/v1/teams"),
      leader.authenticationToken
    ).send({ eventId: String(teamEvent._id), teamName: "The Mind Benders" });
    return response.body.data.team.inviteCode;
  }

  it("adds a joiner to the roster by invite code", async () => {
    const inviteCode = await createTeamAsLeader();

    const response = await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      joiner.authenticationToken
    ).send({ inviteCode });

    expect(response.status).toBe(200);
    expect(response.body.data.team.memberUserIds).toHaveLength(2);

    const registration = await RegistrationModel.findOne({
      eventId: teamEvent._id,
      userId: joiner.user._id,
    });
    expect(registration.status).toBe("confirmed");
  });

  it("rejects an invite code that matches no team", async () => {
    const response = await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      joiner.authenticationToken
    ).send({ inviteCode: "ZZZZZZZZ" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("TEAM_NOT_FOUND");
  });

  it("lets exactly one of two concurrent joins take the last spot, never overflowing the roster", async () => {
    const inviteCode = await createTeamAsLeader(); // maximumTeamSize 2, one spot left

    const [firstResponse, secondResponse] = await Promise.all([
      withToken(
        request(application).post("/api/v1/registrations/mine/join-team"),
        joiner.authenticationToken
      ).send({ inviteCode }),
      withToken(
        request(application).post("/api/v1/registrations/mine/join-team"),
        extra.authenticationToken
      ).send({ inviteCode }),
    ]);

    const statuses = [firstResponse.status, secondResponse.status].sort();
    expect(statuses).toEqual([200, 409]);
    const failed = firstResponse.status === 409 ? firstResponse : secondResponse;
    expect(failed.body.error.code).toBe("TEAM_FULL");

    const team = await TeamModel.findOne({ inviteCode });
    expect(team.memberUserIds).toHaveLength(2);
  });

  it("counts seats correctly after a failed join — no drift up or down", async () => {
    const inviteCode = await createTeamAsLeader();
    await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      joiner.authenticationToken
    ).send({ inviteCode });
    const countAfterFill = (await EventModel.findById(teamEvent._id)).registeredCount;

    const failedJoin = await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      extra.authenticationToken
    ).send({ inviteCode });
    expect(failedJoin.status).toBe(409);

    expect((await EventModel.findById(teamEvent._id)).registeredCount).toBe(countAfterFill);
    expect(await RegistrationModel.countDocuments({ userId: extra.user._id })).toBe(0);
  });

  it("gives a free-event joiner a pass and an eventEntry entitlement", async () => {
    const inviteCode = await createTeamAsLeader();

    const response = await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      joiner.authenticationToken
    ).send({ inviteCode });
    expect(response.status).toBe(200);
    expect(response.body.data.registration.id).toEqual(expect.any(String));

    const pass = await PassModel.findOne({ userId: joiner.user._id, festId: fest._id });
    expect(pass).not.toBe(null);
    expect(
      await EntitlementModel.countDocuments({
        passId: pass._id,
        entitlementType: "eventEntry",
        referenceId: teamEvent._id,
      })
    ).toBe(1);
  });

  it("rejects joining after the leader locks the team", async () => {
    // A 2–3 event: reach the minimum with one joiner, lock, and a third member
    // finds a locked-but-not-full team.
    const bigEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({
        eventSlug: "team-trio",
        eventType: "team",
        minimumTeamSize: 2,
        maximumTeamSize: 3,
        category: "technical",
        feeType: "free",
        feeAmountPaise: 0,
      })
    );
    const createResponse = await withToken(
      request(application).post("/api/v1/teams"),
      leader.authenticationToken
    ).send({ eventId: String(bigEvent._id), teamName: "Locked Out" });
    const { id: teamId, inviteCode } = createResponse.body.data.team;
    await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      joiner.authenticationToken
    ).send({ inviteCode });

    const lockResponse = await withToken(
      request(application).post(`/api/v1/teams/${teamId}/lock`),
      leader.authenticationToken
    );
    expect(lockResponse.status).toBe(200);
    expect(lockResponse.body.data.status).toBe("locked");
    expect(lockResponse.body.data.isJoinable).toBe(false);

    const joinResponse = await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      extra.authenticationToken
    ).send({ inviteCode });
    expect(joinResponse.status).toBe(409);
    expect(joinResponse.body.error.code).toBe("TEAM_NOT_ACCEPTING_MEMBERS");
  });
});

describe("per-registration answers on the team-code path", () => {
  it("refuses creating a team on a declaration-requiring event without acceptance, and no seat is consumed", async () => {
    const medicalEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({
        eventSlug: "team-medical",
        eventType: "team",
        minimumTeamSize: 2,
        maximumTeamSize: 3,
        category: "technical",
        feeType: "free",
        feeAmountPaise: 0,
        capacity: 10,
        requiresMedicalDeclaration: true,
      })
    );

    const response = await withToken(
      request(application).post("/api/v1/teams"),
      leader.authenticationToken
    ).send({ eventId: String(medicalEvent._id), teamName: "No Waiver" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("MEDICAL_DECLARATION_REQUIRED");
    expect((await EventModel.findById(medicalEvent._id)).registeredCount).toBe(0);
  });

  it("stamps the leader's own acceptance, requires the joiner's own, and inherits food from the leader", async () => {
    const foodFest = await createTestFest(college, admin.user, {
      festName: "Food Fest",
      festSlug: "food-fest",
      status: "published",
      offers: [{ offerName: "Food", offerKey: "food", requiresQuantity: true, isActive: true }],
    });
    const medicalEvent = await createTestEvent(
      foodFest,
      admin.user,
      openRegistrationOverrides({
        eventSlug: "team-medical-food",
        eventType: "team",
        minimumTeamSize: 2,
        maximumTeamSize: 3,
        category: "technical",
        feeType: "free",
        feeAmountPaise: 0,
        requiresMedicalDeclaration: true,
      })
    );

    const createResponse = await withToken(
      request(application).post("/api/v1/teams"),
      leader.authenticationToken
    ).send({
      eventId: String(medicalEvent._id),
      teamName: "Waivered",
      hasAcceptedMedicalDeclaration: true,
      foodPreference: "veg",
      foodOrderCount: 3,
    });
    expect(createResponse.status).toBe(201);
    const { inviteCode } = createResponse.body.data.team;

    const leaderRow = await RegistrationModel.findOne({
      eventId: medicalEvent._id,
      userId: leader.user._id,
    });
    expect(leaderRow.medicalDeclarationAcceptedAt).not.toBe(null);
    expect(leaderRow.foodPreference).toBe("veg");
    expect(leaderRow.foodOrderCount).toBe(3);

    // The joiner does not inherit the leader's acceptance: without their own
    // flag the join is refused outright.
    const refusedJoin = await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      joiner.authenticationToken
    ).send({ inviteCode });
    expect(refusedJoin.status).toBe(400);
    expect(refusedJoin.body.error.code).toBe("MEDICAL_DECLARATION_REQUIRED");

    const acceptedJoin = await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      joiner.authenticationToken
    ).send({ inviteCode, hasAcceptedMedicalDeclaration: true });
    expect(acceptedJoin.status).toBe(200);

    const joinerRow = await RegistrationModel.findOne({
      eventId: medicalEvent._id,
      userId: joiner.user._id,
    });
    // The joiner's own moment of acceptance, stamped at join time — after the
    // leader's, never copied from it.
    expect(joinerRow.medicalDeclarationAcceptedAt).not.toBe(null);
    expect(joinerRow.medicalDeclarationAcceptedAt.getTime()).toBeGreaterThan(
      leaderRow.medicalDeclarationAcceptedAt.getTime()
    );
    // Food is booked by the person who registers: preference inherited, count null.
    expect(joinerRow.foodPreference).toBe("veg");
    expect(joinerRow.foodOrderCount).toBe(null);
  });

  it("rejects an out-of-range team meal count with the bounds, consuming no seat", async () => {
    const foodFest = await createTestFest(college, admin.user, {
      festName: "Food Fest 2",
      festSlug: "food-fest-2",
      status: "published",
      offers: [{ offerName: "Food", offerKey: "food", requiresQuantity: true, isActive: true }],
    });
    const cappedEvent = await createTestEvent(
      foodFest,
      admin.user,
      openRegistrationOverrides({
        eventSlug: "team-food-cap",
        eventType: "team",
        minimumTeamSize: 2,
        maximumTeamSize: 4,
        category: "technical",
        feeType: "free",
        feeAmountPaise: 0,
        capacity: 10,
      })
    );

    // maximumTeamSize is accepted…
    const okResponse = await withToken(
      request(application).post("/api/v1/teams"),
      leader.authenticationToken
    ).send({
      eventId: String(cappedEvent._id),
      teamName: "Four Meals",
      foodPreference: "veg",
      foodOrderCount: 4,
    });
    expect(okResponse.status).toBe(201);

    // …maximumTeamSize + 1 is not, and the failed attempt consumes no seat.
    const countBefore = (await EventModel.findById(cappedEvent._id)).registeredCount;
    const rejected = await withToken(
      request(application).post("/api/v1/teams"),
      joiner.authenticationToken
    ).send({
      eventId: String(cappedEvent._id),
      teamName: "Five Meals",
      foodPreference: "veg",
      foodOrderCount: 5,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("FOOD_ORDER_COUNT_INVALID");
    expect(rejected.body.error.details).toEqual({ minimum: 1, maximum: 4 });
    expect((await EventModel.findById(cappedEvent._id)).registeredCount).toBe(countBefore);
  });
});

describe("POST /api/v1/teams/:teamId/lock", () => {
  async function createTeamOn(event, participant, teamName) {
    const response = await withToken(
      request(application).post("/api/v1/teams"),
      participant.authenticationToken
    ).send({ eventId: String(event._id), teamName });
    return response.body.data.team;
  }

  it("refuses to lock below minimumTeamSize with the sizes in details", async () => {
    const team = await createTeamOn(teamEvent, leader, "Too Small"); // minimum 2, roster 1

    const response = await withToken(
      request(application).post(`/api/v1/teams/${team.id}/lock`),
      leader.authenticationToken
    );

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("TEAM_BELOW_MINIMUM_SIZE");
    expect(response.body.error.details).toEqual({ minimumTeamSize: 2, currentSize: 1 });
  });

  it("refuses a lock by a non-leader with 403 TEAM_LOCK_LEADER_ONLY", async () => {
    const team = await createTeamOn(teamEvent, leader, "Leader Only");
    await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      joiner.authenticationToken
    ).send({ inviteCode: team.inviteCode });

    const response = await withToken(
      request(application).post(`/api/v1/teams/${team.id}/lock`),
      joiner.authenticationToken
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("TEAM_LOCK_LEADER_ONLY");
  });
});

describe("POST /api/v1/registrations/mine/join-team (full team)", () => {
  async function createTeamAsLeader() {
    const response = await withToken(
      request(application).post("/api/v1/teams"),
      leader.authenticationToken
    ).send({ eventId: String(teamEvent._id), teamName: "The Mind Benders" });
    return response.body.data.team.inviteCode;
  }

  it("rejects joining a team that is already full", async () => {
    const inviteCode = await createTeamAsLeader();
    await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      joiner.authenticationToken
    ).send({ inviteCode });

    const response = await withToken(
      request(application).post("/api/v1/registrations/mine/join-team"),
      extra.authenticationToken
    ).send({ inviteCode });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("TEAM_FULL");
  });
});

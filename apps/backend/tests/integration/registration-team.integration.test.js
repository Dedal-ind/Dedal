import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { TeamModel } from "../../src/models/team-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
import {
  installEmailServiceMock,
  findRecordedEmailsOfKind,
  clearRecordedEmails,
} from "../setup/test-email-service.js";
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

import { installRazorpayClientMock } from "../setup/test-razorpay-service.js";
installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let publicFest;
let participant;
let event;

function asParticipant(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${participant.authenticationToken}`);
}

function teamPath(eventId) {
  return `/api/v1/events/${eventId}/registrations/team`;
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
  publicFest = await createTestFest(college, admin.user, { festSlug: "pub", visibility: "public", status: "published" });
  participant = await createTestParticipant(college);
  event = await createTestEvent(
    publicFest,
    admin.user,
    openRegistrationOverrides({ eventType: "team", minimumTeamSize: 2, maximumTeamSize: 4, eventSlug: "team-e" })
  );
});

afterAll(teardownTestDatabase);

describe("POST /api/v1/events/:eventId/registrations/team", () => {
  it("holds a paid perPerson team: total is fee times team size, one shared payment group", async () => {
    const paidEvent = await createTestEvent(
      publicFest,
      admin.user,
      openRegistrationOverrides({
        eventType: "team",
        minimumTeamSize: 2,
        maximumTeamSize: 4,
        eventSlug: "paid-pp",
        feeType: "perPerson",
        feeAmountPaise: 45000,
      })
    );

    const response = await asParticipant(request(application).post(teamPath(paidEvent.id))).send({
      teamName: "Byte Force",
      memberEmails: ["m1@example.com", "m2@example.com", "m3@example.com"],
    });

    expect(response.status).toBe(201);
    const rows = await RegistrationModel.find({ eventId: paidEvent._id });
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.status === "pendingPayment")).toBe(true);
    expect(rows.every((row) => row.paymentStatus === "pending")).toBe(true);
    // perPerson: 45000 × 4 members.
    expect(rows.every((row) => row.totalFeePaise === 180000)).toBe(true);
    expect(new Set(rows.map((row) => row.paymentGroupId)).size).toBe(1);
    expect(rows[0].paymentGroupId).toEqual(expect.any(String));
  });

  it("holds a paid perTeam team: total is the flat fee regardless of size, one shared group", async () => {
    const sportsEvent = await createTestEvent(
      publicFest,
      admin.user,
      openRegistrationOverrides({
        eventType: "team",
        minimumTeamSize: 2,
        maximumTeamSize: 15,
        eventSlug: "cricket",
        feeType: "perTeam",
        feeAmountPaise: 300000,
      })
    );
    const memberEmails = Array.from({ length: 14 }, (unused, index) => `player${index}@example.com`);

    const response = await asParticipant(request(application).post(teamPath(sportsEvent.id))).send({
      teamName: "Cricket XI Plus",
      memberEmails,
    });

    expect(response.status).toBe(201);
    const rows = await RegistrationModel.find({ eventId: sportsEvent._id });
    expect(rows).toHaveLength(15);
    // perTeam: the flat 300000, NOT × 15.
    expect(rows.every((row) => row.totalFeePaise === 300000)).toBe(true);
    expect(new Set(rows.map((row) => row.paymentGroupId)).size).toBe(1);
  });

  it("registers a team, creates placeholders, and emails teammates", async () => {
    const response = await asParticipant(request(application).post(teamPath(event.id))).send({
      teamName: "Byte Force",
      memberEmails: ["new1@example.com", "new2@example.com"],
    });

    expect(response.status).toBe(201);
    expect(response.body.data.registrations).toHaveLength(3);
    expect(response.body.data.team.inviteCode).toHaveLength(8);
    expect(findRecordedEmailsOfKind("teamInvitation")).toHaveLength(2);
    expect(await UserModel.countDocuments({ emailAddress: "new1@example.com" })).toBe(1);
  });

  it("de-duplicates member emails case-insensitively", async () => {
    const response = await asParticipant(request(application).post(teamPath(event.id))).send({
      teamName: "Dupes",
      memberEmails: ["Mate@example.com", "mate@example.com"],
    });

    expect(response.status).toBe(201);
    // Leader + the single distinct teammate.
    expect(response.body.data.registrations).toHaveLength(2);
  });

  it("rejects an invalid team name", async () => {
    const response = await asParticipant(request(application).post(teamPath(event.id))).send({
      teamName: "x",
      memberEmails: ["a@example.com"],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a team smaller than the minimum", async () => {
    const response = await asParticipant(request(application).post(teamPath(event.id))).send({
      teamName: "Solo Team",
      memberEmails: [],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_TEAM_SIZE");
  });

  it("rejects a solo event", async () => {
    const soloEvent = await createTestEvent(
      publicFest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "solo-e" })
    );
    const response = await asParticipant(request(application).post(teamPath(soloEvent.id))).send({
      teamName: "Team",
      memberEmails: ["a@example.com"],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("SOLO_REGISTRATION_REQUIRED");
  });

  it("does not surface a raw 500 when two teams race to create the same new member", async () => {
    // Two leaders naming the same not-yet-existing member fire at once. Both team
    // rosters resolve that email through findOrCreateUserByEmailAddress, so both
    // would create the placeholder — pre-fix the loser surfaces a raw E11000 500.
    // Two different team events, so the shared placeholder can be reused by both
    // rather than colliding on the per-event registration index.
    const secondLeader = await createTestParticipant(college, { emailAddress: "lead2@example.com" });
    const secondEvent = await createTestEvent(
      publicFest,
      admin.user,
      openRegistrationOverrides({ eventType: "team", minimumTeamSize: 2, maximumTeamSize: 4, eventSlug: "team-e2" })
    );
    const sharedMember = "sharednew@example.com";

    const [first, second] = await Promise.all([
      asParticipant(request(application).post(teamPath(event.id))).send({
        teamName: "Alpha",
        memberEmails: [sharedMember],
      }),
      request(application)
        .post(teamPath(secondEvent.id))
        .set("Authorization", `Bearer ${secondLeader.authenticationToken}`)
        .send({ teamName: "Beta", memberEmails: [sharedMember] }),
    ]);

    // Never a raw duplicate-key 500; either both commit or one loses on a domain 409.
    for (const response of [first, second]) {
      expect([201, 409]).toContain(response.status);
      if (response.status === 409) {
        expect(response.body.error.code).toBe("MEMBER_ALREADY_IN_TEAM");
      }
    }
    // The placeholder is a single shared row, not two.
    expect(await UserModel.countDocuments({ emailAddress: sharedMember })).toBe(1);
  });

  it("translates the losing team's duplicate-key race into a domain 409, not a 500", async () => {
    // Two leaders naming the same existing member both pass the assertMembersFree
    // read, both claim seats, and the loser's insertMany trips the registrations
    // (eventId, userId) partial unique index. Pre-fix that surfaces as a raw 500;
    // it must surface as the same MEMBER_ALREADY_IN_TEAM the pre-check throws.
    const sharedMember = await createTestParticipant(college, { emailAddress: "shared3@example.com" });
    const secondLeader = await createTestParticipant(college, { emailAddress: "lead2@example.com" });

    const [first, second] = await Promise.all([
      asParticipant(request(application).post(teamPath(event.id))).send({
        teamName: "Alpha",
        memberEmails: [sharedMember.user.emailAddress],
      }),
      request(application)
        .post(teamPath(event.id))
        .set("Authorization", `Bearer ${secondLeader.authenticationToken}`)
        .send({ teamName: "Beta", memberEmails: [sharedMember.user.emailAddress] }),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.status).not.toBe(500);
    expect(loser.body.error.code).toBe("MEMBER_ALREADY_IN_TEAM");
  });

  it("rejects a member already registered for the event", async () => {
    await asParticipant(request(application).post(teamPath(event.id))).send({
      teamName: "First",
      memberEmails: ["shared@example.com"],
    });
    const otherLeader = await createTestParticipant(college, { emailAddress: "lead2@example.com" });
    const response = await request(application)
      .post(teamPath(event.id))
      .set("Authorization", `Bearer ${otherLeader.authenticationToken}`)
      .send({ teamName: "Second", memberEmails: ["shared@example.com"] });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("MEMBER_ALREADY_IN_TEAM");
  });
});

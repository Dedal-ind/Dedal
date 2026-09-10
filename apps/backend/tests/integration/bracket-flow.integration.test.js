import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { MatchModel } from "../../src/models/match-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestOutsider,
  createTestFest,
  createTestEvent,
  createTestStaffMember,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let event;

function eventPath(suffix = "") {
  return `/api/v1/fests/${fest.id}/events/${event.id}${suffix}`;
}

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

async function createConfirmedParticipants(count) {
  const users = [];
  for (let index = 0; index < count; index += 1) {
    const user = await UserModel.create({ emailAddress: `player${index}@example.com`, fullName: `Player ${index}` });
    await RegistrationModel.create({
      eventId: event._id,
      userId: user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
    });
    users.push(user);
  }
  return users;
}

async function statusOf(userId) {
  const registration = await RegistrationModel.findOne({ eventId: event._id, userId }).lean();
  return registration.status;
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    MatchModel.createIndexes(),
    EventModel.createIndexes(),
    UserModel.createIndexes(),
    FestModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
    RegistrationModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user, {
    scoringFormat: "bracketSingleElimination",
    status: "published",
  });
});

afterAll(teardownTestDatabase);

describe("coordinator bracket flow", () => {
  it("runs a four-player event from generation to a crowned winner", async () => {
    await createConfirmedParticipants(4);

    const generateResponse = await withToken(
      request(application).post(eventPath("/generate-bracket")),
      admin.authenticationToken
    );
    expect(generateResponse.status).toBe(201);
    expect(generateResponse.body.data).toHaveLength(3);

    const bracketResponse = await withToken(
      request(application).get(eventPath("/bracket")),
      admin.authenticationToken
    );
    expect(bracketResponse.status).toBe(200);
    const roundOne = bracketResponse.body.data.filter((match) => match.roundNumber === 1);
    expect(roundOne).toHaveLength(2);

    for (const match of roundOne) {
      const response = await withToken(
        request(application).patch(eventPath(`/matches/${match.id}`)),
        admin.authenticationToken
      ).send({ winnerUserId: match.participantAUserId.id, participantAScore: 3, participantBScore: 1 });
      expect(response.status).toBe(200);
      expect(response.body.data.isFinalized).toBe(true);
    }

    /*
     * The final already has a version: advancing the two semi winners into it
     * wrote to it twice. A result entered here must echo that version back, the
     * same as the coordinator's screen does after re-reading the bracket.
     */
    const final = await MatchModel.findOne({ eventId: event._id, roundNumber: 2 });
    const championId = final.participantAUserId;
    const runnerUpId = final.participantBUserId;
    const finalResponse = await withToken(
      request(application).patch(eventPath(`/matches/${final._id}`)),
      admin.authenticationToken
    ).send({
      winnerUserId: String(championId),
      decisionType: "unanimous",
      expectedVersion: final.version,
    });
    expect(finalResponse.status).toBe(200);

    expect(await statusOf(championId)).toBe("winner1st");
    expect(await statusOf(runnerUpId)).toBe("winner2nd");
  });

  it("refuses a coordinator generating a bracket (now admin-only)", async () => {
    await createConfirmedParticipants(4);
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      assignment: { eventIds: [event._id] },
    });

    const response = await withToken(
      request(application).post(eventPath("/generate-bracket")),
      coordinator.authenticationToken
    );
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("refuses a coordinator creating a volunteer shift (shift writes now admin-only)", async () => {
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      assignment: { eventIds: [event._id] },
    });

    const response = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/shifts`),
      coordinator.authenticationToken
    ).send({});
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("still lets a coordinator enter a match result (scoreboard stays coordinator-writable)", async () => {
    await createConfirmedParticipants(4);
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      assignment: { eventIds: [event._id] },
    });
    // Generation is admin-only now, so the admin sets up the bracket.
    await withToken(
      request(application).post(eventPath("/generate-bracket")),
      admin.authenticationToken
    );
    const [firstMatch] = await MatchModel.find({ eventId: event._id, roundNumber: 1 }).sort({
      matchNumberInRound: 1,
    });

    const response = await withToken(
      request(application).patch(eventPath(`/matches/${firstMatch._id}`)),
      coordinator.authenticationToken
    ).send({ winnerUserId: String(firstMatch.participantAUserId) });
    expect(response.status).toBe(200);
  });

  it("refuses a coordinator not assigned to the event", async () => {
    await createConfirmedParticipants(4);
    const otherEvent = await createTestEvent(fest, admin.user, { eventSlug: "other" });
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      assignment: { eventIds: [otherEvent._id] },
    });

    const response = await withToken(
      request(application).post(eventPath("/generate-bracket")),
      coordinator.authenticationToken
    );
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("refuses an outsider", async () => {
    const outsider = await createTestOutsider();
    const response = await withToken(
      request(application).post(eventPath("/generate-bracket")),
      outsider.authenticationToken
    );
    expect(response.status).toBe(403);
  });

  it("attaches a scoresheet once and blocks a coordinator overwrite", async () => {
    await createConfirmedParticipants(4);
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      assignment: { eventIds: [event._id] },
    });
    // Generation is admin-only; the admin sets up the bracket the coordinator scores.
    await withToken(
      request(application).post(eventPath("/generate-bracket")),
      admin.authenticationToken
    );
    const [firstMatch] = await MatchModel.find({ eventId: event._id, roundNumber: 1 }).sort({
      matchNumberInRound: 1,
    });

    const firstUpload = await withToken(
      request(application).post(eventPath(`/matches/${firstMatch._id}/scoresheet`)),
      coordinator.authenticationToken
    ).send({ scoresheetImageUrl: "https://images.example.com/sheet.jpg" });
    expect(firstUpload.status).toBe(200);

    /*
     * expectedVersion 1 is the version the first upload left behind, so this
     * caller is up to date and the concurrency guard has nothing to say. What
     * stops them is the scoresheet lock, which is what this test is about.
     */
    /* Judges persist and read back, independently of the sheet. */
    const withJudges = await withToken(
      request(application).post(eventPath(`/matches/${firstMatch._id}/scoresheet`)),
      coordinator.authenticationToken
    ).send({ judgeNames: ["Asha Nair", "  Ravi Kumar  ", "", "Priya Sharma"], expectedVersion: 1 });
    expect(withJudges.status).toBe(200);
    /* Trimmed, and the blank dropped rather than stored. */
    expect(withJudges.body.data.judgeNames).toEqual(["Asha Nair", "Ravi Kumar", "Priya Sharma"]);

    const bracketRead = await withToken(
      request(application).get(eventPath("/bracket")),
      coordinator.authenticationToken
    );
    const readBack = bracketRead.body.data.find((m) => m.id === String(firstMatch._id));
    expect(readBack.judgeNames).toEqual(["Asha Nair", "Ravi Kumar", "Priya Sharma"]);
    /* The judges landed without touching the sheet that was already attached. */
    expect(readBack.scoresheetImageUrl).toBe("https://images.example.com/sheet.jpg");

    const overwrite = await withToken(
      request(application).post(eventPath(`/matches/${firstMatch._id}/scoresheet`)),
      coordinator.authenticationToken
    ).send({ scoresheetImageUrl: "https://images.example.com/other.jpg", expectedVersion: 2 });
    expect(overwrite.status).toBe(409);
    expect(overwrite.body.error.code).toBe("SCORESHEET_ALREADY_SET");
  });
});

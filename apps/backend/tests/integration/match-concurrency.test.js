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
  createTestFest,
  createTestEvent,
  createTestStaffMember,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let coordinator;
let fest;
let event;

function eventPath(suffix = "") {
  return `/api/v1/fests/${fest.id}/events/${event.id}${suffix}`;
}

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

async function createConfirmedParticipants(count) {
  for (let index = 0; index < count; index += 1) {
    const user = await UserModel.create({
      emailAddress: `player${index}@example.com`,
      fullName: `Player ${index}`,
    });
    await RegistrationModel.create({
      eventId: event._id,
      userId: user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
    });
  }
}

/* Four players give a clean two-match first round and a final, with no byes. */
async function generateFourPlayerBracket() {
  await createConfirmedParticipants(4);
  await withToken(request(application).post(eventPath("/generate-bracket")), admin.authenticationToken);
}

async function firstRoundMatches() {
  return MatchModel.find({ eventId: event._id, roundNumber: 1 }).sort({ matchNumberInRound: 1 });
}

function submitResult(matchId, body, token = admin.authenticationToken) {
  return withToken(request(application).patch(eventPath(`/matches/${matchId}`)), token).send(body);
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
  coordinator = await createTestStaffMember(fest, "coordinator", {
    assignment: { eventIds: [event._id] },
  });
});

afterAll(teardownTestDatabase);

describe("match write version guard", () => {
  it("accepts a first entry with no expectedVersion and moves the version to 1", async () => {
    await generateFourPlayerBracket();
    const [match] = await firstRoundMatches();
    expect(match.version).toBe(0);

    const response = await submitResult(match._id, {
      winnerUserId: String(match.participantAUserId),
      participantAScore: 3,
      participantBScore: 1,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.version).toBe(1);
  });

  it("accepts a correction that echoes the version it read", async () => {
    await generateFourPlayerBracket();
    const [match] = await firstRoundMatches();
    await submitResult(match._id, { winnerUserId: String(match.participantAUserId) });

    const correction = await submitResult(match._id, {
      winnerUserId: String(match.participantBUserId),
      expectedVersion: 1,
    });

    expect(correction.status).toBe(200);
    expect(correction.body.data.version).toBe(2);
  });

  /*
   * The whole point of the chunk: two coordinators who both loaded version 0.
   * The first write wins; the second must not silently land on top of it.
   */
  it("refuses the loser of a race and hands back the state that beat them", async () => {
    await generateFourPlayerBracket();
    const [match] = await firstRoundMatches();

    const firstWrite = await submitResult(match._id, {
      winnerUserId: String(match.participantAUserId),
      participantAScore: 5,
      expectedVersion: 0,
    });
    expect(firstWrite.status).toBe(200);
    expect(firstWrite.body.data.version).toBe(1);

    const secondWrite = await submitResult(match._id, {
      winnerUserId: String(match.participantBUserId),
      participantAScore: 9,
      expectedVersion: 0,
    });

    expect(secondWrite.status).toBe(409);
    expect(secondWrite.body.error.code).toBe("MATCH_CONCURRENT_UPDATE");
    expect(secondWrite.body.error.details.currentMatch.version).toBe(1);
    expect(secondWrite.body.error.details.currentMatch.participantAScore).toBe(5);

    const stored = await MatchModel.findById(match._id);
    expect(stored.participantAScore).toBe(5);
    expect(String(stored.winnerUserId)).toBe(String(match.participantAUserId));
  });

  it("refuses an unversioned write once the match has any history", async () => {
    await generateFourPlayerBracket();
    const [match] = await firstRoundMatches();
    await submitResult(match._id, { winnerUserId: String(match.participantAUserId) });

    const unversioned = await submitResult(match._id, {
      winnerUserId: String(match.participantBUserId),
    });

    expect(unversioned.status).toBe(409);
    expect(unversioned.body.error.code).toBe("MATCH_CONCURRENT_UPDATE");
  });

  /*
   * Declaring a winner and finalising are not separate calls in this codebase —
   * enterMatchResult does both in one write — so guarding that one path covers
   * both. What is worth pinning is that the guard runs BEFORE the finalise lock,
   * so a stale caller learns what the match now says rather than only that it is
   * shut.
   */
  it("answers a stale caller with the conflict rather than the finalise lock", async () => {
    await generateFourPlayerBracket();
    const [match] = await firstRoundMatches();
    await submitResult(match._id, { winnerUserId: String(match.participantAUserId) });

    const stale = await submitResult(
      match._id,
      { winnerUserId: String(match.participantBUserId), expectedVersion: 0 },
      coordinator.authenticationToken
    );

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("MATCH_CONCURRENT_UPDATE");
    expect(stale.body.error.details.currentMatch.isFinalized).toBe(true);
  });

  it("guards the scoresheet endpoint too", async () => {
    await generateFourPlayerBracket();
    const [match] = await firstRoundMatches();

    const attach = await withToken(
      request(application).post(eventPath(`/matches/${match._id}/scoresheet`)),
      coordinator.authenticationToken
    ).send({ scoresheetImageUrl: "https://images.example.com/sheet.jpg", expectedVersion: 0 });
    expect(attach.status).toBe(200);
    expect(attach.body.data.version).toBe(1);

    const stale = await withToken(
      request(application).post(eventPath(`/matches/${match._id}/scoresheet`)),
      admin.authenticationToken
    ).send({ scoresheetImageUrl: "https://images.example.com/other.jpg", expectedVersion: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("MATCH_CONCURRENT_UPDATE");
  });
});

describe("auto-advancement and the version it leaves behind", () => {
  it("bumps the child match and credits the coordinator who finalised the parent", async () => {
    await generateFourPlayerBracket();
    const [match] = await firstRoundMatches();

    await submitResult(
      match._id,
      { winnerUserId: String(match.participantAUserId) },
      coordinator.authenticationToken
    );

    const child = await MatchModel.findOne({ eventId: event._id, roundNumber: 2 });
    expect(child.version).toBe(1);
    expect(String(child.lastUpdatedByUserId)).toBe(String(coordinator.user._id));
    expect(String(child.participantAUserId)).toBe(String(match.participantAUserId));
  });

  /*
   * The scenario from the brief: a coordinator has the final open while someone
   * else finalises a semi. Their submit must fail and show them the competitor
   * that was slotted in underneath them, not overwrite it.
   */
  it("conflicts a coordinator whose child match was auto-advanced under them", async () => {
    await generateFourPlayerBracket();
    const [semiOne, semiTwo] = await firstRoundMatches();

    const childBeforeAnything = await MatchModel.findOne({ eventId: event._id, roundNumber: 2 });
    const versionTheCoordinatorRead = childBeforeAnything.version;

    await submitResult(semiOne._id, { winnerUserId: String(semiOne.participantAUserId) });
    await submitResult(semiTwo._id, { winnerUserId: String(semiTwo.participantAUserId) });

    const finalMatch = await MatchModel.findOne({ eventId: event._id, roundNumber: 2 });
    const staleSubmit = await submitResult(
      finalMatch._id,
      {
        winnerUserId: String(semiOne.participantAUserId),
        expectedVersion: versionTheCoordinatorRead,
      },
      coordinator.authenticationToken
    );

    expect(staleSubmit.status).toBe(409);
    expect(staleSubmit.body.error.code).toBe("MATCH_CONCURRENT_UPDATE");
    const returned = staleSubmit.body.error.details.currentMatch;
    expect(returned.participantAUserId.id).toBe(String(semiOne.participantAUserId));
    expect(returned.participantBUserId.id).toBe(String(semiTwo.participantAUserId));
  });
});

describe("match reads carry the editor", () => {
  it("resolves lastUpdatedBy to a name and leaves untouched matches blank", async () => {
    await generateFourPlayerBracket();
    const [match] = await firstRoundMatches();
    await submitResult(
      match._id,
      { winnerUserId: String(match.participantAUserId) },
      coordinator.authenticationToken
    );

    const bracket = await withToken(
      request(application).get(eventPath("/bracket")),
      admin.authenticationToken
    );
    expect(bracket.status).toBe(200);

    const edited = bracket.body.data.find((row) => row.id === String(match._id));
    expect(edited.lastUpdatedByUserId).toBe(String(coordinator.user._id));
    expect(edited.lastUpdatedByFullName).toBe(coordinator.user.fullName);
    expect(edited.lastUpdatedAt).toBeTruthy();

    const untouched = bracket.body.data.find(
      (row) => row.roundNumber === 1 && row.id !== String(match._id)
    );
    expect(untouched.lastUpdatedByUserId).toBeNull();
    expect(untouched.lastUpdatedByFullName).toBeNull();
    expect(untouched.lastUpdatedAt).toBeNull();
    expect(untouched.version).toBe(0);
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RoundModel } from "../../src/models/round-model.js";
import { RoundScoreModel } from "../../src/models/round-score-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { ScanModel } from "../../src/models/scan-model.js";
import {
  installEmailServiceMock,
  findRecordedEmailsOfKind,
  clearRecordedEmails,
} from "../setup/test-email-service.js";
import { installRazorpayClientMock } from "../setup/test-razorpay-service.js";
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
  createTestEventCheckpoint,
  createTestParticipant,
  createTestPass,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

/*
 * The coordinator's multi-round judging flow, over real HTTP.
 *
 * The fixture puts SIX participants through the event's door (an accepted IN
 * scan), because round 1 is seeded from who actually arrived — not from who
 * registered.
 */
let college;
let admin;
let fest;
let event;
let entryCheckpoint;
let participants;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

const roundsPath = () => `/api/v1/fests/${fest.id}/events/${event.id}/rounds`;

async function checkInParticipant(participant, index) {
  const pass = await createTestPass(fest, participant.user);
  await ScanModel.create({
    passId: pass._id,
    checkpointId: entryCheckpoint._id,
    scannedByUserId: admin.user._id,
    scanMethod: "qr",
    direction: "in",
    result: "accepted",
    clientScanId: `round-checkin-${index}`,
    scannedAt: new Date(),
  });
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user, { scoringFormat: "judged", status: "ongoing" });
  entryCheckpoint = await createTestEventCheckpoint(fest, event._id);

  participants = [];
  for (let index = 0; index < 6; index += 1) {
    const participant = await createTestParticipant(college, {
      emailAddress: `round-person-${index}@example.com`,
      usn: `1AA00AA20${index}`,
      fullName: `Round Person ${index}`,
    });
    await checkInParticipant(participant, index);
    participants.push(participant);
  }
});

describe("round lifecycle", () => {
  it("seeds round 1 from checked-in participants and leaves later rounds empty", async () => {
    const first = await withToken(request(application).post(roundsPath()), admin.authenticationToken).send({
      roundName: "Prelims",
    });
    expect(first.status).toBe(201);
    expect(first.body.data.roundNumber).toBe(1);
    // Everyone who came through the door, nobody who did not.
    expect(first.body.data.participantIds).toHaveLength(6);

    const second = await withToken(request(application).post(roundsPath()), admin.authenticationToken).send({});
    expect(second.body.data.roundNumber).toBe(2);
    expect(second.body.data.participantIds).toHaveLength(0);

    const third = await withToken(request(application).post(roundsPath()), admin.authenticationToken).send({});
    expect(third.body.data.roundNumber).toBe(3);

    const listed = await withToken(request(application).get(roundsPath()), admin.authenticationToken);
    expect(listed.status).toBe(200);
    expect(listed.body.data.rounds.map((round) => round.roundNumber)).toEqual([1, 2, 3]);
    expect(listed.body.data.rounds[0].participantCount).toBe(6);
  });

  it("scores round 1, advances exactly the named five, then retracts two", async () => {
    const roundOne = (
      await withToken(request(application).post(roundsPath()), admin.authenticationToken).send({})
    ).body.data;

    // (a) score
    const scored = await withToken(
      request(application).post(`${roundsPath()}/${roundOne.id}/scores`),
      admin.authenticationToken
    ).send({
      scores: participants.slice(0, 3).map((participant, index) => ({
        participantUserId: String(participant.user._id),
        score: 90 - index,
        notes: `Judge note ${index}`,
      })),
    });
    expect(scored.status).toBe(200);
    expect(scored.body.data.savedCount).toBe(3);
    expect(await RoundScoreModel.countDocuments({ roundId: roundOne.id })).toBe(3);

    // Re-scoring the same person UPDATES rather than duplicating (unique index).
    await withToken(
      request(application).post(`${roundsPath()}/${roundOne.id}/scores`),
      admin.authenticationToken
    ).send({
      scores: [{ participantUserId: String(participants[0].user._id), score: 99 }],
    });
    expect(await RoundScoreModel.countDocuments({ roundId: roundOne.id })).toBe(3);

    /*
     * ROUND 2 HAS TO EXIST FIRST. Advancing used to auto-create the next round,
     * and no longer does: the service's own comment records why, that "Push all
     * to next round" on the final round manufactured round N+1 for ever, an
     * endless ladder no coordinator planned, with phantom draft rounds showing
     * on the scoreboard before anyone had started them. Rounds are now planned
     * deliberately and advancing only moves people into one that exists, so an
     * advance with no round 2 is a 400 rather than a silent creation.
     */
    const roundTwoCreated = await withToken(
      request(application).post(roundsPath()),
      admin.authenticationToken
    ).send({});
    expect(roundTwoCreated.status).toBe(201);
    expect(roundTwoCreated.body.data.roundNumber).toBe(2);

    // (a) advance five
    const advancingIds = participants.slice(0, 5).map((participant) => String(participant.user._id));
    const advanced = await withToken(
      request(application).post(`${roundsPath()}/${roundOne.id}/advance`),
      admin.authenticationToken
    ).send({ participantUserIds: advancingIds });
    expect(advanced.status).toBe(200);
    expect(advanced.body.data.roundNumber).toBe(2);
    expect(advanced.body.data.participantIds.map(String).sort()).toEqual([...advancingIds].sort());

    // Advancing the same people again cannot duplicate them ($addToSet).
    await withToken(
      request(application).post(`${roundsPath()}/${roundOne.id}/advance`),
      admin.authenticationToken
    ).send({ participantUserIds: advancingIds });
    const roundTwo = await RoundModel.findOne({ eventId: event._id, roundNumber: 2 }).lean();
    expect(roundTwo.participantIds).toHaveLength(5);

    // (b) retract two — the undo path
    const retracted = await withToken(
      request(application).post(`${roundsPath()}/${roundTwo._id}/retract`),
      admin.authenticationToken
    ).send({ participantUserIds: advancingIds.slice(0, 2) });
    expect(retracted.status).toBe(200);
    expect(retracted.body.data.participantIds.map(String).sort()).toEqual(
      advancingIds.slice(2).sort()
    );
  });

  it("(c) refuses a stale version with 409 and leaves the round untouched", async () => {
    const roundOne = (
      await withToken(request(application).post(roundsPath()), admin.authenticationToken).send({})
    ).body.data;
    expect(roundOne.version).toBe(1);

    const firstCoordinator = await withToken(
      request(application).patch(`${roundsPath()}/${roundOne.id}`),
      admin.authenticationToken
    ).send({ roundName: "Renamed by the first coordinator", expectedVersion: 1 });
    expect(firstCoordinator.status).toBe(200);
    expect(firstCoordinator.body.data.version).toBe(2);

    // The second coordinator still holds version 1 — their write must not land.
    const secondCoordinator = await withToken(
      request(application).patch(`${roundsPath()}/${roundOne.id}`),
      admin.authenticationToken
    ).send({ roundName: "Clobbered by the second", expectedVersion: 1 });
    expect(secondCoordinator.status).toBe(409);
    expect(secondCoordinator.body.error.code).toBe("ROUND_CONCURRENT_UPDATE");

    const stored = await RoundModel.findById(roundOne.id).lean();
    expect(stored.roundName).toBe("Renamed by the first coordinator");
  });

  it("assigns groups on advancement and tells each group its own name", async () => {
    clearRecordedEmails();
    const roundOne = (
      await withToken(request(application).post(roundsPath()), admin.authenticationToken).send({})
    ).body.data;
    // A round to advance INTO {D} advancing with no next round is refused.
    const roundTwo = (
      await withToken(request(application).post(roundsPath()), admin.authenticationToken).send({})
    ).body.data;

    const [alpha, bravo, cut] = participants;
    const outcome = await withToken(
      request(application).post(`${roundsPath()}/${roundOne.id}/eliminate`),
      admin.authenticationToken
    ).send({
      advancingUserIds: [String(alpha.user._id), String(bravo.user._id)],
      eliminatedUserIds: [String(cut.user._id)],
      lots: {
        [String(alpha.user._id)]: "outstanding",
        [String(bravo.user._id)]: "improving",
      },
    });

    expect(outcome.status).toBe(200);
    expect(outcome.body.data.advancedCount).toBe(2);

    // The group is persisted on the round they advanced INTO, so the
    // coordinator's next scoresheet shows it.
    const alphaScore = await RoundScoreModel.findOne({
      roundId: roundTwo.id,
      participantUserId: alpha.user._id,
    }).lean();
    expect(alphaScore.roundLot).toBe("outstanding");
    const bravoScore = await RoundScoreModel.findOne({
      roundId: roundTwo.id,
      participantUserId: bravo.user._id,
    }).lean();
    expect(bravoScore.roundLot).toBe("improving");

    /*
     * The lot chooses the whole MESSAGE, not a group name. Each advancer must
     * read their own tier and not the other's.
     */
    const emails = findRecordedEmailsOfKind("generic");
    const toAlpha = emails.find((mail) => mail.emailAddress === alpha.user.emailAddress);
    const toBravo = emails.find((mail) => mail.emailAddress === bravo.user.emailAddress);
    expect(toAlpha.subject).toBe("🏆 Outstanding Performance — Robowars 2027");
    expect(toAlpha.text).toContain("steal the spotlight");
    expect(toAlpha.text).not.toContain("Keep improving");
    expect(toBravo.subject).toBe("📈 Selected — Keep Improving — Robowars 2027");
    expect(toBravo.text).toContain("Guess what? You're through!");

    // And the person who was cut hears the other message entirely.
    const toCut = emails.find((mail) => mail.emailAddress === cut.user.emailAddress);
    expect(toCut.subject).toContain("Thank you for participating");
    expect(toCut.text).toContain("not been selected for the next round this time");
  });

  it("still announces the result on the FINAL round, which has no round after it", async () => {
    clearRecordedEmails();
    const onlyRound = (
      await withToken(request(application).post(roundsPath()), admin.authenticationToken).send({})
    ).body.data;

    const [finalist, cut] = participants;
    const outcome = await withToken(
      request(application).post(`${roundsPath()}/${onlyRound.id}/eliminate`),
      admin.authenticationToken
    ).send({
      advancingUserIds: [String(finalist.user._id)],
      eliminatedUserIds: [String(cut.user._id)],
    });

    expect(outcome.status).toBe(200);
    expect(outcome.body.data.isFinalRound).toBe(true);
    /*
     * The whole point: this used to send nothing at all on a final round, so
     * the result people most want to hear was the one nobody was told.
     */
    const emails = findRecordedEmailsOfKind("generic");
    expect(emails.some((mail) => mail.emailAddress === cut.user.emailAddress)).toBe(true);
  });

  it("refuses a podium that names one person twice, writing nothing", async () => {
    const roundOne = (
      await withToken(request(application).post(roundsPath()), admin.authenticationToken).send({})
    ).body.data;
    await withToken(
      request(application).post(`${roundsPath()}/${roundOne.id}/scores`),
      admin.authenticationToken
    ).send({
      scores: participants.slice(0, 3).map((participant, index) => ({
        participantUserId: String(participant.user._id),
        score: 90 - index,
      })),
    });
    await withToken(
      request(application).post(`${roundsPath()}/${roundOne.id}/start`),
      admin.authenticationToken
    ).send({});

    const duplicated = await withToken(
      request(application).post(`${roundsPath()}/finalise`),
      admin.authenticationToken
    ).send({
      winners: [
        { userId: String(participants[0].user._id), placement: 1 },
        { userId: String(participants[0].user._id), placement: 2 },
      ],
    });

    expect(duplicated.status).toBe(400);
    // Nothing may be written: a half-applied podium leaves one place vacant.
    const anyWinner = await RegistrationModel.findOne({
      eventId: event._id,
      status: { $in: ["winner1st", "winner2nd", "winner3rd"] },
    }).lean();
    expect(anyWinner).toBeNull();
  });

  it("refuses two people sharing one placement", async () => {
    const roundOne = (
      await withToken(request(application).post(roundsPath()), admin.authenticationToken).send({})
    ).body.data;
    await withToken(
      request(application).post(`${roundsPath()}/${roundOne.id}/scores`),
      admin.authenticationToken
    ).send({
      scores: [{ participantUserId: String(participants[0].user._id), score: 90 }],
    });
    await withToken(
      request(application).post(`${roundsPath()}/${roundOne.id}/start`),
      admin.authenticationToken
    ).send({});

    const clash = await withToken(
      request(application).post(`${roundsPath()}/finalise`),
      admin.authenticationToken
    ).send({
      winners: [
        { userId: String(participants[0].user._id), placement: 1 },
        { userId: String(participants[1].user._id), placement: 1 },
      ],
    });

    expect(clash.status).toBe(400);
  });

  /*
   * A COMPLETED ROUND LOCKS WHO COMPETED, NOT WHAT THEY SCORED.
   *
   * This test used to assert that a late score was refused with 409. That is no
   * longer true, and deliberately so: saveRoundScores documents the exemption,
   * because a transcription error found an hour later is a normal thing and
   * locking the sheet the moment the round closes turns a two-second correction
   * into a support request. Every write is audited, so a late edit is traceable
   * rather than invisible.
   *
   * The lock itself still exists — retract and document upload keep it, since
   * those change who competed rather than what they scored — so the test keeps
   * its original intent and points at the operation that is still refused.
   * Asserting only the score succeeds would have left ROUND_ALREADY_COMPLETED
   * with no coverage anywhere in the suite.
   */
  it("locks the roster of a COMPLETED round but still accepts score corrections", async () => {
    const roundOne = (
      await withToken(request(application).post(roundsPath()), admin.authenticationToken).send({})
    ).body.data;
    await withToken(
      request(application).patch(`${roundsPath()}/${roundOne.id}`),
      admin.authenticationToken
    ).send({ status: "completed", expectedVersion: 1 });

    const lateScore = await withToken(
      request(application).post(`${roundsPath()}/${roundOne.id}/scores`),
      admin.authenticationToken
    ).send({ scores: [{ participantUserId: String(participants[0].user._id), score: 50 }] });
    expect(lateScore.status).toBe(200);

    const lateRetract = await withToken(
      request(application).post(`${roundsPath()}/${roundOne.id}/retract`),
      admin.authenticationToken
    ).send({ participantUserIds: [String(participants[0].user._id)] });
    expect(lateRetract.status).toBe(409);
    expect(lateRetract.body.error.code).toBe("ROUND_ALREADY_COMPLETED");
  });

  it("returns the round detail with each participant's score", async () => {
    const roundOne = (
      await withToken(request(application).post(roundsPath()), admin.authenticationToken).send({})
    ).body.data;
    await withToken(
      request(application).post(`${roundsPath()}/${roundOne.id}/scores`),
      admin.authenticationToken
    ).send({ scores: [{ participantUserId: String(participants[0].user._id), score: 77 }] });

    const detail = await withToken(
      request(application).get(`${roundsPath()}/${roundOne.id}`),
      admin.authenticationToken
    );
    expect(detail.status).toBe(200);
    expect(detail.body.data.participants).toHaveLength(6);
    const scoredRow = detail.body.data.participants.find(
      (row) => row.participantUserId === String(participants[0].user._id)
    );
    expect(scoredRow.score).toBe(77);
    expect(scoredRow.fullName).toBe("Round Person 0");
    // An unscored participant is null, not zero — the two are different facts.
    expect(
      detail.body.data.participants.find(
        (row) => row.participantUserId === String(participants[5].user._id)
      ).score
    ).toBeNull();
  });
});

describe("event overview stats (Section C's data source)", () => {
  it("reports registered, gate, venue and yet-to-arrive from their own sources", async () => {
    const response = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/events/${event.id}/overview-stats`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    // Nobody registered in this fixture, but six came through the venue door —
    // the two numbers come from different sources and are allowed to disagree.
    expect(response.body.data.venueCheckInCount).toBe(6);
    expect(response.body.data.gateCheckInCount).toBe(0);
    expect(response.body.data.registeredCount).toBe(0);
    expect(response.body.data.yetToArriveCount).toBe(0); // floored, never negative
  });
});

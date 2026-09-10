import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import scoreService from "../../../src/services/score-service.js";
import { EventScoreModel } from "../../../src/models/event-score-model.js";
import { RegistrationModel } from "../../../src/models/registration-model.js";
import { EventModel } from "../../../src/models/event-model.js";
import { AuditLogModel } from "../../../src/models/audit-log-model.js";
// Imported so the "Team" and "User" schemas are registered before the leaderboard populate.
import { TeamModel } from "../../../src/models/team-model.js";
import { UserModel } from "../../../src/models/user-model.js";
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
  createTestUser,
} from "../../setup/create-test-fixtures.js";

let admin;
let fest;

async function makeEvent(overrides = {}) {
  return createTestEvent(fest, admin.user, { status: "published", ...overrides });
}

async function confirmRegistration(event, emailAddress) {
  const user = await createTestUser({ emailAddress, fullName: emailAddress });
  const registration = await RegistrationModel.create({
    eventId: event._id,
    userId: user._id,
    status: "confirmed",
    feeAmountSnapshotPaise: 0,
  });
  return registration;
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    EventScoreModel.createIndexes(),
    RegistrationModel.createIndexes(),
    EventModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  const college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
});

afterAll(teardownTestDatabase);

describe("initializeScores", () => {
  it("creates one zero-score row per confirmed registration and is idempotent", async () => {
    const event = await makeEvent({ scoringFormat: "scoreBased", eventSlug: "s1" });
    await confirmRegistration(event, "p1@example.com");
    await confirmRegistration(event, "p2@example.com");
    await confirmRegistration(event, "p3@example.com");

    const first = await scoreService.initializeScores(String(event._id));
    expect(first).toEqual({ createdCount: 3, skippedCount: 0 });
    expect(await EventScoreModel.countDocuments({ eventId: event._id, score: 0 })).toBe(3);

    const second = await scoreService.initializeScores(String(event._id));
    expect(second).toEqual({ createdCount: 0, skippedCount: 3 });
  });

  it("refuses a bracket event with LEADERBOARD_NOT_AVAILABLE", async () => {
    const bracketEvent = await makeEvent({
      scoringFormat: "bracketSingleElimination",
      eventSlug: "bracket",
    });

    await expect(scoreService.initializeScores(String(bracketEvent._id))).rejects.toMatchObject({
      errorCode: "LEADERBOARD_NOT_AVAILABLE",
    });
  });
});

describe("updateScore", () => {
  it("updates 0 to 85, bumps the version, and writes an audit entry", async () => {
    const event = await makeEvent({ scoringFormat: "scoreBased", eventSlug: "s2" });
    const registration = await confirmRegistration(event, "p1@example.com");
    await scoreService.initializeScores(String(event._id));

    const updated = await scoreService.updateScore({
      eventId: String(event._id),
      registrationId: String(registration._id),
      newScore: 85,
      expectedVersion: 0,
      actorUserId: admin.user._id,
      festId: String(fest._id),
    });

    expect(updated.score).toBe(85);
    expect(updated.version).toBe(1);

    const audit = await AuditLogModel.findOne({ action: "score.updated" }).lean();
    expect(audit.beforeState.score).toBe(0);
    expect(audit.afterState.score).toBe(85);
  });

  it("refuses a stale write with MATCH_CONCURRENT_UPDATE", async () => {
    const event = await makeEvent({ scoringFormat: "scoreBased", eventSlug: "s3" });
    const registration = await confirmRegistration(event, "p1@example.com");
    await scoreService.initializeScores(String(event._id));

    // Both coordinators read version 0; the first write wins.
    await scoreService.updateScore({
      eventId: String(event._id),
      registrationId: String(registration._id),
      newScore: 50,
      expectedVersion: 0,
      actorUserId: admin.user._id,
    });

    await expect(
      scoreService.updateScore({
        eventId: String(event._id),
        registrationId: String(registration._id),
        newScore: 60,
        expectedVersion: 0,
        actorUserId: admin.user._id,
      })
    ).rejects.toMatchObject({ errorCode: "MATCH_CONCURRENT_UPDATE" });
  });
});

describe("getLeaderboard", () => {
  it("returns scores sorted descending when visible, empty when hidden", async () => {
    const event = await makeEvent({
      scoringFormat: "scoreBased",
      eventSlug: "s4",
      isLeaderboardVisible: true,
    });
    const low = await confirmRegistration(event, "low@example.com");
    const high = await confirmRegistration(event, "high@example.com");
    const mid = await confirmRegistration(event, "mid@example.com");
    await scoreService.initializeScores(String(event._id));

    for (const [registration, score] of [
      [low, 10],
      [high, 90],
      [mid, 40],
    ]) {
      await scoreService.updateScore({
        eventId: String(event._id),
        registrationId: String(registration._id),
        newScore: score,
        expectedVersion: 0,
        actorUserId: admin.user._id,
      });
    }

    const leaderboard = await scoreService.getLeaderboard(String(event._id));
    expect(leaderboard.map((row) => row.score)).toEqual([90, 40, 10]);
    expect(leaderboard.map((row) => row.rank)).toEqual([1, 2, 3]);

    await EventModel.updateOne({ _id: event._id }, { isLeaderboardVisible: false });
    expect(await scoreService.getLeaderboard(String(event._id))).toEqual([]);
  });
});

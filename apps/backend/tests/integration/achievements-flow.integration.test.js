import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { AchievementModel } from "../../src/models/achievement-model.js";
import { SelfDeclaredAchievementModel } from "../../src/models/self-declared-achievement-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { CollegeModel } from "../../src/models/college-model.js";
import { MatchModel } from "../../src/models/match-model.js";
import { EventScoreModel } from "../../src/models/event-score-model.js";
import { CertificateModel } from "../../src/models/certificate-model.js";
import { TeamModel } from "../../src/models/team-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
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
  createTestParticipant,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

// The badge award after a registration is fire-and-forget, so it may land a few
// microtasks after the HTTP response. Retry the assertion rather than sleep.
async function eventually(assertionFn) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await assertionFn();
    if (result) return result;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("condition not met in time");
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    AchievementModel.createIndexes(),
    SelfDeclaredAchievementModel.createIndexes(),
    RegistrationModel.createIndexes(),
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
    CollegeModel.createIndexes(),
    MatchModel.createIndexes(),
    EventScoreModel.createIndexes(),
    CertificateModel.createIndexes(),
    TeamModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
});

afterAll(teardownTestDatabase);

describe("achievements", () => {
  it("awards 1st and 2nd from a finalized bracket final, idempotently", async () => {
    const event = await createTestEvent(fest, admin.user, {
      eventSlug: "bracket-2027",
      scoringFormat: "bracketSingleElimination",
      status: "completed",
    });
    const winner = await createTestParticipant(college, { emailAddress: "winner@example.com" });
    const runnerUp = await createTestParticipant(college, { emailAddress: "runner@example.com" });

    // The final round: a single finalized match, winner decided.
    await MatchModel.create({
      eventId: event._id,
      roundNumber: 1,
      matchNumberInRound: 1,
      participantAUserId: winner.user._id,
      participantBUserId: runnerUp.user._id,
      winnerUserId: winner.user._id,
      isFinalized: true,
    });

    const awardPath = `/api/v1/fests/${fest.id}/events/${event.id}/award-results`;
    const first = await withToken(request(application).post(awardPath), admin.authenticationToken);
    expect(first.status).toBe(200);
    expect(first.body.data.awardedCount).toBe(2);

    const winnerRows = await AchievementModel.find({
      userId: winner.user._id,
      achievementType: "eventResult",
    }).lean();
    expect(winnerRows).toHaveLength(1);
    expect(winnerRows[0].metadata.placement).toBe(1);

    const runnerRows = await AchievementModel.find({
      userId: runnerUp.user._id,
      achievementType: "eventResult",
    }).lean();
    expect(runnerRows).toHaveLength(1);
    expect(runnerRows[0].metadata.placement).toBe(2);

    // Idempotent: a second call awards nothing more.
    const second = await withToken(request(application).post(awardPath), admin.authenticationToken);
    expect(second.status).toBe(200);
    expect(second.body.data.awardedCount).toBe(0);
    expect(await AchievementModel.countDocuments({ eventId: event._id })).toBe(2);
  });

  it("refuses award-results when nothing is finalized", async () => {
    const event = await createTestEvent(fest, admin.user, {
      eventSlug: "unfinalized-2027",
      scoringFormat: "scoreBased",
      status: "completed",
    });
    const response = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/events/${event.id}/award-results`),
      admin.authenticationToken
    );
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("RESULTS_NOT_FINALIZED");
  });

  it("grants the firstFest badge after a first registration is confirmed", async () => {
    const event = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "free-solo-2027", capacity: 5 })
    );
    const participant = await createTestParticipant(college);

    const registerResponse = await withToken(
      request(application).post(`/api/v1/events/${event.id}/registrations/solo`),
      participant.authenticationToken
    ).send({});
    expect(registerResponse.status).toBe(201);

    const badge = await eventually(async () => {
      const listing = await withToken(
        request(application).get("/api/v1/users/me/achievements"),
        participant.authenticationToken
      );
      return listing.body.data.find(
        (item) => item.achievementType === "badge" && item.title === "First Fest"
      );
    });
    expect(badge).toBeTruthy();
    expect(badge.isVerified).toBe(true);
    expect(badge.source).toBe("system");
  });

  it("shows a self-declared achievement with source selfDeclared and unverified", async () => {
    const participant = await createTestParticipant(college);

    const created = await withToken(
      request(application).post("/api/v1/users/me/achievements"),
      participant.authenticationToken
    ).send({ title: "Captained the state team", description: "Regional finals, 2026." });
    expect(created.status).toBe(201);

    const listing = await withToken(
      request(application).get("/api/v1/users/me/achievements"),
      participant.authenticationToken
    );
    expect(listing.status).toBe(200);
    const item = listing.body.data.find((entry) => entry.title === "Captained the state team");
    expect(item).toBeTruthy();
    expect(item.achievementType).toBe("selfDeclared");
    expect(item.source).toBe("selfDeclared");
    expect(item.isVerified).toBe(false);
  });

  it("hides non-visible self-declared achievements from another user's view", async () => {
    const owner = await createTestParticipant(college);
    const viewer = await createTestParticipant(college, { emailAddress: "viewer@example.com" });

    await SelfDeclaredAchievementModel.create({
      userId: owner.user._id,
      title: "Public claim",
      isVisible: true,
    });
    await SelfDeclaredAchievementModel.create({
      userId: owner.user._id,
      title: "Private claim",
      isVisible: false,
    });

    const publicView = await withToken(
      request(application).get(`/api/v1/users/${owner.user._id}/achievements`),
      viewer.authenticationToken
    );
    expect(publicView.status).toBe(200);
    const titles = publicView.body.data.map((entry) => entry.title);
    expect(titles).toContain("Public claim");
    expect(titles).not.toContain("Private claim");

    // The owner still sees both through their own view.
    const ownerView = await withToken(
      request(application).get("/api/v1/users/me/achievements"),
      owner.authenticationToken
    );
    const ownerTitles = ownerView.body.data.map((entry) => entry.title);
    expect(ownerTitles).toContain("Private claim");
  });

  it("awards the top three of a finalized leaderboard with correct placements", async () => {
    const event = await createTestEvent(fest, admin.user, {
      eventSlug: "quiz-2027",
      scoringFormat: "scoreBased",
      status: "completed",
    });
    const gold = await createTestParticipant(college, { emailAddress: "gold@example.com" });
    const silver = await createTestParticipant(college, { emailAddress: "silver@example.com" });
    const bronze = await createTestParticipant(college, { emailAddress: "bronze@example.com" });

    const rows = [
      { user: gold, score: 30 },
      { user: silver, score: 20 },
      { user: bronze, score: 10 },
    ];
    for (const row of rows) {
      await EventScoreModel.create({
        eventId: event._id,
        registrationId: new mongoose.Types.ObjectId(),
        userId: row.user.user._id,
        score: row.score,
        isFinalized: true,
      });
    }

    const response = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/events/${event.id}/award-results`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    expect(response.body.data.awardedCount).toBe(3);

    const placementFor = async (user) => {
      const row = await AchievementModel.findOne({
        userId: user.user._id,
        eventId: event._id,
        achievementType: "eventResult",
      }).lean();
      return row ? row.metadata.placement : null;
    };
    expect(await placementFor(gold)).toBe(1);
    expect(await placementFor(silver)).toBe(2);
    expect(await placementFor(bronze)).toBe(3);
  });

  it("surfaces a released certificate as a certificate-type achievement", async () => {
    const event = await createTestEvent(fest, admin.user, { eventSlug: "cert-event-2027" });
    const participant = await createTestParticipant(college);

    await CertificateModel.create({
      userId: participant.user._id,
      festId: fest._id,
      eventId: event._id,
      certificateType: "participation",
      verificationCode: "ABCD1234ABCD1234",
      status: "released",
      releasedAt: new Date("2027-03-05T00:00:00.000Z"),
      metadata: { eventName: "Robowars 2027", festName: "Alliance ONE 2027" },
    });

    const listing = await withToken(
      request(application).get("/api/v1/users/me/achievements"),
      participant.authenticationToken
    );
    expect(listing.status).toBe(200);
    const certItem = listing.body.data.find((entry) => entry.achievementType === "certificate");
    expect(certItem).toBeTruthy();
    expect(certItem.title).toBe("Robowars 2027");
    expect(certItem.source).toBe("certificate");
    expect(certItem.isVerified).toBe(true);
  });
});

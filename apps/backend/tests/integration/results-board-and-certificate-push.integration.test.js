import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { CertificateModel } from "../../src/models/certificate-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
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
  createTestStaffMember,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let event; // scoreBased, ongoing — scorable and certifiable
let participants;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

async function registerConfirmed(user) {
  return RegistrationModel.create({
    eventId: event._id,
    userId: user._id,
    status: "confirmed",
    feeAmountSnapshotPaise: 0,
    totalFeePaise: 0,
    registeredAt: new Date(),
  });
}

/* Finalized top-3 through the real endpoints: initialize → score → finalize → award. */
async function scoreFinalizeAndAward(scores) {
  await withToken(
    request(application).post(`/api/v1/fests/${fest.id}/events/${event.id}/scores/initialize`),
    admin.authenticationToken
  );
  const leaderboard = await request(application).get(
    `/api/v1/fests/${fest.id}/events/${event.id}/leaderboard`
  );
  for (const [index, row] of leaderboard.body.data.entries()) {
    await withToken(
      request(application).patch(
        `/api/v1/fests/${fest.id}/events/${event.id}/scores/${row.registrationId}`
      ),
      admin.authenticationToken
    ).send({ score: scores[index] ?? 0, expectedVersion: 0 });
  }
  await withToken(
    request(application).post(`/api/v1/fests/${fest.id}/events/${event.id}/scores/finalize`),
    admin.authenticationToken
  );
  await withToken(
    request(application).post(`/api/v1/fests/${fest.id}/events/${event.id}/award-results`),
    admin.authenticationToken
  );
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user, {
    scoringFormat: "scoreBased",
    status: "ongoing",
    isLeaderboardVisible: true,
  });
  participants = [];
  for (let index = 0; index < 4; index += 1) {
    const participant = await createTestParticipant(college, {
      emailAddress: `scored-${index}@example.com`,
      usn: `1AA00AA10${index}`,
      fullName: `Scored Person ${index}`,
    });
    await registerConfirmed(participant.user);
    participants.push(participant);
  }
});

describe("coordinator non-bracket scoring authority", () => {
  it("a coordinator can PATCH a score; finalize and award-results are 403 for them", async () => {
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "score-coordinator@example.com",
      assignment: { eventIds: [event._id] },
    });

    await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/events/${event.id}/scores/initialize`),
      coordinator.authenticationToken
    );
    const leaderboard = await request(application).get(
      `/api/v1/fests/${fest.id}/events/${event.id}/leaderboard`
    );
    const firstRow = leaderboard.body.data[0];

    const patched = await withToken(
      request(application).patch(
        `/api/v1/fests/${fest.id}/events/${event.id}/scores/${firstRow.registrationId}`
      ),
      coordinator.authenticationToken
    ).send({ score: 42, expectedVersion: 0 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.score).toBe(42);

    const finalized = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/events/${event.id}/scores/finalize`),
      coordinator.authenticationToken
    );
    expect(finalized.status).toBe(403);

    const awarded = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/events/${event.id}/award-results`),
      coordinator.authenticationToken
    );
    expect(awarded.status).toBe(403);
  });
});

describe("certificate pushes", () => {
  it("push-winners issues released top-3 certificates and is idempotent", async () => {
    await scoreFinalizeAndAward([100, 90, 80, 70]);

    const first = await withToken(
      request(application).post(
        `/api/v1/fests/${fest.id}/events/${event.id}/certificates/push-winners`
      ),
      admin.authenticationToken
    );
    expect(first.status).toBe(200);
    expect(first.body.data.generatedCount).toBe(3);
    expect(first.body.data.releasedCount).toBe(3);

    const second = await withToken(
      request(application).post(
        `/api/v1/fests/${fest.id}/events/${event.id}/certificates/push-winners`
      ),
      admin.authenticationToken
    );
    expect(second.status).toBe(200);
    expect(second.body.data.generatedCount).toBe(0);
    expect(second.body.data.releasedCount).toBe(0);

    const winnerCertificates = await CertificateModel.find({
      eventId: event._id,
      certificateType: { $in: ["winner1st", "winner2nd", "winner3rd"] },
    }).lean();
    expect(winnerCertificates).toHaveLength(3);
    expect(winnerCertificates.every((row) => row.status === "released")).toBe(true);

    const auditRow = await AuditLogModel.findOne({ action: "certificates.pushedWinners" }).lean();
    expect(auditRow.afterState).toMatchObject({ generatedCount: 3, releasedCount: 3 });
  });

  it("push-participation covers all standing registrants, skips winners, and is idempotent", async () => {
    await scoreFinalizeAndAward([100, 90, 80, 70]);
    await withToken(
      request(application).post(
        `/api/v1/fests/${fest.id}/events/${event.id}/certificates/push-winners`
      ),
      admin.authenticationToken
    );

    const first = await withToken(
      request(application).post(
        `/api/v1/fests/${fest.id}/events/${event.id}/certificates/push-participation`
      ),
      admin.authenticationToken
    );
    expect(first.status).toBe(200);
    // 4 confirmed registrants, 3 already hold winner certificates (the unique
    // index makes those inserts no-ops) — one new participation certificate.
    expect(first.body.data.generatedCount).toBe(1);
    expect(first.body.data.releasedCount).toBe(1);

    const second = await withToken(
      request(application).post(
        `/api/v1/fests/${fest.id}/events/${event.id}/certificates/push-participation`
      ),
      admin.authenticationToken
    );
    expect(second.body.data.generatedCount).toBe(0);
    expect(second.body.data.releasedCount).toBe(0);

    const auditRow = await AuditLogModel.findOne({
      action: "certificates.pushedParticipation",
    }).lean();
    expect(auditRow).not.toBeNull();
  });

  it("push-winners without awarded results is a 409", async () => {
    const response = await withToken(
      request(application).post(
        `/api/v1/fests/${fest.id}/events/${event.id}/certificates/push-winners`
      ),
      admin.authenticationToken
    );
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("RESULTS_NOT_FINALIZED");
  });
});

describe("results board", () => {
  it("returns leaderboard for score events and the winner for bracket events, in one call", async () => {
    await scoreFinalizeAndAward([100, 90, 80, 70]);

    // A bracket event whose final already stamped a winner registration.
    const bracketEvent = await createTestEvent(fest, admin.user, {
      eventSlug: "bracket-event",
      eventName: "Bracket Event",
      scoringFormat: "bracketSingleElimination",
      status: "ongoing",
    });
    const champion = await createTestParticipant(college, {
      emailAddress: "champion@example.com",
      usn: "1AA00AA200",
      fullName: "Bracket Champion",
    });
    await RegistrationModel.create({
      eventId: bracketEvent._id,
      userId: champion.user._id,
      status: "winner1st",
      feeAmountSnapshotPaise: 0,
      totalFeePaise: 0,
      registeredAt: new Date(),
    });

    const response = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/results-board`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    const { events } = response.body.data;
    expect(events).toHaveLength(2);

    const scoreBoard = events.find((row) => row.scoringFormat === "scoreBased");
    expect(scoreBoard.confirmedCount).toBe(4);
    expect(scoreBoard.leaderboard[0]).toMatchObject({ rank: 1, score: 100, isFinalized: true });
    expect(scoreBoard.achievementCount).toBe(3);

    const bracketBoard = events.find(
      (row) => row.scoringFormat === "bracketSingleElimination"
    );
    expect(bracketBoard.leaderboard).toEqual([]);
    expect(bracketBoard.bracketWinnerName).toBe("Bracket Champion");
    expect(bracketBoard.confirmedCount).toBe(1);
  });
});

/*
 * per-event-analytics.integration.test.js
 *
 * The per-event deep block: capacity projection, co-registration, round
 * drop-off, team size distribution, dwell time, revenue per registrant and the
 * comparison against the fest average.
 *
 * THESE ARE THE ARITHMETIC EDGE CASES, not a smoke test. Every one of the seven
 * named below is a place where the obvious implementation returns Infinity,
 * NaN, or a number that is quietly wrong in a way nobody notices until an
 * organiser reconciles it against something real:
 *
 *   - dividing remaining slots by a velocity of zero;
 *   - counting a co-registration twice because a user has two rows;
 *   - measuring round drop-off against the previous round instead of the first;
 *   - averaging dwell over people who never scanned out;
 *   - gross / 0 registrations.
 *
 * The empty-data case is tested as carefully as the populated one, because a
 * freshly created event is the state an organiser opens this screen in most
 * often and an analytics panel must never be the thing that fails a dashboard.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { TeamModel } from "../../src/models/team-model.js";
import { RoundModel } from "../../src/models/round-model.js";
import { CheckpointModel } from "../../src/models/checkpoint-model.js";
import { ScanModel } from "../../src/models/scan-model.js";
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
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();

const {
  getPerEventDeepAnalytics,
  buildCapacityProjection,
  buildAttendanceInsights,
} = await import("../../src/services/per-event-analytics-service.js");

let college;
let admin;
let fest;
let mainEvent;
let participantCounter = 0;

async function addConfirmed(event, { teamId = null, feePaise = 0 } = {}) {
  participantCounter += 1;
  const participant = await createTestParticipant(college, {
    emailAddress: `pev${participantCounter}@example.com`,
    usn: `1AN00PE${participantCounter.toString().padStart(3, "0")}`,
  });
  await RegistrationModel.create({
    eventId: event._id,
    userId: participant.user._id,
    teamId,
    status: "confirmed",
    feeAmountSnapshotPaise: feePaise,
    totalFeePaise: feePaise,
    registeredAt: new Date(),
  });
  return participant.user;
}

function runDeep(eventIds, { confirmed, grossRevenuePaise = 0, perDay = [] }) {
  return getPerEventDeepAnalytics({
    festId: fest._id,
    eventIds,
    scopedFunnel: { registrationsConfirmed: confirmed },
    grossRevenuePaise,
    registrationsPerDay: perDay,
  });
}

beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(async () => {
  await teardownTestDatabase();
});

beforeEach(async () => {
  await clearAllCollections();
  participantCounter = 0;
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user);
  mainEvent = await createTestEvent(fest, admin.user, {
    eventName: "Robowars",
    eventSlug: "robowars",
    capacity: 50,
  });
});

describe("capacity fill projection", () => {
  it("reports stalled rather than dividing by a velocity of zero", () => {
    const projection = buildCapacityProjection({
      capacity: 50,
      confirmedCount: 10,
      registrationsPerDayRecent: 0,
    });

    expect(projection.status).toBe("stalled");
    expect(projection.daysToFill).toBeNull();
    expect(projection.projectedFullOn).toBeNull();
    /* The fill itself is still a real number — only the FORECAST is withheld. */
    expect(projection.fill.rate).toBeCloseTo(0.2);
    expect(projection.remainingSlots).toBe(40);
  });

  it("projects a fill date from a positive velocity", () => {
    const projection = buildCapacityProjection({
      capacity: 50,
      confirmedCount: 30,
      registrationsPerDayRecent: 4,
    });

    expect(projection.status).toBe("projected");
    expect(projection.daysToFill).toBe(5);
    expect(Number.isFinite(new Date(projection.projectedFullOn).getTime())).toBe(true);
  });

  it("reports full without a projection once the capacity is reached", () => {
    const projection = buildCapacityProjection({
      capacity: 50,
      confirmedCount: 50,
      registrationsPerDayRecent: 4,
    });

    expect(projection.status).toBe("full");
    expect(projection.remainingSlots).toBe(0);
    expect(projection.projectedFullOn).toBeNull();
  });

  it("reports noCapacity for an uncapped event instead of a fill rate of Infinity", () => {
    const projection = buildCapacityProjection({
      capacity: null,
      confirmedCount: 30,
      registrationsPerDayRecent: 4,
    });

    expect(projection.status).toBe("noCapacity");
    expect(projection.fill.rate).toBe(0);
    expect(Number.isFinite(projection.fill.rate)).toBe(true);
  });
});

describe("dwell time", () => {
  const userA = new mongoose.Types.ObjectId();
  const userB = new mongoose.Types.ObjectId();

  it("averages only over people who scanned both in and out", () => {
    const base = new Date("2026-03-01T04:30:00.000Z").getTime(); // 10:00 IST
    const insights = buildAttendanceInsights(
      [
        { userId: userA, direction: "in", scannedAt: new Date(base) },
        { userId: userA, direction: "out", scannedAt: new Date(base + 2 * 3600000) },
        /* B never scans out — must not be averaged in as a zero-length stay,
           which would halve the reported average. */
        { userId: userB, direction: "in", scannedAt: new Date(base) },
      ],
      new Set([String(userA), String(userB)])
    );

    expect(insights.dwell.observed).toBe(true);
    expect(insights.dwell.sampleCount).toBe(1);
    expect(insights.dwell.averageMinutes).toBe(120);
  });

  it("reports dwell as unobserved when no check-out scans exist", () => {
    const base = new Date("2026-03-01T04:30:00.000Z").getTime();
    const insights = buildAttendanceInsights(
      [{ userId: userA, direction: "in", scannedAt: new Date(base) }],
      new Set([String(userA)])
    );

    /*
     * `observed: false`, not `averageMinutes: 0`. Most fests run IN_ONLY doors,
     * and "average stay: 0h 0m" reads as a measurement of the event rather than
     * of a door that was never configured.
     */
    expect(insights.dwell.observed).toBe(false);
    expect(insights.checkOutScanningObserved).toBe(false);
  });

  it("counts a re-entry as one arrival at its FIRST scan", () => {
    const morning = new Date("2026-03-01T04:30:00.000Z"); // 10:00 IST
    const afternoon = new Date("2026-03-01T09:30:00.000Z"); // 15:00 IST
    const insights = buildAttendanceInsights(
      [
        { userId: userA, direction: "in", scannedAt: morning },
        { userId: userA, direction: "in", scannedAt: afternoon },
      ],
      new Set([String(userA)])
    );

    expect(insights.checkInRate.numerator).toBe(1);
    /* Both scans still appear in the arrival histogram — it is a chart of scan
       events — but the person is one check-in. */
    expect(insights.scansByHour[10].count).toBe(1);
    expect(insights.scansByHour[15].count).toBe(1);
  });

  it("returns all 24 hours and a null peak when there are no scans", () => {
    const insights = buildAttendanceInsights([], new Set());

    expect(insights.scansByHour).toHaveLength(24);
    expect(insights.peakHour).toBeNull();
    expect(insights.checkInRate.rate).toBe(0);
    expect(insights.noShowRate.rate).toBe(0);
  });
});

describe("revenue per registrant", () => {
  it("returns zero, not NaN, with no confirmed registrations", async () => {
    const deep = await runDeep([mainEvent._id], { confirmed: 0, grossRevenuePaise: 0 });

    expect(deep.revenue.revenuePerRegistrantPaise).toBe(0);
    expect(Number.isNaN(deep.revenue.revenuePerRegistrantPaise)).toBe(false);
    expect(deep.revenue.addOnAttachRate.rate).toBe(0);
  });

  it("divides gross by the confirmed count", async () => {
    await addConfirmed(mainEvent, { feePaise: 20000 });
    await addConfirmed(mainEvent, { feePaise: 20000 });

    const deep = await runDeep([mainEvent._id], { confirmed: 2, grossRevenuePaise: 40000 });

    expect(deep.revenue.revenuePerRegistrantPaise).toBe(20000);
    expect(deep.revenue.freeVersusPaid).toEqual({ freeCount: 0, paidCount: 2 });
  });
});

describe("co-registration patterns", () => {
  it("counts each overlapping participant once per event", async () => {
    const alsoRan = await createTestEvent(fest, admin.user, {
      eventName: "Hackathon",
      eventSlug: "hackathon",
    });
    const unrelated = await createTestEvent(fest, admin.user, {
      eventName: "Quiz",
      eventSlug: "quiz",
    });

    const shared = await addConfirmed(mainEvent);
    await addConfirmed(mainEvent);
    /* The same user in the other event. A second row for the same pair would
       double-count without the distinct-pair grouping. */
    await RegistrationModel.create({
      eventId: alsoRan._id,
      userId: shared._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
      totalFeePaise: 0,
      registeredAt: new Date(),
    });
    await RegistrationModel.create({
      eventId: unrelated._id,
      userId: new mongoose.Types.ObjectId(),
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
      totalFeePaise: 0,
      registeredAt: new Date(),
    });

    const deep = await runDeep([mainEvent._id], { confirmed: 2 });

    /* Quiz has a registrant, but not one of OURS, so it is not an overlap. */
    expect(deep.coRegistration).toHaveLength(1);
    expect(deep.coRegistration[0].eventName).toBe("Hackathon");
    expect(deep.coRegistration[0].sharedParticipantCount).toBe(1);
    expect(deep.coRegistration[0].shareOfThisEvent.denominator).toBe(2);
  });

  it("never lists the subject event in its own overlaps", async () => {
    await addConfirmed(mainEvent);

    const deep = await runDeep([mainEvent._id], { confirmed: 1 });

    expect(deep.coRegistration.map((row) => row.eventId)).not.toContain(String(mainEvent._id));
  });
});

describe("per-round drop-off", () => {
  it("measures every round against the FIRST round, not the previous one", async () => {
    const common = { eventId: mainEvent._id, festId: fest._id, createdByUserId: admin.user._id };
    /* Inserted out of order to prove the sort is doing the work. */
    await RoundModel.create({
      ...common,
      roundNumber: 3,
      participantIds: [new mongoose.Types.ObjectId()],
    });
    await RoundModel.create({
      ...common,
      roundNumber: 1,
      participantIds: Array.from({ length: 8 }, () => new mongoose.Types.ObjectId()),
    });
    await RoundModel.create({
      ...common,
      roundNumber: 2,
      participantIds: Array.from({ length: 4 }, () => new mongoose.Types.ObjectId()),
    });

    const deep = await runDeep([mainEvent._id], { confirmed: 8 });

    expect(deep.rounds.map((round) => round.roundNumber)).toEqual([1, 2, 3]);
    expect(deep.rounds.map((round) => round.participantCount)).toEqual([8, 4, 1]);
    /*
     * Against the first round: 100%, 50%, 12.5%. Against the PREVIOUS round it
     * would be 100%, 50%, 25% — and rounds 2 and 3 would look equally healthy
     * when the third is a quarter the size of the second.
     */
    expect(deep.rounds.map((round) => round.shareOfFirstRound.rate)).toEqual([1, 0.5, 0.125]);
  });

  it("returns an empty list for an event with no rounds", async () => {
    const deep = await runDeep([mainEvent._id], { confirmed: 0 });

    expect(deep.rounds).toEqual([]);
  });
});

describe("team insights", () => {
  it("builds a size distribution and counts teams at full capacity", async () => {
    const teamEvent = await createTestEvent(fest, admin.user, {
      eventName: "Battle of Bands",
      eventSlug: "battle-of-bands",
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 4,
    });
    const makeMembers = (count) =>
      Array.from({ length: count }, () => new mongoose.Types.ObjectId());

    for (const [size, status] of [
      [4, "locked"],
      [4, "locked"],
      [3, "locked"],
      [2, "forming"],
    ]) {
      const members = makeMembers(size);
      await TeamModel.create({
        eventId: teamEvent._id,
        festId: fest._id,
        teamName: `Team ${size}-${status}-${Math.random().toString(36).slice(2, 8)}`,
        leaderUserId: members[0],
        memberUserIds: members,
        inviteCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        status,
      });
    }

    const deep = await runDeep([teamEvent._id], { confirmed: 13 });

    expect(deep.teams.isTeamEvent).toBe(true);
    expect(deep.teams.totalTeams).toBe(4);
    expect(deep.teams.sizeDistribution).toEqual([
      { size: 2, teamCount: 1 },
      { size: 3, teamCount: 1 },
      { size: 4, teamCount: 2 },
    ]);
    expect(deep.teams.averageTeamSize).toBe(3.3);
    expect(deep.teams.teamsAtFullCapacity).toBe(2);
    expect(deep.teams.teamsWithOpenSlots).toBe(2);
    expect(deep.teams.teamsLocked).toBe(3);
    expect(deep.teams.teamsForming).toBe(1);
    /* Every team carries exactly one auto-generated code, so "generated" is the
       team count and "redeemed" is the teams that grew past their leader. */
    expect(deep.teams.inviteCodes.generated).toBe(4);
    expect(deep.teams.inviteCodes.redeemedProxy).toBe(4);
  });

  it("reports isTeamEvent false for a solo event rather than empty team stats", async () => {
    const deep = await runDeep([mainEvent._id], { confirmed: 0 });

    expect(deep.teams.isTeamEvent).toBe(false);
    expect(deep.teams.totalTeams).toBe(0);
    expect(deep.teams.averageTeamSize).toBe(0);
  });
});

describe("comparison against the fest average", () => {
  it("ranks the event and computes the average over participating events only", async () => {
    const second = await createTestEvent(fest, admin.user, {
      eventName: "Hackathon",
      eventSlug: "hackathon",
    });
    /* An event with no registrations at all — excluded from the average, which
       would otherwise be dragged down by every unopened event in the fest. */
    await createTestEvent(fest, admin.user, { eventName: "Empty", eventSlug: "empty" });

    await addConfirmed(mainEvent, { feePaise: 10000 });
    await addConfirmed(mainEvent, { feePaise: 10000 });
    await addConfirmed(mainEvent, { feePaise: 10000 });
    await addConfirmed(second, { feePaise: 10000 });

    const deep = await runDeep([mainEvent._id], { confirmed: 3, grossRevenuePaise: 30000 });

    expect(deep.comparison.rank).toBe(1);
    /* Two events have registrations; the third is excluded. */
    expect(deep.comparison.rankedEventCount).toBe(2);
    expect(deep.comparison.festAverage.registrations).toBe(2);
    expect(deep.comparison.thisEvent.registrations).toBe(3);
    expect(deep.comparison.thisEvent.revenuePerHeadPaise).toBe(10000);
  });

  it("ranks second when another event has more registrations", async () => {
    const bigger = await createTestEvent(fest, admin.user, {
      eventName: "Hackathon",
      eventSlug: "hackathon",
    });
    await addConfirmed(mainEvent);
    await addConfirmed(bigger);
    await addConfirmed(bigger);

    const deep = await runDeep([mainEvent._id], { confirmed: 1 });

    expect(deep.comparison.rank).toBe(2);
  });
});

describe("empty event", () => {
  it("returns a complete zeroed block rather than throwing", async () => {
    const deep = await runDeep([mainEvent._id], { confirmed: 0 });

    expect(deep.event.eventName).toBe("Robowars");
    expect(deep.capacity.status).toBe("stalled");
    expect(deep.attendance.checkInRate.rate).toBe(0);
    expect(deep.attendance.scansByHour).toHaveLength(24);
    expect(deep.revenue.grossRevenuePaise).toBe(0);
    expect(deep.certificates.totalIssued).toBe(0);
    expect(deep.certificates.participationCoverage.rate).toBe(0);
    expect(deep.coRegistration).toEqual([]);
    expect(deep.soloVersusTeam).toEqual({ soloCount: 0, teamCount: 0 });
  });
});

describe("check-in rate through real checkpoints", () => {
  it("counts distinct attendees and derives the no-show rate from them", async () => {
    const attending = await addConfirmed(mainEvent);
    await addConfirmed(mainEvent);

    const checkpoint = await CheckpointModel.create({
      festId: fest._id,
      eventId: mainEvent._id,
      checkpointName: "Robowars door",
      checkpointType: "eventEntry",
      directionMode: "inOnly",
      createdByUserId: admin.user._id,
    });
    /* Two scans, one person — the rate must be 1 of 2, not 2 of 2. */
    for (const offsetMinutes of [0, 5]) {
      await ScanModel.create({
        clientScanId: `scan-${offsetMinutes}`,
        festId: fest._id,
        userId: attending._id,
        checkpointId: checkpoint._id,
        scannedByUserId: admin.user._id,
        scanMethod: "qr",
        direction: "in",
        result: "accepted",
        scannedAt: new Date(Date.now() + offsetMinutes * 60000),
      });
    }

    const deep = await runDeep([mainEvent._id], { confirmed: 2 });

    expect(deep.attendance.checkInRate.numerator).toBe(1);
    expect(deep.attendance.checkInRate.denominator).toBe(2);
    expect(deep.attendance.noShowRate.numerator).toBe(1);
  });
});

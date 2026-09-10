import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import { PassModel } from "../../src/models/pass-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
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
  createTestPass,
  createTestEventEntitlement,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

/*
 * What the pass endpoint has to answer, and could not.
 *
 * An eventEntry entitlement knew WHICH event it opened and nothing else: not the
 * team the holder competes with, not the round they are due at. Neither belongs
 * on the entitlement document — a team gets renamed and rounds get rescheduled,
 * and a stored copy would drift — so both are joined at read time. These tests
 * pin the join results AND the cost of doing them, because this is the endpoint
 * a volunteer hits at a door.
 *
 * On the shape of the join: a registration has no passId. It is reached through
 * (pass.userId, entitlement.referenceId) — the participant and the event — which
 * is the registration's own unique key. And a round is a CHILD EVENT
 * (Event.parentEventId), which is what the rest of the platform means by the
 * word; the separate Round collection carries no startsAt/endsAt/venue at all.
 */

let college;
let admin;
let fest;
let participant;
let pass;

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

function asParticipant(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${participant.authenticationToken}`);
}

function fetchMyPass() {
  return asParticipant(request(application).get("/api/v1/passes/mine").query({ festId: fest.id }));
}

function hoursFromNow(hourCount) {
  return new Date(Date.now() + hourCount * MILLISECONDS_PER_HOUR);
}

async function createParentEvent(overrides = {}) {
  return createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({
      eventName: "Hackathon",
      eventSlug: `hackathon-${new mongoose.Types.ObjectId()}`,
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 4,
      capacity: 20,
      ...overrides,
    })
  );
}

async function createRound(parentEvent, roundName, startsAt, endsAt, overrides = {}) {
  return createTestEvent(fest, admin.user, {
    ...openRegistrationOverrides(),
    parentEventId: parentEvent._id,
    eventName: roundName,
    eventSlug: `${roundName.toLowerCase().replace(/\s+/g, "-")}-${new mongoose.Types.ObjectId()}`,
    venue: `${roundName} Hall`,
    // A round's own registration window has to sit before it runs, and these
    // rounds are deliberately placed in the past and the future around "now".
    registrationOpensAt: new Date(startsAt.getTime() - 48 * MILLISECONDS_PER_HOUR),
    registrationClosesAt: new Date(startsAt.getTime() - MILLISECONDS_PER_HOUR),
    startsAt,
    endsAt,
    ...overrides,
  });
}

async function createTeamRegistration(event, teamName, overrides = {}) {
  const team = await TeamModel.create({
    eventId: event._id,
    teamName,
    leaderUserId: participant.user._id,
    memberUserIds: [participant.user._id],
    // Unique per team: the invite code carries a unique index.
    inviteCode: String(new mongoose.Types.ObjectId()).slice(-8).toUpperCase(),
    ...overrides.team,
  });
  await RegistrationModel.create({
    eventId: event._id,
    userId: participant.user._id,
    teamId: team._id,
    feeAmountSnapshotPaise: 0,
    ...overrides.registration,
  });
  return team;
}

function findEventEntitlement(responseBody, eventId) {
  return responseBody.data.entitlements.find(
    (entitlement) =>
      entitlement.entitlementType === "eventEntry" &&
      String(entitlement.referenceId?.id ?? entitlement.referenceId) === String(eventId)
  );
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    PassModel.createIndexes(),
    EntitlementModel.createIndexes(),
    EventModel.createIndexes(),
    RegistrationModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  participant = await createTestParticipant(college);
  pass = await createTestPass(fest, participant.user);
});

afterAll(teardownTestDatabase);

describe("GET /api/v1/passes/mine — teamName on an eventEntry entitlement", () => {
  it("carries the team's name when the holder registered as a team", async () => {
    const event = await createParentEvent();
    await createTestEventEntitlement(pass, event._id);
    await createTeamRegistration(event, "Byte Me");

    const response = await fetchMyPass();

    expect(response.status).toBe(200);
    expect(findEventEntitlement(response.body, event._id).teamName).toBe("Byte Me");
  });

  it("is null for a solo registration — there is no team to name", async () => {
    const event = await createParentEvent({
      eventType: "solo",
      minimumTeamSize: 1,
      maximumTeamSize: 1,
    });
    await createTestEventEntitlement(pass, event._id);
    await RegistrationModel.create({
      eventId: event._id,
      userId: participant.user._id,
      teamId: null,
      feeAmountSnapshotPaise: 0,
    });

    const response = await fetchMyPass();

    expect(response.status).toBe(200);
    expect(findEventEntitlement(response.body, event._id).teamName).toBeNull();
  });

  it("is null for a manually granted entitlement with no registration behind it", async () => {
    const event = await createParentEvent();
    await createTestEventEntitlement(pass, event._id, { source: "manualGrant" });

    const response = await fetchMyPass();

    expect(response.status).toBe(200);
    expect(findEventEntitlement(response.body, event._id).teamName).toBeNull();
  });
});

describe("GET /api/v1/passes/mine — activeRound on an eventEntry entitlement", () => {
  it("returns the LIVE round when one is running right now", async () => {
    const event = await createParentEvent();
    await createTestEventEntitlement(pass, event._id);
    await createRound(event, "Round One", hoursFromNow(-6), hoursFromNow(-4));
    await createRound(event, "Round Two", hoursFromNow(-1), hoursFromNow(1));
    await createRound(event, "Round Three", hoursFromNow(4), hoursFromNow(6));

    const response = await fetchMyPass();

    const { activeRound } = findEventEntitlement(response.body, event._id);
    expect(activeRound.eventName).toBe("Round Two");
    expect(activeRound.status).toBe("live");
    expect(activeRound.venue).toBe("Round Two Hall");
    expect(new Date(activeRound.startsAt).getTime()).toBeLessThan(Date.now());
    expect(new Date(activeRound.endsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns the NEXT UPCOMING round when none is live", async () => {
    const event = await createParentEvent();
    await createTestEventEntitlement(pass, event._id);
    await createRound(event, "Round One", hoursFromNow(-6), hoursFromNow(-4));
    await createRound(event, "Round Two", hoursFromNow(2), hoursFromNow(3));
    await createRound(event, "Round Three", hoursFromNow(5), hoursFromNow(6));

    const response = await fetchMyPass();

    const { activeRound } = findEventEntitlement(response.body, event._id);
    expect(activeRound.eventName).toBe("Round Two");
    expect(activeRound.status).toBe("upcoming");
  });

  it("returns the LAST COMPLETED round when every round is past", async () => {
    const event = await createParentEvent();
    await createTestEventEntitlement(pass, event._id);
    await createRound(event, "Round One", hoursFromNow(-9), hoursFromNow(-8));
    await createRound(event, "Round Two", hoursFromNow(-6), hoursFromNow(-5));
    await createRound(event, "Round Three", hoursFromNow(-3), hoursFromNow(-2));

    const response = await fetchMyPass();

    const { activeRound } = findEventEntitlement(response.body, event._id);
    expect(activeRound.eventName).toBe("Round Three");
    expect(activeRound.status).toBe("completed");
  });

  it("is null for an event with no rounds", async () => {
    const event = await createParentEvent();
    await createTestEventEntitlement(pass, event._id);

    const response = await fetchMyPass();

    expect(findEventEntitlement(response.body, event._id).activeRound).toBeNull();
  });
});

describe("GET /api/v1/passes/mine — the enrichment costs at most two queries", () => {
  /*
   * Counted through mongoose's debug hook, which fires once per operation the
   * driver actually sends (find, aggregate, findOne…). The baseline is MEASURED,
   * not asserted against a hardcoded number: the two enrichment helpers are
   * swapped for empty-map stubs, the same request is replayed, and the delta
   * between the two counts is the whole cost of the feature.
   */
  async function countQueriesForRequest() {
    let queryCount = 0;
    mongoose.set("debug", () => {
      queryCount += 1;
    });
    try {
      const response = await fetchMyPass();
      expect(response.status).toBe(200);
      return { queryCount, response };
    } finally {
      mongoose.set("debug", false);
    }
  }

  it("adds no more than 2 queries, and does not grow with the number of events", async () => {
    const { createRequire } = await import("node:module");
    const requireFromHere = createRequire(import.meta.url);
    const enrichmentHelpers = requireFromHere(
      "../../src/helpers/pass-entitlement-enrichment-helpers.js"
    );
    const realBuildTeamNameByEventId = enrichmentHelpers.buildTeamNameByEventId;
    const realBuildActiveRoundByEventId = enrichmentHelpers.buildActiveRoundByEventId;

    // Five registered events, each a team registration with three rounds — the
    // exact shape an N+1 would blow up on.
    const events = [];
    for (let eventIndex = 0; eventIndex < 5; eventIndex += 1) {
      const event = await createParentEvent({ eventName: `Hackathon ${eventIndex}` });
      await createTestEventEntitlement(pass, event._id);
      await createTeamRegistration(event, `Team ${eventIndex}`);
      await createRound(event, `Heat ${eventIndex}A`, hoursFromNow(-6), hoursFromNow(-4));
      await createRound(event, `Heat ${eventIndex}B`, hoursFromNow(-1), hoursFromNow(1));
      await createRound(event, `Heat ${eventIndex}C`, hoursFromNow(4), hoursFromNow(6));
      events.push(event);
    }

    // The pre-enrichment cost of the very same read.
    enrichmentHelpers.buildTeamNameByEventId = async () => new Map();
    enrichmentHelpers.buildActiveRoundByEventId = async () => new Map();
    let preEnrichmentQueryCount;
    try {
      ({ queryCount: preEnrichmentQueryCount } = await countQueriesForRequest());
    } finally {
      enrichmentHelpers.buildTeamNameByEventId = realBuildTeamNameByEventId;
      enrichmentHelpers.buildActiveRoundByEventId = realBuildActiveRoundByEventId;
    }

    const { queryCount: fiveEventQueryCount, response } = await countQueriesForRequest();

    // The stubs must really have been bypassed — otherwise the delta below would
    // be a comparison of two identical runs.
    expect(findEventEntitlement(response.body, events[0]._id).teamName).toBe("Team 0");
    expect(findEventEntitlement(response.body, events[4]._id).activeRound.status).toBe("live");

    expect(preEnrichmentQueryCount).toBeGreaterThan(0);
    expect(fiveEventQueryCount - preEnrichmentQueryCount).toBeLessThanOrEqual(2);

    // Same read with a SINGLE event must cost the same as with five: the
    // signature of batching, and the assertion an N+1 cannot survive.
    await EntitlementModel.deleteMany({
      passId: pass._id,
      entitlementType: "eventEntry",
      referenceId: { $ne: events[0]._id },
    });
    const { queryCount: oneEventQueryCount } = await countQueriesForRequest();
    expect(fiveEventQueryCount).toBe(oneEventQueryCount);
  });
});

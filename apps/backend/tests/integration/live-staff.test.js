import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { ScanModel } from "../../src/models/scan-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { CheckpointModel } from "../../src/models/checkpoint-model.js";
import { StaffAssignmentModel } from "../../src/models/staff-assignment-model.js";
import { VolunteerShiftModel } from "../../src/models/volunteer-shift-model.js";
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
  createTestStaffMember,
  createTestPass,
  createTestGateCheckpoint,
  createTestEventCheckpoint,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const { application } = await import("../../src/application.js");

const MISSING_ID = "000000000000000000000000";
const MINUTE = 60 * 1000;

let college;
let admin;
let fest;
let event;
let otherEvent;
let gateCheckpoint;
let eventCheckpoint;
let otherEventCheckpoint;
let eventCoordinator;
let otherEventCoordinator;
let volunteer;
let participant;
let pass;
let scanSequence;

function livePath(festId, eventId) {
  return `/api/v1/fests/${festId}/events/${eventId}/live-staff`;
}

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

function getLiveStaff(token, festId = fest._id, eventId = event._id) {
  return withToken(request(application).get(livePath(festId, eventId)), token);
}

/* clientScanId is uniquely indexed, so each seeded scan needs its own. */
async function seedScan(overrides = {}) {
  scanSequence += 1;
  return ScanModel.create({
    clientScanId: `client-scan-${scanSequence}`,
    passId: pass._id,
    checkpointId: eventCheckpoint._id,
    scannedByUserId: volunteer.user._id,
    scanMethod: "qr",
    direction: "in",
    result: "accepted",
    scannedAt: new Date(),
    ...overrides,
  });
}

async function seedShift(user, checkpoint, startsAt, endsAt, overrides = {}) {
  return VolunteerShiftModel.create({
    festId: fest._id,
    userId: user._id,
    checkpointId: checkpoint._id,
    startsAt,
    endsAt,
    assignedByUserId: admin.user._id,
    ...overrides,
  });
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    ScanModel.createIndexes(),
    UserModel.createIndexes(),
    FestModel.createIndexes(),
    EventModel.createIndexes(),
    CheckpointModel.createIndexes(),
    StaffAssignmentModel.createIndexes(),
    VolunteerShiftModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  scanSequence = 0;

  college = await createTestCollege();
  admin = await createTestAdministrator(college);

  /*
   * startsOn is in the past because the checkpoint tallies count from the fest's
   * start; the fixture's default 2027 window would put every seeded scan before
   * the window opened and report zero.
   */
  fest = await createTestFest(college, admin.user, {
    status: "published",
    startsOn: new Date(Date.now() - 24 * 60 * MINUTE),
    endsOn: new Date(Date.now() + 24 * 60 * MINUTE),
  });

  event = await createTestEvent(fest, admin.user, { eventName: "Chess Knockout" });
  otherEvent = await createTestEvent(fest, admin.user, {
    eventSlug: "other-event-2027",
    eventName: "Other Event",
  });

  gateCheckpoint = await createTestGateCheckpoint(fest);
  eventCheckpoint = await createTestEventCheckpoint(fest, event._id, {
    checkpointName: "Chess Knockout Entry",
  });
  otherEventCheckpoint = await createTestEventCheckpoint(fest, otherEvent._id, {
    checkpointName: "Other Event Entry",
  });

  eventCoordinator = await createTestStaffMember(fest, "coordinator", {
    emailAddress: "event-coord@example.com",
    assignment: { eventIds: [event._id] },
  });
  otherEventCoordinator = await createTestStaffMember(fest, "coordinator", {
    emailAddress: "other-coord@example.com",
    assignment: { eventIds: [otherEvent._id] },
  });
  volunteer = await createTestStaffMember(fest, "volunteer", {
    emailAddress: "volunteer@example.com",
    assignment: { eventIds: [event._id] },
  });

  participant = await createTestParticipant(college);
  pass = await createTestPass(fest, participant.user);
});

afterAll(teardownTestDatabase);

describe("live-staff authorization", () => {
  it("lets an administrator of the host college read the snapshot", async () => {
    const response = await getLiveStaff(admin.authenticationToken);
    expect(response.status).toBe(200);
  });

  it("lets a coordinator of this event read the snapshot", async () => {
    const response = await getLiveStaff(eventCoordinator.authenticationToken);
    expect(response.status).toBe(200);
  });

  /* The middleware admits any coordinator of the fest; the service narrows it. */
  it("refuses a coordinator of a different event in the same fest", async () => {
    const response = await getLiveStaff(otherEventCoordinator.authenticationToken);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("refuses a volunteer", async () => {
    const response = await getLiveStaff(volunteer.authenticationToken);
    expect(response.status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    const response = await request(application).get(livePath(fest._id, event._id));
    expect(response.status).toBe(401);
  });

  it("returns 404 EVENT_NOT_FOUND for an event belonging to another fest", async () => {
    const otherFest = await createTestFest(college, admin.user, {
      festSlug: "other-fest-2027",
      status: "published",
    });
    const foreignEvent = await createTestEvent(otherFest, admin.user, {
      eventSlug: "foreign-event",
    });

    const response = await getLiveStaff(admin.authenticationToken, fest._id, foreignEvent._id);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
  });

  /*
   * The coordinator/admin middleware resolves an unknown fest to PERMISSION_DENIED
   * rather than FEST_NOT_FOUND, deliberately, so the gate cannot be used to probe
   * which ids exist. It runs ahead of the service, so the 404 the service would
   * raise is unreachable here.
   */
  it("refuses an unknown fest at the gate rather than disclosing it does not exist", async () => {
    const response = await getLiveStaff(admin.authenticationToken, MISSING_ID, event._id);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });
});

describe("live-staff snapshot shape", () => {
  it("returns the documented top-level contract", async () => {
    const response = await getLiveStaff(admin.authenticationToken);
    const snapshot = response.body.data;

    expect(response.status).toBe(200);
    expect(snapshot.eventName).toBe("Chess Knockout");
    expect(typeof snapshot.generatedAt).toBe("string");
    expect(typeof snapshot.eventStartsAt).toBe("string");
    expect(typeof snapshot.eventEndsAt).toBe("string");
    expect(Array.isArray(snapshot.onShiftVolunteers)).toBe(true);
    expect(Array.isArray(snapshot.upcomingVolunteers)).toBe(true);
    expect(Array.isArray(snapshot.recentScans)).toBe(true);
  });

  /* The gate counts toward this event: someone arriving through it is en route here. */
  it("includes both the fest gate and the event door, with tallies", async () => {
    await seedScan({ checkpointId: gateCheckpoint._id });
    await seedScan({ checkpointId: eventCheckpoint._id, result: "rejectedNoEntitlement" });
    await seedScan({ checkpointId: otherEventCheckpoint._id });

    const response = await getLiveStaff(admin.authenticationToken);
    const { checkpoints } = response.body.data;

    const types = checkpoints.map((checkpoint) => checkpoint.checkpointType).sort();
    expect(types).toEqual(["eventEntry", "gate"]);
    expect(checkpoints.map((c) => c.checkpointId)).not.toContain(String(otherEventCheckpoint._id));

    const gate = checkpoints.find((c) => c.checkpointType === "gate");
    expect(gate).toMatchObject({ acceptedCount: 1, rejectedCount: 0, totalCount: 1 });

    const door = checkpoints.find((c) => c.checkpointType === "eventEntry");
    expect(door).toMatchObject({ acceptedCount: 0, rejectedCount: 1, totalCount: 1 });
  });
});

describe("onShiftVolunteers", () => {
  it("includes only volunteers on shift at this event's checkpoints", async () => {
    const now = Date.now();
    await seedShift(volunteer.user, eventCheckpoint, new Date(now - 30 * MINUTE), new Date(now + 30 * MINUTE));

    // On shift, but at another event's door: outside this event's picture.
    const elsewhere = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "elsewhere@example.com",
    });
    await seedShift(elsewhere.user, otherEventCheckpoint, new Date(now - 30 * MINUTE), new Date(now + 30 * MINUTE));

    // At this event's door, but their shift already ended.
    const finished = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "finished@example.com",
    });
    await seedShift(finished.user, eventCheckpoint, new Date(now - 120 * MINUTE), new Date(now - 60 * MINUTE));

    const response = await getLiveStaff(admin.authenticationToken);
    const { onShiftVolunteers } = response.body.data;

    expect(onShiftVolunteers).toHaveLength(1);
    expect(onShiftVolunteers[0].userId).toBe(String(volunteer.user._id));
    expect(onShiftVolunteers[0].checkpointName).toBe("Chess Knockout Entry");
  });

  it("maps activityStatus from the volunteer's most recent scan", async () => {
    const now = Date.now();
    const shiftStart = new Date(now - 60 * MINUTE);
    const shiftEnd = new Date(now + 60 * MINUTE);
    await seedShift(volunteer.user, eventCheckpoint, shiftStart, shiftEnd);

    async function statusWithLastScanMinutesAgo(minutesAgo) {
      await ScanModel.deleteMany({});
      if (minutesAgo !== null) {
        await seedScan({ scannedAt: new Date(Date.now() - minutesAgo * MINUTE) });
      }
      const response = await getLiveStaff(admin.authenticationToken);
      return response.body.data.onShiftVolunteers[0];
    }

    expect((await statusWithLastScanMinutesAgo(2)).activityStatus).toBe("active");
    expect((await statusWithLastScanMinutesAgo(10)).activityStatus).toBe("idle");
    expect((await statusWithLastScanMinutesAgo(30)).activityStatus).toBe("stale");

    const noScans = await statusWithLastScanMinutesAgo(null);
    expect(noScans.activityStatus).toBe("no-scans-yet");
    expect(noScans.lastScanAt).toBeNull();
    expect(noScans.minutesSinceLastScan).toBeNull();
    expect(noScans.scanCounts).toEqual({ accepted: 0, rejected: 0, total: 0 });
  });

  /*
   * The tally starts at the shift, not at the fest: a volunteer must not be
   * credited for scans they made on an earlier shift at the same door.
   */
  it("scopes scanCounts to the shift window rather than the whole fest", async () => {
    const now = Date.now();
    await seedShift(volunteer.user, eventCheckpoint, new Date(now - 30 * MINUTE), new Date(now + 30 * MINUTE));

    await seedScan({ scannedAt: new Date(now - 5 * MINUTE) });
    await seedScan({ scannedAt: new Date(now - 10 * MINUTE), result: "rejectedAlreadyUsed" });
    // Before the shift opened — an earlier stint at the same checkpoint.
    await seedScan({ scannedAt: new Date(now - 90 * MINUTE) });

    const response = await getLiveStaff(admin.authenticationToken);
    const [onShift] = response.body.data.onShiftVolunteers;

    expect(onShift.scanCounts).toEqual({ accepted: 1, rejected: 1, total: 2 });
  });
});

describe("upcomingVolunteers", () => {
  it("includes only shifts starting within the next 60 minutes", async () => {
    const now = Date.now();
    await seedShift(volunteer.user, eventCheckpoint, new Date(now + 30 * MINUTE), new Date(now + 90 * MINUTE));

    const later = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "later@example.com",
    });
    await seedShift(later.user, eventCheckpoint, new Date(now + 90 * MINUTE), new Date(now + 150 * MINUTE));

    const response = await getLiveStaff(admin.authenticationToken);
    const { upcomingVolunteers, onShiftVolunteers } = response.body.data;

    expect(onShiftVolunteers).toHaveLength(0);
    expect(upcomingVolunteers).toHaveLength(1);
    expect(upcomingVolunteers[0].userId).toBe(String(volunteer.user._id));
    expect(upcomingVolunteers[0].minutesUntilStart).toBe(30);
  });
});

describe("recentScans", () => {
  it("caps at ten, newest first, from this event's checkpoints only", async () => {
    const now = Date.now();
    for (let index = 0; index < 12; index += 1) {
      await seedScan({ scannedAt: new Date(now - index * MINUTE) });
    }
    await seedScan({ checkpointId: otherEventCheckpoint._id, scannedAt: new Date(now) });

    const response = await getLiveStaff(admin.authenticationToken);
    const { recentScans } = response.body.data;

    expect(recentScans).toHaveLength(10);
    expect(recentScans.map((scan) => scan.checkpointId)).not.toContain(
      String(otherEventCheckpoint._id)
    );

    const timestamps = recentScans.map((scan) => new Date(scan.scannedAt).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it("resolves the scanner and the participant behind the pass", async () => {
    await seedScan();

    const response = await getLiveStaff(admin.authenticationToken);
    const [scan] = response.body.data.recentScans;

    expect(scan.scannedByUserId).toBe(String(volunteer.user._id));
    expect(scan.participantUserId).toBe(String(participant.user._id));
    expect(scan.participantFullName).toBe("Test Participant");
    expect(scan).toMatchObject({ result: "accepted", scanMethod: "qr", direction: "in" });
  });

  /* A rejectedPassNotFound row has no pass, and must still be reported. */
  it("keeps a scan whose pass cannot be resolved, with null participant fields", async () => {
    await seedScan({ passId: null, result: "rejectedPassNotFound" });

    const response = await getLiveStaff(admin.authenticationToken);
    const [scan] = response.body.data.recentScans;

    expect(scan.participantUserId).toBeNull();
    expect(scan.participantFullName).toBeNull();
    expect(scan.result).toBe("rejectedPassNotFound");
  });
});

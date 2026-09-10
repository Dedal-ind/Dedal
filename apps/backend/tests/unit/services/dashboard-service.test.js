import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { RegistrationModel } from "../../../src/models/registration-model.js";
import { ScanModel } from "../../../src/models/scan-model.js";
import { CheckpointModel } from "../../../src/models/checkpoint-model.js";
import { EventModel } from "../../../src/models/event-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import { UserModel } from "../../../src/models/user-model.js";
import { PassModel } from "../../../src/models/pass-model.js";
import { installEmailServiceMock } from "../../setup/test-email-service.js";
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
  createTestGateCheckpoint,
  createTestEventCheckpoint,
  createTestPass,
} from "../../setup/create-test-fixtures.js";

installEmailServiceMock();
const dashboardService = await import("../../../src/services/dashboard-service.js");

let college;
let admin;
let fest;

let scanCounter = 0;
async function createScan(checkpoint, overrides = {}) {
  scanCounter += 1;
  return ScanModel.create({
    clientScanId: `scan-${scanCounter}`,
    checkpointId: checkpoint._id,
    scannedByUserId: admin.user._id,
    scanMethod: "qr",
    direction: "in",
    result: "accepted",
    scannedAt: new Date(),
    ...overrides,
  });
}

async function createRegistration(event, overrides = {}) {
  const user = await UserModel.create({
    emailAddress: `reg-${Math.abs(scanCounter += 1)}@example.com`,
  });
  return RegistrationModel.create({
    eventId: event._id,
    userId: user._id,
    status: "confirmed",
    feeAmountSnapshotPaise: 0,
    ...overrides,
  });
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    RegistrationModel.createIndexes(),
    ScanModel.createIndexes(),
    CheckpointModel.createIndexes(),
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
    PassModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  scanCounter = 0;
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
});

afterAll(teardownTestDatabase);

describe("getFestDashboard", () => {
  it("returns all zeros for an empty fest", async () => {
    const dashboard = await dashboardService.getFestDashboard(fest.id);

    expect(dashboard.events).toEqual([]);
    expect(dashboard.totals.totalRegistrations).toBe(0);
    expect(dashboard.totals.currentHeadcount).toBe(0);
    expect(dashboard.staffOnDuty).toBe(0);
    expect(dashboard.recentScans).toEqual([]);
  });

  it("totals registrations by status", async () => {
    const event = await createTestEvent(fest, admin.user);
    await createRegistration(event, { status: "confirmed" });
    await createRegistration(event, { status: "confirmed" });
    await createRegistration(event, { status: "confirmed" });
    await createRegistration(event, { status: "waitlisted" });
    await createRegistration(event, { status: "cancelled" });

    const dashboard = await dashboardService.getFestDashboard(fest.id);

    expect(dashboard.totals.totalRegistrations).toBe(5);
    expect(dashboard.totals.totalConfirmed).toBe(3);
    expect(dashboard.totals.totalWaitlisted).toBe(1);
    expect(dashboard.totals.totalCancelled).toBe(1);
    expect(dashboard.events).toHaveLength(1);
  });

  it("computes gate headcount as accepted in-scans minus out-scans", async () => {
    const gate = await createTestGateCheckpoint(fest, { directionMode: "inAndOut" });
    await createScan(gate, { direction: "in" });
    await createScan(gate, { direction: "in" });
    await createScan(gate, { direction: "in" });
    await createScan(gate, { direction: "out" });
    // A rejected attempt must not move the headcount.
    await createScan(gate, { direction: "in", result: "rejectedNoEntitlement" });

    const dashboard = await dashboardService.getFestDashboard(fest.id);

    expect(dashboard.totals.totalCheckedInAtGate).toBe(3);
    expect(dashboard.totals.currentHeadcount).toBe(2);
  });

  it("counts accepted event-entry scans per event", async () => {
    const event = await createTestEvent(fest, admin.user);
    const doorCheckpoint = await createTestEventCheckpoint(fest, event._id);
    await createScan(doorCheckpoint);
    await createScan(doorCheckpoint);

    const dashboard = await dashboardService.getFestDashboard(fest.id);

    expect(dashboard.events[0].checkedInCount).toBe(2);
  });

  it("scopes a coordinator to their own events and hides the gate", async () => {
    const firstEvent = await createTestEvent(fest, admin.user, { eventSlug: "first" });
    const secondEvent = await createTestEvent(fest, admin.user, { eventSlug: "second" });
    await createRegistration(firstEvent, { status: "confirmed" });
    await createRegistration(secondEvent, { status: "confirmed" });
    const gate = await createTestGateCheckpoint(fest, { directionMode: "inAndOut" });
    await createScan(gate, { direction: "in" });

    const dashboard = await dashboardService.getFestDashboard(fest.id, {
      scopeEventIds: [firstEvent._id],
      includeGate: false,
    });

    expect(dashboard.events).toHaveLength(1);
    expect(dashboard.events[0].eventId).toBe(String(firstEvent._id));
    expect(dashboard.totals.totalRegistrations).toBe(1);
    expect(dashboard.totals.totalCheckedInAtGate).toBe(0);
  });

  it("populates recent scans with participant and checkpoint names", async () => {
    const participant = await UserModel.create({
      emailAddress: "scanned@example.com",
      fullName: "Scanned Person",
    });
    const pass = await createTestPass(fest, participant);
    const gate = await createTestGateCheckpoint(fest);
    await createScan(gate, { passId: pass._id });

    const dashboard = await dashboardService.getFestDashboard(fest.id);

    expect(dashboard.recentScans).toHaveLength(1);
    expect(dashboard.recentScans[0].participantName).toBe("Scanned Person");
    expect(dashboard.recentScans[0].checkpointName).toBe("Main Gate");
    expect(dashboard.recentScans[0].result).toBe("accepted");
  });
});

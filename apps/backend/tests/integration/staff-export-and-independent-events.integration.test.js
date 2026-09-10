import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { FestModel } from "../../src/models/fest-model.js";
import { EventModel } from "../../src/models/event-model.js";
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
  createTestStaffMember,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let event;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user);
});

describe("filtered staff-assignments export (Section A)", () => {
  async function seedStaff() {
    await createTestStaffMember(fest, "coordinator", {
      emailAddress: "active-coordinator@example.com",
      assignment: { eventIds: [event._id] },
    });
    await createTestStaffMember(fest, "coordinator", {
      emailAddress: "revoked-coordinator@example.com",
      assignment: { status: "revoked", revokedAt: new Date(), revocationReason: "Rotated out" },
    });
    await createTestStaffMember(fest, "volunteer", {
      emailAddress: "active-volunteer@example.com",
    });
  }

  it("role + status filters combine as AND: only the revoked coordinator", async () => {
    await seedStaff();
    const response = await withToken(
      request(application).get(
        `/api/v1/fests/${fest.id}/exports/staff-assignments.csv?role=coordinator&status=revoked`
      ),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    expect(response.text).toContain("revoked-coordinator@example.com");
    expect(response.text).not.toContain("active-coordinator@example.com");
    expect(response.text).not.toContain("active-volunteer@example.com");
    expect(response.text).toContain("Rotated out");
  });

  it("no filters returns everything, and the audit row records filtersApplied", async () => {
    await seedStaff();
    const response = await withToken(
      request(application).get(`/api/v1/fests/${fest.id}/exports/staff-assignments.csv`),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    const lines = response.text.trim().split(/\r?\n/);
    expect(lines.length).toBe(4); // header + 3 rows

    const filtered = await withToken(
      request(application).get(
        `/api/v1/fests/${fest.id}/exports/staff-assignments.csv?role=volunteer&status=active`
      ),
      admin.authenticationToken
    );
    expect(filtered.status).toBe(200);

    const auditRows = await AuditLogModel.find({ "afterState.exportType": "staff-assignments" })
      .sort({ createdAt: 1 })
      .lean();
    expect(auditRows.map((row) => row.afterState.filtersApplied)).toEqual([
      "none",
      "role=volunteer;status=active",
    ]);
  });

  it("eventId narrows to that event's staff (fest-wide rows included — they staff every event)", async () => {
    await seedStaff();
    const otherEvent = await createTestEvent(fest, admin.user, { eventSlug: "other-event" });
    await createTestStaffMember(fest, "coordinator", {
      emailAddress: "other-event-coordinator@example.com",
      assignment: { eventIds: [otherEvent._id] },
    });

    const response = await withToken(
      request(application).get(
        `/api/v1/fests/${fest.id}/exports/staff-assignments.csv?eventId=${event.id}`
      ),
      admin.authenticationToken
    );
    expect(response.status).toBe(200);
    expect(response.text).toContain("active-coordinator@example.com");
    // Fest-wide volunteer staffs every event, so they belong on this sheet.
    expect(response.text).toContain("active-volunteer@example.com");
    expect(response.text).not.toContain("other-event-coordinator@example.com");
  });

  it("the count preview matches the export's row count", async () => {
    await seedStaff();
    const counted = await withToken(
      request(application).get(
        `/api/v1/fests/${fest.id}/exports/staff-assignments/count?role=coordinator`
      ),
      admin.authenticationToken
    );
    expect(counted.status).toBe(200);
    expect(counted.body.data.rowCount).toBe(2);
  });
});

describe("independent events (Section B)", () => {
  const INDEPENDENT_PAYLOAD = {
    eventName: "Guest Lecture: Systems Design",
    description: "A standalone one-evening guest lecture.",
    eventType: "solo",
    feeType: "free",
    venue: "Main Auditorium",
    category: "other",
    scoringFormat: "none",
    startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString(),
    registrationOpensAt: new Date().toISOString(),
    registrationClosesAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
  };

  it("creates fest + event in one call; compensates when the event insert fails", async () => {
    const response = await withToken(
      request(application).post("/api/v1/events/independent"),
      admin.authenticationToken
    ).send(INDEPENDENT_PAYLOAD);
    expect(response.status).toBe(201);
    const { fest: soloFest, event: soloEvent } = response.body.data;
    expect(soloFest.isSoloContainer).toBe(true);
    expect(soloFest.festName).toBe(INDEPENDENT_PAYLOAD.eventName);
    expect(soloEvent.festId).toBe(soloFest.id);
    expect(soloFest.status).toBe("draft");

    // The wrapper's dates are the event's dates.
    expect(new Date(soloFest.startsOn).getTime()).toBe(
      new Date(INDEPENDENT_PAYLOAD.startsAt).getTime()
    );
  });

  it("publishing the independent event auto-publishes the solo fest, audited", async () => {
    const created = await withToken(
      request(application).post("/api/v1/events/independent"),
      admin.authenticationToken
    ).send(INDEPENDENT_PAYLOAD);
    const { fest: soloFest, event: soloEvent } = created.body.data;

    const published = await withToken(
      request(application).post(`/api/v1/fests/${soloFest.id}/events/${soloEvent.id}/publish`),
      admin.authenticationToken
    );
    expect(published.status).toBe(200);

    const festRow = await FestModel.findById(soloFest.id).lean();
    expect(festRow.status).toBe("published");
    const auditRow = await AuditLogModel.findOne({
      action: "fest.published",
      "afterState.soloContainerAutoPublish": true,
    }).lean();
    expect(auditRow).not.toBeNull();
  });

  it("cancelling the independent event cancels the solo fest via the cascade", async () => {
    const created = await withToken(
      request(application).post("/api/v1/events/independent"),
      admin.authenticationToken
    ).send(INDEPENDENT_PAYLOAD);
    const { fest: soloFest, event: soloEvent } = created.body.data;
    await withToken(
      request(application).post(`/api/v1/fests/${soloFest.id}/events/${soloEvent.id}/publish`),
      admin.authenticationToken
    );

    const cancelled = await withToken(
      request(application).post(`/api/v1/fests/${soloFest.id}/events/${soloEvent.id}/cancel`),
      admin.authenticationToken
    ).send({ reason: "Speaker unavailable, lecture called off" });
    expect(cancelled.status).toBe(200);

    const festRow = await FestModel.findById(soloFest.id).lean();
    expect(festRow.status).toBe("cancelled");
    expect(festRow.cancelledAt).not.toBeNull();
    const auditRow = await AuditLogModel.findOne({
      action: "fest.cancelled",
      "afterState.soloContainerAutoCancel": true,
    }).lean();
    expect(auditRow).not.toBeNull();
  });

  it("solo fests are hidden from the public list but tagged in the admin list", async () => {
    const created = await withToken(
      request(application).post("/api/v1/events/independent"),
      admin.authenticationToken
    ).send(INDEPENDENT_PAYLOAD);
    const { fest: soloFest, event: soloEvent } = created.body.data;
    await withToken(
      request(application).post(`/api/v1/fests/${soloFest.id}/events/${soloEvent.id}/publish`),
      admin.authenticationToken
    );

    const publicList = await request(application).get("/api/v1/public/fests");
    expect(publicList.status).toBe(200);
    expect(publicList.body.data.some((row) => row.id === soloFest.id)).toBe(false);
    // The ordinary published fest still lists.
    expect(publicList.body.data.some((row) => row.id === fest.id)).toBe(true);

    const adminList = await withToken(
      request(application).get("/api/v1/fests/mine"),
      admin.authenticationToken
    );
    const soloRow = adminList.body.data.find((row) => row.id === soloFest.id);
    expect(soloRow).toBeDefined();
    expect(soloRow.isSoloContainer).toBe(true);
  });

  it("rescheduling the independent event syncs the wrapper fest's dates", async () => {
    const created = await withToken(
      request(application).post("/api/v1/events/independent"),
      admin.authenticationToken
    ).send(INDEPENDENT_PAYLOAD);
    const { fest: soloFest, event: soloEvent } = created.body.data;

    const newStartsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const newEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString();
    const patched = await withToken(
      request(application).patch(`/api/v1/fests/${soloFest.id}/events/${soloEvent.id}`),
      admin.authenticationToken
    ).send({ startsAt: newStartsAt, endsAt: newEndsAt });
    expect(patched.status).toBe(200);

    const festRow = await FestModel.findById(soloFest.id).lean();
    expect(festRow.startsOn.toISOString()).toBe(newStartsAt);
    expect(festRow.endsOn.toISOString()).toBe(newEndsAt);
  });

  it("convert-to-full-fest flips the flag one way and refuses ordinary fests", async () => {
    const created = await withToken(
      request(application).post("/api/v1/events/independent"),
      admin.authenticationToken
    ).send(INDEPENDENT_PAYLOAD);
    const { fest: soloFest } = created.body.data;

    const converted = await withToken(
      request(application).post(`/api/v1/fests/${soloFest.id}/convert-to-full-fest`),
      admin.authenticationToken
    );
    expect(converted.status).toBe(200);
    expect((await FestModel.findById(soloFest.id).lean()).isSoloContainer).toBe(false);

    const again = await withToken(
      request(application).post(`/api/v1/fests/${soloFest.id}/convert-to-full-fest`),
      admin.authenticationToken
    );
    expect(again.status).toBe(409);
  });
});

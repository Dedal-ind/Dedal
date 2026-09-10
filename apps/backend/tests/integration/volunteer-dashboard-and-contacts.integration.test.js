import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { VolunteerShiftModel } from "../../src/models/volunteer-shift-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
import { ScanModel } from "../../src/models/scan-model.js";
import { UserModel } from "../../src/models/user-model.js";
import {
  EARLY_ACCESS_WINDOW_HOURS,
  LATE_ACCESS_WINDOW_HOURS,
} from "../../src/constants/shift-constants.js";
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
  createTestEventCheckpoint,
  createTestStaffMember,
  createTestParticipant,
  createTestPass,
  createTestEventEntitlement,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

let college;
let admin;
let fest;
let event;
let entryCheckpoint;

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
  entryCheckpoint = await createTestEventCheckpoint(fest, event._id);
});

describe("auto-shift on volunteer assignment (Section B)", () => {
  it("creates a default shift at the event-entry checkpoint with the access-window constants", async () => {
    const response = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/staff-assignments`),
      admin.authenticationToken
    ).send({
      emailAddress: "auto-shift-volunteer@example.com",
      role: "volunteer",
      eventIds: [String(event._id)],
    });
    expect(response.status).toBe(201);

    const shifts = await VolunteerShiftModel.find({ checkpointId: entryCheckpoint._id }).lean();
    expect(shifts).toHaveLength(1);
    expect(shifts[0].startsAt.getTime()).toBe(
      event.startsAt.getTime() - EARLY_ACCESS_WINDOW_HOURS * MILLISECONDS_PER_HOUR
    );
    expect(shifts[0].endsAt.getTime()).toBe(
      event.endsAt.getTime() + LATE_ACCESS_WINDOW_HOURS * MILLISECONDS_PER_HOUR
    );

    // Traceable alongside the assignment itself.
    const auditRow = await AuditLogModel.findOne({ action: "shift.autoCreated" }).lean();
    expect(auditRow).not.toBeNull();
  });

  it("is idempotent — widening the same volunteer onto the same event does not duplicate the shift", async () => {
    const payload = {
      emailAddress: "merge-volunteer@example.com",
      role: "volunteer",
      eventIds: [String(event._id)],
    };
    const first = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/staff/assign`),
      admin.authenticationToken
    ).send(payload);
    expect(first.status).toBe(201);
    const second = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/staff/assign`),
      admin.authenticationToken
    ).send(payload);
    expect(second.status).toBe(201);

    const shiftCount = await VolunteerShiftModel.countDocuments({
      checkpointId: entryCheckpoint._id,
    });
    expect(shiftCount).toBe(1);
  });

  it("does NOT auto-create a shift for a coordinator", async () => {
    const response = await withToken(
      request(application).post(`/api/v1/fests/${fest.id}/staff-assignments`),
      admin.authenticationToken
    ).send({
      emailAddress: "coordinator@example.com",
      role: "coordinator",
      eventIds: [String(event._id)],
    });
    expect(response.status).toBe(201);
    expect(await VolunteerShiftModel.countDocuments({})).toBe(0);
  });
});

describe("staff contacts (Section A)", () => {
  it("resolves the assignment override first, falls back to the personal phone, and omits the phoneless", async () => {
    // Override wins.
    const hotline = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "hotline@example.com",
      assignment: { eventIds: [event._id], assignmentContactPhone: "+91 99999 00001" },
    });
    await UserModel.updateOne(
      { _id: hotline.user._id },
      { fullName: "Hotline Coordinator", phoneNumber: "+91 11111 11111" }
    );
    // Fallback to the personal number.
    const personal = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "personal@example.com",
      assignment: { eventIds: [event._id] },
    });
    await UserModel.updateOne(
      { _id: personal.user._id },
      { fullName: "Personal Volunteer", phoneNumber: "+91 22222 22222" }
    );
    // No override, no personal phone → omitted (never a broken tel: link).
    const phoneless = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "phoneless@example.com",
      assignment: { eventIds: [event._id] },
    });
    await UserModel.updateOne({ _id: phoneless.user._id }, { fullName: "Phoneless Volunteer" });

    const response = await request(application).get(
      `/api/v1/public/events/${event.id}/staff-contacts`
    );
    expect(response.status).toBe(200);
    const { contacts } = response.body.data;
    expect(contacts).toEqual([
      { fullName: "Hotline Coordinator", role: "coordinator", contactPhone: "+91 99999 00001" },
      { fullName: "Personal Volunteer", role: "volunteer", contactPhone: "+91 22222 22222" },
    ]);
    // The resolved field is the ONLY phone in the payload.
    expect(JSON.stringify(response.body)).not.toContain("+91 11111 11111");
  });
});

describe("volunteer dashboard (Section C)", () => {
  async function seedVolunteerWithShift() {
    const volunteer = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "dashboard-volunteer@example.com",
      assignment: { eventIds: [event._id] },
    });
    const shift = await VolunteerShiftModel.create({
      festId: fest._id,
      userId: volunteer.user._id,
      checkpointId: entryCheckpoint._id,
      startsAt: new Date(Date.now() - MILLISECONDS_PER_HOUR),
      endsAt: new Date(Date.now() + MILLISECONDS_PER_HOUR),
      status: "scheduled",
      assignedByUserId: admin.user._id,
    });
    return { volunteer, shift };
  }

  it("summary counts add up: pending + checkedIn = toCheckIn, and myScansToday is the caller's own", async () => {
    const { volunteer } = await seedVolunteerWithShift();

    const personOne = await createTestParticipant(college, {
      emailAddress: "p1@example.com",
      usn: "1AA00AA001",
    });
    const personTwo = await createTestParticipant(college, {
      emailAddress: "p2@example.com",
      usn: "1AA00AA002",
    });
    const passOne = await createTestPass(fest, personOne.user);
    const passTwo = await createTestPass(fest, personTwo.user);
    await createTestEventEntitlement(passOne, event._id);
    await createTestEventEntitlement(passTwo, event._id);

    // One accepted IN scan (by the volunteer themselves, today).
    await ScanModel.create({
      passId: passOne._id,
      checkpointId: entryCheckpoint._id,
      scannedByUserId: volunteer.user._id,
      direction: "in",
      result: "accepted",
      scanMethod: "qr",
      clientScanId: `client-scan-${Math.random()}`,
      scannedAt: new Date(),
    });

    const response = await withToken(
      request(application).get("/api/v1/backstage/volunteer/summary"),
      volunteer.authenticationToken
    );
    expect(response.status).toBe(200);
    const [checkpointRow] = response.body.data.scope;
    expect(checkpointRow.checkpointId).toBe(String(entryCheckpoint._id));
    expect(checkpointRow.toCheckInCount).toBe(2);
    expect(checkpointRow.checkedInCount).toBe(1);
    expect(checkpointRow.pendingCount + checkpointRow.checkedInCount).toBe(
      checkpointRow.toCheckInCount
    );
    expect(checkpointRow.myScansToday).toBe(1);
    // inOnly checkpoint — a checked-out count would be a lie, so it is null.
    expect(checkpointRow.checkedOutCount).toBeNull();
  });

  it("refuses the dashboard to a non-volunteer", async () => {
    const participant = await createTestParticipant(college, {
      emailAddress: "not-staff@example.com",
    });
    const response = await withToken(
      request(application).get("/api/v1/backstage/volunteer/summary"),
      participant.authenticationToken
    );
    expect(response.status).toBe(403);
  });

  it("a volunteer requesting another volunteer's checkpoint CSV gets 403 PERMISSION_DENIED", async () => {
    await seedVolunteerWithShift();

    // A second volunteer, scheduled at a DIFFERENT event's checkpoint — having
    // shifts of their own, the no-shift fallback cannot authorise them either.
    const otherEvent = await createTestEvent(fest, admin.user, { eventSlug: "other-event" });
    const otherCheckpoint = await createTestEventCheckpoint(fest, otherEvent._id, {
      checkpointName: "Other Entry",
    });
    const intruder = await createTestStaffMember(fest, "volunteer", {
      emailAddress: "intruder@example.com",
      assignment: { eventIds: [otherEvent._id] },
    });
    await VolunteerShiftModel.create({
      festId: fest._id,
      userId: intruder.user._id,
      checkpointId: otherCheckpoint._id,
      startsAt: new Date(Date.now() - MILLISECONDS_PER_HOUR),
      endsAt: new Date(Date.now() + MILLISECONDS_PER_HOUR),
      status: "scheduled",
      assignedByUserId: admin.user._id,
    });

    const response = await withToken(
      request(application).get(
        `/api/v1/backstage/volunteer/checkpoints/${entryCheckpoint._id}/participants.csv`
      ),
      intruder.authenticationToken
    );
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("streams both CSVs for the volunteer's own checkpoint and audits data.exported", async () => {
    const { volunteer } = await seedVolunteerWithShift();
    const person = await createTestParticipant(college, {
      emailAddress: "csv-person@example.com",
      usn: "1AA00AA003",
      phoneNumber: "+91 33333 33333",
    });
    const pass = await createTestPass(fest, person.user);
    await createTestEventEntitlement(pass, event._id);
    await ScanModel.create({
      passId: pass._id,
      checkpointId: entryCheckpoint._id,
      scannedByUserId: volunteer.user._id,
      direction: "in",
      result: "accepted",
      scanMethod: "qr",
      clientScanId: `client-scan-${Math.random()}`,
      scannedAt: new Date(),
    });

    const fullList = await withToken(
      request(application).get(
        `/api/v1/backstage/volunteer/checkpoints/${entryCheckpoint._id}/participants.csv`
      ),
      volunteer.authenticationToken
    );
    expect(fullList.status).toBe(200);
    expect(fullList.headers["content-type"]).toContain("text/csv");
    expect(fullList.text).toContain("1AA00AA003");
    expect(fullList.text).toContain("eventEntry");

    const checkedIn = await withToken(
      request(application).get(
        `/api/v1/backstage/volunteer/checkpoints/${entryCheckpoint._id}/checked-in.csv`
      ),
      volunteer.authenticationToken
    );
    expect(checkedIn.status).toBe(200);
    expect(checkedIn.text).toContain("1AA00AA003");

    const exportAudits = await AuditLogModel.find({ action: "data.exported" }).lean();
    expect(exportAudits.length).toBe(2);
    expect(exportAudits.every((row) => row.afterState.checkpointId === String(entryCheckpoint._id))).toBe(true);
  });
});

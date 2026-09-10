/*
 * Sections C and D: the shift reminder sweep, the .ics endpoint, and the
 * registration confirmation email.
 *
 * The sweep is driven by passing an explicit `now` rather than by faking timers
 * or sleeping — the whole point of the no-cron design is that "is this shift due
 * a reminder" is a pure function of the clock and two stamps, so a test can just
 * hand it a clock.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { VolunteerShiftModel } from "../../src/models/volunteer-shift-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
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
  createTestStaffMember,
  createTestParticipant,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");
const { sendPendingShiftReminders } = await import("../../src/services/shift-reminder-service.js");

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

let college;
let admin;
let fest;
let event;
let checkpoint;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

/* A scheduled shift starting `hoursFromNow` out, for a volunteer with an email. */
async function seedShift(hoursFromNow, now, overrides = {}) {
  const volunteer = await createTestStaffMember(fest, "volunteer", {
    emailAddress: overrides.emailAddress ?? "shift-volunteer@example.com",
    assignment: { eventIds: [event._id] },
  });
  const startsAt = new Date(now.getTime() + hoursFromNow * MILLISECONDS_PER_HOUR);
  const shift = await VolunteerShiftModel.create({
    festId: fest._id,
    userId: volunteer.user._id,
    checkpointId: checkpoint._id,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * MILLISECONDS_PER_HOUR),
    status: overrides.status ?? "scheduled",
    assignedByUserId: admin.user._id,
  });
  return { volunteer, shift };
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  clearRecordedEmails();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  // Registration must actually be OPEN — the default fixture's window starts
  // in 2027, which would 404 every registration below.
  event = await createTestEvent(fest, admin.user, openRegistrationOverrides());
  checkpoint = await createTestEventCheckpoint(fest, event._id);
});

describe("shift reminder sweep (Section C)", () => {
  it("sends the 12-hour reminder once and stamps the shift", async () => {
    const now = new Date();
    const { shift } = await seedShift(11, now);

    const sentCount = await sendPendingShiftReminders(now);

    expect(sentCount).toBe(1);
    const reminders = findRecordedEmailsOfKind("shiftReminder");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].hoursUntilStart).toBe(12);
    expect(reminders[0].checkpointName).toBe(checkpoint.checkpointName);

    const stamped = await VolunteerShiftModel.findById(shift._id).lean();
    expect(stamped.reminderSentAt12h).not.toBeNull();
    expect(stamped.reminderSentAt1h).toBeNull();
  });

  it("is idempotent — a second sweep in the same window sends nothing", async () => {
    const now = new Date();
    await seedShift(11, now);

    await sendPendingShiftReminders(now);
    const secondSweepCount = await sendPendingShiftReminders(now);

    expect(secondSweepCount).toBe(0);
    expect(findRecordedEmailsOfKind("shiftReminder")).toHaveLength(1);
  });

  it("sends BOTH reminders across the two windows, never one twice", async () => {
    const now = new Date();
    const { shift } = await seedShift(11, now);

    await sendPendingShiftReminders(now);
    // Advance to 30 minutes before the shift: inside the 1-hour window.
    const later = new Date(shift.startsAt.getTime() - 0.5 * MILLISECONDS_PER_HOUR);
    await sendPendingShiftReminders(later);

    const reminders = findRecordedEmailsOfKind("shiftReminder");
    expect(reminders).toHaveLength(2);
    expect(reminders.map((reminder) => reminder.hoursUntilStart)).toEqual([12, 1]);

    const stamped = await VolunteerShiftModel.findById(shift._id).lean();
    expect(stamped.reminderSentAt12h).not.toBeNull();
    expect(stamped.reminderSentAt1h).not.toBeNull();
  });

  it("skips a cancelled shift", async () => {
    const now = new Date();
    await seedShift(11, now, { status: "cancelled" });

    expect(await sendPendingShiftReminders(now)).toBe(0);
    expect(findRecordedEmailsOfKind("shiftReminder")).toHaveLength(0);
  });

  it("does not remind about a shift that has already started", async () => {
    /*
     * The regression the upper bound exists for: without `startsAt: {$gt: now}`
     * an in-progress or finished shift stays "within 12 hours of starting"
     * forever, and the volunteer working it is told it starts in 12 hours.
     */
    const now = new Date();
    await seedShift(-2, now);

    expect(await sendPendingShiftReminders(now)).toBe(0);
    expect(findRecordedEmailsOfKind("shiftReminder")).toHaveLength(0);
  });

  it("does not remind about a shift further out than 12 hours", async () => {
    const now = new Date();
    await seedShift(30, now);

    expect(await sendPendingShiftReminders(now)).toBe(0);
  });

  it("a shift created inside the 1-hour window still gets its reminder", async () => {
    // The case a precomputed timer would miss entirely: the shift did not exist
    // when its own reminder time passed.
    const now = new Date();
    await seedShift(0.5, now);

    const sentCount = await sendPendingShiftReminders(now);

    expect(sentCount).toBe(2); // both windows are past due at once
    expect(findRecordedEmailsOfKind("shiftReminder")).toHaveLength(2);
  });
});

describe("public .ics endpoint (Section D)", () => {
  it("returns a valid RFC 5545 file with calendar headers", async () => {
    // PUBLIC: no Authorization header — an emailed link has no session.
    const response = await request(application).get(`/api/v1/events/${event.id}/calendar.ics`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/calendar/);
    expect(response.headers["content-disposition"]).toMatch(/attachment; filename=".+\.ics"/);

    const body = response.text;
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain("END:VCALENDAR");
    expect(body).toContain(`UID:event-${event.id}@dedal.in`);
    expect(body).toContain(`SUMMARY:${event.eventName}`);
    expect(body).toContain(`LOCATION:${event.venue}`);
    // CRLF line endings — Outlook rejects bare LF.
    expect(body).toContain("\r\n");
  });

  it("404s for a draft event rather than leaking an unannounced schedule", async () => {
    const draftEvent = await createTestEvent(fest, admin.user, {
      eventSlug: "secret-event",
      status: "draft",
    });

    const response = await request(application).get(`/api/v1/events/${draftEvent.id}/calendar.ics`);

    expect(response.status).toBe(404);
  });

  it("404s on a malformed event id instead of throwing a cast error", async () => {
    const response = await request(application).get("/api/v1/events/not-an-id/calendar.ics");

    expect(response.status).toBe(404);
  });
});

describe("registration confirmation email (Section D)", () => {
  it("fires once on a free solo registration and stamps the registration", async () => {
    const participant = await createTestParticipant(college, {
      emailAddress: "confirmed@example.com",
      usn: "1AA00AA300",
    });

    const response = await withToken(
      request(application).post(`/api/v1/events/${event.id}/registrations/solo`),
      participant.authenticationToken
    ).send({});
    expect(response.status).toBe(201);

    const confirmations = findRecordedEmailsOfKind("registrationConfirmation");
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0].emailAddress).toBe("confirmed@example.com");
    expect(confirmations[0].eventName).toBe(event.eventName);
    expect(confirmations[0].totalFeePaise).toBe(0);

    const registration = await RegistrationModel.findOne({ userId: participant.user._id }).lean();
    expect(registration.registrationConfirmationEmailSentAt).not.toBeNull();
  });

  it("is separate from the pass email — both are sent, neither replaces the other", async () => {
    const participant = await createTestParticipant(college, {
      emailAddress: "both@example.com",
      usn: "1AA00AA301",
    });

    await withToken(
      request(application).post(`/api/v1/events/${event.id}/registrations/solo`),
      participant.authenticationToken
    ).send({});

    expect(findRecordedEmailsOfKind("pass")).toHaveLength(1);
    expect(findRecordedEmailsOfKind("registrationConfirmation")).toHaveLength(1);
  });
});

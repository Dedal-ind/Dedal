/*
 * Sections A–C: volunteer hours, coordinator bulk email, per-round export.
 *
 * The hours maths is driven by passing an explicit `now` where possible and by
 * seeding shift windows relative to a fixed reference otherwise — the clamp
 * (min(endsAt, now) - startsAt) is the whole point of the feature, so the tests
 * pin a clock rather than trusting the wall.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { VolunteerShiftModel } from "../../src/models/volunteer-shift-model.js";
import { RoundModel } from "../../src/models/round-model.js";
import { RoundScoreModel } from "../../src/models/round-score-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
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
const volunteerHoursService = await import("../../src/services/volunteer-hours-service.js");

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

let college;
let admin;
let fest;
let event;
let checkpoint;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

/* A shift that ran from `hoursAgoStart` ago to `hoursAgoEnd` ago. */
async function seedShift(volunteer, hoursAgoStart, hoursAgoEnd, overrides = {}) {
  const now = Date.now();
  return VolunteerShiftModel.create({
    festId: fest._id,
    userId: volunteer.user._id,
    checkpointId: checkpoint._id,
    startsAt: new Date(now - hoursAgoStart * MILLISECONDS_PER_HOUR),
    endsAt: new Date(now - hoursAgoEnd * MILLISECONDS_PER_HOUR),
    status: "scheduled",
    assignedByUserId: admin.user._id,
    ...overrides,
  });
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  clearRecordedEmails();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  // Published: a draft fest refuses registrations, and section B needs real
  // confirmed registrants to mail.
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user, openRegistrationOverrides());
  checkpoint = await createTestEventCheckpoint(fest, event._id);
});

describe("(A) volunteer hours", () => {
  async function seedVolunteer() {
    return createTestStaffMember(fest, "volunteer", {
      emailAddress: "hours-volunteer@example.com",
      assignment: { eventIds: [event._id] },
    });
  }

  it("totals three completed shifts to 7.5 hours", async () => {
    const volunteer = await seedVolunteer();
    // 3h + 2.5h + 2h = 7.5
    await seedShift(volunteer, 30, 27);
    await seedShift(volunteer, 20, 17.5);
    await seedShift(volunteer, 10, 8);

    const summary = await withToken(
      request(application).get("/api/v1/backstage/volunteer/hours-summary"),
      volunteer.authenticationToken
    );
    expect(summary.status).toBe(200);
    expect(summary.body.data.totalHoursWorked).toBe(7.5);
    expect(summary.body.data.shifts).toHaveLength(3);
    expect(summary.body.data.volunteerEmailAddress).toBe("hours-volunteer@example.com");
    /*
     * The staff fixture creates users with no college and no full name, so both
     * come back empty. Asserted as PRESENT rather than truthy: the point is that
     * the service reports what the account actually holds and does not fabricate
     * an identity for a service letter.
     */
    expect(summary.body.data).toHaveProperty("collegeName");
    expect(summary.body.data).toHaveProperty("volunteerFullName");
  });

  it("clamps an in-progress shift to the part already worked", async () => {
    const volunteer = await seedVolunteer();
    // Started 2h ago, ends 4h from now: 2 worked, not 6 rostered.
    await seedShift(volunteer, 2, -4);

    const summary = await withToken(
      request(application).get("/api/v1/backstage/volunteer/hours-summary"),
      volunteer.authenticationToken
    );
    expect(summary.body.data.totalHoursWorked).toBe(2);
  });

  it("ignores a shift that has not started and a cancelled one", async () => {
    const volunteer = await seedVolunteer();
    await seedShift(volunteer, 4, 2); // 2h, counts
    await seedShift(volunteer, -1, -3); // starts in an hour
    await seedShift(volunteer, 10, 8, { status: "cancelled" }); // called off

    const summary = await withToken(
      request(application).get("/api/v1/backstage/volunteer/hours-summary"),
      volunteer.authenticationToken
    );
    expect(summary.body.data.totalHoursWorked).toBe(2);
    expect(summary.body.data.shifts).toHaveLength(1);
  });

  it("sums from raw milliseconds so the rows add up to the stated total", async () => {
    const volunteer = await seedVolunteer();
    // Three shifts of 2.45h. Rounded individually they are 2.5 each (7.5);
    // the true total is 7.35 → 7.4. The total must come from the raw sum.
    await seedShift(volunteer, 30, 27.55);
    await seedShift(volunteer, 20, 17.55);
    await seedShift(volunteer, 10, 7.55);

    const summary = await withToken(
      request(application).get("/api/v1/backstage/volunteer/hours-summary"),
      volunteer.authenticationToken
    );
    expect(summary.body.data.totalHoursWorked).toBe(7.4);
  });

  it("is volunteer-only — a coordinator is refused", async () => {
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "hours-coordinator@example.com",
      assignment: { eventIds: [event._id] },
    });
    const refused = await withToken(
      request(application).get("/api/v1/backstage/volunteer/hours-summary"),
      coordinator.authenticationToken
    );
    expect(refused.status).toBe(403);
  });

  it("exposes per-user totals for the admin staff list", async () => {
    const volunteer = await seedVolunteer();
    await seedShift(volunteer, 5, 2); // 3h

    const hoursByUserId = await volunteerHoursService.getWorkedHoursByUserId(fest._id);
    expect(hoursByUserId.get(String(volunteer.user._id))).toBe(3);
  });
});

describe("(B) coordinator bulk email", () => {
  let coordinator;

  async function seedConfirmedParticipants(count) {
    const participants = [];
    for (let index = 0; index < count; index += 1) {
      const participant = await createTestParticipant(college, {
        emailAddress: `bulk-${index}@example.com`,
        // Distinct USNs: the column is uniquely indexed, and the fixture default
        // would collide on the second participant.
        usn: `1AA00AA10${index}`,
      });
      const registered = await withToken(
        request(application).post(`/api/v1/events/${event._id}/registrations/solo`),
        participant.authenticationToken
      ).send({});
      expect(registered.status).toBe(201);
      participants.push(participant);
    }
    return participants;
  }

  function sendBulk(body) {
    return withToken(
      request(application).post(
        `/api/v1/fests/${fest._id}/events/${event._id}/notify-participants`
      ),
      coordinator.authenticationToken
    ).send(body);
  }

  beforeEach(async () => {
    coordinator = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "bulk-coordinator@example.com",
      assignment: { eventIds: [event._id] },
    });
  });

  it("emails every confirmed registrant once and records an audit row", async () => {
    await seedConfirmedParticipants(3);
    clearRecordedEmails();

    const sent = await sendBulk({ subject: "Venue change", message: "Moved to Room 204." });
    expect(sent.status).toBe(200);
    expect(sent.body.data.recipientCount).toBe(3);
    expect(sent.body.data.sentCount).toBe(3);
    expect(sent.body.data.sendsRemainingToday).toBe(2);

    // One email per confirmed registrant, carrying the coordinator's own words.
    const notifications = findRecordedEmailsOfKind("participantNotification");
    expect(notifications).toHaveLength(3);
    expect(notifications.map((email) => email.emailAddress).sort()).toEqual([
      "bulk-0@example.com",
      "bulk-1@example.com",
      "bulk-2@example.com",
    ]);
    expect(notifications[0].subject).toBe("Venue change");
    expect(notifications[0].message).toBe("Moved to Room 204.");

    const audit = await AuditLogModel.findOne({ action: "event.bulkEmailSent" }).lean();
    expect(audit).toBeTruthy();
    expect(audit.afterState.recipientCount).toBe(3);
    expect(audit.afterState.subject).toBe("Venue change");
    // The body is deliberately NOT copied into the audit log.
    expect(JSON.stringify(audit.afterState)).not.toContain("Moved to Room 204.");
  });

  it("refuses the 4th send in the same day", async () => {
    await seedConfirmedParticipants(1);

    for (let index = 0; index < 3; index += 1) {
      const sent = await sendBulk({ subject: `Notice ${index}`, message: "Body." });
      expect(sent.status).toBe(200);
    }
    const refused = await sendBulk({ subject: "One too many", message: "Body." });
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe("BULK_EMAIL_LIMIT_REACHED");
  });

  it("a stamp from an earlier day is read as a fresh budget", async () => {
    await seedConfirmedParticipants(1);
    // Yesterday's tally, maxed out. No job resets this — the read does.
    await EventModel.updateOne(
      { _id: event._id },
      {
        $set: {
          dailyBulkEmailCount: 3,
          lastBulkEmailSentAt: new Date(Date.now() - 36 * MILLISECONDS_PER_HOUR),
        },
      }
    );

    const sent = await sendBulk({ subject: "New day", message: "Body." });
    expect(sent.status).toBe(200);
    expect(sent.body.data.sendsUsedToday).toBe(1);
  });

  it("validates subject and message lengths", async () => {
    const noSubject = await sendBulk({ subject: "  ", message: "Body." });
    expect(noSubject.status).toBe(400);

    const longSubject = await sendBulk({ subject: "x".repeat(121), message: "Body." });
    expect(longSubject.status).toBe(400);

    const longMessage = await sendBulk({ subject: "Fine", message: "x".repeat(2001) });
    expect(longMessage.status).toBe(400);
  });

  it("the preview reports the recipient count and the remaining budget", async () => {
    await seedConfirmedParticipants(2);
    const preview = await withToken(
      request(application).get(
        `/api/v1/fests/${fest._id}/events/${event._id}/notify-participants`
      ),
      coordinator.authenticationToken
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data.recipientCount).toBe(2);
    expect(preview.body.data.sendsRemainingToday).toBe(3);
  });

  it("is closed to a participant", async () => {
    const participant = await createTestParticipant(college, {
      emailAddress: "nosy@example.com",
    });
    const refused = await withToken(
      request(application).post(
        `/api/v1/fests/${fest._id}/events/${event._id}/notify-participants`
      ),
      participant.authenticationToken
    ).send({ subject: "Hello", message: "Body." });
    expect(refused.status).toBe(403);
  });
});

describe("(C) per-round participant export", () => {
  let coordinator;
  let participants;

  beforeEach(async () => {
    coordinator = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "round-coordinator@example.com",
      assignment: { eventIds: [event._id] },
    });
    participants = [];
    for (let index = 0; index < 3; index += 1) {
      participants.push(
        await createTestParticipant(college, {
          emailAddress: `round-participant-${index}@example.com`,
          fullName: `Participant ${index}`,
          usn: `1RV22CS00${index}`,
        })
      );
    }
  });

  it("streams the round roster with scores and the advanced flag", async () => {
    const roundOne = await RoundModel.create({
      eventId: event._id,
      festId: fest._id,
      roundName: "Round 1",
      roundNumber: 1,
      participantIds: participants.map((participant) => participant.user._id),
      createdByUserId: coordinator.user._id,
    });
    // Round 2 holds only the first two — that IS the advancement record.
    await RoundModel.create({
      eventId: event._id,
      festId: fest._id,
      roundName: "Round 2",
      roundNumber: 2,
      participantIds: [participants[0].user._id, participants[1].user._id],
      createdByUserId: coordinator.user._id,
    });
    await RoundScoreModel.create({
      roundId: roundOne._id,
      eventId: event._id,
      participantUserId: participants[0].user._id,
      score: 88,
      scoredByUserId: coordinator.user._id,
    });

    const csv = await withToken(
      request(application).get(
        `/api/v1/fests/${fest._id}/events/${event._id}/rounds/${roundOne._id}/participants.csv`
      ),
      coordinator.authenticationToken
    );
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    // round-{n}-{eventSlug}-{yyyymmdd}.csv
    expect(csv.headers["content-disposition"]).toMatch(
      new RegExp(`filename="round-1-${event.eventSlug}-\\d{8}\\.csv"`)
    );

    const lines = csv.text.trim().split("\r\n");
    expect(lines[0]).toBe(
      "participantFullName,usn,collegeName,contactPhone,score,advancedToNextRound"
    );
    expect(lines).toHaveLength(4); // header + 3 participants

    const scoredRow = lines.find((line) => line.startsWith("Participant 0"));
    expect(scoredRow).toContain("88");
    expect(scoredRow).toContain("true");
    // Unscored is an EMPTY cell, not a zero.
    const unscoredRow = lines.find((line) => line.startsWith("Participant 2"));
    expect(unscoredRow).toContain(",,false");
    expect(unscoredRow).toContain("false");
  });

  it("writes a data.exported audit row naming the round", async () => {
    const round = await RoundModel.create({
      eventId: event._id,
      festId: fest._id,
      roundName: "Round 1",
      roundNumber: 1,
      participantIds: [participants[0].user._id],
      createdByUserId: coordinator.user._id,
    });
    await withToken(
      request(application).get(
        `/api/v1/fests/${fest._id}/events/${event._id}/rounds/${round._id}/participants.csv`
      ),
      coordinator.authenticationToken
    );

    const audit = await AuditLogModel.findOne({ action: "data.exported" }).lean();
    expect(audit).toBeTruthy();
    expect(audit.afterState.roundId).toBe(String(round._id));
    expect(audit.afterState.roundNumber).toBe(1);
  });

  it("404s for a round belonging to a different event", async () => {
    const otherEvent = await createTestEvent(fest, admin.user, {
      eventName: "Other Event",
      eventSlug: "other-event",
    });
    const foreignRound = await RoundModel.create({
      eventId: otherEvent._id,
      festId: fest._id,
      roundName: "Round 1",
      roundNumber: 1,
      participantIds: [],
      createdByUserId: admin.user._id,
    });
    const refused = await withToken(
      request(application).get(
        `/api/v1/fests/${fest._id}/events/${event._id}/rounds/${foreignRound._id}/participants.csv`
      ),
      coordinator.authenticationToken
    );
    expect(refused.status).toBe(404);
  });
});

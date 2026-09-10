/*
 * Section B: post-event feedback.
 *
 * The gate under test is "did you actually attend", which the system knows only
 * as an ACCEPTED scan at one of the event's entry checkpoints. So the fixtures
 * here write real scan rows rather than stubbing an attendance flag — if the
 * scan shape changes, this suite is supposed to fail.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { ScanModel } from "../../src/models/scan-model.js";
import { EventFeedbackModel } from "../../src/models/event-feedback-model.js";
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
  createTestParticipant,
  createTestPass,
  createTestStaffMember,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let event;
let checkpoint;
let participant;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

/* An accepted scan of this participant's pass at the event's own door. */
async function recordAttendance(attendee, overrides = {}) {
  const pass = await createTestPass(fest, attendee.user);
  await ScanModel.create({
    clientScanId: `scan-${String(attendee.user._id)}-${Math.trunc(process.hrtime()[1])}`,
    passId: pass._id,
    checkpointId: checkpoint._id,
    scannedByUserId: admin.user._id,
    scanMethod: "qr",
    direction: "in",
    result: "accepted",
    scannedAt: new Date(),
    ...overrides,
  });
  return pass;
}

async function submitFeedback(attendee, body) {
  return withToken(
    request(application).post(`/api/v1/events/${event._id}/feedback`),
    attendee.authenticationToken
  ).send(body);
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user);
  event = await createTestEvent(fest, admin.user);
  checkpoint = await createTestEventCheckpoint(fest, event._id);
  participant = await createTestParticipant(college, {
    emailAddress: "attendee@example.com",
  });
});

describe("the attendance gate", () => {
  it("accepts feedback from someone with an accepted scan", async () => {
    await recordAttendance(participant);

    const submitted = await submitFeedback(participant, { rating: 4, comment: "Great event." });
    expect(submitted.status).toBe(201);
    expect(submitted.body.data.rating).toBe(4);
    expect(submitted.body.data.comment).toBe("Great event.");

    const stored = await EventFeedbackModel.findOne({ eventId: event._id }).lean();
    // festId is denormalised off the event so the export never has to join.
    expect(String(stored.festId)).toBe(String(fest._id));
  });

  it("refuses someone who registered but never turned up — no armchair reviews", async () => {
    // No scan at all: they hold a pass but never walked through the door.
    await createTestPass(fest, participant.user);

    const refused = await submitFeedback(participant, { rating: 5 });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("FEEDBACK_NOT_ATTENDED");
    expect(await EventFeedbackModel.countDocuments({})).toBe(0);
  });

  it("refuses someone whose only scan was REJECTED", async () => {
    await recordAttendance(participant, { result: "rejectedNoEntitlement" });

    const refused = await submitFeedback(participant, { rating: 5 });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("FEEDBACK_NOT_ATTENDED");
  });

  it("refuses a scan at a DIFFERENT event's door", async () => {
    const otherEvent = await createTestEvent(fest, admin.user, {
      eventName: "Other Event",
      // The fixture does not derive the slug from the name, and it is unique per fest.
      eventSlug: "other-event",
    });
    const otherCheckpoint = await createTestEventCheckpoint(fest, otherEvent._id);
    await recordAttendance(participant, { checkpointId: otherCheckpoint._id });

    const refused = await submitFeedback(participant, { rating: 5 });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("FEEDBACK_NOT_ATTENDED");
  });
});

describe("one shot per participant", () => {
  it("refuses a second submission with FEEDBACK_ALREADY_SUBMITTED", async () => {
    await recordAttendance(participant);
    expect((await submitFeedback(participant, { rating: 4 })).status).toBe(201);

    const refused = await submitFeedback(participant, { rating: 1, comment: "changed my mind" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("FEEDBACK_ALREADY_SUBMITTED");

    // The original rating is untouched — this is not an upsert.
    const stored = await EventFeedbackModel.findOne({ eventId: event._id }).lean();
    expect(stored.rating).toBe(4);
    expect(await EventFeedbackModel.countDocuments({})).toBe(1);
  });

  it("the unique index refuses a duplicate even if the service check is bypassed", async () => {
    await recordAttendance(participant);
    await submitFeedback(participant, { rating: 3 });

    await expect(
      EventFeedbackModel.create({
        eventId: event._id,
        festId: fest._id,
        userId: participant.user._id,
        rating: 5,
        submittedAt: new Date(),
      })
    ).rejects.toThrow();
  });
});

describe("rating validation", () => {
  it.each([0, 6, 2.5, "four", null])("refuses a rating of %p", async (rating) => {
    await recordAttendance(participant);
    const refused = await submitFeedback(participant, { rating });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("accepts feedback with no comment at all", async () => {
    await recordAttendance(participant);
    const submitted = await submitFeedback(participant, { rating: 5 });
    expect(submitted.status).toBe(201);
    expect(submitted.body.data.comment).toBeNull();
  });
});

describe("eligibility, for the participant app's rating card", () => {
  it("reports attended-but-not-yet-rated, then rated", async () => {
    await recordAttendance(participant);

    const before = await withToken(
      request(application).get(`/api/v1/events/${event._id}/feedback/me`),
      participant.authenticationToken
    );
    expect(before.body.data).toMatchObject({ hasAttended: true, hasSubmitted: false, rating: null });

    await submitFeedback(participant, { rating: 4 });

    const after = await withToken(
      request(application).get(`/api/v1/events/${event._id}/feedback/me`),
      participant.authenticationToken
    );
    expect(after.body.data).toMatchObject({ hasAttended: true, hasSubmitted: true, rating: 4 });
  });

  it("reports not-attended for someone who never scanned in", async () => {
    const eligibility = await withToken(
      request(application).get(`/api/v1/events/${event._id}/feedback/me`),
      participant.authenticationToken
    );
    expect(eligibility.body.data.hasAttended).toBe(false);
  });
});

describe("the coordinator summary", () => {
  async function seedRatings(ratings) {
    for (const [index, rating] of ratings.entries()) {
      const attendee = await createTestParticipant(college, {
        emailAddress: `rater-${index}@example.com`,
      });
      await recordAttendance(attendee);
      await submitFeedback(attendee, {
        rating,
        comment: index === 0 ? "Loved it." : undefined,
      });
    }
  }

  it("returns the average, the total, a full distribution and recent comments", async () => {
    await seedRatings([5, 4, 4, 2]);

    const summary = await withToken(
      request(application).get(`/api/v1/events/${event._id}/feedback/summary`),
      admin.authenticationToken
    );
    expect(summary.status).toBe(200);
    expect(summary.body.data.totalResponses).toBe(4);
    expect(summary.body.data.averageRating).toBe(3.8); // (5+4+4+2)/4
    // Every bucket present, including the empty ones — an omitted "1" reads as
    // missing data rather than as good news.
    expect(summary.body.data.ratingDistribution).toEqual({ 1: 0, 2: 1, 3: 0, 4: 2, 5: 1 });
    expect(summary.body.data.recentComments).toHaveLength(1);
    expect(summary.body.data.recentComments[0].comment).toBe("Loved it.");
  });

  it("reports a null average and an empty distribution when nobody has rated", async () => {
    const summary = await withToken(
      request(application).get(`/api/v1/events/${event._id}/feedback/summary`),
      admin.authenticationToken
    );
    expect(summary.status).toBe(200);
    expect(summary.body.data.averageRating).toBeNull();
    expect(summary.body.data.totalResponses).toBe(0);
    expect(summary.body.data.ratingDistribution).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it("never names the author of a comment", async () => {
    await seedRatings([5]);
    const summary = await withToken(
      request(application).get(`/api/v1/events/${event._id}/feedback/summary`),
      admin.authenticationToken
    );
    const serialised = JSON.stringify(summary.body);
    expect(serialised).not.toContain("userId");
    expect(serialised).not.toContain("rater-0@example.com");
  });

  it("is open to a coordinator of the event but closed to a participant", async () => {
    const coordinator = await createTestStaffMember(fest, "coordinator", {
      emailAddress: "event-coordinator@example.com",
      assignment: { eventIds: [event._id] },
    });
    const allowed = await withToken(
      request(application).get(`/api/v1/events/${event._id}/feedback/summary`),
      coordinator.authenticationToken
    );
    expect(allowed.status).toBe(200);

    const refused = await withToken(
      request(application).get(`/api/v1/events/${event._id}/feedback/summary`),
      participant.authenticationToken
    );
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("PERMISSION_DENIED");
  });

  it("needs a token at all", async () => {
    const anonymous = await request(application).get(
      `/api/v1/events/${event._id}/feedback/summary`
    );
    expect(anonymous.status).toBe(401);
  });
});

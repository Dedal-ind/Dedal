/*
 * Section A: the waitlist and its automatic promotion.
 *
 * The promotion is NOT triggered directly in these tests. It is reached the way
 * production reaches it — by cancelling a confirmed registration, or by letting
 * the pending-payment sweep release a seat — because the whole design claim is
 * that promotion hangs off seat release rather than off an admin action.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { AuditLogModel } from "../../src/models/audit-log-model.js";
import { MAXIMUM_WAITLIST_LENGTH } from "../../src/helpers/registration-seat-helpers.js";
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
  createTestParticipant,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

/* A one-seat event, so the second joiner always meets a full house. */
async function createFullableEvent(overrides = {}) {
  return createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({ capacity: 1, waitlistEnabled: true, ...overrides })
  );
}

let participantCounter = 0;
async function createParticipant() {
  participantCounter += 1;
  return createTestParticipant(college, {
    emailAddress: `waitlist-${participantCounter}@example.com`,
    usn: `1AA00AA${String(200 + participantCounter).padStart(3, "0")}`,
  });
}

function registerSolo(event, participant) {
  return withToken(
    request(application).post(`/api/v1/events/${event._id}/registrations/solo`),
    participant.authenticationToken
  ).send({});
}

beforeAll(setupTestDatabase);
afterAll(teardownTestDatabase);

beforeEach(async () => {
  await clearAllCollections();
  clearRecordedEmails();
  participantCounter = 0;
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
});

describe("joining the waitlist", () => {
  it("a full event with waitlistEnabled queues at position 1 without taking a seat", async () => {
    const event = await createFullableEvent();
    await registerSolo(event, await createParticipant()); // takes the only seat

    const queued = await registerSolo(event, await createParticipant());
    expect(queued.status).toBe(201);
    expect(queued.body.data.registration.status).toBe("waitlisted");
    expect(queued.body.data.registration.waitlistPosition).toBe(1);

    // The seat count is untouched — a queued person holds nothing.
    const stored = await EventModel.findById(event._id).lean();
    expect(stored.registeredCount).toBe(1);
  });

  it("numbers the queue in join order", async () => {
    const event = await createFullableEvent();
    await registerSolo(event, await createParticipant());

    const first = await registerSolo(event, await createParticipant());
    const second = await registerSolo(event, await createParticipant());
    expect(first.body.data.registration.waitlistPosition).toBe(1);
    expect(second.body.data.registration.waitlistPosition).toBe(2);
  });

  it("still refuses with EVENT_FULL when waitlisting is off", async () => {
    const event = await createFullableEvent({ waitlistEnabled: false });
    await registerSolo(event, await createParticipant());

    const refused = await registerSolo(event, await createParticipant());
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("EVENT_FULL");
  });

  it(`refuses the ${MAXIMUM_WAITLIST_LENGTH + 1}th joiner with WAITLIST_FULL`, async () => {
    const event = await createFullableEvent();
    await registerSolo(event, await createParticipant());

    // Seed the queue to its cap directly — 50 HTTP registrations would make this
    // suite minutes long, and the cap is a count check, not a flow check.
    const fillers = [];
    for (let index = 0; index < MAXIMUM_WAITLIST_LENGTH; index += 1) {
      fillers.push({
        eventId: event._id,
        userId: (await createParticipant()).user._id,
        status: "waitlisted",
        waitlistPosition: index + 1,
        feeAmountSnapshotPaise: 0,
        registeredAt: new Date(),
      });
    }
    await RegistrationModel.insertMany(fillers);

    const refused = await registerSolo(event, await createParticipant());
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("WAITLIST_FULL");
  });

  it("a PAID full event queues without a payment order — nobody pays to hold a place", async () => {
    const event = await createFullableEvent({ feeType: "perPerson", feeAmountPaise: 50000 });
    // The seat-taker pays; the queue-joiner must not be asked to.
    await registerSolo(event, await createParticipant());

    const queued = await registerSolo(event, await createParticipant());
    expect(queued.status).toBe(201);
    expect(queued.body.data.registration.status).toBe("waitlisted");
    // No Razorpay order rode along.
    expect(queued.body.data.payment ?? null).toBeNull();
  });
});

describe("promotion when a seat is released", () => {
  it("a cancellation promotes the oldest waitlisted row to CONFIRMED on a free event", async () => {
    const event = await createFullableEvent();
    const seatHolder = await createParticipant();
    const queuedFirst = await createParticipant();
    const queuedSecond = await createParticipant();

    const seated = await registerSolo(event, seatHolder);
    await registerSolo(event, queuedFirst);
    await registerSolo(event, queuedSecond);
    clearRecordedEmails();

    const cancelled = await withToken(
      request(application).post(
        `/api/v1/registrations/${seated.body.data.registration.id}/cancel`
      ),
      seatHolder.authenticationToken
    ).send({ reason: "Cannot make it any more" });
    expect(cancelled.status).toBe(200);

    const promoted = await RegistrationModel.findOne({ userId: queuedFirst.user._id }).lean();
    expect(promoted.status).toBe("confirmed");
    // Position cleared: a confirmed row is not in a queue.
    expect(promoted.waitlistPosition).toBeNull();
    expect(promoted.promotedFromWaitlistAt).not.toBeNull();

    // The person behind them stays put.
    const stillQueued = await RegistrationModel.findOne({ userId: queuedSecond.user._id }).lean();
    expect(stillQueued.status).toBe("waitlisted");

    // Exactly one seat changed hands — the count is back where it started.
    const storedEvent = await EventModel.findById(event._id).lean();
    expect(storedEvent.registeredCount).toBe(1);

    const promotionEmails = findRecordedEmailsOfKind("waitlistPromotion");
    expect(promotionEmails).toHaveLength(1);
    expect(promotionEmails[0].emailAddress).toBe(queuedFirst.user.emailAddress);
    expect(promotionEmails[0].isPaid).toBe(false);

    const audit = await AuditLogModel.findOne({ action: "registration.waitlistPromoted" }).lean();
    expect(audit).toBeTruthy();
    expect(audit.afterState.promotedTo).toBe("confirmed");
  });

  it("promotes to PENDING_PAYMENT on a paid event and says so in the email", async () => {
    const event = await createFullableEvent({ feeType: "perPerson", feeAmountPaise: 50000 });
    const seatHolder = await createParticipant();
    const queued = await createParticipant();

    /*
     * A paid seat that was actually captured, seeded directly. Going through the
     * HTTP flow would leave the seat-holder PENDING_PAYMENT, and cancelling that
     * takes the release-a-hold path rather than the confirmed-cancel path under
     * test here.
     */
    const seated = await RegistrationModel.create({
      eventId: event._id,
      userId: seatHolder.user._id,
      status: "confirmed",
      paymentStatus: "completed",
      feeAmountSnapshotPaise: 50000,
      totalFeePaise: 50000,
      registeredAt: new Date(),
    });
    await EventModel.updateOne({ _id: event._id }, { $set: { registeredCount: 1 } });

    await registerSolo(event, queued);
    clearRecordedEmails();

    await withToken(
      request(application).post(
        `/api/v1/registrations/${seated._id}/cancel`
      ),
      seatHolder.authenticationToken
    ).send({ reason: "Cannot make it any more" });

    const promoted = await RegistrationModel.findOne({ userId: queued.user._id }).lean();
    expect(promoted.status).toBe("pendingPayment");

    const [promotionEmail] = findRecordedEmailsOfKind("waitlistPromotion");
    expect(promotionEmail.isPaid).toBe(true);
    // The deadline is the message on a paid promotion.
    expect(promotionEmail.paymentWindowMinutes).toBe(30);
  });

  it("promotes only ONE person per released seat", async () => {
    const event = await createFullableEvent();
    const seatHolder = await createParticipant();
    const seated = await registerSolo(event, seatHolder);
    for (let index = 0; index < 3; index += 1) {
      await registerSolo(event, await createParticipant());
    }

    await withToken(
      request(application).post(
        `/api/v1/registrations/${seated.body.data.registration.id}/cancel`
      ),
      seatHolder.authenticationToken
    ).send({ reason: "Cannot make it any more" });

    expect(
      await RegistrationModel.countDocuments({ eventId: event._id, status: "confirmed" })
    ).toBe(1);
    expect(
      await RegistrationModel.countDocuments({ eventId: event._id, status: "waitlisted" })
    ).toBe(2);
  });

  it("cancelling a WAITLISTED row promotes nobody — it released no seat", async () => {
    const event = await createFullableEvent();
    await registerSolo(event, await createParticipant());
    const queuedFirst = await createParticipant();
    const queuedSecond = await createParticipant();
    const queued = await registerSolo(event, queuedFirst);
    await registerSolo(event, queuedSecond);
    clearRecordedEmails();

    await withToken(
      request(application).post(
        `/api/v1/registrations/${queued.body.data.registration.id}/cancel`
      ),
      queuedFirst.authenticationToken
    ).send({ reason: "Changed my mind" });

    // The person behind must NOT have been promoted: no seat came back.
    const stillQueued = await RegistrationModel.findOne({ userId: queuedSecond.user._id }).lean();
    expect(stillQueued.status).toBe("waitlisted");
    expect(findRecordedEmailsOfKind("waitlistPromotion")).toHaveLength(0);

    // And the count never went negative.
    const storedEvent = await EventModel.findById(event._id).lean();
    expect(storedEvent.registeredCount).toBe(1);
  });
});

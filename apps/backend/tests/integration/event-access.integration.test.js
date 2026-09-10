import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";

import { application } from "../../src/application.js";
import { EventModel } from "../../src/models/event-model.js";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { PassModel } from "../../src/models/pass-model.js";
import { NotificationModel } from "../../src/models/notification-model.js";
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
  createTestParticipant,
  buildEventAttributes,
} from "../setup/create-test-fixtures.js";
import registrationService from "../../src/services/registration-service.js";

installEmailServiceMock();

/*
 * EVENT ACCESS — the four actions that sound alike and are not.
 *
 * The rules pinned down here are the ones a reader would otherwise have to infer
 * from three services: registration closes ONLY when an admin closes it (no date
 * does it any more), close is reversible and per-event, cancel and delete are
 * final and differ in what they do to the people who signed up.
 */

const HOUR = 60 * 60 * 1000;
const hoursFromNow = (hours) => new Date(Date.now() + hours * HOUR);

let college;
let admin;
let fest;
let event;
let otherEvent;
let participant;

function authed(builder) {
  return builder.set("Authorization", `Bearer ${admin.authenticationToken}`);
}

const eventPath = (id) => `/api/v1/fests/${fest._id}/events/${id}`;

/*
 * The `code` off a rejected ApplicationError. Read through a catch rather than
 * rejects.toMatchObject: an Error's own enumerable properties are not what
 * toMatchObject compares, so that form passes or fails for reasons unrelated to
 * the code actually thrown.
 */
async function captureErrorCode(run) {
  try {
    await run();
    return null;
  } catch (error) {
    /* ApplicationError names it errorCode, not code — the `code` shape is what
     * the frontend's api-client normalises the HTTP envelope into. */
    return error?.errorCode ?? null;
  }
}

beforeAll(async () => {
  await setupTestDatabase();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });

  const window = {
    status: "published",
    registrationOpensAt: hoursFromNow(-12),
    registrationClosesAt: hoursFromNow(-6),
    startsAt: hoursFromNow(-4),
    endsAt: hoursFromNow(-2),
  };
  /*
   * Deliberately ALL IN THE PAST — registrationClosesAt, startsAt and endsAt.
   * Under the old rules this event was shut; under the new ones it is open,
   * which is the single most important behaviour in this file.
   */
  event = await EventModel.create({
    ...buildEventAttributes(),
    ...window,
    eventSlug: "already-started",
    festId: fest._id,
    createdByUserId: admin.user._id,
  });
  otherEvent = await EventModel.create({
    ...buildEventAttributes(),
    ...window,
    eventName: "Untouched Event",
    eventSlug: "untouched-event",
    festId: fest._id,
    createdByUserId: admin.user._id,
  });
  participant = await createTestParticipant(college);
});

afterAll(teardownTestDatabase);

describe("registration does not auto-close", () => {
  it("accepts a registration for an event whose start AND end have passed", async () => {
    const result = await registrationService.registerParticipantSolo(
      participant.user._id,
      String(event._id)
    );
    expect(result.registration.status).toBe("confirmed");
  });

  it("reports registrationStatus 'open' despite every date being in the past", async () => {
    const stored = await EventModel.findById(event._id);
    expect(stored.registrationStatus).toBe("open");
  });
});

describe("close and reopen registration", () => {
  it("closes one event and leaves its siblings open", async () => {
    const response = await authed(request(application).post(`${eventPath(event._id)}/close-registration`));
    expect(response.status).toBe(200);

    expect((await EventModel.findById(event._id)).registrationStatus).toBe("closed");
    expect((await EventModel.findById(otherEvent._id)).registrationStatus).toBe("open");
  });

  it("refuses a registration once closed, and accepts again after reopen", async () => {
    await authed(request(application).post(`${eventPath(event._id)}/close-registration`));
    expect(await captureErrorCode(() =>
      registrationService.registerParticipantSolo(participant.user._id, String(event._id))
    )).toBe("REGISTRATION_CLOSED");

    await authed(request(application).post(`${eventPath(event._id)}/reopen-registration`));
    const result = await registrationService.registerParticipantSolo(
      participant.user._id,
      String(event._id)
    );
    expect(result.registration.status).toBe("confirmed");
  });

  it("leaves existing registrations intact through a close", async () => {
    await registrationService.registerParticipantSolo(participant.user._id, String(event._id));
    await authed(request(application).post(`${eventPath(event._id)}/close-registration`));

    const registration = await RegistrationModel.findOne({
      eventId: event._id,
      userId: participant.user._id,
    });
    expect(registration.status).toBe("confirmed");
    expect(await PassModel.countDocuments({ userId: participant.user._id, festId: fest._id })).toBe(1);
  });

  it("reopening one event does not reopen another", async () => {
    await authed(request(application).post(`/api/v1/fests/${fest._id}/close-registration`));
    await authed(request(application).post(`${eventPath(event._id)}/reopen-registration`));

    expect((await EventModel.findById(event._id)).registrationStatus).toBe("open");
    expect((await EventModel.findById(otherEvent._id)).registrationStatus).toBe("closed");
  });
});

describe("fest-wide close and reopen", () => {
  it("closes every event of the fest at once", async () => {
    const response = await authed(
      request(application).post(`/api/v1/fests/${fest._id}/close-registration`)
    );
    expect(response.status).toBe(200);
    expect(response.body.data.eventsChanged).toBe(2);

    for (const id of [event._id, otherEvent._id]) {
      expect((await EventModel.findById(id)).registrationStatus).toBe("closed");
    }
  });

  it("skips cancelled events when reopening, and says how many", async () => {
    await authed(request(application).post(`${eventPath(otherEvent._id)}/cancel`));
    await authed(request(application).post(`/api/v1/fests/${fest._id}/close-registration`));

    const response = await authed(
      request(application).post(`/api/v1/fests/${fest._id}/reopen-registration`)
    );
    expect(response.body.data.eventsSkippedFinal).toBe(1);
    // A cancelled event stays closed however the fest-wide switch is thrown.
    expect((await EventModel.findById(otherEvent._id)).registrationStatus).toBe("closed");
    expect((await EventModel.findById(event._id)).registrationStatus).toBe("open");
  });
});

describe("cancel is final", () => {
  it("marks the event cancelled and forces registration closed", async () => {
    await authed(request(application).post(`${eventPath(event._id)}/cancel`));

    const stored = await EventModel.findById(event._id);
    expect(stored.status).toBe("cancelled");
    expect(stored.registrationStatus).toBe("closed");
  });

  it("refuses a second cancellation rather than silently succeeding", async () => {
    await authed(request(application).post(`${eventPath(event._id)}/cancel`));
    const second = await authed(request(application).post(`${eventPath(event._id)}/cancel`));
    expect(second.status).toBe(409);
  });

  it("refuses to edit a cancelled event", async () => {
    await authed(request(application).post(`${eventPath(event._id)}/cancel`));
    const response = await authed(
      request(application).patch(eventPath(event._id)).send({ venue: "Somewhere else" })
    );
    expect(response.status).toBe(409);
  });
});

describe("delete withdraws without destroying", () => {
  it("soft-deletes: the row survives, the status changes, registration shuts", async () => {
    await authed(request(application).delete(`${eventPath(event._id)}/soft`));

    const stored = await EventModel.findById(event._id);
    expect(stored).not.toBeNull();
    expect(stored.status).toBe("deleted");
    expect(stored.registrationStatus).toBe("closed");
  });

  /*
   * The load-bearing difference between delete and cancel. Cancel ends the
   * participant's booking; delete leaves it exactly as it was and only stops the
   * event being listed.
   */
  it("leaves existing registrations, payments and passes untouched", async () => {
    await registrationService.registerParticipantSolo(participant.user._id, String(event._id));
    await authed(request(application).delete(`${eventPath(event._id)}/soft`));

    const registration = await RegistrationModel.findOne({
      eventId: event._id,
      userId: participant.user._id,
    });
    expect(registration.status).toBe("confirmed");
    expect(registration.cancelledAt ?? null).toBeNull();
    expect(await PassModel.countDocuments({ userId: participant.user._id, festId: fest._id })).toBe(1);
  });

  it("notifies the affected participants in their inbox", async () => {
    await registrationService.registerParticipantSolo(participant.user._id, String(event._id));
    await authed(request(application).delete(`${eventPath(event._id)}/soft`));

    const notifications = await NotificationModel.find({ userId: participant.user._id });
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.some((row) => row.notificationType === "eventRemoved")).toBe(true);
  });

  it("does not touch the sibling event or the fest", async () => {
    await authed(request(application).delete(`${eventPath(event._id)}/soft`));

    expect((await EventModel.findById(otherEvent._id)).status).toBe("published");
    expect(await EventModel.countDocuments({ festId: fest._id })).toBe(2);
  });

  it("refuses a registration for a deleted event", async () => {
    await authed(request(application).delete(`${eventPath(event._id)}/soft`));
    /* A deleted event is outside REGISTERABLE_EVENT_STATUSES, so the status
     * guard refuses it before the registration-window guard is even reached. */
    expect(await captureErrorCode(() =>
      registrationService.registerParticipantSolo(participant.user._id, String(event._id))
    )).toBe("EVENT_NOT_REGISTERABLE");
  });
});

describe("notify participants", () => {
  it("writes inbox rows when the inbox channel is chosen", async () => {
    await registrationService.registerParticipantSolo(participant.user._id, String(event._id));

    const response = await authed(
      request(application)
        .post(`${eventPath(event._id)}/notify-participants`)
        .send({ subject: "Venue moved", message: "We are in Hall B.", channels: ["inbox"] })
    );

    expect(response.status).toBe(200);
    expect(response.body.data.inboxNotifiedCount).toBe(1);
    // Inbox-only must not spend the day's email budget.
    expect(response.body.data.sentCount).toBe(0);
  });

  it("refuses a send with no channel at all", async () => {
    const response = await authed(
      request(application)
        .post(`${eventPath(event._id)}/notify-participants`)
        .send({ subject: "Hi", message: "There", channels: ["carrier-pigeon"] })
    );
    expect(response.status).toBe(400);
  });
});

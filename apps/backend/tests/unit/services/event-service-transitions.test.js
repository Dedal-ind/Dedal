import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { EventModel } from "../../../src/models/event-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import eventService from "../../../src/services/event-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestOutsider,
  createTestFest,
  createTestEvent,
  buildEventAttributes,
} from "../../setup/create-test-fixtures.js";

let college;
let admin;
let outsider;
let publishedFest;

beforeAll(async () => {
  await setupTestDatabase();
  await EventModel.createIndexes();
  await FestModel.createIndexes();
  await StaffAssignmentModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  outsider = await createTestOutsider();
  publishedFest = await createTestFest(college, admin.user, { status: "published" });
});

afterAll(teardownTestDatabase);

/* Split from event-service.test.js to stay within the per-file line budget. */
describe("updateEvent", () => {
  it("applies the patch and re-runs the cross-field hook", async () => {
    const event = await createTestEvent(publishedFest, admin.user);
    const updated = await eventService.updateEvent(admin.user._id, publishedFest.id, event.id, {
      venue: "Hall B",
    });

    expect(updated.venue).toBe("Hall B");
  });

  it("rejects a patch that breaks an invariant", async () => {
    const event = await createTestEvent(publishedFest, admin.user);

    await expect(
      eventService.updateEvent(admin.user._id, publishedFest.id, event.id, {
        endsAt: new Date("2027-03-01T09:00:00.000Z"),
      })
    ).rejects.toThrow(/endsAt must be on or after startsAt/);
  });

  it("refuses a non-administrator", async () => {
    const event = await createTestEvent(publishedFest, admin.user);

    await expect(
      eventService.updateEvent(outsider.user._id, publishedFest.id, event.id, { venue: "X" })
    ).rejects.toMatchObject({ errorCode: "PERMISSION_DENIED" });
  });

  it("refuses to edit a cancelled event", async () => {
    const event = await createTestEvent(publishedFest, admin.user, { status: "cancelled" });

    const error = await eventService
      .updateEvent(admin.user._id, publishedFest.id, event.id, { venue: "X" })
      .catch((caughtError) => caughtError);

    expect(error.errorCode).toBe("INVALID_EVENT_STATE");
    expect(error.details).toEqual({ currentStatus: "cancelled", attemptedAction: "update" });
  });
});

describe("publishEvent", () => {
  it("moves a draft event to published", async () => {
    const event = await createTestEvent(publishedFest, admin.user);
    const published = await eventService.publishEvent(admin.user._id, publishedFest.id, event.id);

    expect(published.status).toBe("published");
  });

  it("refuses to publish an event that is not a draft", async () => {
    const event = await createTestEvent(publishedFest, admin.user, { status: "published" });

    const error = await eventService
      .publishEvent(admin.user._id, publishedFest.id, event.id)
      .catch((caughtError) => caughtError);

    expect(error.errorCode).toBe("INVALID_EVENT_STATE");
    expect(error.details).toEqual({
      currentStatus: "published",
      attemptedTransition: "publish",
    });
  });

  /* A published event inside an unpublished fest would leak once browsing exists. */
  it("refuses to publish inside a draft or archived fest", async () => {
    for (const festStatus of ["draft", "archived"]) {
      const fest = await createTestFest(college, admin.user, {
        festSlug: `fest-${festStatus}`,
        status: festStatus,
      });
      const event = await createTestEvent(fest, admin.user);

      const error = await eventService
        .publishEvent(admin.user._id, fest.id, event.id)
        .catch((caughtError) => caughtError);

      expect(error.errorCode).toBe("INVALID_FEST_STATE");
      expect(error.details.currentFestStatus).toBe(festStatus);
    }
  });

  it("refuses a non-administrator", async () => {
    const event = await createTestEvent(publishedFest, admin.user);

    await expect(
      eventService.publishEvent(outsider.user._id, publishedFest.id, event.id)
    ).rejects.toMatchObject({ errorCode: "PERMISSION_DENIED" });
  });
});

describe("cancelEvent", () => {
  it("cancels a draft or published event", async () => {
    for (const status of ["draft", "published"]) {
      const event = await createTestEvent(publishedFest, admin.user, {
        status,
        eventSlug: `event-${status}`,
      });
      const cancelled = await eventService.cancelEvent(admin.user._id, publishedFest.id, event.id);
      expect(cancelled.status).toBe("cancelled");
    }
  });

  it("reports an already-cancelled event with its own code", async () => {
    const event = await createTestEvent(publishedFest, admin.user, { status: "cancelled" });

    await expect(
      eventService.cancelEvent(admin.user._id, publishedFest.id, event.id)
    ).rejects.toMatchObject({ errorCode: "EVENT_ALREADY_CANCELLED", statusCode: 409 });
  });

  it("refuses to cancel a completed event", async () => {
    const event = await createTestEvent(publishedFest, admin.user, { status: "completed" });

    const error = await eventService
      .cancelEvent(admin.user._id, publishedFest.id, event.id)
      .catch((caughtError) => caughtError);

    expect(error.errorCode).toBe("INVALID_EVENT_STATE");
    expect(error.details.attemptedTransition).toBe("cancel");
  });

  it("refuses a non-administrator", async () => {
    const event = await createTestEvent(publishedFest, admin.user);

    await expect(
      eventService.cancelEvent(outsider.user._id, publishedFest.id, event.id)
    ).rejects.toMatchObject({ errorCode: "PERMISSION_DENIED" });
  });
});

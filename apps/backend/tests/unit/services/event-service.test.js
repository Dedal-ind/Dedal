import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { EventModel } from "../../../src/models/event-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import { CheckpointModel } from "../../../src/models/checkpoint-model.js";
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

describe("createEvent", () => {
  it("creates a draft event owned by the administrator", async () => {
    const event = await eventService.createEvent(
      admin.user._id,
      publishedFest.id,
      buildEventAttributes()
    );

    expect(event.status).toBe("draft");
    expect(event.eventSlug).toBe("robowars-2027");
    expect(event.registeredCount).toBe(0);
    expect(event.festId.toString()).toBe(publishedFest.id);
  });

  it("creates an event with no category, leaving it null (a container)", async () => {
    const attributes = buildEventAttributes({ eventName: "Manthan Vertical" });
    delete attributes.category;

    const event = await eventService.createEvent(admin.user._id, publishedFest.id, attributes);

    expect(event.category).toBe(null);
  });

  it("still creates an event with a valid category", async () => {
    const event = await eventService.createEvent(
      admin.user._id,
      publishedFest.id,
      buildEventAttributes({ category: "technical" })
    );

    expect(event.category).toBe("technical");
  });

  it("creates a child event carrying the parentEventId of a parent in the same fest", async () => {
    const parent = await eventService.createEvent(
      admin.user._id,
      publishedFest.id,
      buildEventAttributes({ eventName: "Manthan Vertical" })
    );

    const child = await eventService.createEvent(
      admin.user._id,
      publishedFest.id,
      buildEventAttributes({ eventName: "Debate", parentEventId: parent.id })
    );

    expect(String(child.parentEventId)).toBe(parent.id);
  });

  it("refuses a parentEventId that belongs to a different fest", async () => {
    const otherFest = await createTestFest(college, admin.user, { festSlug: "other-fest" });
    const foreignParent = await eventService.createEvent(
      admin.user._id,
      otherFest.id,
      buildEventAttributes({ eventName: "Foreign Parent" })
    );

    await expect(
      eventService.createEvent(
        admin.user._id,
        publishedFest.id,
        buildEventAttributes({ eventName: "Child", parentEventId: foreignParent.id })
      )
    ).rejects.toMatchObject({ errorCode: "PARENT_EVENT_WRONG_FEST", statusCode: 400 });
  });

  it("scopes the slug retry to the fest", async () => {
    await eventService.createEvent(admin.user._id, publishedFest.id, buildEventAttributes());
    const second = await eventService.createEvent(
      admin.user._id,
      publishedFest.id,
      buildEventAttributes()
    );
    expect(second.eventSlug).toBe("robowars-2027-2");

    const otherFest = await createTestFest(college, admin.user, { festSlug: "other-fest" });
    const inOtherFest = await eventService.createEvent(
      admin.user._id,
      otherFest.id,
      buildEventAttributes()
    );
    expect(inOtherFest.eventSlug).toBe("robowars-2027");
  });

  it("refuses a non-administrator", async () => {
    await expect(
      eventService.createEvent(outsider.user._id, publishedFest.id, buildEventAttributes())
    ).rejects.toMatchObject({ errorCode: "PERMISSION_DENIED", statusCode: 403 });
  });

  it("refuses a fest that does not exist", async () => {
    await expect(
      eventService.createEvent(
        admin.user._id,
        new mongoose.Types.ObjectId().toString(),
        buildEventAttributes()
      )
    ).rejects.toMatchObject({ errorCode: "FEST_NOT_FOUND", statusCode: 404 });
  });

  it("refuses to add an event to an archived fest", async () => {
    const archivedFest = await createTestFest(college, admin.user, {
      festSlug: "archived-fest",
      status: "archived",
    });

    const error = await eventService
      .createEvent(admin.user._id, archivedFest.id, buildEventAttributes())
      .catch((caughtError) => caughtError);

    expect(error.errorCode).toBe("INVALID_FEST_STATE");
    expect(error.details).toEqual({ currentStatus: "archived", attemptedAction: "createEvent" });
  });

  it("refuses a name that produces an empty slug", async () => {
    await expect(
      eventService.createEvent(
        admin.user._id,
        publishedFest.id,
        buildEventAttributes({ eventName: "!!!" })
      )
    ).rejects.toMatchObject({ errorCode: "VALIDATION_FAILED", statusCode: 400 });
  });
});

describe("listPublicEvents", () => {
  it("returns only the publicly visible statuses, soonest first", async () => {
    const statuses = ["draft", "published", "ongoing", "completed", "cancelled"];
    for (const [index, status] of statuses.entries()) {
      await createTestEvent(publishedFest, admin.user, {
        status,
        eventSlug: `event-${index}`,
        startsAt: new Date(`2027-03-0${index + 1}T10:00:00.000Z`),
        endsAt: new Date(`2027-03-0${index + 1}T18:00:00.000Z`),
      });
    }

    const events = await eventService.listPublicEvents(publishedFest.id);

    /*
     * CANCELLED is publicly visible, by design. PUBLICLY_VISIBLE_EVENT_STATUSES
     * includes it so an event called off after people registered still renders,
     * carrying its cancelled badge, instead of leaving the participant who
     * signed up with a dead link and no explanation. Registration is blocked
     * separately by REGISTERABLE_EVENT_STATUSES, so being listed here does not
     * make it registerable. DRAFT and DELETED remain excluded.
     *
     * Sorted by startsAt, and the fixture dates ascend with the status list, so
     * cancelled is last.
     */
    expect(events.map((event) => event.status)).toEqual([
      "published",
      "ongoing",
      "completed",
      "cancelled",
    ]);
  });

  it("needs no administrator and returns an empty list for a fest with no events", async () => {
    expect(await eventService.listPublicEvents(publishedFest.id)).toEqual([]);
  });

  it("returns only top-level events by default and a parent's children when filtered", async () => {
    const parent = await createTestEvent(publishedFest, admin.user, {
      status: "published",
      eventName: "Athlos",
      eventSlug: "athlos",
    });
    await createTestEvent(publishedFest, admin.user, {
      status: "published",
      eventName: "100m Sprint",
      eventSlug: "sprint",
      parentEventId: parent._id,
    });

    const topLevel = await eventService.listPublicEvents(publishedFest.id);
    expect(topLevel.map((event) => event.eventSlug)).toEqual(["athlos"]);

    const children = await eventService.listPublicEvents(publishedFest.id, {
      parentEventId: String(parent._id),
    });
    expect(children.map((event) => event.eventSlug)).toEqual(["sprint"]);
  });

  it("refuses a fest that does not exist", async () => {
    await expect(eventService.listPublicEvents("not-an-object-id")).rejects.toMatchObject({
      errorCode: "FEST_NOT_FOUND",
    });
  });
});

describe("listAllEventsForAdmin", () => {
  it("returns every status", async () => {
    await createTestEvent(publishedFest, admin.user, { status: "draft", eventSlug: "a" });
    await createTestEvent(publishedFest, admin.user, { status: "cancelled", eventSlug: "b" });

    const events = await eventService.listAllEventsForAdmin(admin.user._id, publishedFest.id);
    expect(events).toHaveLength(2);
  });

  it("refuses a non-administrator", async () => {
    await expect(
      eventService.listAllEventsForAdmin(outsider.user._id, publishedFest.id)
    ).rejects.toMatchObject({ errorCode: "PERMISSION_DENIED" });
  });
});

describe("getEventById", () => {
  it("returns the event for an administrator", async () => {
    const event = await createTestEvent(publishedFest, admin.user);
    const found = await eventService.getEventById(admin.user._id, publishedFest.id, event.id);

    expect(found.id).toBe(event.id);
    expect(found.eventName).toBe("Robowars 2027");
  });

  it("refuses a non-administrator", async () => {
    const event = await createTestEvent(publishedFest, admin.user);

    await expect(
      eventService.getEventById(outsider.user._id, publishedFest.id, event.id)
    ).rejects.toMatchObject({ errorCode: "PERMISSION_DENIED" });
  });

  it("treats a missing event and a malformed id alike as a 404", async () => {
    for (const badId of [new mongoose.Types.ObjectId().toString(), "not-an-object-id"]) {
      await expect(
        eventService.getEventById(admin.user._id, publishedFest.id, badId)
      ).rejects.toMatchObject({ errorCode: "EVENT_NOT_FOUND", statusCode: 404 });
    }
  });

  /* An event under the wrong fest must not be distinguishable from a missing one. */
  it("hides an event that belongs to another fest", async () => {
    const otherFest = await createTestFest(college, admin.user, { festSlug: "other-fest" });
    const event = await createTestEvent(otherFest, admin.user);

    await expect(
      eventService.getEventById(admin.user._id, publishedFest.id, event.id)
    ).rejects.toMatchObject({ errorCode: "EVENT_NOT_FOUND" });
  });
});

describe("publishEvent", () => {
  it("creates a single eventEntry checkpoint named for the event", async () => {
    const event = await createTestEvent(publishedFest, admin.user, { status: "draft" });
    await eventService.publishEvent(admin.user._id, publishedFest.id, event.id);

    const doors = await CheckpointModel.find({ eventId: event._id, checkpointType: "eventEntry" });
    expect(doors).toHaveLength(1);
    expect(doors[0].checkpointName).toBe("Robowars 2027 Entry");
    expect(doors[0].directionMode).toBe("inOnly");
    expect(doors[0].festId.toString()).toBe(publishedFest.id);
  });

  it("does not duplicate the eventEntry checkpoint if publish is retried", async () => {
    const event = await createTestEvent(publishedFest, admin.user, { status: "draft" });
    await eventService.publishEvent(admin.user._id, publishedFest.id, event.id);

    // A second publish attempt is refused by the guard, so the checkpoint count holds.
    await eventService
      .publishEvent(admin.user._id, publishedFest.id, event.id)
      .catch((caughtError) => caughtError);

    const doors = await CheckpointModel.find({ eventId: event._id, checkpointType: "eventEntry" });
    expect(doors).toHaveLength(1);
  });
});

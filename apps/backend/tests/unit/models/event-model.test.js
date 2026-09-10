import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { EventModel } from "../../../src/models/event-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import { buildEventAttributes } from "../../setup/create-test-fixtures.js";

const festId = new mongoose.Types.ObjectId();
const createdByUserId = new mongoose.Types.ObjectId();

function buildEvent(overrides = {}) {
  return {
    ...buildEventAttributes(),
    eventSlug: "robowars-2027",
    festId,
    createdByUserId,
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  await EventModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

describe("EventModel schema", () => {
  it("requires the core fields", async () => {
    await expect(EventModel.create({})).rejects.toThrow(/eventName|festId|description|venue/);
  });

  it("defaults status, sizes, scoring, counters and the optional free text", async () => {
    const event = await EventModel.create(buildEvent());

    expect(event.status).toBe("draft");
    expect(event.minimumTeamSize).toBe(1);
    expect(event.maximumTeamSize).toBe(1);
    expect(event.scoringFormat).toBe("none");
    expect(event.registeredCount).toBe(0);
    expect(event.capacity).toBe(null);
    expect(event.waitlistEnabled).toBe(false);
    expect(event.feeAmountPaise).toBe(0);
    expect(event.rules).toBe(null);
    expect(event.weightCategories).toEqual([]);
  });

  it("rejects each enum field outside its range", async () => {
    const badValues = {
      category: "underwater",
      eventType: "duo",
      scoringFormat: "vibes",
      status: "paused",
    };

    for (const [fieldName, badValue] of Object.entries(badValues)) {
      await expect(EventModel.create(buildEvent({ [fieldName]: badValue }))).rejects.toThrow(
        new RegExp(fieldName)
      );
    }
  });

  it("rejects a capacity below one and a negative fee", async () => {
    await expect(EventModel.create(buildEvent({ capacity: 0 }))).rejects.toThrow(/capacity/);
    await expect(EventModel.create(buildEvent({ feeAmountPaise: -1 }))).rejects.toThrow(
      /feeAmountPaise/
    );
  });

  it("lowercases the slug", async () => {
    const event = await EventModel.create(buildEvent({ eventSlug: "ROBOWARS" }));
    expect(event.eventSlug).toBe("robowars");
  });
});

describe("EventModel invariant 1: the event ends at or after it starts", () => {
  it("accepts an end at the same instant as the start", async () => {
    const sameMoment = new Date("2027-03-01T10:00:00.000Z");
    await expect(
      EventModel.create(buildEvent({ startsAt: sameMoment, endsAt: sameMoment }))
    ).resolves.toBeDefined();
  });

  it("invalidates an end before the start", async () => {
    await expect(
      EventModel.create(buildEvent({ endsAt: new Date("2027-03-01T09:00:00.000Z") }))
    ).rejects.toThrow(/endsAt must be on or after startsAt/);
  });
});

describe("EventModel invariant 2: registration closes after it opens", () => {
  it("invalidates a close at the same instant as the open", async () => {
    const sameMoment = new Date("2027-01-01T00:00:00.000Z");
    await expect(
      EventModel.create(
        buildEvent({ registrationOpensAt: sameMoment, registrationClosesAt: sameMoment })
      )
    ).rejects.toThrow(/registrationClosesAt must be after registrationOpensAt/);
  });

  it("invalidates a close before the open", async () => {
    await expect(
      EventModel.create(buildEvent({ registrationClosesAt: new Date("2026-12-01T00:00:00.000Z") }))
    ).rejects.toThrow(/registrationClosesAt must be after registrationOpensAt/);
  });
});

describe("EventModel invariant 3: registration closes before the event begins", () => {
  it("accepts a close at the exact moment the event starts", async () => {
    const startsAt = new Date("2027-03-01T10:00:00.000Z");
    await expect(
      EventModel.create(buildEvent({ startsAt, registrationClosesAt: startsAt }))
    ).resolves.toBeDefined();
  });

  it("invalidates a close after the event starts", async () => {
    await expect(
      EventModel.create(buildEvent({ registrationClosesAt: new Date("2027-03-02T00:00:00.000Z") }))
    ).rejects.toThrow(/Registration must close before the event begins/);
  });
});

describe("EventModel invariant 5: fee type and amount agree", () => {
  it("rejects a perTeam event with a zero fee", async () => {
    await expect(
      EventModel.create(buildEvent({ feeType: "perTeam", feeAmountPaise: 0 }))
    ).rejects.toThrow(/feeAmountPaise/);
  });

  it("accepts a perTeam event with a positive fee", async () => {
    await expect(
      EventModel.create(buildEvent({ feeType: "perTeam", feeAmountPaise: 300000 }))
    ).resolves.toBeDefined();
  });

  it("rejects a free event carrying a non-zero fee", async () => {
    await expect(
      EventModel.create(buildEvent({ feeType: "free", feeAmountPaise: 500 }))
    ).rejects.toThrow(/feeAmountPaise/);
  });
});

describe("EventModel invariant 4: team sizes match the event type", () => {
  it("accepts a solo event sized one to one", async () => {
    await expect(EventModel.create(buildEvent({ eventType: "solo" }))).resolves.toBeDefined();
  });

  it("invalidates a solo event with either size above one, naming both fields", async () => {
    const error = await EventModel.create(
      buildEvent({ eventType: "solo", minimumTeamSize: 3, maximumTeamSize: 3 })
    ).catch((caughtError) => caughtError);

    expect(Object.keys(error.errors).sort()).toEqual(["maximumTeamSize", "minimumTeamSize"]);
    expect(error.errors.minimumTeamSize.message).toMatch(/solo event must have minimumTeamSize 1/);
  });

  it("accepts a team event sized two to five", async () => {
    await expect(
      EventModel.create(buildEvent({ eventType: "team", minimumTeamSize: 2, maximumTeamSize: 5 }))
    ).resolves.toBeDefined();
  });

  it("invalidates a team event whose minimum is below two", async () => {
    await expect(
      EventModel.create(buildEvent({ eventType: "team", minimumTeamSize: 1, maximumTeamSize: 4 }))
    ).rejects.toThrow(/team event must have minimumTeamSize of at least 2/);
  });

  it("invalidates a team event whose maximum is below its minimum", async () => {
    await expect(
      EventModel.create(buildEvent({ eventType: "team", minimumTeamSize: 4, maximumTeamSize: 2 }))
    ).rejects.toThrow(/maximumTeamSize must be at least minimumTeamSize/);
  });
});

describe("EventModel indexes", () => {
  it("declares all five named indexes", async () => {
    const indexNames = (await EventModel.collection.indexes()).map((index) => index.name);

    for (const expectedName of [
      "index_events_festId_eventSlug",
      "index_events_festId",
      "index_events_festId_category",
      "index_events_festId_status",
      "index_events_startsAt",
    ]) {
      expect(indexNames).toContain(expectedName);
    }
  });

  it("scopes slug uniqueness to the fest", async () => {
    const slugIndex = (await EventModel.collection.indexes()).find(
      (index) => index.name === "index_events_festId_eventSlug"
    );

    expect(slugIndex.unique).toBe(true);
    expect(slugIndex.key).toEqual({ festId: 1, eventSlug: 1 });
  });

  it("rejects a duplicate slug inside one fest", async () => {
    await EventModel.create(buildEvent());
    await expect(EventModel.create(buildEvent())).rejects.toMatchObject({ code: 11000 });
  });

  it("allows the same slug under a different fest", async () => {
    await EventModel.create(buildEvent());
    await expect(
      EventModel.create(buildEvent({ festId: new mongoose.Types.ObjectId() }))
    ).resolves.toBeDefined();
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { EventModel } from "../../../src/models/event-model.js";
import {
  backfillEventSiblingRanks,
  planLevel,
} from "../../../src/helpers/backfill-event-sibling-ranks.js";
import { normaliseRank } from "../../../src/helpers/sibling-rank-helpers.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestFest,
  createTestEvent,
} from "../../setup/create-test-fixtures.js";

let college;
let admin;
let fest;

beforeAll(async () => {
  await setupTestDatabase();
  await EventModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
});

afterAll(async () => {
  await teardownTestDatabase();
});

/*
 * A pre-migration row: integer displayOrder, no rank. Created through the
 * model (so every required field is right) and then stripped of the rank the
 * pre-save hook minted, exactly the state the backfill will meet in production.
 */
async function makeLegacyEvent(slug, displayOrder, overrides = {}) {
  const event = await createTestEvent(fest, admin.user, {
    eventSlug: slug,
    eventName: slug,
    ...overrides,
  });
  await EventModel.collection.updateOne(
    { _id: event._id },
    { $set: { displayOrder }, $unset: { siblingRank: "" } }
  );
  return event;
}

async function levelOrder(parentEventId) {
  const rows = await EventModel.find({ festId: fest._id, parentEventId: parentEventId ?? null })
    .select("eventName siblingRank")
    .sort({ siblingRank: 1, _id: 1 })
    .lean();
  return rows.map((row) => row.eventName);
}

async function rankMap() {
  const rows = await EventModel.find({}).select("siblingRank").lean();
  return new Map(rows.map((row) => [String(row._id), row.siblingRank ?? null]));
}

describe("backfillEventSiblingRanks", () => {
  it("ranks every level in displayOrder-then-id order, and a second run is a no-op", async () => {
    // Created out of order on purpose: displayOrder, not creation order, must win.
    await makeLegacyEvent("third", 3);
    await makeLegacyEvent("first", 1);
    await makeLegacyEvent("second", 2);
    const parent = await makeLegacyEvent("parent", 0);
    await makeLegacyEvent("child-b", 2, { parentEventId: parent._id });
    await makeLegacyEvent("child-a", 1, { parentEventId: parent._id });
    // Two rows tied on displayOrder fall back to id order.
    const tieOne = await makeLegacyEvent("tie-one", 5, { parentEventId: parent._id });
    const tieTwo = await makeLegacyEvent("tie-two", 5, { parentEventId: parent._id });

    const firstRun = await backfillEventSiblingRanks();

    expect(firstRun).toMatchObject({ levelsSeen: 2, levelsTouched: 2, eventsTouched: 8, eventsSeen: 8 });
    expect(await levelOrder(null)).toEqual(["parent", "first", "second", "third"]);
    const tiedFirst = String(tieOne._id) < String(tieTwo._id) ? "tie-one" : "tie-two";
    const tiedSecond = tiedFirst === "tie-one" ? "tie-two" : "tie-one";
    expect(await levelOrder(parent._id)).toEqual(["child-a", "child-b", tiedFirst, tiedSecond]);

    const afterFirst = await rankMap();
    for (const rank of afterFirst.values()) {
      expect(normaliseRank(rank)).toBe(rank);
    }

    const secondRun = await backfillEventSiblingRanks();

    expect(secondRun).toMatchObject({ levelsSeen: 2, levelsTouched: 0, eventsTouched: 0, eventsSeen: 8 });
    expect(await rankMap()).toEqual(afterFirst);
  });

  it("appends only the unranked rows of a partly ranked level, keeping existing ranks", async () => {
    const ranked = await createTestEvent(fest, admin.user, { eventSlug: "ranked", eventName: "ranked" });
    const rankedBefore = (await EventModel.findById(ranked._id).lean()).siblingRank;
    await makeLegacyEvent("legacy-two", 2);
    await makeLegacyEvent("legacy-one", 1);

    const run = await backfillEventSiblingRanks();

    expect(run).toMatchObject({ levelsTouched: 1, eventsTouched: 2 });
    expect((await EventModel.findById(ranked._id).lean()).siblingRank).toBe(rankedBefore);
    expect(await levelOrder(null)).toEqual(["ranked", "legacy-one", "legacy-two"]);
  });

  it("never writes displayOrder", async () => {
    await makeLegacyEvent("only", 7);
    await backfillEventSiblingRanks();
    expect((await EventModel.findOne({ eventName: "only" }).lean()).displayOrder).toBe(7);
  });

  it("drops the retired displayOrder index once, and reports it", async () => {
    await EventModel.collection.createIndex(
      { festId: 1, parentEventId: 1, displayOrder: 1 },
      { name: "index_events_festId_parentEventId_displayOrder" }
    );

    expect((await backfillEventSiblingRanks()).droppedRetiredIndex).toBe(true);
    expect((await backfillEventSiblingRanks()).droppedRetiredIndex).toBe(false);

    const names = (await EventModel.collection.indexes()).map((index) => index.name);
    expect(names).not.toContain("index_events_festId_parentEventId_displayOrder");
    expect(names).toContain("index_events_festId_parentEventId_siblingRank");
  });
});

describe("planLevel", () => {
  it("plans nothing for a fully ranked level", () => {
    expect(planLevel([{ _id: "a", siblingRank: "V", displayOrder: 0 }])).toEqual([]);
  });

  it("treats a malformed rank as unranked", () => {
    const plan = planLevel([
      { _id: "a", siblingRank: "V", displayOrder: 0 },
      { _id: "b", siblingRank: "", displayOrder: 1 },
      { _id: "c", siblingRank: "not a rank!", displayOrder: 2 },
    ]);
    expect(plan.map((write) => write._id)).toEqual(["b", "c"]);
    expect(plan[0].siblingRank > "V").toBe(true);
    expect(plan[1].siblingRank > plan[0].siblingRank).toBe(true);
  });
});

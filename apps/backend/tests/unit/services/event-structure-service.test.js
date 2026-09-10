import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { EventModel } from "../../../src/models/event-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import { StaffAssignmentModel } from "../../../src/models/staff-assignment-model.js";
import eventStructureService from "../../../src/services/event-structure-service.js";
import eventService from "../../../src/services/event-service.js";
import { RANK_LENGTH_CEILING, normaliseRank } from "../../../src/helpers/sibling-rank-helpers.js";
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
  await FestModel.createIndexes();
  await StaffAssignmentModel.createIndexes();
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

/* Distinct slugs: (festId, eventSlug) is unique, so reusing the default collides. */
async function makeEvent(slug, overrides = {}) {
  return createTestEvent(fest, admin.user, { eventSlug: slug, eventName: slug, ...overrides });
}

async function reload(event) {
  return EventModel.findById(event._id).lean();
}

/* One level of one fest in the order every reader uses: rank, then id. */
async function levelOrder(festId, parentEventId) {
  const rows = await EventModel.find({ festId, parentEventId: parentEventId ?? null })
    .select("eventName siblingRank")
    .sort({ siblingRank: 1, _id: 1 })
    .lean();
  return rows.map((row) => row.eventName);
}

/*
 * Every event's ordering-relevant state, keyed by id. Diffing two snapshots
 * counts how many rows a move actually wrote — the property the string-rank
 * design exists to guarantee.
 */
async function snapshotAll() {
  const rows = await EventModel.find({})
    .select("festId parentEventId siblingRank updatedAt")
    .lean();
  return new Map(
    rows.map((row) => [
      String(row._id),
      JSON.stringify({
        festId: String(row.festId),
        parentEventId: row.parentEventId ? String(row.parentEventId) : null,
        siblingRank: row.siblingRank,
        updatedAt: row.updatedAt,
      }),
    ])
  );
}

function changedIds(before, after) {
  const changed = [];
  for (const [id, state] of after) {
    if (before.get(id) !== state) {
      changed.push(id);
    }
  }
  return changed;
}

function move(event, payload) {
  return eventStructureService.moveEvent(admin.user._id, fest.id, event.id, {
    newParentEventId: null,
    newFestId: null,
    previousSiblingId: null,
    nextSiblingId: null,
    ...payload,
  });
}

describe("rank at creation", () => {
  it("ranks every new event after the current last sibling of its level", async () => {
    const first = await makeEvent("first");
    const second = await makeEvent("second");
    const parent = await makeEvent("parent");
    const child = await makeEvent("child", { parentEventId: parent._id });

    for (const event of [first, second, parent, child]) {
      expect(normaliseRank((await reload(event)).siblingRank)).not.toBeNull();
    }
    expect(await levelOrder(fest._id, null)).toEqual(["first", "second", "parent"]);
    expect(await levelOrder(fest._id, parent._id)).toEqual(["child"]);
  });

  it("does not write displayOrder", async () => {
    const event = await makeEvent("plain");
    expect((await reload(event)).displayOrder).toBe(0);
  });
});

describe("moveEvent", () => {
  it("drags to the top of a level, writing exactly one row", async () => {
    const first = await makeEvent("first");
    const second = await makeEvent("second");
    const mover = await makeEvent("mover");

    const before = await snapshotAll();
    await move(mover, { nextSiblingId: first.id });
    const after = await snapshotAll();

    expect(await levelOrder(fest._id, null)).toEqual(["mover", "first", "second"]);
    expect(changedIds(before, after)).toEqual([String(mover._id)]);
  });

  it("drags to the bottom of a level, writing exactly one row", async () => {
    const mover = await makeEvent("mover");
    const first = await makeEvent("first");
    const second = await makeEvent("second");

    const before = await snapshotAll();
    await move(mover, { previousSiblingId: second.id });
    const after = await snapshotAll();

    expect(await levelOrder(fest._id, null)).toEqual(["first", "second", "mover"]);
    expect(changedIds(before, after)).toEqual([String(mover._id)]);
    expect(first).toBeTruthy();
  });

  it("drags between two adjacent siblings, writing exactly one row", async () => {
    const first = await makeEvent("first");
    const second = await makeEvent("second");
    const mover = await makeEvent("mover");

    const before = await snapshotAll();
    await move(mover, { previousSiblingId: first.id, nextSiblingId: second.id });
    const after = await snapshotAll();

    expect(await levelOrder(fest._id, null)).toEqual(["first", "mover", "second"]);
    expect(changedIds(before, after)).toEqual([String(mover._id)]);
  });

  it("keeps order through a long chain of drags into the same gap and rebalances the level", async () => {
    const anchor = await makeEvent("anchor");
    const alpha = await makeEvent("alpha");
    const beta = await makeEvent("beta");

    // Alternate: drop beta between anchor and alpha, then alpha between anchor
    // and beta. Every drag lands in the tightest gap the level has, so ranks
    // lengthen as fast as the encoding allows.
    let inner = alpha; // currently directly after anchor
    let outer = beta;
    let longestRankSeen = 0;
    let rebalanceObserved = false;

    for (let round = 0; round < 180; round += 1) {
      await move(outer, { previousSiblingId: anchor.id, nextSiblingId: inner.id });
      [inner, outer] = [outer, inner];

      expect(await levelOrder(fest._id, null)).toEqual(["anchor", inner.eventName, outer.eventName]);

      const innerRank = (await reload(inner)).siblingRank;
      if (innerRank.length < longestRankSeen && longestRankSeen >= RANK_LENGTH_CEILING) {
        rebalanceObserved = true;
      }
      longestRankSeen = Math.max(longestRankSeen, innerRank.length);
    }

    expect(longestRankSeen).toBeGreaterThanOrEqual(RANK_LENGTH_CEILING);
    expect(rebalanceObserved).toBe(true);
    // After a rebalance the level is short again and still in order.
    const ranks = (await EventModel.find({ festId: fest._id }).select("siblingRank").lean()).map(
      (row) => row.siblingRank
    );
    expect(Math.max(...ranks.map((rank) => rank.length))).toBeLessThanOrEqual(RANK_LENGTH_CEILING);
  }, 120000);

  it("makes a top-level event a child of another event", async () => {
    const parent = await makeEvent("parent");
    const mover = await makeEvent("mover");

    await move(mover, { newParentEventId: parent.id });

    const moved = await reload(mover);
    expect(String(moved.parentEventId)).toBe(String(parent._id));
    expect(await levelOrder(fest._id, parent._id)).toEqual(["mover"]);
  });

  it("reparents across levels without touching the level it left", async () => {
    const parent = await makeEvent("parent");
    const first = await makeEvent("first", { parentEventId: parent._id });
    const second = await makeEvent("second", { parentEventId: parent._id });
    const third = await makeEvent("third", { parentEventId: parent._id });

    const before = await snapshotAll();
    await move(second, { newParentEventId: null, previousSiblingId: parent.id });
    const after = await snapshotAll();

    expect(changedIds(before, after)).toEqual([String(second._id)]);
    expect(await levelOrder(fest._id, parent._id)).toEqual(["first", "third"]);
    expect(await levelOrder(fest._id, null)).toEqual(["parent", "second"]);
    expect(first).toBeTruthy();
    expect(third).toBeTruthy();
  });

  it("returns a child to the top level when the new parent is null", async () => {
    const parent = await makeEvent("parent");
    const child = await makeEvent("child", { parentEventId: parent._id });

    await move(child, { newParentEventId: null });

    expect((await reload(child)).parentEventId).toBeNull();
  });

  it("carries descendants into the destination fest on a cross-fest move", async () => {
    const otherFest = await createTestFest(college, admin.user, {
      status: "published",
      festSlug: "other-fest",
      festName: "Other Fest",
    });
    const root = await makeEvent("root");
    const child = await makeEvent("child", { parentEventId: root._id });
    const grandchild = await makeEvent("grandchild", { parentEventId: child._id });
    const existing = await createTestEvent(otherFest, admin.user, {
      eventSlug: "existing",
      eventName: "existing",
    });

    await move(root, { newFestId: otherFest.id, previousSiblingId: existing.id });

    expect(String((await reload(root)).festId)).toBe(String(otherFest._id));
    expect(String((await reload(child)).festId)).toBe(String(otherFest._id));
    expect(String((await reload(grandchild)).festId)).toBe(String(otherFest._id));
    expect(await levelOrder(otherFest._id, null)).toEqual(["existing", "root"]);
    expect(await levelOrder(fest._id, null)).toEqual([]);
  });

  it("rejects a drop naming a neighbour that has since moved to another level", async () => {
    const parent = await makeEvent("parent");
    const first = await makeEvent("first");
    const second = await makeEvent("second");
    const mover = await makeEvent("mover");

    // Another admin's client moved `first` under `parent` in the meantime.
    await move(first, { newParentEventId: parent.id });

    const before = await snapshotAll();
    await expect(
      move(mover, { previousSiblingId: first.id, nextSiblingId: second.id })
    ).rejects.toMatchObject({ errorCode: "EVENT_SIBLING_CONFLICT", statusCode: 409 });
    expect(changedIds(before, await snapshotAll())).toEqual([]);
  });

  it("rejects a drop naming a neighbour that no longer exists", async () => {
    const mover = await makeEvent("mover");
    const gone = await makeEvent("gone");
    await EventModel.deleteOne({ _id: gone._id });

    await expect(move(mover, { nextSiblingId: gone.id })).rejects.toMatchObject({
      errorCode: "EVENT_SIBLING_CONFLICT",
      statusCode: 409,
    });
  });

  it("repairs a level whose stored ranks are missing before minting", async () => {
    const first = await makeEvent("first");
    const second = await makeEvent("second");
    const mover = await makeEvent("mover");
    await EventModel.updateMany({ festId: fest._id }, { $unset: { siblingRank: "" } });

    await move(mover, { previousSiblingId: first.id, nextSiblingId: second.id });

    expect(await levelOrder(fest._id, null)).toEqual(["first", "mover", "second"]);
  });

  it("refuses to move an event under its own descendant", async () => {
    const grandparent = await makeEvent("grandparent");
    const parent = await makeEvent("parent", { parentEventId: grandparent._id });
    const child = await makeEvent("child", { parentEventId: parent._id });

    await expect(move(grandparent, { newParentEventId: child.id })).rejects.toMatchObject({
      errorCode: "EVENT_CIRCULAR_PARENT",
      statusCode: 400,
    });

    // The refusal must leave the hierarchy exactly as it was.
    expect((await reload(grandparent)).parentEventId).toBeNull();
  });

  it("refuses to move an event under itself", async () => {
    const event = await makeEvent("self");

    await expect(move(event, { newParentEventId: event.id })).rejects.toMatchObject({
      errorCode: "EVENT_CIRCULAR_PARENT",
    });
  });

  it("rejects a parent that belongs to a different fest", async () => {
    const otherFest = await createTestFest(college, admin.user, {
      status: "published",
      festSlug: "other-fest",
      festName: "Other Fest",
    });
    const foreignParent = await createTestEvent(otherFest, admin.user, {
      eventSlug: "foreign",
      eventName: "foreign",
    });
    const mover = await makeEvent("mover");

    await expect(move(mover, { newParentEventId: foreignParent.id })).rejects.toMatchObject({
      errorCode: "PARENT_EVENT_WRONG_FEST",
      statusCode: 400,
    });
  });
});

describe("reorderEvents", () => {
  it("applies every ordering in one batch", async () => {
    const first = await makeEvent("first");
    const second = await makeEvent("second");
    const third = await makeEvent("third");

    // Reverse the level: third, second, first — each item names its neighbours
    // as they will stand once the batch has applied.
    await eventStructureService.reorderEvents(admin.user._id, fest.id, [
      { eventId: third.id, parentEventId: null, previousSiblingId: null, nextSiblingId: first.id },
      { eventId: second.id, parentEventId: null, previousSiblingId: third.id, nextSiblingId: first.id },
    ]);

    expect(await levelOrder(fest._id, null)).toEqual(["third", "second", "first"]);
  });

  it("reparents through the batch as well as reordering", async () => {
    const parent = await makeEvent("parent");
    const mover = await makeEvent("mover");

    await eventStructureService.reorderEvents(admin.user._id, fest.id, [
      { eventId: mover.id, parentEventId: parent.id, previousSiblingId: null, nextSiblingId: null },
    ]);

    expect(String((await reload(mover)).parentEventId)).toBe(String(parent._id));
  });

  it("rejects a batch that is only circular once applied, writing nothing", async () => {
    const alpha = await makeEvent("alpha");
    const beta = await makeEvent("beta");

    // Row by row each line is legal; together they are a detached two-node ring.
    await expect(
      eventStructureService.reorderEvents(admin.user._id, fest.id, [
        { eventId: alpha.id, parentEventId: beta.id, previousSiblingId: null, nextSiblingId: null },
        { eventId: beta.id, parentEventId: alpha.id, previousSiblingId: null, nextSiblingId: null },
      ])
    ).rejects.toMatchObject({ errorCode: "EVENT_CIRCULAR_PARENT" });

    expect((await reload(alpha)).parentEventId).toBeNull();
    expect((await reload(beta)).parentEventId).toBeNull();
  });

  it("rejects a batch naming a neighbour on another level, writing nothing", async () => {
    const parent = await makeEvent("parent");
    const child = await makeEvent("child", { parentEventId: parent._id });
    const mover = await makeEvent("mover");

    const before = await snapshotAll();
    await expect(
      eventStructureService.reorderEvents(admin.user._id, fest.id, [
        { eventId: mover.id, parentEventId: null, previousSiblingId: child.id, nextSiblingId: null },
      ])
    ).rejects.toMatchObject({ errorCode: "EVENT_SIBLING_CONFLICT", statusCode: 409 });
    expect(changedIds(before, await snapshotAll())).toEqual([]);
  });

  it("rejects an event from another fest", async () => {
    const otherFest = await createTestFest(college, admin.user, {
      status: "published",
      festSlug: "other-fest",
      festName: "Other Fest",
    });
    const foreign = await createTestEvent(otherFest, admin.user, {
      eventSlug: "foreign",
      eventName: "foreign",
    });

    await expect(
      eventStructureService.reorderEvents(admin.user._id, fest.id, [
        { eventId: foreign.id, parentEventId: null, previousSiblingId: null, nextSiblingId: null },
      ])
    ).rejects.toMatchObject({ errorCode: "EVENT_NOT_FOUND", statusCode: 404 });
  });
});

describe("rebalanceLevel", () => {
  it("rewrites one level to short ranks in its current order and leaves other levels alone", async () => {
    const parent = await makeEvent("parent");
    const first = await makeEvent("first", { parentEventId: parent._id });
    const second = await makeEvent("second", { parentEventId: parent._id });
    const untouched = await makeEvent("untouched");
    await EventModel.updateOne({ _id: first._id }, { $set: { siblingRank: "A".repeat(30) } });
    await EventModel.updateOne({ _id: second._id }, { $set: { siblingRank: "B".repeat(30) } });

    const before = await snapshotAll();
    const result = await eventStructureService.rebalanceLevel(fest._id, parent._id);
    const after = await snapshotAll();

    expect(result).toEqual({ levelSize: 2, rewrittenCount: 2 });
    expect(await levelOrder(fest._id, parent._id)).toEqual(["first", "second"]);
    expect((await reload(first)).siblingRank.length).toBeLessThanOrEqual(2);
    expect(changedIds(before, after).sort()).toEqual([String(first._id), String(second._id)].sort());
    expect(after.get(String(untouched._id))).toBe(before.get(String(untouched._id)));
  });
});

describe("contingent eligibility", () => {
  it("marks a top-level event with children eligible, and nothing else", async () => {
    const parent = await makeEvent("parent");
    const child = await makeEvent("child", { parentEventId: parent._id });
    const standalone = await makeEvent("standalone");

    const events = await eventService.listAllEventsForAdmin(admin.user._id, fest.id);
    const byId = new Map(events.map((event) => [event.id, event]));

    expect(byId.get(String(parent._id)).isContingentEligible).toBe(true);
    expect(byId.get(String(parent._id)).childEventCount).toBe(1);
    // A sub-event is already inside somebody else's contingent.
    expect(byId.get(String(child._id)).isContingentEligible).toBe(false);
    // A childless top-level event is not a container.
    expect(byId.get(String(standalone._id)).isContingentEligible).toBe(false);
  });
});

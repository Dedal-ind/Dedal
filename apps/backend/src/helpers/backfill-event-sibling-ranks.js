require("dotenv").config();
const mongoose = require("mongoose");

const { applicationConfig } = require("../config/application-config");
const { normaliseRank, rankAfter, evenlySpacedRanks } = require("./sibling-rank-helpers");

/*
 * Operator-run, IDEMPOTENT backfill of Event.siblingRank from the deprecated
 * integer displayOrder.
 *
 * Works LEVEL BY LEVEL — a level being the events that share a festId and a
 * parentEventId (a null parent is a level of its own). Within a level the
 * existing order is displayOrder ascending with _id as the tiebreaker, exactly
 * the order the old structure service used, so nothing an admin arranged
 * changes position.
 *
 * Re-running changes nothing already ranked:
 *   - a level where every event already carries a valid rank is skipped;
 *   - a level with no ranks at all gets short evenly spaced ranks;
 *   - a level that is partly ranked (events created after the first run of a
 *     partial deploy, say) keeps every existing rank and appends the unranked
 *     ones after the current last rank, in their displayOrder order.
 *
 * Also retires the index this field replaces, if it is still present. Mongoose
 * creates indexes it knows about but never drops one it has forgotten, so the
 * old (festId, parentEventId, displayOrder) index would otherwise linger.
 *
 * Writes go through the raw collection: the model's pre-save hook mints a rank
 * for NEW documents only, and going through the driver keeps this a plain
 * field write with no hook, validator or timestamp side effects.
 *
 * Run with: npm run migrate:event-sibling-ranks
 */

const RETIRED_INDEX_NAME = "index_events_festId_parentEventId_displayOrder";

function levelKeyOf(event) {
  return `${String(event.festId)}:${event.parentEventId ? String(event.parentEventId) : ""}`;
}

function compareByDisplayOrderThenId(left, right) {
  const byOrder = (Number(left.displayOrder) || 0) - (Number(right.displayOrder) || 0);
  if (byOrder !== 0) {
    return byOrder;
  }
  return String(left._id) < String(right._id) ? -1 : String(left._id) > String(right._id) ? 1 : 0;
}

/*
 * The writes for one level, or none when the level is already fully ranked.
 * Pure over the rows it is handed, so the plan for a level can be checked
 * without a database.
 */
function planLevel(rows) {
  const ranked = rows.filter((row) => normaliseRank(row.siblingRank) !== null);
  const unranked = rows
    .filter((row) => normaliseRank(row.siblingRank) === null)
    .sort(compareByDisplayOrderThenId);

  if (unranked.length === 0) {
    return [];
  }

  if (ranked.length === 0) {
    const ranks = evenlySpacedRanks(unranked.length);
    return unranked.map((row, index) => ({ _id: row._id, siblingRank: ranks[index] }));
  }

  // Partly ranked: keep what exists, append the rest after the current last.
  let lastRank = ranked
    .map((row) => normaliseRank(row.siblingRank))
    .sort()
    .at(-1);
  return unranked.map((row) => {
    lastRank = rankAfter(lastRank);
    return { _id: row._id, siblingRank: lastRank };
  });
}

async function dropRetiredIndex(collection) {
  const indexes = await collection.indexes();
  if (!indexes.some((index) => index.name === RETIRED_INDEX_NAME)) {
    return false;
  }
  await collection.dropIndex(RETIRED_INDEX_NAME);
  return true;
}

async function backfillEventSiblingRanks() {
  // Reuse an already-open connection; only a bare script invocation opens one.
  const ownsConnection = mongoose.connection.readyState === 0;
  if (ownsConnection) {
    await mongoose.connect(applicationConfig.databaseUri);
  }
  try {
    const collection = mongoose.connection.db.collection("events");
    const rows = await collection
      .find({}, { projection: { _id: 1, festId: 1, parentEventId: 1, displayOrder: 1, siblingRank: 1 } })
      .toArray();

    const rowsByLevel = new Map();
    for (const row of rows) {
      const key = levelKeyOf(row);
      if (!rowsByLevel.has(key)) {
        rowsByLevel.set(key, []);
      }
      rowsByLevel.get(key).push(row);
    }

    const operations = [];
    let levelsTouched = 0;
    for (const levelRows of rowsByLevel.values()) {
      const plan = planLevel(levelRows);
      if (plan.length === 0) {
        continue;
      }
      levelsTouched += 1;
      for (const write of plan) {
        operations.push({
          updateOne: { filter: { _id: write._id }, update: { $set: { siblingRank: write.siblingRank } } },
        });
      }
    }

    if (operations.length > 0) {
      await collection.bulkWrite(operations, { ordered: true });
    }
    const droppedRetiredIndex = await dropRetiredIndex(collection);

    const report = {
      levelsSeen: rowsByLevel.size,
      levelsTouched,
      eventsTouched: operations.length,
      eventsSeen: rows.length,
      droppedRetiredIndex,
    };
    console.log(
      `events: ranked ${report.eventsTouched} of ${report.eventsSeen} events across ` +
        `${report.levelsTouched} of ${report.levelsSeen} levels` +
        (droppedRetiredIndex ? `; dropped ${RETIRED_INDEX_NAME}.` : ".")
    );
    return report;
  } finally {
    if (ownsConnection) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  backfillEventSiblingRanks()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { backfillEventSiblingRanks, planLevel };

// seed-results-demo.js
// Demo RESULTS for the two demo fests, so the hierarchical results board has all
// three of its levels to draw instead of a table of "Pending".
//
// It seeds, per chosen leaf event: confirmed registrations for existing users,
// three rounds, a round score for every participant in every round, and — for
// some events only — the stamped winner1st/2nd/3rd verdict a coordinator's
// finalise would leave behind.
//
// SOME EVENTS ARE LEFT UNFINALISED ON PURPOSE, and some left with no scores at
// all. The board has three states to show at level 1 and 2 — a stamped verdict,
// a provisional standing computed from marks, and nothing yet — and demo data
// that only ever produced the first would leave the other two untested.
//
// Safe by design:
//   · INSERT-ONLY for rounds, scores and registrations; it creates no users and
//     no events, and deletes nothing.
//   · IDEMPOTENT — an event that already has rounds is skipped whole, so a
//     rerun cannot double-score anybody.
//   · Existing users only. Inventing participants would put fake people in the
//     user directory, where they outlive the demo.
//
// Run with: npm run seed:demo-results
// Clean up with the commands printed at the end.

require("dotenv").config();

const mongoose = require("mongoose");

const { FestModel } = require("../src/models/fest-model");
const { EventModel } = require("../src/models/event-model");
const { UserModel } = require("../src/models/user-model");
const { RegistrationModel } = require("../src/models/registration-model");
const { RoundModel } = require("../src/models/round-model");
const { RoundScoreModel } = require("../src/models/round-score-model");
const { REGISTRATION_STATUSES } = require("../src/constants/registration-constants");

const ROUND_NAMES = ["Prelims", "Semi-final", "Final"];
const PARTICIPANTS_PER_EVENT = 6;

/*
 * Which events get which treatment, by event name. "finalised" stamps the
 * podium; "provisional" leaves the marks to speak for themselves; anything not
 * listed is left untouched so the board still has a Pending row to draw.
 */
const TREATMENT_BY_EVENT_NAME = {
  Finance: "finalised",
  Marketing: "finalised",
  HR: "provisional",
  Operations: "provisional",
  "Business Analytics": "finalised",
  "Solo Singing": "finalised",
  "Poetry Slam": "finalised",
  Sketching: "provisional",
  Quiz: "finalised",
};

function scoreFor(participantIndex, roundIndex) {
  /* Deterministic, not random: a reseed produces the same podium, so a
     screenshot of the board stays true after a database reset. */
  return 10 + ((participantIndex * 7 + roundIndex * 3) % 21);
}

async function seedEvent(event, fest, users, actorUserId) {
  const existingRounds = await RoundModel.countDocuments({ eventId: event._id });
  if (existingRounds > 0) {
    return { skipped: true };
  }

  const participants = users.slice(0, PARTICIPANTS_PER_EVENT);
  if (participants.length < 2) {
    return { skipped: true };
  }

  for (const user of participants) {
    const existing = await RegistrationModel.findOne({ eventId: event._id, userId: user._id });
    if (existing) {
      continue;
    }
    await RegistrationModel.create({
      eventId: event._id,
      userId: user._id,
      status: REGISTRATION_STATUSES.CONFIRMED,
      feeAmountSnapshotPaise: event.feeAmountPaise ?? 0,
      registeredAt: new Date(),
    });
  }

  const participantIds = participants.map((user) => user._id);
  const totalByUserId = new Map(participantIds.map((id) => [String(id), 0]));

  for (const [roundIndex, roundName] of ROUND_NAMES.entries()) {
    const round = await RoundModel.create({
      eventId: event._id,
      festId: fest._id,
      roundNumber: roundIndex + 1,
      roundName,
      status: "completed",
      rosterFinalised: true,
      participantIds,
      createdByUserId: actorUserId,
    });

    for (const [participantIndex, user] of participants.entries()) {
      const score = scoreFor(participantIndex, roundIndex);
      await RoundScoreModel.create({
        roundId: round._id,
        eventId: event._id,
        participantUserId: user._id,
        score,
        scoredByUserId: actorUserId,
        scoredAt: new Date(),
      });
      totalByUserId.set(String(user._id), totalByUserId.get(String(user._id)) + score);
    }
  }

  const treatment = TREATMENT_BY_EVENT_NAME[event.eventName];
  if (treatment !== "finalised") {
    return { skipped: false, finalised: false, participantCount: participants.length };
  }

  /*
   * The stamped verdict, exactly as round finalisation leaves it: the top three
   * totals carry winner1st/2nd/3rd on their registration. The board reads this
   * in preference to recomputing, because it is a decision rather than a sum.
   */
  const podium = [...totalByUserId.entries()]
    .sort((first, second) => second[1] - first[1])
    .slice(0, 3);
  const statuses = [
    REGISTRATION_STATUSES.WINNER_1ST,
    REGISTRATION_STATUSES.WINNER_2ND,
    REGISTRATION_STATUSES.WINNER_3RD,
  ];
  for (const [index, [userId]] of podium.entries()) {
    await RegistrationModel.updateOne(
      { eventId: event._id, userId },
      { $set: { status: statuses[index] } }
    );
  }
  await EventModel.updateOne({ _id: event._id }, { $set: { resultsFinalisedAt: new Date() } });

  return { skipped: false, finalised: true, participantCount: participants.length };
}

async function main() {
  const databaseUri = process.env.DATABASE_URI;
  if (!databaseUri) {
    throw new Error("DATABASE_URI is not set. Check backend/.env.");
  }

  await mongoose.connect(databaseUri);
  console.log("Connected to the database.");

  const users = await UserModel.find().select("_id fullName").sort({ createdAt: 1 }).limit(20).lean();
  if (users.length < 2) {
    throw new Error("Not enough users in the database to seed a scoreboard.");
  }
  const actorUserId = users[0]._id;

  const fests = await FestModel.find({
    festSlug: { $in: ["alliance-one-demo", "flat-fest-demo"] },
  }).lean();
  if (fests.length === 0) {
    throw new Error("Run seed:demo-structure and/or seed:demo-flat-fest first.");
  }

  const touchedFestIds = [];
  for (const fest of fests) {
    console.log(`\n${fest.festName}`);
    touchedFestIds.push(String(fest._id));
    const events = await EventModel.find({ festId: fest._id }).lean();
    const parentIds = new Set(
      events.filter((event) => event.parentEventId).map((event) => String(event.parentEventId))
    );

    for (const event of events) {
      /* Leaves only: a container holds verticals, not competitors. */
      if (parentIds.has(String(event._id))) {
        continue;
      }
      if (!TREATMENT_BY_EVENT_NAME[event.eventName]) {
        console.log(`  ${event.eventName}: left with no results (Pending on the board)`);
        continue;
      }
      const outcome = await seedEvent(event, fest, users, actorUserId);
      if (outcome.skipped) {
        console.log(`  ${event.eventName}: already has rounds, skipped`);
        continue;
      }
      console.log(
        `  ${event.eventName}: ${outcome.participantCount} participants, ${ROUND_NAMES.length} rounds, ` +
          `${outcome.finalised ? "winners stamped" : "provisional (not finalised)"}`
      );
    }
  }

  console.log("\nTo clean up later:");
  console.log(
    `db.rounds.deleteMany({festId: {$in: [${touchedFestIds
      .map((id) => `ObjectId('${id}')`)
      .join(", ")}]}})  // then db.roundScores.deleteMany({}) for the orphans`
  );
}

main()
  .catch((error) => {
    console.error("Seeding failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    console.log("Disconnected.");
  });

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { MatchModel } from "../../../src/models/match-model.js";
import { EventModel } from "../../../src/models/event-model.js";
import { UserModel } from "../../../src/models/user-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import { RegistrationModel } from "../../../src/models/registration-model.js";
// Imported so its schema is registered before getBracket populates team competitors.
import { TeamModel } from "../../../src/models/team-model.js";
import { installEmailServiceMock } from "../../setup/test-email-service.js";
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

installEmailServiceMock();
const bracketService = await import("../../../src/services/bracket-service.js");

let college;
let admin;
let fest;
let event;

async function createCompetitors(count) {
  const users = [];
  for (let index = 0; index < count; index += 1) {
    users.push(
      await UserModel.create({ emailAddress: `competitor${index}@example.com`, fullName: `Player ${index}` })
    );
  }
  return users;
}

async function registerAll(users) {
  for (const user of users) {
    await RegistrationModel.create({
      eventId: event._id,
      userId: user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
    });
  }
}

function generateFor(users) {
  return bracketService.generateBracket(
    String(event._id),
    users.map((user) => user.id),
    { actorUserId: admin.user._id, festId: fest.id }
  );
}

async function statusOf(user) {
  const registration = await RegistrationModel.findOne({ eventId: event._id, userId: user._id }).lean();
  return registration.status;
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    MatchModel.createIndexes(),
    EventModel.createIndexes(),
    UserModel.createIndexes(),
    RegistrationModel.createIndexes(),
    TeamModel.createIndexes(),
    FestModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  event = await createTestEvent(fest, admin.user, {
    scoringFormat: "bracketSingleElimination",
  });
});

afterAll(teardownTestDatabase);

describe("generateBracket shape", () => {
  it("creates three matches for four participants", async () => {
    const users = await createCompetitors(4);
    await generateFor(users);

    expect(await MatchModel.countDocuments({ eventId: event._id })).toBe(3);
    expect(await MatchModel.countDocuments({ eventId: event._id, roundNumber: 1 })).toBe(2);
    expect(await MatchModel.countDocuments({ eventId: event._id, roundNumber: 2 })).toBe(1);
  });

  it("creates seven matches for eight participants", async () => {
    const users = await createCompetitors(8);
    await generateFor(users);

    expect(await MatchModel.countDocuments({ eventId: event._id })).toBe(7);
  });

  it("assigns byes for a non-power-of-two count", async () => {
    const users = await createCompetitors(5);
    await generateFor(users);

    // Bracket size 8: seven matches, three of the four round-one matches are byes.
    expect(await MatchModel.countDocuments({ eventId: event._id })).toBe(7);
    const byes = await MatchModel.find({ eventId: event._id, isBye: true });
    expect(byes).toHaveLength(3);
    for (const bye of byes) {
      expect(bye.participantAUserId).not.toBeNull();
      expect(bye.participantBUserId).toBeNull();
      expect(bye.isFinalized).toBe(true);
      expect(String(bye.winnerUserId)).toBe(String(bye.participantAUserId));
    }
  });

  it("advances a bye's competitor into the next round", async () => {
    const users = await createCompetitors(5);
    await generateFor(users);

    const secondRound = await MatchModel.find({ eventId: event._id, roundNumber: 2 });
    const filledSlots = secondRound.flatMap((match) =>
      [match.participantAUserId, match.participantBUserId].filter(Boolean)
    );
    // The three byes each seat their competitor one round up.
    expect(filledSlots.length).toBe(3);
  });

  it("rejects a single participant", async () => {
    const users = await createCompetitors(1);
    await expect(generateFor(users)).rejects.toMatchObject({
      errorCode: "INSUFFICIENT_PARTICIPANTS",
      statusCode: 400,
    });
  });

  /*
   * Superseded by 12.10: a second generation over a bracket nobody has played on
   * is no longer refused outright, because a coordinator reseeding before the
   * roster settled is a normal thing to do. What replaces the blanket refusal is
   * the activity guard — see bracket-regeneration.test.js, which covers both the
   * rebuild and the refusal once a result exists.
   */
  it("rebuilds a second time over an untouched bracket and archives the first", async () => {
    const users = await createCompetitors(4);
    await generateFor(users);
    const originalIds = (await MatchModel.find({ eventId: event._id })).map((match) =>
      String(match._id)
    );

    const rebuilt = await generateFor(users);
    expect(rebuilt).toHaveLength(3);

    const archived = await MatchModel.find({
      eventId: event._id,
      status: "supersededByRegeneration",
    });
    expect(archived.map((match) => String(match._id)).sort()).toEqual(originalIds.sort());
  });
});

describe("enterMatchResult", () => {
  async function firstRoundMatches() {
    return MatchModel.find({ eventId: event._id, roundNumber: 1 }).sort({ matchNumberInRound: 1 });
  }

  it("keeps both final slots when two feeder results advance in parallel", async () => {
    const users = await createCompetitors(4);
    await registerAll(users);
    await generateFor(users);
    const [matchOne, matchTwo] = await firstRoundMatches();
    const winnerOne = String(matchOne.participantAUserId);
    const winnerTwo = String(matchTwo.participantAUserId);

    // Both semis resolve at the same instant, each feeding a different slot of the
    // final. Pre-fix the last load-modify-save nulled the other writer's slot.
    await Promise.all([
      bracketService.enterMatchResult(
        String(event._id),
        String(matchOne._id),
        { winnerUserId: winnerOne },
        { actorUserId: admin.user._id }
      ),
      bracketService.enterMatchResult(
        String(event._id),
        String(matchTwo._id),
        { winnerUserId: winnerTwo },
        { actorUserId: admin.user._id }
      ),
    ]);

    const final = await MatchModel.findOne({ eventId: event._id, roundNumber: 2 });
    const slots = [final.participantAUserId, final.participantBUserId].map((id) => (id ? String(id) : null));
    expect(slots).not.toContain(null);
    expect(new Set(slots)).toEqual(new Set([winnerOne, winnerTwo]));
    /*
     * The load-modify-save version bump is the observable lost update: both writers
     * read version 0, so pre-fix both stamp it to 1 and the final lands at 1. The
     * atomic $inc counts both, reaching 2. (The slots themselves survive pre-fix
     * only because a mongoose save persists just its own dirty paths.)
     */
    expect(final.version).toBe(2);
  });

  it("advances the winner into the next match", async () => {
    const users = await createCompetitors(4);
    await registerAll(users);
    await generateFor(users);
    const [firstMatch] = await firstRoundMatches();

    await bracketService.enterMatchResult(
      String(event._id),
      String(firstMatch._id),
      { winnerUserId: String(firstMatch.participantAUserId) },
      { actorUserId: admin.user._id }
    );

    const final = await MatchModel.findOne({ eventId: event._id, roundNumber: 2 });
    expect(String(final.participantAUserId)).toBe(String(firstMatch.participantAUserId));
  });

  it("marks the loser eliminated and the winner advanced", async () => {
    const users = await createCompetitors(4);
    await registerAll(users);
    await generateFor(users);
    const [firstMatch] = await firstRoundMatches();
    const winnerId = firstMatch.participantAUserId;
    const loserId = firstMatch.participantBUserId;

    await bracketService.enterMatchResult(
      String(event._id),
      String(firstMatch._id),
      { winnerUserId: String(winnerId) },
      { actorUserId: admin.user._id }
    );

    const winner = users.find((user) => String(user._id) === String(winnerId));
    const loser = users.find((user) => String(user._id) === String(loserId));
    // Round one of a two-round bracket advances the winner to the final.
    expect(await statusOf(winner)).toBe("advancedToFinal");
    expect(await statusOf(loser)).toBe("eliminated");
  });

  it("crowns the final's winner first and its loser second", async () => {
    const users = await createCompetitors(4);
    await registerAll(users);
    await generateFor(users);
    const roundOne = await firstRoundMatches();
    for (const match of roundOne) {
      await bracketService.enterMatchResult(
        String(event._id),
        String(match._id),
        { winnerUserId: String(match.participantAUserId) },
        { actorUserId: admin.user._id }
      );
    }

    /* Advancing the two semi winners wrote to the final, so it has a version. */
    const final = await MatchModel.findOne({ eventId: event._id, roundNumber: 2 });
    const championId = final.participantAUserId;
    const runnerUpId = final.participantBUserId;
    await bracketService.enterMatchResult(
      String(event._id),
      String(final._id),
      { winnerUserId: String(championId) },
      { actorUserId: admin.user._id, expectedVersion: final.version }
    );

    const champion = users.find((user) => String(user._id) === String(championId));
    const runnerUp = users.find((user) => String(user._id) === String(runnerUpId));
    expect(await statusOf(champion)).toBe("winner1st");
    expect(await statusOf(runnerUp)).toBe("winner2nd");
  });

  it("locks a finalised match to a coordinator", async () => {
    const users = await createCompetitors(4);
    await registerAll(users);
    await generateFor(users);
    const [firstMatch] = await firstRoundMatches();
    const result = { winnerUserId: String(firstMatch.participantAUserId) };
    await bracketService.enterMatchResult(String(event._id), String(firstMatch._id), result, {
      actorUserId: admin.user._id,
      isAdministrator: false,
    });

    /*
     * expectedVersion 1 keeps this caller current, so the refusal under test is
     * the finalise lock rather than the concurrency guard that now sits before it.
     */
    await expect(
      bracketService.enterMatchResult(String(event._id), String(firstMatch._id), result, {
        actorUserId: admin.user._id,
        isAdministrator: false,
        expectedVersion: 1,
      })
    ).rejects.toMatchObject({ errorCode: "MATCH_ALREADY_FINALIZED", statusCode: 409 });
  });

  it("lets an administrator correct a finalised match", async () => {
    const users = await createCompetitors(4);
    await registerAll(users);
    await generateFor(users);
    const [firstMatch] = await firstRoundMatches();
    await bracketService.enterMatchResult(
      String(event._id),
      String(firstMatch._id),
      { winnerUserId: String(firstMatch.participantAUserId) },
      { actorUserId: admin.user._id, isAdministrator: false }
    );

    const corrected = await bracketService.enterMatchResult(
      String(event._id),
      String(firstMatch._id),
      { winnerUserId: String(firstMatch.participantBUserId) },
      { actorUserId: admin.user._id, isAdministrator: true, expectedVersion: 1 }
    );

    expect(String(corrected.winnerUserId.id || corrected.winnerUserId)).toBe(
      String(firstMatch.participantBUserId)
    );
  });

  it("rejects a winner who is not in the match", async () => {
    const users = await createCompetitors(4);
    await registerAll(users);
    await generateFor(users);
    const [firstMatch] = await firstRoundMatches();
    const outsider = await UserModel.create({ emailAddress: "nobody@example.com" });

    await expect(
      bracketService.enterMatchResult(
        String(event._id),
        String(firstMatch._id),
        { winnerUserId: String(outsider._id) },
        { actorUserId: admin.user._id }
      )
    ).rejects.toMatchObject({ errorCode: "INVALID_WINNER", statusCode: 400 });
  });
});

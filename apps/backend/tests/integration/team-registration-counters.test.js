import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { TeamModel } from "../../src/models/team-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { CollegeModel } from "../../src/models/college-model.js";
import { PassModel } from "../../src/models/pass-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
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
  createTestEvent,
  createTestParticipant,
  createTestUser,
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

installEmailServiceMock();
const service = await import("../../src/services/registration-service.js");

let college;
let admin;
let fest;
let leader;

/*
 * The seat count is the number capacity checks and dashboards read, so the
 * assertions here are all on the stored value rather than on a response body: a
 * drift that never surfaces to the caller is exactly the failure mode these
 * cover. Nobody sees an error when the count goes wrong — they see registrations
 * refused as full, or a dashboard that lies, hours later and far from the cause.
 */
async function seatCount(event) {
  const stored = await EventModel.findById(event._id).select("registeredCount").lean();
  return stored.registeredCount;
}

function makeTeamEvent(overrides = {}) {
  return createTestEvent(
    fest,
    admin.user,
    openRegistrationOverrides({
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 4,
      eventSlug: "team-event",
      ...overrides,
    })
  );
}

async function memberEmails(count, prefix = "member") {
  const emails = [];
  for (let index = 0; index < count; index += 1) {
    const emailAddress = `${prefix}${index}@example.com`;
    await createTestUser({
      emailAddress,
      fullName: `Member ${index}`,
      collegeId: college._id,
      usn: `1AA00AA1${String(index).padStart(2, "0")}`,
      isProfileComplete: true,
    });
    emails.push(emailAddress);
  }
  return emails;
}

async function registerTeam(event, emails, teamLeader = leader, teamName = "Team") {
  return service.registerParticipantTeam(teamLeader.user._id, String(event._id), {
    teamName,
    memberEmails: emails,
  });
}

/*
 * The live row, not merely the first one. A leader who has registered and
 * cancelled before has several rows for this event, and cancelling an already
 * cancelled one is a no-op that would quietly leave the real team standing.
 */
async function cancelTeam(event, teamLeader = leader) {
  const registration = await RegistrationModel.findOne({
    eventId: event._id,
    userId: teamLeader.user._id,
    status: { $ne: "cancelled" },
  });
  return service.cancelRegistration({
    registrationId: String(registration._id),
    actorUserId: teamLeader.user._id,
  });
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    RegistrationModel.createIndexes(),
    TeamModel.createIndexes(),
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
    CollegeModel.createIndexes(),
    PassModel.createIndexes(),
    EntitlementModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  leader = await createTestParticipant(college, {
    emailAddress: "leader@example.com",
    usn: "1AA00AA000",
  });
});

afterAll(teardownTestDatabase);

/*
 * An uncapped event has no seats to count, so claimTeamSeats increments nothing.
 * The bug this covers was a cancel that decremented anyway.
 */
describe("an uncapped team event never counts seats", () => {
  it("does not increment when a team registers", async () => {
    const event = await makeTeamEvent({ capacity: null });
    await registerTeam(event, [leader.user.emailAddress, ...(await memberEmails(2))]);

    expect(await seatCount(event)).toBe(0);
  });

  it("does not drift negative when that team cancels", async () => {
    const event = await makeTeamEvent({ capacity: null });
    await registerTeam(event, [leader.user.emailAddress, ...(await memberEmails(2))]);

    const result = await cancelTeam(event);

    expect(result.cancelledCount).toBe(3);
    /* Before the fix this was -3: the cancel gave back seats nobody took. */
    expect(await seatCount(event)).toBe(0);
  });

  it("stays at zero across repeated register/cancel cycles", async () => {
    const event = await makeTeamEvent({ capacity: null });
    const emails = await memberEmails(2);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await registerTeam(event, [leader.user.emailAddress, ...emails], leader, `Team ${cycle}`);
      await cancelTeam(event);
    }

    /* The drift compounded: three cycles would have left this at -9. */
    expect(await seatCount(event)).toBe(0);
  });
});

describe("a capped team event counts seats both ways", () => {
  it("increments by the roster size on register", async () => {
    const event = await makeTeamEvent({ capacity: 20 });
    await registerTeam(event, [leader.user.emailAddress, ...(await memberEmails(3))]);

    expect(await seatCount(event)).toBe(4);
  });

  it("returns to zero on cancel", async () => {
    const event = await makeTeamEvent({ capacity: 20 });
    await registerTeam(event, [leader.user.emailAddress, ...(await memberEmails(3))]);

    await cancelTeam(event);

    expect(await seatCount(event)).toBe(0);
  });
});

/*
 * The race has to be run for real. assertMembersFree reads the same status list
 * the unique index filters on, so anything it would catch never reaches the
 * insert — registering the shared member up front only reproduces the refusal,
 * not the drift, because the claim never runs. The seats are only stranded when
 * both leaders clear that read before either writes, which means both calls have
 * to be in flight at once.
 */
async function raceTwoLeaders(event, sharedEmails) {
  const secondLeader = await createTestParticipant(college, {
    emailAddress: "second-leader@example.com",
    usn: "1AA00AA900",
  });

  const outcomes = await Promise.allSettled([
    registerTeam(event, [leader.user.emailAddress, ...sharedEmails], leader, "First"),
    registerTeam(event, [secondLeader.user.emailAddress, ...sharedEmails], secondLeader, "Second"),
  ]);

  return {
    winners: outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    losers: outcomes.filter((outcome) => outcome.status === "rejected").length,
  };
}

describe("a team create that loses the member race gives its seats back", () => {
  it("leaves a capped event holding only the winner's seats", async () => {
    const event = await makeTeamEvent({ capacity: 20 });
    const shared = await memberEmails(1, "shared");

    const { winners, losers } = await raceTwoLeaders(event, shared);

    /* Exactly one roster may hold the shared member; the index sees to that. */
    expect(winners).toBe(1);
    expect(losers).toBe(1);
    /* Without the compensator the loser's two seats stay taken, leaving 4. */
    expect(await seatCount(event)).toBe(2);
  });

  it("leaves an uncapped event at zero rather than compensating a claim never made", async () => {
    const event = await makeTeamEvent({ capacity: null });
    const shared = await memberEmails(1, "shared");

    const { winners, losers } = await raceTwoLeaders(event, shared);

    expect(winners).toBe(1);
    expect(losers).toBe(1);
    /* The compensator must skip exactly what the claim skipped, or this is -2. */
    expect(await seatCount(event)).toBe(0);
  });
});

/*
 * The team row is inserted before the roster, so anything that kills the roster
 * insert leaves it behind. An orphan is not merely untidy — assertMembersFree
 * matches on team membership, so it would go on blocking the very people whose
 * registration never landed.
 */
describe("a team create that fails leaves nothing behind", () => {
  it("deletes the orphan team when the roster insert loses the race", async () => {
    const event = await makeTeamEvent({ capacity: 20 });
    const shared = await memberEmails(1, "shared");

    const { winners, losers } = await raceTwoLeaders(event, shared);
    expect(winners).toBe(1);
    expect(losers).toBe(1);

    /* One roster landed, so exactly one team may remain. */
    expect(await TeamModel.countDocuments({ eventId: event._id })).toBe(1);
  });

  it("leaves no team with an empty roster", async () => {
    const event = await makeTeamEvent({ capacity: 20 });
    await raceTwoLeaders(event, await memberEmails(1, "shared"));

    const teams = await TeamModel.find({ eventId: event._id }).lean();
    for (const team of teams) {
      const rows = await RegistrationModel.countDocuments({ teamId: team._id });
      expect(rows).toBeGreaterThan(0);
    }
  });

  it("still reports the original error, not a cleanup failure", async () => {
    const event = await makeTeamEvent({ capacity: 20 });
    const shared = await memberEmails(1, "shared");
    await registerTeam(event, [leader.user.emailAddress, ...shared]);

    const secondLeader = await createTestParticipant(college, {
      emailAddress: "third-leader@example.com",
      usn: "1AA00AA901",
    });

    await expect(
      registerTeam(event, [secondLeader.user.emailAddress, ...shared], secondLeader, "Third")
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

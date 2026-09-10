import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { EventModel } from "../../../src/models/event-model.js";
import { FestModel } from "../../../src/models/fest-model.js";
import { RegistrationModel } from "../../../src/models/registration-model.js";
import { AddOnOrderModel } from "../../../src/models/add-on-order-model.js";
import { EntitlementModel } from "../../../src/models/entitlement-model.js";
import { TeamModel } from "../../../src/models/team-model.js";
import addOnService from "../../../src/services/add-on-service.js";
import teamService from "../../../src/services/team-service.js";
import festService from "../../../src/services/fest-service.js";
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
  createTestParticipant,
  openRegistrationOverrides,
} from "../../setup/create-test-fixtures.js";

let college;
let admin;
let fest;
let event;
let participant;

/* A paid DJ offer and a free workshop offer, both fest-scoped. */
const OFFERS = [
  {
    offerName: "DJ Night",
    offerKey: "djnight",
    isActive: true,
    isPaid: true,
    ratePaise: 20000,
    collectsNumberOfPeople: true,
    numberOfPeopleMinimum: 1,
    numberOfPeopleMaximum: 4,
  },
  {
    offerName: "Workshop",
    offerKey: "workshop",
    isActive: true,
    isPaid: false,
    ratePaise: 0,
  },
];

beforeAll(async () => {
  await setupTestDatabase();
  await EventModel.createIndexes();
  await FestModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published", offers: OFFERS });
  event = await createTestEvent(fest, admin.user, {
    eventSlug: "hackathon",
    eventName: "Hackathon",
    ...openRegistrationOverrides(),
  });
  participant = await createTestParticipant(college, { emailAddress: "player@example.com" });
});

afterAll(async () => {
  await teardownTestDatabase();
});

async function seedConfirmedRegistration(overrides = {}) {
  return RegistrationModel.create({
    eventId: event._id,
    userId: participant.user._id,
    status: "confirmed",
    paymentStatus: "notRequired",
    feeAmountSnapshotPaise: 0,
    totalFeePaise: 0,
    registeredAt: new Date(),
    ...overrides,
  });
}

describe("listAvailableAddOns", () => {
  it("offers what the participant has not already bought", async () => {
    const registration = await seedConfirmedRegistration();

    const result = await addOnService.listAvailableAddOns(
      participant.user._id,
      registration._id
    );

    expect(result.offers.map((offer) => offer.offerKey).sort()).toEqual(["djnight", "workshop"]);
    expect(result.eventName).toBe("Hackathon");
  });

  it("hides an offer already on the registration", async () => {
    const djOffer = fest.offers.find((offer) => offer.offerKey === "djnight");
    const registration = await seedConfirmedRegistration({
      offerSelections: [
        {
          offerId: djOffer._id,
          offerKey: "djnight",
          scope: "fest",
          numberOfPeople: 1,
          numberOfDays: 1,
        },
      ],
    });

    const result = await addOnService.listAvailableAddOns(participant.user._id, registration._id);

    expect(result.offers.map((offer) => offer.offerKey)).toEqual(["workshop"]);
  });

  it("refuses a registration belonging to somebody else", async () => {
    const registration = await seedConfirmedRegistration();
    const other = await createTestParticipant(college, { emailAddress: "other@example.com" });

    await expect(
      addOnService.listAvailableAddOns(other.user._id, registration._id)
    ).rejects.toMatchObject({ errorCode: "REGISTRATION_NOT_FOUND", statusCode: 404 });
  });

  it("refuses a registration that is not confirmed", async () => {
    const registration = await seedConfirmedRegistration({
      status: "pendingPayment",
      paymentStatus: "pending",
    });

    await expect(
      addOnService.listAvailableAddOns(participant.user._id, registration._id)
    ).rejects.toMatchObject({ errorCode: "REGISTRATION_NOT_CONFIRMED", statusCode: 409 });
  });
});

describe("addRegistrationAddOns", () => {
  it("applies a free add-on inline, with no payment order", async () => {
    const registration = await seedConfirmedRegistration();

    const result = await addOnService.addRegistrationAddOns(participant.user._id, registration._id, [
      { offerKey: "workshop", scope: "fest" },
    ]);

    expect(result.paid).toBe(false);
    expect(result.amountPaise).toBe(0);
    // Free add-ons must never create a payment order to be abandoned.
    expect(await AddOnOrderModel.countDocuments({})).toBe(0);

    const updated = await RegistrationModel.findById(registration._id).lean();
    expect(updated.offerSelections.map((selection) => selection.offerKey)).toEqual(["workshop"]);
  });

  it("parks a paid add-on and does NOT touch the registration until capture", async () => {
    const registration = await seedConfirmedRegistration();

    const result = await addOnService.addRegistrationAddOns(participant.user._id, registration._id, [
      { offerKey: "djnight", scope: "fest", numberOfPeople: 2 },
    ]);

    expect(result.paid).toBe(true);
    expect(result.amountPaise).toBe(40000); // 20000 x 2 people
    expect(result.paymentGroupId).toBeTruthy();

    // The seat is already confirmed and must stay exactly as it was.
    const untouched = await RegistrationModel.findById(registration._id).lean();
    expect(untouched.offerSelections).toEqual([]);
    expect(untouched.status).toBe("confirmed");
    expect(untouched.paymentStatus).toBe("notRequired");
  });

  it("attaches the offers once the payment is captured", async () => {
    const registration = await seedConfirmedRegistration();
    const { paymentGroupId } = await addOnService.addRegistrationAddOns(
      participant.user._id,
      registration._id,
      [{ offerKey: "djnight", scope: "fest", numberOfPeople: 2 }]
    );

    await addOnService.confirmAddOnOrder(paymentGroupId, "pay_test_1");

    const updated = await RegistrationModel.findById(registration._id).lean();
    expect(updated.offerSelections.map((selection) => selection.offerKey)).toEqual(["djnight"]);
    expect(updated.offerSelections[0].numberOfPeople).toBe(2);

    // The pass carries the entitlement, derived by the existing sync.
    const entitlement = await EntitlementModel.findOne({ entitlementType: "offerClaim" }).lean();
    expect(entitlement).not.toBeNull();
    expect(entitlement.maximumUses).toBe(2);
  });

  it("is idempotent on a replayed capture", async () => {
    const registration = await seedConfirmedRegistration();
    const { paymentGroupId } = await addOnService.addRegistrationAddOns(
      participant.user._id,
      registration._id,
      [{ offerKey: "djnight", scope: "fest", numberOfPeople: 1 }]
    );

    await addOnService.confirmAddOnOrder(paymentGroupId, "pay_test_1");
    const replay = await addOnService.confirmAddOnOrder(paymentGroupId, "pay_test_1");

    expect(replay.alreadyConfirmed).toBe(true);
    const updated = await RegistrationModel.findById(registration._id).lean();
    // Not applied twice.
    expect(updated.offerSelections).toHaveLength(1);
  });

  it("rejects a selection that names no available offer", async () => {
    const registration = await seedConfirmedRegistration();

    await expect(
      addOnService.addRegistrationAddOns(participant.user._id, registration._id, [
        { offerKey: "nonexistent", scope: "fest" },
      ])
    ).rejects.toMatchObject({ errorCode: "VALIDATION_FAILED", statusCode: 400 });
  });
});

describe("publishing a fest cascades to its draft events", () => {
  it("publishes draft events and leaves cancelled ones alone", async () => {
    const draftFest = await createTestFest(college, admin.user, {
      status: "draft",
      festSlug: "cascade-fest",
      festName: "Cascade Fest",
    });
    const draftEvent = await createTestEvent(draftFest, admin.user, {
      eventSlug: "draft-one",
      eventName: "Draft One",
      ...openRegistrationOverrides({ status: "draft" }),
    });
    const cancelledEvent = await createTestEvent(draftFest, admin.user, {
      eventSlug: "called-off",
      eventName: "Called Off",
      ...openRegistrationOverrides({ status: "cancelled" }),
    });

    await festService.publishFest(admin.user._id, draftFest.id);

    // The fest itself must have flipped, or the cascade below proves nothing.
    expect((await FestModel.findById(draftFest._id).lean()).status).toBe("published");

    expect((await EventModel.findById(draftEvent._id).lean()).status).toBe("published");
    /* An admin who called an event off does not expect publishing the fest to
       bring it back. */
    expect((await EventModel.findById(cancelledEvent._id).lean()).status).toBe("cancelled");
  });
});

describe("team captain", () => {
  async function seedTeam() {
    const second = await createTestParticipant(college, { emailAddress: "mate@example.com" });
    const team = await TeamModel.create({
      eventId: event._id,
      teamName: "The Contenders",
      leaderUserId: participant.user._id,
      memberUserIds: [participant.user._id, second.user._id],
      inviteCode: "CAPTAIN1",
    });
    return { team, second };
  }

  it("lets a member claim the captaincy", async () => {
    const { team } = await seedTeam();

    await teamService.claimTeamCaptain(participant.user._id, team._id);

    const updated = await TeamModel.findById(team._id).lean();
    expect(String(updated.captainUserId)).toBe(String(participant.user._id));
  });

  it("is idempotent for the holder", async () => {
    const { team } = await seedTeam();
    await teamService.claimTeamCaptain(participant.user._id, team._id);

    await expect(
      teamService.claimTeamCaptain(participant.user._id, team._id)
    ).resolves.toBeTruthy();
  });

  it("refuses a second member once claimed", async () => {
    const { team, second } = await seedTeam();
    await teamService.claimTeamCaptain(participant.user._id, team._id);

    await expect(
      teamService.claimTeamCaptain(second.user._id, team._id)
    ).rejects.toMatchObject({ errorCode: "CAPTAIN_ALREADY_CLAIMED", statusCode: 409 });
  });

  it("refuses a non-member, without confirming the team exists", async () => {
    const { team } = await seedTeam();
    const outsider = await createTestParticipant(college, { emailAddress: "outsider@example.com" });

    await expect(
      teamService.claimTeamCaptain(outsider.user._id, team._id)
    ).rejects.toMatchObject({ errorCode: "TEAM_NOT_FOUND", statusCode: 404 });
  });

  it("reopens the claim after the captain resigns", async () => {
    const { team, second } = await seedTeam();
    await teamService.claimTeamCaptain(participant.user._id, team._id);
    await teamService.resignTeamCaptain(participant.user._id, team._id);

    await teamService.claimTeamCaptain(second.user._id, team._id);

    const updated = await TeamModel.findById(team._id).lean();
    expect(String(updated.captainUserId)).toBe(String(second.user._id));
  });

  it("forces the LAST joiner to captain when nobody has claimed it", async () => {
    const teamEvent = await createTestEvent(fest, admin.user, {
      eventSlug: "duo",
      eventName: "Duo",
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 2,
      ...openRegistrationOverrides(),
    });
    const leader = await createTestParticipant(college, { emailAddress: "leader@example.com" });
    const team = await TeamModel.create({
      eventId: teamEvent._id,
      teamName: "Last One In",
      leaderUserId: leader.user._id,
      memberUserIds: [leader.user._id],
      inviteCode: "LASTONE1",
      status: "forming",
    });

    const joiner = await createTestParticipant(college, { emailAddress: "lastin@example.com" });
    const result = await teamService.joinTeamByInviteCode(joiner.user._id, {
      inviteCode: team.inviteCode,
    });

    // A full team with nobody answering the phone is the failure this prevents.
    expect(result.captainAutoAssigned).toBe(true);
    expect(result.isCaptain).toBe(true);
    const reloaded = await TeamModel.findById(team._id).lean();
    expect(String(reloaded.captainUserId)).toBe(String(joiner.user._id));
  });

  it("leaves the post open when the team is not yet full and nobody asked", async () => {
    const teamEvent = await createTestEvent(fest, admin.user, {
      eventSlug: "trio",
      eventName: "Trio",
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 4,
      ...openRegistrationOverrides(),
    });
    const leader = await createTestParticipant(college, { emailAddress: "trioleader@example.com" });
    const team = await TeamModel.create({
      eventId: teamEvent._id,
      teamName: "Room To Spare",
      leaderUserId: leader.user._id,
      memberUserIds: [leader.user._id],
      inviteCode: "ROOMLEFT",
      status: "forming",
    });

    const joiner = await createTestParticipant(college, { emailAddress: "midjoin@example.com" });
    const result = await teamService.joinTeamByInviteCode(joiner.user._id, {
      inviteCode: team.inviteCode,
    });

    expect(result.captainAutoAssigned).toBe(false);
    expect(result.isCaptain).toBe(false);
    expect((await TeamModel.findById(team._id).lean()).captainUserId).toBeNull();
  });

  it("gives the captaincy to a joiner who asks for it mid-team", async () => {
    const teamEvent = await createTestEvent(fest, admin.user, {
      eventSlug: "quartet",
      eventName: "Quartet",
      eventType: "team",
      minimumTeamSize: 2,
      maximumTeamSize: 4,
      ...openRegistrationOverrides(),
    });
    const leader = await createTestParticipant(college, { emailAddress: "qleader@example.com" });
    const team = await TeamModel.create({
      eventId: teamEvent._id,
      teamName: "Volunteered",
      leaderUserId: leader.user._id,
      memberUserIds: [leader.user._id],
      inviteCode: "IWILLDO1",
      status: "forming",
    });

    const joiner = await createTestParticipant(college, { emailAddress: "willing@example.com" });
    const result = await teamService.joinTeamByInviteCode(joiner.user._id, {
      inviteCode: team.inviteCode,
      claimCaptain: true,
    });

    expect(result.isCaptain).toBe(true);
    // They asked, so there is nothing to announce.
    expect(result.captainAutoAssigned).toBe(false);
  });

  it("refuses a resignation from anyone but the captain", async () => {
    const { team, second } = await seedTeam();
    await teamService.claimTeamCaptain(participant.user._id, team._id);

    await expect(
      teamService.resignTeamCaptain(second.user._id, team._id)
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

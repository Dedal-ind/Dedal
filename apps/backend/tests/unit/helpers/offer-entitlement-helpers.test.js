import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { FestModel } from "../../../src/models/fest-model.js";
import { RegistrationModel } from "../../../src/models/registration-model.js";
import { EntitlementModel } from "../../../src/models/entitlement-model.js";
import { syncOfferEntitlements } from "../../../src/helpers/offer-entitlement-helpers.js";
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
  createTestPass,
} from "../../setup/create-test-fixtures.js";

let college;
let admin;
let fest;
let event;
let participant;
let pass;
let foodOfferId;

async function createConfirmedRegistration(overrides = {}) {
  return RegistrationModel.create({
    eventId: event._id,
    userId: participant.user._id,
    status: "confirmed",
    feeAmountSnapshotPaise: 0,
    registeredAt: new Date(),
    ...overrides,
  });
}

function findFoodClaim() {
  return EntitlementModel.findOne({
    passId: pass._id,
    entitlementType: "offerClaim",
    referenceId: foodOfferId,
    status: "active",
  });
}

beforeAll(async () => {
  await setupTestDatabase();
  await EntitlementModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, {
    status: "published",
    offers: [{ offerName: "Food", offerKey: "food", requiresQuantity: true, isActive: true }],
  });
  fest = await FestModel.findById(fest._id);
  foodOfferId = fest.offers[0]._id;
  event = await createTestEvent(fest, admin.user, { status: "published" });
  participant = await createTestParticipant(college);
  pass = await createTestPass(fest, participant.user);
});

afterAll(teardownTestDatabase);

describe("syncOfferEntitlements", () => {
  it("is idempotent across repeated calls", async () => {
    await createConfirmedRegistration({ foodOrderCount: 3 });
    await syncOfferEntitlements(participant.user._id, fest, pass);
    await syncOfferEntitlements(participant.user._id, fest, pass);
    await syncOfferEntitlements(participant.user._id, fest, pass);

    const claims = await EntitlementModel.find({
      passId: pass._id,
      entitlementType: "offerClaim",
    });
    expect(claims).toHaveLength(1);
    expect(claims[0].maximumUses).toBe(3);
  });

  it("raises maximumUses when a second registration books more", async () => {
    await createConfirmedRegistration({ foodOrderCount: 2 });
    await syncOfferEntitlements(participant.user._id, fest, pass);
    expect((await findFoodClaim()).maximumUses).toBe(2);

    const secondEvent = await createTestEvent(fest, admin.user, {
      status: "published",
      eventSlug: "second-event",
    });
    await RegistrationModel.create({
      eventId: secondEvent._id,
      userId: participant.user._id,
      status: "confirmed",
      feeAmountSnapshotPaise: 0,
      registeredAt: new Date(),
      foodOrderCount: 2,
    });
    await syncOfferEntitlements(participant.user._id, fest, pass);
    expect((await findFoodClaim()).maximumUses).toBe(4);
  });

  it("never lowers maximumUses below usedCount after a cancellation", async () => {
    const registration = await createConfirmedRegistration({ foodOrderCount: 4 });
    await syncOfferEntitlements(participant.user._id, fest, pass);

    // Three meals already served at the counter.
    const claim = await findFoodClaim();
    claim.usedCount = 3;
    await claim.save();

    registration.status = "cancelled";
    await registration.save();
    await syncOfferEntitlements(participant.user._id, fest, pass);

    const clamped = await findFoodClaim();
    expect(clamped.status).toBe("active");
    expect(clamped.maximumUses).toBe(3); // clamped to what was already served
  });

  it("does not re-create the entitlement of a deactivated offer", async () => {
    await createConfirmedRegistration({ foodOrderCount: 2 });
    await syncOfferEntitlements(participant.user._id, fest, pass);
    expect(await findFoodClaim()).not.toBe(null);

    fest.offers[0].isActive = false;
    await fest.save();
    // Remove the claim as an operator might, then re-sync: nothing returns.
    await EntitlementModel.deleteMany({ entitlementType: "offerClaim" });
    await syncOfferEntitlements(participant.user._id, fest, pass);
    expect(await findFoodClaim()).toBe(null);
  });
});

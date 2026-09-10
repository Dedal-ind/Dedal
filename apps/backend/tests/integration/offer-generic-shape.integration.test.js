import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { CheckpointModel } from "../../src/models/checkpoint-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { PassModel } from "../../src/models/pass-model.js";
import { installEmailServiceMock } from "../setup/test-email-service.js";
import { installRazorpayClientMock } from "../setup/test-razorpay-service.js";
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
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";
import { convertOffer } from "../../src/helpers/migrate-offer-generic-shape.js";
import { computeRegistrationFee } from "../../src/helpers/registration-payment-helpers.js";

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

let college;
let admin;
let fest;
let participant;
let participantCounter = 0;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

async function nextParticipant() {
  participantCounter += 1;
  return createTestParticipant(college, {
    emailAddress: `generic${participantCounter}@example.com`,
    usn: `1GN00AA${participantCounter.toString().padStart(3, "0")}`,
  });
}

beforeAll(async () => {
  await setupTestDatabase();
  await RegistrationModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  participantCounter = 0;
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  participant = await nextParticipant();
});

afterAll(teardownTestDatabase);

describe("generic offer shape — pricing", () => {
  it("a paid offer at 3 people x 2 days x Rs 100 charges Rs 600", async () => {
    const pricedFest = await createTestFest(college, admin.user, {
      festName: "Axis Fest",
      festSlug: "axis-fest",
      status: "published",
      offers: [
        {
          offerName: "Stay",
          offerKey: "stay",
          isActive: true,
          isPaid: true,
          ratePaise: 10000, // Rs 100 per person per day
          collectsNumberOfPeople: true,
          numberOfPeopleMaximum: 5,
          collectsNumberOfDays: true,
          numberOfDaysMaximum: 5,
        },
      ],
    });
    const event = await createTestEvent(
      pricedFest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "axis-solo", feeType: "free", feeAmountPaise: 0 })
    );

    const response = await withToken(
      request(application).post(`/api/v1/events/${event.id}/registrations/solo`),
      participant.authenticationToken
    ).send({ offerSelections: [{ offerKey: "stay", numberOfPeople: 3, numberOfDays: 2 }] });

    expect(response.status).toBe(201);
    expect(response.body.data.registration.totalFeePaise).toBe(60000);
    const line = response.body.data.registration.feeBreakdown.find((entry) => entry.label === "Stay");
    // quantity is the multiplied-out unit count, so the snapshot reconciles.
    expect(line).toMatchObject({ quantity: 6, unitPaise: 10000, subtotalPaise: 60000 });
    expect(response.body.data.registration.offerSelections[0]).toMatchObject({
      offerKey: "stay",
      scope: "fest",
      numberOfPeople: 3,
      numberOfDays: 2,
    });
  });

  it("a FREE offer costs nothing however large the quantities", async () => {
    const freeFest = await createTestFest(college, admin.user, {
      festName: "Free Fest",
      festSlug: "free-offer-fest",
      status: "published",
      offers: [
        {
          offerName: "Shuttle",
          offerKey: "shuttle",
          isActive: true,
          isPaid: false,
          ratePaise: 0,
          collectsNumberOfPeople: true,
          collectsNumberOfDays: true,
        },
      ],
    });
    const event = await createTestEvent(
      freeFest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "free-offer-solo", feeType: "free", feeAmountPaise: 0 })
    );

    const response = await withToken(
      request(application).post(`/api/v1/events/${event.id}/registrations/solo`),
      participant.authenticationToken
    ).send({ offerSelections: [{ offerKey: "shuttle", numberOfPeople: 9, numberOfDays: 9 }] });

    expect(response.status).toBe(201);
    expect(response.body.data.registration.totalFeePaise).toBe(0);
    expect(response.body.data.registration.status).toBe("confirmed");
  });

  it("enforces numberOfPeopleMaximum and rejects a paid offer with no rate at write time", async () => {
    const cappedFest = await createTestFest(college, admin.user, {
      festName: "Capped Fest",
      festSlug: "capped-fest",
      status: "published",
      offers: [
        {
          offerName: "Pass",
          offerKey: "pass",
          isActive: true,
          isPaid: true,
          ratePaise: 5000,
          collectsNumberOfPeople: true,
          numberOfPeopleMaximum: 2,
        },
      ],
    });
    const event = await createTestEvent(
      cappedFest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "capped-solo", feeType: "free", feeAmountPaise: 0 })
    );
    const overCap = await withToken(
      request(application).post(`/api/v1/events/${event.id}/registrations/solo`),
      participant.authenticationToken
    ).send({ offerSelections: [{ offerKey: "pass", numberOfPeople: 3 }] });
    expect(overCap.status).toBe(400);
    expect(overCap.body.error.code).toBe("OFFER_SELECTION_INVALID");
    expect(overCap.body.error.details).toMatchObject({ axis: "number of people", maximum: 2 });

    // The isPaid/ratePaise cross-field rule, on the admin write path.
    const badOffer = await withToken(
      request(application).patch(`/api/v1/fests/${cappedFest.id}`),
      admin.authenticationToken
    ).send({ offers: [{ offerName: "Broken", isPaid: true, ratePaise: 0 }] });
    expect(badOffer.status).toBe(400);
    expect(badOffer.body.error.details.offers).toMatch(/ratePaise greater than 0/);
  });

  it("forces ratePaise to zero when isPaid is false, whatever the client sent", async () => {
    const response = await withToken(
      request(application).patch(`/api/v1/fests/${fest.id}`),
      admin.authenticationToken
    ).send({ offers: [{ offerName: "Smuggled", isPaid: false, ratePaise: 99999 }] });
    expect(response.status).toBe(200);
    expect(response.body.data.offers[0]).toMatchObject({ isPaid: false, ratePaise: 0 });
  });
});

describe("generic offer shape — migration", () => {
  it("converts the old shape, is idempotent, and prices identically to the migrated equivalent", async () => {
    // A pre-migration offer, written straight to the collection so the new
    // schema cannot silently normalise it.
    const legacyOfferId = new mongoose.Types.ObjectId();
    const legacyOffer = {
      _id: legacyOfferId,
      offerName: "Legacy Meal",
      offerKey: "legacy-meal",
      requiresQuantity: true,
      isActive: true,
      pricePerUnitPaise: 15000,
      description: "Old shape",
      quantityMinimum: 1,
      quantityMaximum: 4,
    };
    await FestModel.collection.updateOne({ _id: fest._id }, { $set: { offers: [legacyOffer] } });

    const { migrateOfferGenericShape } = await import(
      "../../src/helpers/migrate-offer-generic-shape.js"
    );
    const firstRun = await migrateOfferGenericShape();
    expect(firstRun.festResult.convertedOfferCount).toBe(1);
    // Idempotent: a second run finds nothing left to convert.
    const secondRun = await migrateOfferGenericShape();
    expect(secondRun.festResult.convertedOfferCount).toBe(0);

    const migratedFest = await FestModel.findById(fest._id).lean();
    const migratedOffer = migratedFest.offers[0];
    expect(migratedOffer).toMatchObject({
      isPaid: true,
      ratePaise: 15000,
      collectsNumberOfPeople: true,
      numberOfPeopleMaximum: 4,
      collectsNumberOfDays: false,
    });
    // The old fields are GONE, not carried alongside — one shape, never two.
    expect(migratedOffer.pricePerUnitPaise).toBeUndefined();
    expect(migratedOffer.requiresQuantity).toBeUndefined();

    /*
     * GOLDEN: the fee for the pre-migration offer equals the fee for its
     * migrated equivalent. convertOffer is applied in-memory to the legacy row
     * and both are priced through the one formula at the same quantities.
     */
    const soloEvent = { feeType: "free", feeAmountPaise: 0 };
    const convertedInMemory = convertOffer(legacyOffer);
    const migratedFee = computeRegistrationFee(
      soloEvent,
      1,
      { offers: [migratedOffer] },
      [{ offerKey: "legacy-meal", scope: "fest", numberOfPeople: 3, numberOfDays: 1 }],
      0,
      false
    );
    const inMemoryFee = computeRegistrationFee(
      soloEvent,
      1,
      { offers: [convertedInMemory] },
      [{ offerKey: "legacy-meal", scope: "fest", numberOfPeople: 3, numberOfDays: 1 }],
      0,
      false
    );
    expect(migratedFee.totalFeePaise).toBe(45000); // 3 x Rs 150, exactly the old per-unit price
    expect(inMemoryFee.totalFeePaise).toBe(migratedFee.totalFeePaise);
  });
});

describe("event-level offers", () => {
  it("event offers price alongside fest offers, keep their scope, and get their own checkpoint + entitlement", async () => {
    const dualFest = await createTestFest(college, admin.user, {
      festName: "Dual Fest",
      festSlug: "dual-fest",
      status: "published",
      offers: [
        { offerName: "Food", offerKey: "food", isActive: true, isPaid: true, ratePaise: 10000, collectsNumberOfPeople: true },
      ],
    });
    const event = await createTestEvent(
      dualFest,
      admin.user,
      openRegistrationOverrides({
        eventType: "solo",
        eventSlug: "dual-solo",
        feeType: "free",
        feeAmountPaise: 0,
        offers: [
          { offerName: "Kit", offerKey: "kit", isActive: true, isPaid: true, ratePaise: 25000 },
        ],
      })
    );
    // Re-sending the offers materialises the event's own counter, scoped to the
    // event (the fixture event is born published, so the publish transition —
    // which does the same — has already passed).
    await withToken(
      request(application).patch(`/api/v1/fests/${dualFest.id}/events/${event.id}`),
      admin.authenticationToken
    ).send({
      offers: [{ offerName: "Kit", isPaid: true, ratePaise: 25000 }],
    });
    const eventCheckpoint = await CheckpointModel.findOne({
      festId: dualFest._id,
      eventId: event._id,
      checkpointType: "offer",
    });
    expect(eventCheckpoint).not.toBeNull();
    expect(eventCheckpoint.checkpointName).toBe("Kit");

    const response = await withToken(
      request(application).post(`/api/v1/events/${event.id}/registrations/solo`),
      participant.authenticationToken
    ).send({
      foodPreference: "veg",
      offerSelections: [{ offerKey: "kit", scope: "event" }],
    });
    expect(response.status).toBe(201);
    // Food (fest, 1 person derived) Rs 100 + Kit (event) Rs 250 — the event's
    // own offer prices alongside the fest's, and a nonzero total means the seat
    // is held pending payment (the free path would have confirmed it).
    expect(response.body.data.registration.totalFeePaise).toBe(35000);
    expect(response.body.data.registration.status).toBe("pendingPayment");
    expect(response.body.data.registration.offerSelections[0].scope).toBe("event");
    const labels = response.body.data.registration.feeBreakdown.map((line) => line.label);
    expect(labels).toEqual(["Registration", "Food", "Kit"]);
  });

  it("a FREE event-scoped offer earns its own entitlement, keyed on its own subdocument id", async () => {
    const freeDualFest = await createTestFest(college, admin.user, {
      festName: "Free Dual",
      festSlug: "free-dual-fest",
      status: "published",
      offers: [{ offerName: "Food", offerKey: "food", isActive: true, isPaid: false, ratePaise: 0 }],
    });
    const event = await createTestEvent(
      freeDualFest,
      admin.user,
      openRegistrationOverrides({
        eventType: "solo",
        eventSlug: "free-dual-solo",
        feeType: "free",
        feeAmountPaise: 0,
        offers: [{ offerName: "Kit", offerKey: "kit", isActive: true, isPaid: false, ratePaise: 0 }],
      })
    );

    const response = await withToken(
      request(application).post(`/api/v1/events/${event.id}/registrations/solo`),
      participant.authenticationToken
    ).send({ foodPreference: "veg", offerSelections: [{ offerKey: "kit", scope: "event" }] });
    expect(response.status).toBe(201);
    expect(response.body.data.registration.status).toBe("confirmed");

    const reloadedEvent = await EventModel.findById(event._id);
    const kitOfferId = reloadedEvent.offers[0]._id;
    const reloadedFest = await FestModel.findById(freeDualFest._id);
    const foodOfferId = reloadedFest.offers[0]._id;
    const pass = await PassModel.findOne({ userId: participant.user._id, festId: freeDualFest._id });

    // Two entitlements, one per offer SUBDOCUMENT — the event-scoped Kit is not
    // absorbed into the fest-scoped Food, and neither shares a referenceId.
    const kitEntitlement = await EntitlementModel.findOne({
      passId: pass._id,
      entitlementType: "offerClaim",
      referenceId: kitOfferId,
    });
    const foodEntitlement = await EntitlementModel.findOne({
      passId: pass._id,
      entitlementType: "offerClaim",
      referenceId: foodOfferId,
    });
    expect(kitEntitlement).not.toBeNull();
    expect(kitEntitlement.maximumUses).toBe(1);
    expect(foodEntitlement).not.toBeNull();
    expect(kitEntitlement.maximumUses).toBe(1);
  });
});

describe("sponsors", () => {
  it("accepts a sponsor list through the fest PATCH and enforces the cap", async () => {
    const response = await withToken(
      request(application).patch(`/api/v1/fests/${fest.id}`),
      admin.authenticationToken
    ).send({
      // sponsorName and tier are both required ON WRITE (see
      // helpers/sponsor-field-parsers.js); only linkUrl stays optional.
      sponsors: [
        {
          imageUrl: "https://cdn.example.com/one.png",
          sponsorName: "One",
          tier: "title",
          linkUrl: "https://one.example.com",
        },
        { imageUrl: "https://cdn.example.com/two.png", sponsorName: "Two", tier: "partner" },
      ],
    });
    expect(response.status).toBe(200);
    expect(response.body.data.sponsors).toHaveLength(2);
    expect(response.body.data.sponsors[1]).toMatchObject({
      sponsorName: "Two",
      tier: "partner",
      linkUrl: null,
    });

    const overCap = await withToken(
      request(application).patch(`/api/v1/fests/${fest.id}`),
      admin.authenticationToken
    ).send({
      // The cap was lowered from 20 to 10; eleven is now one too many.
      sponsors: Array.from({ length: 11 }, (unused, index) => ({
        imageUrl: `https://cdn.example.com/${index}.png`,
        sponsorName: `Sponsor ${index}`,
        tier: "partner",
      })),
    });
    expect(overCap.status).toBe(400);
    expect(overCap.body.error.details.sponsors).toMatch(/10 sponsors/);
  });
});

describe("a fest with no offers and no sponsors is unchanged", () => {
  it("registers exactly as before: free, confirmed, no offer rows, no sponsor payload", async () => {
    const bareEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "bare-solo", feeType: "free", feeAmountPaise: 0 })
    );
    const response = await withToken(
      request(application).post(`/api/v1/events/${bareEvent.id}/registrations/solo`),
      participant.authenticationToken
    ).send({});

    expect(response.status).toBe(201);
    const registration = response.body.data.registration;
    expect(registration.status).toBe("confirmed");
    expect(registration.totalFeePaise).toBe(0);
    expect(registration.offerSelections).toEqual([]);
    expect(registration.foodPreference).toBeNull();
    expect(registration.needsAccommodation).toBeNull();
    expect(response.body.data.payment).toBeUndefined();

    const reloadedFest = await FestModel.findById(fest._id).lean();
    expect(reloadedFest.offers).toEqual([]);
    expect(reloadedFest.sponsors).toEqual([]);
  });
});

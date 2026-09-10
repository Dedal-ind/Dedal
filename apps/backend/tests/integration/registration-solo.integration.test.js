import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
import { EventModel } from "../../src/models/event-model.js";
import { FestModel } from "../../src/models/fest-model.js";
import { UserModel } from "../../src/models/user-model.js";
import { PassModel } from "../../src/models/pass-model.js";
import { EntitlementModel } from "../../src/models/entitlement-model.js";
import { claimSoloSeat } from "../../src/helpers/registration-seat-helpers.js";
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
  openRegistrationOverrides,
} from "../setup/create-test-fixtures.js";

import { installRazorpayClientMock } from "../setup/test-razorpay-service.js";
installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

const MISSING_ID = "000000000000000000000000";

let college;
let admin;
let fest;
let participant;
let event;

function asParticipant(httpRequest) {
  return httpRequest.set("Authorization", `Bearer ${participant.authenticationToken}`);
}

function soloPath(eventId) {
  return `/api/v1/events/${eventId}/registrations/solo`;
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    RegistrationModel.createIndexes(),
    EventModel.createIndexes(),
    FestModel.createIndexes(),
    UserModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
  participant = await createTestParticipant(college);
  event = await createTestEvent(fest, admin.user, openRegistrationOverrides({ eventType: "solo", capacity: 2 }));
});

afterAll(teardownTestDatabase);

describe("solo foodOrderCount", () => {
  it("stays null when the fest offers no food", async () => {
    const response = await asParticipant(request(application).post(soloPath(event.id))).send({});
    expect(response.status).toBe(201);
    const row = await RegistrationModel.findOne({ eventId: event._id, userId: participant.user._id });
    expect(row.foodOrderCount).toBe(null);
  });

  it("derives 1 for a solo registrant on a food-offering fest, and 0 for noMealNeeded", async () => {
    const foodFest = await createTestFest(college, admin.user, {
      festName: "Solo Food Fest",
      festSlug: "solo-food-fest",
      status: "published",
      offers: [{ offerName: "Food", offerKey: "food", requiresQuantity: true, isActive: true }],
    });
    const foodEvent = await createTestEvent(
      foodFest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "solo-food" })
    );

    // A meal-wanting registrant books one meal, derived, never asked.
    const vegResponse = await asParticipant(request(application).post(soloPath(foodEvent.id))).send({
      foodPreference: "veg",
    });
    expect(vegResponse.status).toBe(201);
    expect(
      (await RegistrationModel.findOne({ eventId: foodEvent._id, userId: participant.user._id }))
        .foodOrderCount
    ).toBe(1);

    // noMealNeeded forces 0, ignoring any submitted count.
    const noMealParticipant = await createTestParticipant(college, {
      emailAddress: "nomeal@example.com",
      usn: "1AA00AA090",
    });
    const noMealResponse = await request(application)
      .post(soloPath(foodEvent.id))
      .set("Authorization", `Bearer ${noMealParticipant.authenticationToken}`)
      .send({ foodPreference: "noMealNeeded", foodOrderCount: 5 });
    expect(noMealResponse.status).toBe(201);
    expect(
      (await RegistrationModel.findOne({ eventId: foodEvent._id, userId: noMealParticipant.user._id }))
        .foodOrderCount
    ).toBe(0);
  });
});

describe("claimSoloSeat capacity freshness", () => {
  it("refuses a claim against the DB's current capacity, not a stale in-memory value", async () => {
    // An admin reduces capacity after the event was loaded into memory. The atomic
    // claim must read the DB's live capacity, or it overbooks against the stale
    // higher value carried in JS.
    const capped = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "shrink", capacity: 5, waitlistEnabled: false })
    );
    // staleEvent carries capacity 5 in memory, as a caller loaded it before the cut.
    const staleEvent = await EventModel.findById(capped._id);

    await EventModel.updateOne({ _id: capped._id }, { registeredCount: 4, capacity: 4 });

    await expect(claimSoloSeat(staleEvent)).rejects.toMatchObject({ errorCode: "EVENT_FULL" });
    const reloaded = await EventModel.findById(capped._id);
    expect(reloaded.registeredCount).toBe(4);
  });
});

describe("POST /api/v1/events/:eventId/registrations/solo", () => {
  it("registers the participant and returns the confirmed registration", async () => {
    const response = await asParticipant(request(application).post(soloPath(event.id)));

    expect(response.status).toBe(201);
    expect(response.body.data.registration.status).toBe("confirmed");
    expect(response.body.data.event.registeredCount).toBe(1);
  });

  it("registers a free event as notRequired/confirmed with a pass and entitlement", async () => {
    const response = await asParticipant(request(application).post(soloPath(event.id)));

    expect(response.status).toBe(201);
    expect(response.body.data.registration.status).toBe("confirmed");
    expect(response.body.data.registration.paymentStatus).toBe("notRequired");

    const pass = await PassModel.findOne({ userId: participant.user._id, festId: fest._id });
    expect(pass).not.toBe(null);
    expect(
      await EntitlementModel.countDocuments({ passId: pass._id, entitlementType: "eventEntry", referenceId: event._id })
    ).toBe(1);
  });

  it("holds a paid solo seat as pendingPayment with no pass or entitlement yet", async () => {
    const paidEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "paid-solo", capacity: 10, feeType: "perPerson", feeAmountPaise: 45000 })
    );

    const response = await asParticipant(request(application).post(soloPath(paidEvent.id)));

    expect(response.status).toBe(201);
    const registration = response.body.data.registration;
    expect(registration.status).toBe("pendingPayment");
    expect(registration.paymentStatus).toBe("pending");
    expect(registration.paymentGroupId).toEqual(expect.any(String));
    expect(registration.totalFeePaise).toBe(45000);
    // Seat is held; the count moved.
    expect((await EventModel.findById(paidEvent._id)).registeredCount).toBe(1);
    // No pass or entitlement until payment confirms.
    expect(await PassModel.countDocuments({ userId: participant.user._id })).toBe(0);
    expect(await EntitlementModel.countDocuments({ referenceId: paidEvent._id })).toBe(0);
  });

  it("confirms a payment group: flips to confirmed and mints the pass and entitlement", async () => {
    const paidEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "paid-confirm", feeType: "perPerson", feeAmountPaise: 45000 })
    );
    const registerResponse = await asParticipant(request(application).post(soloPath(paidEvent.id)));
    const { paymentGroupId } = registerResponse.body.data.registration;

    const confirmResponse = await request(application)
      .post("/api/v1/registrations/confirm-payment")
      .set("Authorization", `Bearer ${admin.authenticationToken}`)
      .send({ paymentGroupId, paymentReference: "cash received" });

    expect(confirmResponse.status).toBe(200);
    expect(confirmResponse.body.data.confirmedCount).toBe(1);

    const registration = await RegistrationModel.findOne({ eventId: paidEvent._id, userId: participant.user._id });
    expect(registration.status).toBe("confirmed");
    expect(registration.paymentStatus).toBe("completed");

    const pass = await PassModel.findOne({ userId: participant.user._id, festId: fest._id });
    expect(pass).not.toBe(null);
    expect(
      await EntitlementModel.countDocuments({ passId: pass._id, entitlementType: "eventEntry", referenceId: paidEvent._id })
    ).toBe(1);
  });

  it("refuses registration on a leaf event that has no category", async () => {
    const uncategorized = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "uncat", category: null })
    );

    const response = await asParticipant(request(application).post(soloPath(uncategorized.id)));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("REGISTRATION_EVENT_NOT_CATEGORIZED");
  });

  it("refuses registration on a parent (container) event that has child events", async () => {
    // Give the event a child, turning it into a grouping container.
    await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "leaf", parentEventId: event._id })
    );

    const response = await asParticipant(request(application).post(soloPath(event.id)));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("REGISTRATION_ON_PARENT_EVENT");
  });

  it("lets an unblocked participant pass both the middleware and the loadRegisterableUser guard", async () => {
    // Defence in depth: the middleware now reloads and re-checks the user, and
    // loadRegisterableUser still runs its own isBlocked check. An unblocked user
    // must sail through both to the confirmed registration.
    const response = await asParticipant(request(application).post(soloPath(event.id)));

    expect(response.status).toBe(201);
    expect(response.body.data.registration.status).toBe("confirmed");
  });

  it("refuses an unauthenticated caller", async () => {
    const response = await request(application).post(soloPath(event.id));
    expect(response.status).toBe(401);
  });

  it("rejects a duplicate active registration", async () => {
    await asParticipant(request(application).post(soloPath(event.id)));
    const response = await asParticipant(request(application).post(soloPath(event.id)));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("ALREADY_REGISTERED");
  });

  it("404s a missing event", async () => {
    const response = await asParticipant(request(application).post(soloPath(MISSING_ID)));
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("EVENT_NOT_FOUND");
  });

  it("rejects a team event with TEAM_REGISTRATION_REQUIRED", async () => {
    const teamEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventType: "team", minimumTeamSize: 2, maximumTeamSize: 4, eventSlug: "team-e" })
    );
    const response = await asParticipant(request(application).post(soloPath(teamEvent.id)));

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("TEAM_REGISTRATION_REQUIRED");
  });

  it("throws EVENT_FULL once capacity is exhausted", async () => {
    const smallEvent = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "small", capacity: 1 })
    );
    const second = await createTestParticipant(college, { emailAddress: "second@example.com" });
    await asParticipant(request(application).post(soloPath(smallEvent.id)));

    const response = await request(application)
      .post(soloPath(smallEvent.id))
      .set("Authorization", `Bearer ${second.authenticationToken}`);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("EVENT_FULL");
  });
});

describe("food and accommodation preferences on solo registration", () => {
  async function eventInFestWith(overrides, slug) {
    const preferenceFest = await createTestFest(college, admin.user, {
      status: "published",
      festSlug: `${slug}-fest`,
      ...overrides,
    });
    return createTestEvent(
      preferenceFest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: `${slug}-event` })
    );
  }

  function rowFor(eventDoc) {
    return RegistrationModel.findOne({ eventId: eventDoc._id, userId: participant.user._id });
  }

  it("stores the submitted food preference when the fest offers food", async () => {
    const foodEvent = await eventInFestWith({ offers: [{ offerName: "Food", offerKey: "food", requiresQuantity: true, isActive: true }] }, "food-on");

    const response = await asParticipant(request(application).post(soloPath(foodEvent.id))).send({
      foodPreference: "veg",
    });

    expect(response.status).toBe(201);
    expect((await rowFor(foodEvent)).foodPreference).toBe("veg");
  });

  it("rejects when the fest offers food but no preference is sent", async () => {
    const foodEvent = await eventInFestWith({ offers: [{ offerName: "Food", offerKey: "food", requiresQuantity: true, isActive: true }] }, "food-req");

    const response = await asParticipant(request(application).post(soloPath(foodEvent.id))).send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("FOOD_PREFERENCE_REQUIRED");
  });

  it("stores null food preference when the fest does not offer food", async () => {
    // The beforeEach fest leaves offersFood at its false default.
    const response = await asParticipant(request(application).post(soloPath(event.id))).send({});

    expect(response.status).toBe(201);
    expect((await rowFor(event)).foodPreference).toBe(null);
  });

  it("stores the submitted accommodation need when the fest offers accommodation", async () => {
    const accommodationEvent = await eventInFestWith({ offers: [{ offerName: "Accommodation", offerKey: "accommodation", isActive: true }] }, "acc-on");

    const response = await asParticipant(
      request(application).post(soloPath(accommodationEvent.id))
    ).send({ needsAccommodation: true });

    expect(response.status).toBe(201);
    expect((await rowFor(accommodationEvent)).needsAccommodation).toBe(true);
  });

  it("rejects when the fest offers accommodation but no answer is sent", async () => {
    const accommodationEvent = await eventInFestWith({ offers: [{ offerName: "Accommodation", offerKey: "accommodation", isActive: true }] }, "acc-req");

    const response = await asParticipant(
      request(application).post(soloPath(accommodationEvent.id))
    ).send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("ACCOMMODATION_PREFERENCE_REQUIRED");
  });

  it("stores null accommodation need when the fest does not offer accommodation", async () => {
    const response = await asParticipant(request(application).post(soloPath(event.id))).send({});

    expect(response.status).toBe(201);
    expect((await rowFor(event)).needsAccommodation).toBe(null);
  });
});

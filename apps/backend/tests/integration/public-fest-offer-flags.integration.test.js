import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { RegistrationModel } from "../../src/models/registration-model.js";
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

installEmailServiceMock();
installRazorpayClientMock();
const { application } = await import("../../src/application.js");

/*
 * THE ON-DEVICE BUG, pinned.
 *
 * A participant selected VEG (and then NO MEAL NEEDED, and NON-VEG) on a fest
 * whose offers include food, and every submit came back "a food preference is
 * required". The chips were fine; the fest payload was not.
 *
 * The registration form reads its fest from GET /public/fests (the LIST), and
 * that projection returned a bare fest.toJSON() — so the derived
 * offersFood/offersAccommodation booleans the participant app gates those
 * questions on were ABSENT, while GET /public/fests/:festId (the DETAIL) had
 * them. A client that trusted the flag therefore never sent the answer, and the
 * backend — which reads the offers array, not the flag — refused the
 * registration. Nothing about this is iOS-specific: it fails on every browser.
 *
 * These tests lock the two halves together: the list and the detail must agree,
 * and a registration that omits the answer must still fail loudly (that guard is
 * correct and stays).
 */
let college;
let admin;
let fest;
let participant;

function withToken(httpRequest, token) {
  return httpRequest.set("Authorization", `Bearer ${token}`);
}

const FOOD_AND_STAY_OFFERS = [
  { offerName: "Food", offerKey: "food", isActive: true, isPaid: false, ratePaise: 0 },
  { offerName: "Accommodation", offerKey: "accommodation", isActive: true, isPaid: false, ratePaise: 0 },
  { offerName: "Travel", offerKey: "travel", isActive: true, isPaid: false, ratePaise: 0 },
];

beforeAll(async () => {
  await setupTestDatabase();
  await RegistrationModel.createIndexes();
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, {
    status: "published",
    visibility: "public",
    offers: FOOD_AND_STAY_OFFERS,
  });
  participant = await createTestParticipant(college, {
    emailAddress: "flags@example.com",
    usn: "1FL00AA001",
  });
});

afterAll(teardownTestDatabase);

describe("public fest payload — reserved offer flags", () => {
  it("the fest LIST derives offersFood/offersAccommodation, exactly as the detail does", async () => {
    const listResponse = await request(application).get("/api/v1/public/fests");
    expect(listResponse.status).toBe(200);
    const listedFest = listResponse.body.data.find((row) => row.id === fest.id);
    expect(listedFest).toBeDefined();
    // The regression: these were undefined on the list projection.
    expect(listedFest.offersFood).toBe(true);
    expect(listedFest.offersAccommodation).toBe(true);

    const detailResponse = await request(application).get(`/api/v1/public/fests/${fest.id}`);
    expect(detailResponse.body.data.offersFood).toBe(listedFest.offersFood);
    expect(detailResponse.body.data.offersAccommodation).toBe(listedFest.offersAccommodation);
    // Both carry the offers array itself, so a client can derive the flags too.
    expect(listedFest.offers).toHaveLength(3);
  });

  it("a fest with no food offer reports offersFood false on the list", async () => {
    const bareFest = await createTestFest(college, admin.user, {
      festName: "No Offers Fest",
      festSlug: "no-offers-fest",
      status: "published",
      visibility: "public",
      offers: [],
    });
    const listResponse = await request(application).get("/api/v1/public/fests");
    const listedFest = listResponse.body.data.find((row) => row.id === bareFest.id);
    expect(listedFest.offersFood).toBe(false);
    expect(listedFest.offersAccommodation).toBe(false);
  });

  it("an inactive food offer does not claim the fest offers food", async () => {
    const inactiveFest = await createTestFest(college, admin.user, {
      festName: "Inactive Food Fest",
      festSlug: "inactive-food-fest",
      status: "published",
      visibility: "public",
      offers: [{ offerName: "Food", offerKey: "food", isActive: false, isPaid: false, ratePaise: 0 }],
    });
    const listResponse = await request(application).get("/api/v1/public/fests");
    const listedFest = listResponse.body.data.find((row) => row.id === inactiveFest.id);
    expect(listedFest.offersFood).toBe(false);
  });
});

describe("the registration guard the missing flag tripped", () => {
  it("omitting foodPreference on a food-offering fest is refused (the on-device symptom)", async () => {
    const event = await createTestEvent(
      fest,
      admin.user,
      openRegistrationOverrides({ eventType: "solo", eventSlug: "flags-solo" })
    );
    const response = await withToken(
      request(application).post(`/api/v1/events/${event.id}/registrations/solo`),
      participant.authenticationToken
    ).send({ needsAccommodation: false });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("FOOD_PREFERENCE_REQUIRED");
    expect(response.body.error.message).toMatch(/food preference is required/);
  });

  it("each of the three preferences submits successfully when actually sent", async () => {
    for (const [index, foodPreference] of ["veg", "nonVeg", "noMealNeeded"].entries()) {
      const event = await createTestEvent(
        fest,
        admin.user,
        openRegistrationOverrides({ eventType: "solo", eventSlug: `flags-solo-${index}` })
      );
      const eachParticipant = await createTestParticipant(college, {
        emailAddress: `flags-${index}@example.com`,
        usn: `1FL00AB00${index}`,
      });
      const response = await withToken(
        request(application).post(`/api/v1/events/${event.id}/registrations/solo`),
        eachParticipant.authenticationToken
      ).send({ foodPreference, needsAccommodation: false });

      expect(response.status).toBe(201);
      expect(response.body.data.registration.foodPreference).toBe(foodPreference);
    }
  });
});

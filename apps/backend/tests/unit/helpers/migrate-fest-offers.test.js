import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { FestModel } from "../../../src/models/fest-model.js";
import { migrateFestOffers } from "../../../src/helpers/migrate-fest-offers.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

const hostCollegeId = new mongoose.Types.ObjectId();
const createdByUserId = new mongoose.Types.ObjectId();

function buildRawFest(overrides = {}) {
  return {
    festName: "Legacy Fest",
    festSlug: `legacy-fest-${Math.floor(Math.random() * 100000)}`,
    hostCollegeId,
    createdByUserId,
    startsOn: new Date("2027-03-01T00:00:00.000Z"),
    endsOn: new Date("2027-03-05T00:00:00.000Z"),
    visibility: "public",
    status: "published",
    offers: [],
    ...overrides,
  };
}

beforeAll(setupTestDatabase);
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

describe("migrateFestOffers", () => {
  it("converts both booleans to two offers, unsets the booleans, and is idempotent", async () => {
    // Written raw: the schema no longer carries the booleans.
    await FestModel.collection.insertOne(
      buildRawFest({ offersFood: true, offersAccommodation: true })
    );

    const convertedCount = await migrateFestOffers();
    expect(convertedCount).toBe(1);

    const migrated = await FestModel.collection.findOne({});
    expect(migrated.offersFood).toBeUndefined();
    expect(migrated.offersAccommodation).toBeUndefined();
    expect(migrated.offers).toHaveLength(2);
    const byKey = Object.fromEntries(migrated.offers.map((offer) => [offer.offerKey, offer]));
    expect(byKey.food.offerName).toBe("Food");
    expect(byKey.food.requiresQuantity).toBe(true);
    expect(byKey.accommodation.offerName).toBe("Accommodation");
    expect(byKey.accommodation.requiresQuantity).toBe(false);

    // Second run: the booleans are gone, so nothing matches and nothing is added.
    const secondRunCount = await migrateFestOffers();
    expect(secondRunCount).toBe(0);
    const untouched = await FestModel.collection.findOne({});
    expect(untouched.offers).toHaveLength(2);
  });

  it("leaves a boolean-false fest with no offers and no booleans", async () => {
    await FestModel.collection.insertOne(
      buildRawFest({ offersFood: false, offersAccommodation: false })
    );
    const convertedCount = await migrateFestOffers();
    expect(convertedCount).toBe(1);
    const migrated = await FestModel.collection.findOne({});
    expect(migrated.offers).toHaveLength(0);
    expect(migrated.offersFood).toBeUndefined();
  });
});

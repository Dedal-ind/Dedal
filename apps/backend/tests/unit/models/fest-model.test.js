import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { FestModel } from "../../../src/models/fest-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

const hostCollegeId = new mongoose.Types.ObjectId();
const createdByUserId = new mongoose.Types.ObjectId();
const allowedCollegeId = new mongoose.Types.ObjectId();

function buildFest(overrides = {}) {
  return {
    festName: "Alliance ONE 2027",
    festSlug: "alliance-one-2027",
    hostCollegeId,
    startsOn: new Date("2027-03-01T00:00:00.000Z"),
    endsOn: new Date("2027-03-05T00:00:00.000Z"),
    visibility: "intraCollege",
    createdByUserId,
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDatabase();
  await FestModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

describe("FestModel schema", () => {
  it("requires the core fields", async () => {
    await expect(FestModel.create({})).rejects.toThrow(/festName|festSlug|hostCollegeId/);
  });

  it("lowercases the slug and defaults status, description and archivedAt", async () => {
    const fest = await FestModel.create(buildFest({ festSlug: "ALLIANCE-ONE" }));

    expect(fest.festSlug).toBe("alliance-one");
    expect(fest.status).toBe("draft");
    expect(fest.description).toBe(null);
    expect(fest.archivedAt).toBe(null);
    expect(fest.allowedCollegeIds).toEqual([]);
  });

  it("rejects a visibility or status outside its enum", async () => {
    await expect(FestModel.create(buildFest({ visibility: "secret" }))).rejects.toThrow(
      /visibility/
    );
    await expect(FestModel.create(buildFest({ status: "retired" }))).rejects.toThrow(/status/);
  });
});

describe("FestModel cross-field hook", () => {
  it("accepts a fest that ends after it starts", async () => {
    await expect(FestModel.create(buildFest())).resolves.toBeDefined();
  });

  it("accepts a fest that starts and ends on the same instant", async () => {
    const sameMoment = new Date("2027-03-01T00:00:00.000Z");
    await expect(
      FestModel.create(buildFest({ startsOn: sameMoment, endsOn: sameMoment }))
    ).resolves.toBeDefined();
  });

  it("invalidates a fest that ends before it starts", async () => {
    await expect(
      FestModel.create(buildFest({ endsOn: new Date("2027-02-01T00:00:00.000Z") }))
    ).rejects.toThrow(/endsOn must be on or after startsOn/);
  });

  it("requires an interCollege fest to list at least one allowed college", async () => {
    await expect(FestModel.create(buildFest({ visibility: "interCollege" }))).rejects.toThrow(
      /interCollege fest requires at least one allowed college/
    );
  });

  it("accepts an interCollege fest that lists allowed colleges", async () => {
    await expect(
      FestModel.create(
        buildFest({ visibility: "interCollege", allowedCollegeIds: [allowedCollegeId] })
      )
    ).resolves.toBeDefined();
  });

  it("forbids a non-interCollege fest from listing allowed colleges", async () => {
    for (const visibility of ["intraCollege", "public"]) {
      await expect(
        FestModel.create(buildFest({ visibility, allowedCollegeIds: [allowedCollegeId] }))
      ).rejects.toThrow(new RegExp(`A ${visibility} fest must not list allowed colleges`));
    }
  });

  it("invalidates a contact email that is not an email", async () => {
    await expect(FestModel.create(buildFest({ contactEmail: "nope" }))).rejects.toThrow(
      /contactEmail is not a valid email address/
    );
  });

  /* invalidate() collects every complaint into one ValidationError. */
  it("names every broken invariant at once", async () => {
    const error = await FestModel.create(
      buildFest({
        endsOn: new Date("2027-02-01T00:00:00.000Z"),
        visibility: "interCollege",
        contactEmail: "nope",
      })
    ).catch((caughtError) => caughtError);

    expect(Object.keys(error.errors).sort()).toEqual([
      "allowedCollegeIds",
      "contactEmail",
      "endsOn",
    ]);
  });
});

describe("FestModel indexes", () => {
  it("declares the three named indexes, with a globally unique slug", async () => {
    const indexes = await FestModel.collection.indexes();
    const slugIndex = indexes.find((index) => index.name === "index_fests_festSlug");

    expect(slugIndex.unique).toBe(true);
    const indexNames = indexes.map((index) => index.name);
    expect(indexNames).toContain("index_fests_hostCollegeId_status");
    expect(indexNames).toContain("index_fests_startsOn");
  });

  it("rejects a duplicate slug even across different colleges", async () => {
    await FestModel.create(buildFest());
    await expect(
      FestModel.create(buildFest({ hostCollegeId: new mongoose.Types.ObjectId() }))
    ).rejects.toMatchObject({ code: 11000 });
  });
});

describe("FestModel offers", () => {
  const foodOffer = { offerName: "Food", offerKey: "food", requiresQuantity: true };

  it("gives each offer subdocument a stable _id", async () => {
    const fest = await FestModel.create(
      buildFest({ offers: [foodOffer, { offerName: "Merch Desk", offerKey: "merch-desk" }] })
    );
    expect(fest.offers).toHaveLength(2);
    for (const offer of fest.offers) {
      expect(offer._id).toBeInstanceOf(mongoose.Types.ObjectId);
    }
    const reloaded = await FestModel.findById(fest._id);
    expect(String(reloaded.offers[0]._id)).toBe(String(fest.offers[0]._id));
  });

  it("rejects a duplicate offerKey within one fest", async () => {
    await expect(
      FestModel.create(
        buildFest({ offers: [foodOffer, { offerName: "Food Two", offerKey: "food" }] })
      )
    ).rejects.toThrow(/offerKey must be unique/);
  });

  it("rejects more than 12 offers", async () => {
    const offers = Array.from({ length: 13 }, (unused, index) => ({
      offerName: `Offer ${index}`,
      offerKey: `offer-${index}`,
    }));
    await expect(FestModel.create(buildFest({ offers }))).rejects.toThrow(/more than 12 offers/);
  });
});

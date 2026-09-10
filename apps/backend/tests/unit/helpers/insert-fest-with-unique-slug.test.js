import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";
import { FestModel } from "../../../src/models/fest-model.js";
import { insertFestWithUniqueSlug } from "../../../src/helpers/insert-fest-with-unique-slug.js";
import { FEST_SLUG_MAXIMUM_ATTEMPTS } from "../../../src/constants/fest-constants.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

const hostCollegeId = new mongoose.Types.ObjectId();
const createdByUserId = new mongoose.Types.ObjectId();
const BASE_SLUG = "alliance-one";

function buildFestAttributes() {
  return {
    festName: "Alliance ONE",
    hostCollegeId,
    startsOn: new Date("2027-03-01T00:00:00.000Z"),
    endsOn: new Date("2027-03-05T00:00:00.000Z"),
    visibility: "intraCollege",
    createdByUserId,
  };
}

/* Occupies base, base-2 … base-N so the next insert must walk past them. */
async function occupySlugs(count) {
  for (let attempt = 1; attempt <= count; attempt += 1) {
    const festSlug = attempt === 1 ? BASE_SLUG : `${BASE_SLUG}-${attempt}`;
    await FestModel.create({ ...buildFestAttributes(), festSlug });
  }
}

beforeAll(async () => {
  await setupTestDatabase();
  await FestModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

describe("insertFestWithUniqueSlug", () => {
  it("uses the base slug when it is free", async () => {
    const fest = await insertFestWithUniqueSlug(buildFestAttributes(), BASE_SLUG);
    expect(fest.festSlug).toBe(BASE_SLUG);
  });

  it("walks to the next numbered slug when the base is taken", async () => {
    await occupySlugs(1);
    const fest = await insertFestWithUniqueSlug(buildFestAttributes(), BASE_SLUG);
    expect(fest.festSlug).toBe(`${BASE_SLUG}-2`);
  });

  it("uses the last numbered slug when every earlier one is taken", async () => {
    await occupySlugs(FEST_SLUG_MAXIMUM_ATTEMPTS - 1);
    const fest = await insertFestWithUniqueSlug(buildFestAttributes(), BASE_SLUG);
    expect(fest.festSlug).toBe(`${BASE_SLUG}-${FEST_SLUG_MAXIMUM_ATTEMPTS}`);
  });

  /*
   * B7: the loop swallows one E11000 per attempt. Without keeping the last one,
   * the final failure says the slug was contested but not what Mongo reported.
   */
  it("gives up after the capped number of attempts, carrying the original error", async () => {
    await occupySlugs(FEST_SLUG_MAXIMUM_ATTEMPTS);

    const error = await insertFestWithUniqueSlug(buildFestAttributes(), BASE_SLUG).catch(
      (caughtError) => caughtError
    );

    expect(error.statusCode).toBe(500);
    expect(error.errorCode).toBe("INTERNAL_ERROR");
    expect(error.details.contestedSlug).toBe(BASE_SLUG);
    expect(error.details.attemptCount).toBe(FEST_SLUG_MAXIMUM_ATTEMPTS);
    expect(error.details.originalErrorMessage).toMatch(/E11000|duplicate key/i);
  });

  it("never walks past the cap", async () => {
    await occupySlugs(FEST_SLUG_MAXIMUM_ATTEMPTS);
    await insertFestWithUniqueSlug(buildFestAttributes(), BASE_SLUG).catch(() => null);

    const overflow = await FestModel.countDocuments({
      festSlug: `${BASE_SLUG}-${FEST_SLUG_MAXIMUM_ATTEMPTS + 1}`,
    });
    expect(overflow).toBe(0);
    expect(await FestModel.countDocuments()).toBe(FEST_SLUG_MAXIMUM_ATTEMPTS);
  });

  it("propagates an error that is not a slug collision", async () => {
    const attributes = { ...buildFestAttributes(), visibility: "not-a-visibility" };
    await expect(insertFestWithUniqueSlug(attributes, BASE_SLUG)).rejects.toThrow(/visibility/);
  });
});

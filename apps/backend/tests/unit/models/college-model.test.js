import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { CollegeModel } from "../../../src/models/college-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import { createTestCollege } from "../../setup/create-test-fixtures.js";

beforeAll(async () => {
  await setupTestDatabase();
  await CollegeModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

describe("CollegeModel schema", () => {
  it("requires collegeName, commonName, city and state", async () => {
    await expect(CollegeModel.create({})).rejects.toThrow(
      /collegeName|commonName|city|state/
    );
  });

  it("uppercases the usn prefix and lowercases the contact email", async () => {
    const college = await createTestCollege({
      usnPrefix: "  au  ",
      contactEmail: "  Contact@Example.COM ",
    });

    expect(college.usnPrefix).toBe("AU");
    expect(college.contactEmail).toBe("contact@example.com");
  });

  it("defaults the optional fields", async () => {
    const college = await createTestCollege();

    expect(college.usnPrefix).toBe(null);
    expect(college.logoUrl).toBe(null);
    expect(college.contactEmail).toBe(null);
    expect(college.isVerified).toBe(false);
    expect(college.createdByUserId).toBe(null);
    // Deliberately undefined, not null: a null would collide on the sparse index.
    expect(college.aisheCode).toBeUndefined();
  });
});

describe("CollegeModel pre-validate hook", () => {
  it("passes a document whose contact email is valid", async () => {
    await expect(createTestCollege({ contactEmail: "ok@example.com" })).resolves.toBeDefined();
  });

  it("passes a document with no contact email at all", async () => {
    await expect(createTestCollege({ contactEmail: null })).resolves.toBeDefined();
  });

  it("invalidates a contact email that is not an email", async () => {
    await expect(createTestCollege({ contactEmail: "not-an-email" })).rejects.toThrow(
      /contactEmail is not a valid email address/
    );
  });
});

describe("CollegeModel indexes", () => {
  it("declares all three named indexes", async () => {
    const indexNames = (await CollegeModel.collection.indexes()).map((index) => index.name);

    expect(indexNames).toContain("index_colleges_commonName");
    expect(indexNames).toContain("index_colleges_aisheCode");
    expect(indexNames).toContain("index_colleges_usnPrefix");
  });

  it("makes the aishe code index unique and sparse", async () => {
    const indexes = await CollegeModel.collection.indexes();
    const aisheIndex = indexes.find((index) => index.name === "index_colleges_aisheCode");

    expect(aisheIndex.unique).toBe(true);
    expect(aisheIndex.sparse).toBe(true);
  });

  it("rejects a duplicate aishe code", async () => {
    await createTestCollege({ aisheCode: "C-1234" });
    await expect(createTestCollege({ aisheCode: "C-1234" })).rejects.toMatchObject({ code: 11000 });
  });

  /*
   * The reason aisheCode has no `default: null`: a sparse index skips absent
   * fields but not explicitly-null ones, so two code-less colleges must coexist.
   */
  it("allows many colleges that carry no aishe code", async () => {
    await createTestCollege({ commonName: "First" });
    await expect(createTestCollege({ commonName: "Second" })).resolves.toBeDefined();
    expect(await CollegeModel.countDocuments()).toBe(2);
  });
});

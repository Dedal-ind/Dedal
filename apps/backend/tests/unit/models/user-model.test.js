import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { UserModel } from "../../../src/models/user-model.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

beforeAll(async () => {
  await setupTestDatabase();
  await UserModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

describe("UserModel schema", () => {
  it("requires an email address", async () => {
    await expect(UserModel.create({})).rejects.toThrow(/emailAddress/);
  });

  it("rejects an email address that is not an email", async () => {
    await expect(UserModel.create({ emailAddress: "not-an-email" })).rejects.toThrow(
      /Email address is not valid/
    );
  });

  it("lowercases and trims the email address", async () => {
    const user = await UserModel.create({ emailAddress: "  Person@Example.COM  " });
    expect(user.emailAddress).toBe("person@example.com");
  });

  it("uppercases the usn and defaults the optional fields", async () => {
    const user = await UserModel.create({ emailAddress: "a@example.com", usn: "  ab1cd2  " });

    expect(user.usn).toBe("AB1CD2");
    expect(user.fullName).toBe(null);
    expect(user.collegeId).toBe(null);
    expect(user.emailVerifiedAt).toBe(null);
    expect(user.isProfileComplete).toBe(false);
  });
});

describe("UserModel indexes", () => {
  it("declares the named unique email index exactly once", async () => {
    const indexes = await UserModel.collection.indexes();
    const emailIndexes = indexes.filter((index) => index.name === "index_users_emailAddress");

    expect(emailIndexes).toHaveLength(1);
    expect(emailIndexes[0].unique).toBe(true);
    // A field-level `unique: true` would have added a second, auto-named index.
    expect(indexes.some((index) => index.name === "emailAddress_1")).toBe(false);
  });

  it("rejects a duplicate email address", async () => {
    await UserModel.create({ emailAddress: "duplicate@example.com" });
    await expect(UserModel.create({ emailAddress: "duplicate@example.com" })).rejects.toMatchObject(
      { code: 11000 }
    );
  });

  it("treats a differently-cased duplicate as the same address", async () => {
    await UserModel.create({ emailAddress: "person@example.com" });
    await expect(UserModel.create({ emailAddress: "PERSON@EXAMPLE.COM" })).rejects.toMatchObject({
      code: 11000,
    });
  });
});

describe("recomputeIsProfileComplete", () => {
  it("is false until fullName, collegeId and usn are all present", async () => {
    const user = await UserModel.create({ emailAddress: "a@example.com" });

    expect(user.recomputeIsProfileComplete()).toBe(false);

    user.fullName = "A Person";
    expect(user.recomputeIsProfileComplete()).toBe(false);

    user.usn = "AB1CD2";
    expect(user.recomputeIsProfileComplete()).toBe(false);
  });

  it("is true once every summarised field is present, and writes the flag", async () => {
    const user = await UserModel.create({ emailAddress: "a@example.com" });
    user.fullName = "A Person";
    user.usn = "AB1CD2";
    user.collegeId = user._id;
    // phoneNumber joined the completeness rule when it became a required
    // profile field — complete means callable at the venue, too.
    user.phoneNumber = "9876543210";

    expect(user.recomputeIsProfileComplete()).toBe(true);
    expect(user.isProfileComplete).toBe(true);
  });
});

describe("UserModel toJSON", () => {
  it("exposes id, drops _id and __v", async () => {
    const user = await UserModel.create({ emailAddress: "a@example.com" });
    const plainObject = user.toJSON();

    expect(plainObject.id).toBe(user._id.toString());
    expect(plainObject._id).toBeUndefined();
    expect(plainObject.__v).toBeUndefined();
  });
});

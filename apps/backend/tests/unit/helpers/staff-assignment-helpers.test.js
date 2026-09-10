import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { UserModel } from "../../../src/models/user-model.js";
import { findOrCreateUserByEmailAddress } from "../../../src/helpers/staff-assignment-helpers.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

beforeAll(async () => {
  await setupTestDatabase();
  // The unique emailAddress index must exist for the losing racer's insert to collide.
  await UserModel.createIndexes();
});
beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

describe("findOrCreateUserByEmailAddress", () => {
  it("resolves two racers to one user, with exactly one winner", async () => {
    // The address is already lowercased by the contract at the call sites.
    const emailAddress = "brandnew@example.com";

    const [first, second] = await Promise.all([
      findOrCreateUserByEmailAddress(emailAddress),
      findOrCreateUserByEmailAddress(emailAddress),
    ]);

    expect(String(first.user._id)).toBe(String(second.user._id));
    // Exactly one caller created the row; the other re-read it as the loser.
    expect(first.wasCreated).not.toBe(second.wasCreated);
    expect(await UserModel.countDocuments({ emailAddress })).toBe(1);
  });
});

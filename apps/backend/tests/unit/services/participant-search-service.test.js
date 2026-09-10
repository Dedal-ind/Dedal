import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PassModel } from "../../../src/models/pass-model.js";
import { UserModel } from "../../../src/models/user-model.js";
import participantSearchService from "../../../src/services/participant-search-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestAdministrator,
  createTestOutsider,
  createTestFest,
  createTestParticipant,
  createTestPass,
} from "../../setup/create-test-fixtures.js";

let college;
let admin;
let fest;

async function seedParticipantWithPass(overrides) {
  const participant = await createTestParticipant(college, overrides);
  await createTestPass(fest, participant.user);
  return participant;
}

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([UserModel.createIndexes(), PassModel.createIndexes()]);
});

beforeEach(async () => {
  await clearAllCollections();
  college = await createTestCollege();
  admin = await createTestAdministrator(college);
  fest = await createTestFest(college, admin.user, { status: "published" });
});

afterAll(teardownTestDatabase);

describe("searchParticipants", () => {
  it("matches by case-insensitive name prefix", async () => {
    await seedParticipantWithPass({
      emailAddress: "asha@example.com",
      fullName: "Asha Rao",
      usn: "1AA00CS001",
    });
    await seedParticipantWithPass({
      emailAddress: "bimal@example.com",
      fullName: "Bimal Nair",
      usn: "1AA00CS002",
    });

    const results = await participantSearchService.searchParticipants(admin.user._id, {
      query: "ash",
      festId: fest.id,
    });

    expect(results).toHaveLength(1);
    expect(results[0].fullName).toBe("Asha Rao");
    expect(results[0].passId).toBeTruthy();
  });

  it("matches by USN prefix regardless of case", async () => {
    await seedParticipantWithPass({
      emailAddress: "asha@example.com",
      fullName: "Asha Rao",
      usn: "1AA00CS001",
    });

    const results = await participantSearchService.searchParticipants(admin.user._id, {
      query: "1aa00cs001",
      festId: fest.id,
    });

    expect(results).toHaveLength(1);
    expect(results[0].usn).toBe("1AA00CS001");
  });

  it("returns an empty list when nothing matches", async () => {
    await seedParticipantWithPass({
      emailAddress: "asha@example.com",
      fullName: "Asha Rao",
      usn: "1AA00CS001",
    });

    const results = await participantSearchService.searchParticipants(admin.user._id, {
      query: "zzz",
      festId: fest.id,
    });
    expect(results).toEqual([]);
  });

  it("refuses a caller who is not staff of the fest", async () => {
    const outsider = await createTestOutsider();
    await expect(
      participantSearchService.searchParticipants(outsider.user._id, { query: "a", festId: fest.id })
    ).rejects.toMatchObject({ statusCode: 403, errorCode: "PERMISSION_DENIED" });
  });

  it("rejects an empty query", async () => {
    await expect(
      participantSearchService.searchParticipants(admin.user._id, { query: "  ", festId: fest.id })
    ).rejects.toMatchObject({ statusCode: 400, errorCode: "VALIDATION_FAILED" });
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose from "mongoose";

import {
  DailyCapLedgerModel,
  FlightCapLedgerModel,
} from "../../../src/models/frequency-cap-ledger-model.js";
import { recordImpression, readCounts, dailyExpiryFor } from "../../../src/services/frequency-cap-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([DailyCapLedgerModel.createIndexes(), FlightCapLedgerModel.createIndexes()]);
});

beforeEach(clearAllCollections);
afterAll(teardownTestDatabase);

describe("the frequency cap ledger", () => {
  it("counts concurrent increments exactly, and sets the expiry once — it does not move on later increments", async () => {
    const campaignId = new mongoose.Types.ObjectId();
    const subjectKey = "user:abc";
    const flightEndsAt = new Date(Date.now() + 10 * DAY);
    const firstAt = new Date();

    // Twenty simultaneous impressions on one participant-campaign-day.
    await Promise.all(
      Array.from({ length: 20 }, () =>
        recordImpression({ subjectKey, campaignId, flightEndsAt, at: firstAt })
      )
    );

    const dailyRows = await DailyCapLedgerModel.find({ subjectKey, campaignId }).lean();
    expect(dailyRows).toHaveLength(1);
    expect(dailyRows[0].count).toBe(20);
    expect(dailyRows[0].expiresAt).toEqual(dailyExpiryFor(firstAt));
    const flightRows = await FlightCapLedgerModel.find({ subjectKey, campaignId }).lean();
    expect(flightRows).toHaveLength(1);
    expect(flightRows[0].count).toBe(20);
    const flightExpiry = flightRows[0].expiresAt;

    // A later increment, same day, with a DIFFERENT "at" and a different
    // flight end: the counts move, the expiries do not.
    const laterAt = new Date(firstAt.getTime() + 60 * 60 * 1000);
    const result = await recordImpression({
      subjectKey,
      campaignId,
      flightEndsAt: new Date(flightEndsAt.getTime() + 30 * DAY),
      at: laterAt,
    });
    expect(result).toMatchObject({ dailyCount: 21, flightCount: 21 });
    const dailyAfter = await DailyCapLedgerModel.findOne({ subjectKey, campaignId }).lean();
    expect(dailyAfter.expiresAt).toEqual(dailyExpiryFor(firstAt));
    const flightAfter = await FlightCapLedgerModel.findOne({ subjectKey, campaignId }).lean();
    expect(flightAfter.expiresAt).toEqual(flightExpiry);

    // The read the engine uses sees the same numbers, and nothing for another campaign.
    const counts = await readCounts({
      subjectKey,
      campaignIds: [campaignId, new mongoose.Types.ObjectId()],
      at: laterAt,
    });
    expect(counts.get(String(campaignId))).toEqual({ daily: 21, flight: 21 });
    expect([...counts.values()][1]).toEqual({ daily: 0, flight: 0 });
  });

  it("keeps one daily row per calendar day and one flight row across days", async () => {
    const campaignId = new mongoose.Types.ObjectId();
    const subjectKey = "session:s1";
    const flightEndsAt = new Date(Date.now() + 10 * DAY);
    const today = new Date();
    const tomorrow = new Date(today.getTime() + DAY);

    await recordImpression({ subjectKey, campaignId, flightEndsAt, at: today });
    await recordImpression({ subjectKey, campaignId, flightEndsAt, at: tomorrow });
    await recordImpression({ subjectKey, campaignId, flightEndsAt, at: tomorrow });

    expect(await DailyCapLedgerModel.countDocuments({ subjectKey, campaignId })).toBe(2);
    expect((await readCounts({ subjectKey, campaignIds: [campaignId], at: today })).get(String(campaignId))).toEqual({ daily: 1, flight: 3 });
    expect((await readCounts({ subjectKey, campaignIds: [campaignId], at: tomorrow })).get(String(campaignId))).toEqual({ daily: 2, flight: 3 });
  });

  it("carries TTL indexes so rows expire without a sweep", async () => {
    const dailyIndexes = await DailyCapLedgerModel.collection.indexes();
    const flightIndexes = await FlightCapLedgerModel.collection.indexes();
    expect(dailyIndexes.find((index) => index.name === "index_dailyCapLedger_expiresAt_ttl").expireAfterSeconds).toBe(0);
    expect(flightIndexes.find((index) => index.name === "index_flightCapLedger_expiresAt_ttl").expireAfterSeconds).toBe(0);
    expect(dailyIndexes.find((index) => index.name === "index_dailyCapLedger_subjectKey_campaignId_day").unique).toBe(true);
  });
});

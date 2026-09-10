import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";

import { application } from "../../../src/application.js";
import { AnonymousSessionModel } from "../../../src/models/anonymous-session-model.js";
import { PlacementModel } from "../../../src/models/placement-model.js";
import { CampaignModel } from "../../../src/models/campaign-model.js";
import { CampaignCreativeModel } from "../../../src/models/campaign-creative-model.js";
import { DecisionTokenModel } from "../../../src/models/decision-token-model.js";
import campaignService from "../../../src/services/campaign-service.js";
import { recordImpression } from "../../../src/services/frequency-cap-service.js";
import {
  establishAnonymousSession,
  ANONYMOUS_SESSION_TTL_SECONDS,
} from "../../../src/services/anonymous-session-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestParticipant,
  createTestUser,
} from "../../setup/create-test-fixtures.js";

const DAY = 24 * 60 * 60 * 1000;
const HOME = "homeCarousel";

let admin;
let sponsor;
let college;
/* A participant with NO date of birth: unknown age, the minor path. */
let unknownAge;

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    AnonymousSessionModel.createIndexes(),
    PlacementModel.createIndexes(),
    CampaignModel.createIndexes(),
    CampaignCreativeModel.createIndexes(),
    DecisionTokenModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  await campaignService.ensurePlacements();
  admin = await createTestUser({ emailAddress: "owner@example.com" });
  sponsor = await campaignService.createPromoter(admin._id, { displayName: "Acme", kind: "sponsor" });
  college = await createTestCollege({ isVerified: true });
  unknownAge = await createTestParticipant(college);
});

afterAll(teardownTestDatabase);

async function liveCampaign(overrides = {}) {
  const campaign = await campaignService.createCampaign(admin._id, {
    promoterId: sponsor._id,
    name: overrides.name ?? "Campaign",
    placementKeys: [HOME],
    flightStartsAt: new Date(Date.now() - DAY),
    flightEndsAt: new Date(Date.now() + 5 * DAY),
    ...overrides,
  });
  const creative = await campaignService.createCreative(admin._id, {
    promoterId: sponsor._id,
    title: "Art",
    imageUrl: "https://example.com/art.png",
  });
  await campaignService.attachCreative(admin._id, campaign._id, { creativeId: creative._id });
  return campaignService.publishCampaign(admin._id, campaign._id);
}

function decisionRequest(token, sessionKey) {
  const pending = request(application)
    .get(`/api/v1/decisions?placement=${HOME}`)
    .set("Authorization", `Bearer ${token}`);
  return sessionKey ? pending.set("X-Session-Key", sessionKey) : pending;
}

describe("the server-established anonymous session key", () => {
  it("is issued to a request that has none, and kept stable for requests that carry it", async () => {
    await liveCampaign();

    const first = await decisionRequest(unknownAge.authenticationToken);
    expect(first.status).toBe(200);
    const issued = first.headers["x-session-key"];
    expect(issued).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first.body.data.sessionKey).toBe(issued);
    expect(first.body.data.subjectKind).toBe("session");
    expect(await AnonymousSessionModel.countDocuments()).toBe(1);

    const second = await decisionRequest(unknownAge.authenticationToken, issued);
    expect(second.headers["x-session-key"]).toBe(issued);
    expect(second.body.data.sessionKey).toBe(issued);
    expect(await AnonymousSessionModel.countDocuments()).toBe(1);

    // A key the client made up is not a key: it is replaced, not adopted.
    const forged = await decisionRequest(unknownAge.authenticationToken, "A".repeat(32));
    expect(forged.headers["x-session-key"]).not.toBe("A".repeat(32));
    expect(await AnonymousSessionModel.countDocuments({ key: "A".repeat(32) })).toBe(0);

    // The decision token is bound to the session, never to the person.
    const token = await DecisionTokenModel.findOne({ token: first.body.data.decision.token }).lean();
    expect(token.subjectKey).toBe(`session:${issued}`);
    expect(token.subjectKey).not.toContain(String(unknownAge.user._id));
  });

  it("accumulates the frequency cap across requests that share a key, and not across different keys", async () => {
    const capped = await liveCampaign({ name: "capped", frequencyCap: { maxPerDay: 2 } });

    const first = await decisionRequest(unknownAge.authenticationToken);
    const key = first.headers["x-session-key"];
    expect(first.body.data.fill).toBe(true);
    // The delivery phase will do this against the token; here the impression
    // is recorded directly against the session the server established.
    await recordImpression({ subjectKey: `session:${key}`, campaignId: capped._id, flightEndsAt: capped.flightEndsAt });

    const second = await decisionRequest(unknownAge.authenticationToken, key);
    expect(second.body.data.fill).toBe(true);
    await recordImpression({ subjectKey: `session:${key}`, campaignId: capped._id, flightEndsAt: capped.flightEndsAt });

    // Third request on the same session: at the cap, no-fill.
    const third = await decisionRequest(unknownAge.authenticationToken, key);
    expect(third.body.data).toMatchObject({ fill: false, reason: "noEligibleCampaign", sessionKey: key });

    // A different session — another browser, or a new session after expiry — is not capped.
    const other = await decisionRequest(unknownAge.authenticationToken);
    expect(other.headers["x-session-key"]).not.toBe(key);
    expect(other.body.data.fill).toBe(true);
  });

  it("is random and not derivable from the participant, and an adult gets none", async () => {
    await liveCampaign();
    const keys = new Set();
    for (let round = 0; round < 5; round += 1) {
      const response = await decisionRequest(unknownAge.authenticationToken);
      const key = response.headers["x-session-key"];
      expect(key).not.toContain(String(unknownAge.user._id));
      expect(key).not.toContain(unknownAge.user.emailAddress);
      keys.add(key);
    }
    // Five mints for the same participant: five unrelated keys.
    expect(keys.size).toBe(5);

    const adult = await createTestParticipant(college, {
      emailAddress: "adult@example.com",
      dateOfBirth: new Date(Date.UTC(1995, 0, 1)),
    });
    const response = await decisionRequest(adult.authenticationToken);
    expect(response.headers["x-session-key"]).toBeUndefined();
    expect(response.body.data).toMatchObject({ subjectKind: "participant", sessionKey: null });
  });

  it("expires on its own after a fixed window: an expired key is replaced, and the row carries a TTL", async () => {
    await liveCampaign();
    const now = new Date();
    const minted = await establishAnonymousSession(undefined, now);
    expect(minted.isNew).toBe(true);
    expect(minted.expiresAt.getTime()).toBe(now.getTime() + ANONYMOUS_SESSION_TTL_SECONDS * 1000);

    // Still live one second before expiry; a presented key is kept and the
    // expiry does NOT slide.
    const beforeExpiry = new Date(minted.expiresAt.getTime() - 1000);
    const kept = await establishAnonymousSession(minted.key, beforeExpiry);
    expect(kept).toMatchObject({ key: minted.key, isNew: false, expiresAt: minted.expiresAt });

    // At expiry the key is unknown and a fresh one is minted.
    const replaced = await establishAnonymousSession(minted.key, minted.expiresAt);
    expect(replaced.isNew).toBe(true);
    expect(replaced.key).not.toBe(minted.key);

    // Over HTTP: a row already expired in the database is not honoured.
    await AnonymousSessionModel.updateOne(
      { key: minted.key },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );
    const response = await decisionRequest(unknownAge.authenticationToken, minted.key);
    expect(response.headers["x-session-key"]).not.toBe(minted.key);

    const indexes = await AnonymousSessionModel.collection.indexes();
    expect(indexes.find((index) => index.name === "index_anonymousSessions_expiresAt_ttl").expireAfterSeconds).toBe(0);
    expect(indexes.find((index) => index.name === "index_anonymousSessions_key").unique).toBe(true);
  });
});

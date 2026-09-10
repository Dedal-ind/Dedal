import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";

import { application } from "../../../src/application.js";
import { PlacementModel } from "../../../src/models/placement-model.js";
import { CampaignModel } from "../../../src/models/campaign-model.js";
import { CampaignCreativeModel } from "../../../src/models/campaign-creative-model.js";
import { RegistrationModel } from "../../../src/models/registration-model.js";
import { DecisionTokenModel } from "../../../src/models/decision-token-model.js";
import campaignService from "../../../src/services/campaign-service.js";
import decisionEngine from "../../../src/services/decision-engine-service.js";
import { recordImpression } from "../../../src/services/frequency-cap-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import {
  createTestCollege,
  createTestFest,
  createTestEvent,
  createTestParticipant,
  createTestUser,
} from "../../setup/create-test-fixtures.js";

const DAY = 24 * 60 * 60 * 1000;
const HOME = "homeCarousel";

let admin;
let sponsor;
let college;
let otherCollege;
let adult;

const flight = (now = new Date()) => ({
  flightStartsAt: new Date(now.getTime() - 5 * DAY),
  flightEndsAt: new Date(now.getTime() + 5 * DAY),
});

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
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
  college = await createTestCollege({ commonName: "Alliance", city: "Bengaluru", isVerified: true });
  otherCollege = await createTestCollege({
    collegeName: "Christ University",
    commonName: "Christ",
    city: "Mysuru",
    isVerified: true,
  });
  adult = await createTestUser({
    emailAddress: "adult@example.com",
    collegeId: college._id,
    department: "Computer Science",
    yearOfStudy: 2,
    dateOfBirth: new Date(Date.UTC(1999, 0, 1)),
  });
});

afterAll(teardownTestDatabase);

/* A published campaign with one active creative, ready to serve. */
async function liveCampaign(overrides = {}, creativeWeights = [1]) {
  const campaign = await campaignService.createCampaign(admin._id, {
    promoterId: sponsor._id,
    name: overrides.name ?? "Campaign",
    placementKeys: [HOME],
    ...flight(),
    ...overrides,
  });
  for (const rotationWeight of creativeWeights) {
    const creative = await campaignService.createCreative(admin._id, {
      promoterId: sponsor._id,
      title: `${campaign.name} art ${rotationWeight}`,
      imageUrl: `https://example.com/${campaign.name}-${rotationWeight}.png`,
    });
    await campaignService.attachCreative(admin._id, campaign._id, {
      creativeId: creative._id,
      rotationWeight,
    });
  }
  return campaignService.publishCampaign(admin._id, campaign._id);
}

async function eligibleNames(user, placementKey = HOME, now = new Date()) {
  const subject = decisionEngine.resolveSubject(user, "session-abc");
  const eligible = await decisionEngine.listEligibleCampaigns({ placementKey, user, subject, now });
  return eligible.map((entry) => entry.campaign.name).sort();
}

describe("targeting", () => {
  it("each dimension includes and excludes correctly, and an absent set constrains nothing", async () => {
    const fest = await createTestFest(college, admin, { status: "published" });
    const event = await createTestEvent(fest, admin);
    // A fest registration, inserted natively: only its (userId, eventId, status) matter here.
    await RegistrationModel.collection.insertOne({
      userId: adult._id,
      eventId: event._id,
      status: "confirmed",
    });
    const otherFest = await createTestFest(college, admin, {
      status: "published",
      festSlug: "other",
      festName: "Other",
    });

    await liveCampaign({ name: "untargeted" });
    await liveCampaign({ name: "college-in", targeting: { include: { collegeIds: [college._id] } } });
    await liveCampaign({ name: "college-out", targeting: { include: { collegeIds: [otherCollege._id] } } });
    await liveCampaign({ name: "college-excluded", targeting: { exclude: { collegeIds: [college._id] } } });
    await liveCampaign({ name: "city-in", targeting: { include: { cities: ["bengaluru"] } } });
    await liveCampaign({ name: "city-out", targeting: { include: { cities: ["Mysuru"] } } });
    await liveCampaign({ name: "city-excluded", targeting: { exclude: { cities: ["BENGALURU"] } } });
    await liveCampaign({ name: "dept-in", targeting: { include: { departments: ["computer science"] } } });
    await liveCampaign({ name: "dept-out", targeting: { include: { departments: ["Law"] } } });
    await liveCampaign({ name: "dept-excluded", targeting: { exclude: { departments: ["Computer Science"] } } });
    await liveCampaign({ name: "year-in", targeting: { include: { yearsOfStudy: [1, 2] } } });
    await liveCampaign({ name: "year-out", targeting: { include: { yearsOfStudy: [4] } } });
    await liveCampaign({ name: "year-excluded", targeting: { exclude: { yearsOfStudy: [2] } } });
    await liveCampaign({ name: "fest-in", targeting: { include: { festIds: [fest._id] } } });
    await liveCampaign({ name: "fest-out", targeting: { include: { festIds: [otherFest._id] } } });
    await liveCampaign({ name: "fest-excluded", targeting: { exclude: { festIds: [fest._id] } } });
    // Include on one dimension AND exclude on another: exclude always loses.
    await liveCampaign({
      name: "in-but-excluded",
      targeting: { include: { collegeIds: [college._id] }, exclude: { yearsOfStudy: [2] } },
    });

    expect(await eligibleNames(adult)).toEqual(
      ["untargeted", "college-in", "city-in", "dept-in", "year-in", "fest-in"].sort()
    );
  });

  it("is pure over declared attributes", () => {
    const attributes = { collegeIds: ["c1"], cities: ["bengaluru"], departments: ["law"], yearsOfStudy: ["3"], festIds: [] };
    expect(decisionEngine.evaluateTargeting({}, attributes)).toBe(true);
    expect(decisionEngine.evaluateTargeting({ include: { festIds: ["f1"] } }, attributes)).toBe(false);
    expect(decisionEngine.evaluateTargeting({ exclude: { departments: ["LAW"] } }, attributes)).toBe(false);
    expect(decisionEngine.isTargetingEmpty({ include: {}, exclude: { cities: [] } })).toBe(true);
  });
});

describe("the age gate", () => {
  it("shows an under-eighteen participant only untargeted campaigns, keyed to the session", async () => {
    const minor = await createTestUser({
      emailAddress: "minor@example.com",
      collegeId: college._id,
      dateOfBirth: new Date(Date.now() - 16 * 365 * DAY),
    });
    await liveCampaign({ name: "untargeted" });
    await liveCampaign({ name: "college-in", targeting: { include: { collegeIds: [college._id] } } });

    expect(await eligibleNames(minor)).toEqual(["untargeted"]);
    const subject = decisionEngine.resolveSubject(minor, "session-abc");
    expect(subject).toMatchObject({ isAgeRestricted: true, subjectKind: "session", subjectKey: "session:session-abc" });
    // An adult with the same college sees both.
    expect(await eligibleNames(adult)).toEqual(["college-in", "untargeted"]);
  });

  it("treats an unknown date of birth exactly like a minor", async () => {
    const unknown = await createTestUser({ emailAddress: "unknown@example.com", collegeId: college._id });
    await liveCampaign({ name: "untargeted" });
    await liveCampaign({ name: "college-in", targeting: { include: { collegeIds: [college._id] } } });

    expect(await eligibleNames(unknown)).toEqual(["untargeted"]);
    const subject = decisionEngine.resolveSubject(unknown, "session-xyz");
    expect(subject).toMatchObject({ isAgeRestricted: true, subjectKind: "session" });
    expect(subject.subjectKey).not.toContain(String(unknown._id));
    // No session key at all is a programming error for a restricted subject:
    // the caller must establish one, there is no silent per-request fallback.
    expect(() => decisionEngine.resolveSubject(unknown, undefined)).toThrow(/anonymous session/);
    expect(decisionEngine.resolveSubject(adult, "s").subjectKey).toBe(`user:${adult._id}`);
  });
});

describe("frequency caps", () => {
  it("excludes a campaign at its daily cap and makes it eligible again the following day", async () => {
    const capped = await liveCampaign({ name: "capped", frequencyCap: { maxPerDay: 2 } });
    await liveCampaign({ name: "free" });
    const subject = decisionEngine.resolveSubject(adult, null);
    const today = new Date();

    await recordImpression({ subjectKey: subject.subjectKey, campaignId: capped._id, flightEndsAt: capped.flightEndsAt, at: today });
    expect(await eligibleNames(adult, HOME, today)).toEqual(["capped", "free"]);
    await recordImpression({ subjectKey: subject.subjectKey, campaignId: capped._id, flightEndsAt: capped.flightEndsAt, at: today });
    expect(await eligibleNames(adult, HOME, today)).toEqual(["free"]);

    const tomorrow = new Date(today.getTime() + DAY);
    expect(await eligibleNames(adult, HOME, tomorrow)).toEqual(["capped", "free"]);
  });

  it("excludes a campaign at its flight cap for the rest of the flight", async () => {
    const capped = await liveCampaign({ name: "capped", frequencyCap: { maxPerFlight: 1 } });
    const subject = decisionEngine.resolveSubject(adult, null);
    const today = new Date();
    await recordImpression({ subjectKey: subject.subjectKey, campaignId: capped._id, flightEndsAt: capped.flightEndsAt, at: today });

    expect(await eligibleNames(adult, HOME, today)).toEqual([]);
    expect(await eligibleNames(adult, HOME, new Date(today.getTime() + DAY))).toEqual([]);
    expect(await eligibleNames(adult, HOME, new Date(today.getTime() + 4 * DAY))).toEqual([]);
  });
});

describe("selection", () => {
  it("never chooses a lower tier while a higher tier is eligible", async () => {
    await liveCampaign({ name: "premium", priorityTier: 1, weight: 1 });
    await liveCampaign({ name: "standard", priorityTier: 2, weight: 1000 });
    await liveCampaign({ name: "house", priorityTier: 3, weight: 1000 });
    const subject = decisionEngine.resolveSubject(adult, null);
    const eligible = await decisionEngine.listEligibleCampaigns({ placementKey: HOME, user: adult, subject });

    for (let round = 0; round < 200; round += 1) {
      expect(decisionEngine.selectFromEligible(eligible).campaign.name).toBe("premium");
    }
  });

  it("lands near the expected weighted distribution over many runs, for campaigns and creatives", async () => {
    await liveCampaign({ name: "heavy", weight: 3 }, [3, 1]);
    await liveCampaign({ name: "light", weight: 1 }, [1]);
    const subject = decisionEngine.resolveSubject(adult, null);
    const eligible = await decisionEngine.listEligibleCampaigns({ placementKey: HOME, user: adult, subject });

    const runs = 4000;
    const tally = { heavy: 0, light: 0, heavyArt3: 0 };
    for (let round = 0; round < runs; round += 1) {
      const pick = decisionEngine.selectFromEligible(eligible);
      tally[pick.campaign.name] += 1;
      if (pick.campaign.name === "heavy" && pick.association.rotationWeight === 3) {
        tally.heavyArt3 += 1;
      }
    }
    expect(tally.heavy / runs).toBeGreaterThan(0.71);
    expect(tally.heavy / runs).toBeLessThan(0.79);
    expect(tally.heavyArt3 / tally.heavy).toBeGreaterThan(0.71);
    expect(tally.heavyArt3 / tally.heavy).toBeLessThan(0.79);
  });

  it("raises an under-delivering campaign and damps an over-delivering one, never to zero and never past a tier", async () => {
    const now = new Date();
    const window = { flightStartsAt: new Date(now.getTime() - 5 * DAY), flightEndsAt: new Date(now.getTime() + 5 * DAY) };
    const behind = { ...window, weight: 1, pacing: { totalImpressionTarget: 1000, deliveredImpressions: 0 } };
    const onPace = { ...window, weight: 1, pacing: { totalImpressionTarget: 1000, deliveredImpressions: 500 } };
    const ahead = { ...window, weight: 1, pacing: { totalImpressionTarget: 1000, deliveredImpressions: 1000 } };
    const none = { ...window, weight: 1, pacing: {} };

    expect(decisionEngine.pacingFactor(behind, now)).toBeGreaterThan(1);
    expect(decisionEngine.pacingFactor(onPace, now)).toBeCloseTo(1, 1);
    expect(decisionEngine.pacingFactor(ahead, now)).toBeLessThan(1);
    expect(decisionEngine.pacingFactor(ahead, now)).toBeGreaterThanOrEqual(decisionEngine.PACING_FACTOR_FLOOR);
    expect(decisionEngine.pacingFactor(behind, now)).toBeLessThanOrEqual(decisionEngine.PACING_FACTOR_CEILING);
    expect(decisionEngine.pacingFactor(none, now)).toBe(1);
    // Wildly over-delivered: still strictly positive, still selectable.
    const wayAhead = { ...window, weight: 1, pacing: { totalImpressionTarget: 10, deliveredImpressions: 100000 } };
    expect(decisionEngine.pacingFactor(wayAhead, now)).toBe(decisionEngine.PACING_FACTOR_FLOOR);

    // An over-delivering PREMIUM campaign still beats an under-delivering STANDARD one.
    await liveCampaign({ name: "premium-ahead", priorityTier: 1, pacing: { totalImpressionTarget: 10, deliveredImpressions: 100000 } });
    await liveCampaign({ name: "standard-behind", priorityTier: 2, pacing: { totalImpressionTarget: 1000, deliveredImpressions: 0 } });
    const subject = decisionEngine.resolveSubject(adult, null);
    const eligible = await decisionEngine.listEligibleCampaigns({ placementKey: HOME, user: adult, subject });
    for (let round = 0; round < 100; round += 1) {
      expect(decisionEngine.selectFromEligible(eligible).campaign.name).toBe("premium-ahead");
    }
  });

  it("returns an explicit no-fill when nothing is eligible", async () => {
    // Published but on another placement; and one outside its flight.
    await liveCampaign({ name: "elsewhere", placementKeys: ["passScreen"] });
    const expired = await liveCampaign({ name: "over" });
    await CampaignModel.updateOne(
      { _id: expired._id },
      { $set: { flightStartsAt: new Date(Date.now() - 10 * DAY), flightEndsAt: new Date(Date.now() - DAY) } }
    );

    const result = await decisionEngine.decide({ placementKey: HOME, user: adult });
    expect(result).toMatchObject({
      fill: false,
      reason: "noEligibleCampaign",
      subjectKind: "participant",
      sessionKey: null,
    });
    expect(await DecisionTokenModel.countDocuments()).toBe(0);
  });
});

describe("the decision token", () => {
  it("is usable once, and rejected when reused or expired", async () => {
    await liveCampaign({ name: "only" });
    const result = await decisionEngine.decide({ placementKey: HOME, user: adult });
    expect(result.fill).toBe(true);
    const { token } = result.decision;

    const consumed = await decisionEngine.consumeDecisionToken(token);
    expect(String(consumed.campaignId)).toBe(result.decision.campaignId);
    expect(consumed.consumedAt).toBeInstanceOf(Date);

    await expect(decisionEngine.consumeDecisionToken(token)).rejects.toMatchObject({
      errorCode: "DECISION_TOKEN_INVALID",
      statusCode: 409,
    });
    await expect(decisionEngine.consumeDecisionToken("never-minted")).rejects.toMatchObject({
      errorCode: "DECISION_TOKEN_INVALID",
    });

    // A fresh token, but the clock has moved past its expiry.
    const later = await decisionEngine.decide({ placementKey: HOME, user: adult });
    const past = new Date(later.decision.expiresAt.getTime() + 1000);
    await expect(decisionEngine.consumeDecisionToken(later.decision.token, past)).rejects.toMatchObject({
      errorCode: "DECISION_TOKEN_INVALID",
    });
  });
});

describe("GET /decisions", () => {
  it("returns a decision with media, link, promoter and token, and is never cacheable", async () => {
    const participant = await createTestParticipant(college, {
      dateOfBirth: new Date(Date.UTC(1998, 5, 1)),
    });
    await liveCampaign({ name: "served" });

    const response = await request(application)
      .get(`/api/v1/decisions?placement=${HOME}`)
      .set("Authorization", `Bearer ${participant.authenticationToken}`);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store, private");
    expect(response.body.data.fill).toBe(true);
    expect(response.body.data.decision).toMatchObject({
      placementKey: HOME,
      creative: { mediaType: "image", imageUrl: expect.stringContaining("https://") },
      promoter: { displayName: "Acme", kind: "sponsor" },
    });
    expect(typeof response.body.data.decision.token).toBe("string");
    expect(await DecisionTokenModel.countDocuments({ token: response.body.data.decision.token })).toBe(1);

    const unauthenticated = await request(application).get(`/api/v1/decisions?placement=${HOME}`);
    expect(unauthenticated.status).toBe(401);

    const noFill = await request(application)
      .get("/api/v1/decisions?placement=passScreen")
      .set("Authorization", `Bearer ${participant.authenticationToken}`);
    expect(noFill.status).toBe(200);
    expect(noFill.body.data).toMatchObject({ fill: false, reason: "noEligibleCampaign" });
  });
});

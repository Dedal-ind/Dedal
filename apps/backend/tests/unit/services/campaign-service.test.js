import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PlacementModel } from "../../../src/models/placement-model.js";
import { CampaignModel } from "../../../src/models/campaign-model.js";
import { CampaignCreativeModel } from "../../../src/models/campaign-creative-model.js";
import { AuditLogModel } from "../../../src/models/audit-log-model.js";
import campaignService from "../../../src/services/campaign-service.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import { createTestUser } from "../../setup/create-test-fixtures.js";

let admin;
let sponsor;

const DAY = 24 * 60 * 60 * 1000;
const flight = () => ({
  flightStartsAt: new Date(Date.now() - DAY),
  flightEndsAt: new Date(Date.now() + 30 * DAY),
});

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    PlacementModel.createIndexes(),
    CampaignModel.createIndexes(),
    CampaignCreativeModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  await campaignService.ensurePlacements();
  admin = await createTestUser({ emailAddress: "owner@example.com" });
  sponsor = await campaignService.createPromoter(admin._id, {
    displayName: "Acme Audio",
    kind: "sponsor",
  });
});

afterAll(teardownTestDatabase);

async function creative(overrides = {}) {
  return campaignService.createCreative(admin._id, {
    promoterId: sponsor._id,
    title: "Banner",
    imageUrl: "https://example.com/banner.png",
    ...overrides,
  });
}

async function campaign(overrides = {}) {
  return campaignService.createCampaign(admin._id, {
    promoterId: sponsor._id,
    name: "Fest week",
    placementKeys: ["homeCarousel"],
    ...flight(),
    ...overrides,
  });
}

async function readyCampaign(overrides = {}) {
  const row = await campaign(overrides);
  const art = await creative();
  await campaignService.attachCreative(admin._id, row._id, { creativeId: art._id });
  return row;
}

describe("publishing guards", () => {
  it("refuses a campaign with no active creative association", async () => {
    const row = await campaign();
    await expect(campaignService.publishCampaign(admin._id, row._id)).rejects.toMatchObject({
      errorCode: "CAMPAIGN_NOT_PUBLISHABLE",
      details: { reason: "noActiveCreative" },
    });

    // A paused association does not count either.
    const art = await creative();
    await campaignService.attachCreative(admin._id, row._id, { creativeId: art._id, isActive: false });
    await expect(campaignService.publishCampaign(admin._id, row._id)).rejects.toMatchObject({
      details: { reason: "noActiveCreative" },
    });
    expect((await CampaignModel.findById(row._id)).status).toBe("draft");
  });

  it("refuses a campaign with no placement", async () => {
    const row = await readyCampaign({ placementKeys: [] });
    await expect(campaignService.publishCampaign(admin._id, row._id)).rejects.toMatchObject({
      errorCode: "CAMPAIGN_NOT_PUBLISHABLE",
      details: { reason: "noPlacement" },
    });
  });

  it("publishes, audits, and is idempotent when the guards pass", async () => {
    const row = await readyCampaign();
    const published = await campaignService.publishCampaign(admin._id, row._id);
    expect(published.status).toBe("published");
    expect(published.publishedAt).toBeInstanceOf(Date);
    expect(await AuditLogModel.countDocuments({ action: "campaign.published" })).toBe(1);
    const again = await campaignService.publishCampaign(admin._id, row._id);
    expect(again.publishedAt).toEqual(published.publishedAt);
  });
});

describe("the per-placement publish cap", () => {
  it("refuses the campaign that would exceed the placement's cap, and only on that placement", async () => {
    await PlacementModel.updateOne({ key: "passScreen" }, { $set: { maxPublishedCampaigns: 2 } });

    const first = await readyCampaign({ placementKeys: ["passScreen"] });
    const second = await readyCampaign({ placementKeys: ["passScreen"] });
    await campaignService.publishCampaign(admin._id, first._id);
    await campaignService.publishCampaign(admin._id, second._id);

    const third = await readyCampaign({ placementKeys: ["passScreen"] });
    await expect(campaignService.publishCampaign(admin._id, third._id)).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "CAMPAIGN_PLACEMENT_CAP_REACHED",
      details: { placementKey: "passScreen", publishedCount: 2, maxPublishedCampaigns: 2 },
    });
    expect((await CampaignModel.findById(third._id)).status).toBe("draft");

    // A full pass screen costs the home carousel nothing.
    const elsewhere = await readyCampaign({ placementKeys: ["homeCarousel"] });
    expect((await campaignService.publishCampaign(admin._id, elsewhere._id)).status).toBe("published");

    // And a campaign naming BOTH is refused because one of them is full.
    const both = await readyCampaign({ placementKeys: ["homeCarousel", "passScreen"] });
    await expect(campaignService.publishCampaign(admin._id, both._id)).rejects.toMatchObject({
      errorCode: "CAMPAIGN_PLACEMENT_CAP_REACHED",
      details: { placementKey: "passScreen" },
    });
  });

  it("refuses publishing onto an inactive placement", async () => {
    await PlacementModel.updateOne({ key: "festDetail" }, { $set: { isActive: false } });
    const row = await readyCampaign({ placementKeys: ["festDetail"] });
    await expect(campaignService.publishCampaign(admin._id, row._id)).rejects.toMatchObject({
      errorCode: "PLACEMENT_INACTIVE",
    });
  });
});

describe("campaign rules", () => {
  it("refuses a flight that ends before (or when) it starts", async () => {
    const start = new Date();
    await expect(
      campaign({ flightStartsAt: start, flightEndsAt: new Date(start.getTime() - DAY) })
    ).rejects.toThrow(/end after it starts/);
    await expect(campaign({ flightStartsAt: start, flightEndsAt: start })).rejects.toThrow(
      /end after it starts/
    );
  });

  it("allows only a draft to be deleted", async () => {
    const draft = await readyCampaign();
    const published = await readyCampaign();
    await campaignService.publishCampaign(admin._id, published._id);

    await expect(campaignService.deleteCampaign(admin._id, published._id)).rejects.toMatchObject({
      errorCode: "INVALID_CAMPAIGN_STATE",
    });
    // The model backstops the service.
    const loaded = await CampaignModel.findById(published._id);
    await expect(loaded.deleteOne()).rejects.toThrow(/Only a draft/);

    expect(await campaignService.deleteCampaign(admin._id, draft._id)).toEqual({ deleted: true });
    expect(await CampaignModel.findById(draft._id)).toBeNull();
    expect(await CampaignCreativeModel.countDocuments({ campaignId: draft._id })).toBe(0);

    await campaignService.archiveCampaign(admin._id, published._id);
    await expect(campaignService.deleteCampaign(admin._id, published._id)).rejects.toMatchObject({
      errorCode: "INVALID_CAMPAIGN_STATE",
    });
  });

  it("stores targeting as data over declared attributes only, and refuses anything else", async () => {
    const targeted = await campaign({
      targeting: { include: { cities: ["Bengaluru"], yearsOfStudy: [1, 2] }, exclude: { departments: ["MBA"] } },
    });
    const stored = (await CampaignModel.findById(targeted._id)).toJSON();
    expect(stored.targeting.include.cities).toEqual(["Bengaluru"]);
    expect(stored.targeting.include.yearsOfStudy).toEqual([1, 2]);
    expect(stored.targeting.exclude.departments).toEqual(["MBA"]);
    // Absent dimensions are empty sets — no constraint.
    expect(stored.targeting.include.collegeIds).toEqual([]);
    expect(stored.targeting.exclude.festIds).toEqual([]);

    // A behavioural key has nowhere to live.
    await expect(campaign({ targeting: { include: { interests: ["music"] } } })).rejects.toThrow(
      /interests/
    );
    await expect(campaign({ targeting: { include: { viewedEventIds: [] } } })).rejects.toThrow(
      /viewedEventIds/
    );
  });
});

describe("a creative shared across campaigns", () => {
  it("runs in two campaigns with different rotation weights, and pausing one leaves the other running", async () => {
    const art = await creative({ title: "Shared artwork" });
    const alpha = await campaign({ name: "Alpha" });
    const beta = await campaign({ name: "Beta" });

    const inAlpha = await campaignService.attachCreative(admin._id, alpha._id, {
      creativeId: art._id,
      rotationWeight: 3,
    });
    const inBeta = await campaignService.attachCreative(admin._id, beta._id, {
      creativeId: art._id,
      rotationWeight: 7,
    });

    expect(inAlpha.rotationWeight).toBe(3);
    expect(inBeta.rotationWeight).toBe(7);
    expect(await CampaignCreativeModel.countDocuments({ creativeId: art._id })).toBe(2);

    // Pause in Alpha only: Beta still publishes, Alpha no longer can.
    await campaignService.attachCreative(admin._id, alpha._id, { creativeId: art._id, isActive: false });
    expect((await campaignService.publishCampaign(admin._id, beta._id)).status).toBe("published");
    await expect(campaignService.publishCampaign(admin._id, alpha._id)).rejects.toMatchObject({
      details: { reason: "noActiveCreative" },
    });

    // Re-attaching the same pair updates the one row rather than adding another.
    expect(await CampaignCreativeModel.countDocuments({ campaignId: alpha._id })).toBe(1);
  });

  it("refuses a creative owned by a different promoter", async () => {
    const other = await campaignService.createPromoter(admin._id, {
      displayName: "Other College",
      kind: "college",
    });
    const foreign = await campaignService.createCreative(admin._id, {
      promoterId: other._id,
      title: "Theirs",
      imageUrl: "https://example.com/theirs.png",
    });
    const row = await campaign();
    await expect(
      campaignService.attachCreative(admin._id, row._id, { creativeId: foreign._id })
    ).rejects.toMatchObject({ errorCode: "CREATIVE_PROMOTER_MISMATCH" });
  });
});

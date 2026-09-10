import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PromotionModel } from "../../../src/models/promotion-model.js";
import { PromoterModel } from "../../../src/models/promoter-model.js";
import { PlacementModel } from "../../../src/models/placement-model.js";
import { CampaignModel } from "../../../src/models/campaign-model.js";
import { CreativeModel } from "../../../src/models/creative-model.js";
import { CampaignCreativeModel } from "../../../src/models/campaign-creative-model.js";
import { migratePromotionsToCampaigns } from "../../../src/helpers/migrate-promotions-to-campaigns.js";
import {
  setupTestDatabase,
  teardownTestDatabase,
  clearAllCollections,
} from "../../setup/test-database.js";
import { createTestUser, createTestCollege } from "../../setup/create-test-fixtures.js";

let admin;

beforeAll(async () => {
  await setupTestDatabase();
  await Promise.all([
    PromoterModel.createIndexes(),
    PlacementModel.createIndexes(),
    CampaignModel.createIndexes(),
    CreativeModel.createIndexes(),
    CampaignCreativeModel.createIndexes(),
  ]);
});

beforeEach(async () => {
  await clearAllCollections();
  admin = await createTestUser({ emailAddress: "owner@example.com" });
});

afterAll(teardownTestDatabase);

async function promotion(overrides = {}) {
  return PromotionModel.create({
    title: "Banner",
    promotionType: "commercial",
    imageUrl: "https://example.com/banner.png",
    createdByUserId: admin._id,
    ...overrides,
  });
}

async function snapshot() {
  const [promoters, placements, campaigns, creatives, associations] = await Promise.all([
    PromoterModel.find().sort({ _id: 1 }).lean(),
    PlacementModel.find().sort({ _id: 1 }).lean(),
    CampaignModel.find().sort({ _id: 1 }).lean(),
    CreativeModel.find().sort({ _id: 1 }).lean(),
    CampaignCreativeModel.find().sort({ _id: 1 }).lean(),
  ]);
  return { promoters, placements, campaigns, creatives, associations };
}

describe("migratePromotionsToCampaigns", () => {
  it("creates one promoter per distinct college name and does not duplicate on re-run", async () => {
    const publishedAt = new Date("2026-05-01T10:00:00Z");
    const archivedAt = new Date("2026-06-01T10:00:00Z");
    const college = await createTestCollege({ commonName: "Alliance University", isVerified: true });

    await promotion({
      title: "Alliance ONE 2026",
      promotionType: "collegeEvent",
      collegeName: "Alliance University",
      status: "published",
      publishedAt,
      displayOrder: 1,
    });
    await promotion({
      title: "Alliance Hackday",
      promotionType: "collegeEvent",
      collegeName: "  alliance   university ",
      status: "archived",
      publishedAt,
      archivedAt,
      displayOrder: 2,
    });
    await promotion({
      title: "Other Fest",
      promotionType: "collegeEvent",
      collegeName: "Other College",
      status: "draft",
      displayOrder: 3,
    });
    await promotion({ title: "Power Your Passion", status: "published", publishedAt, displayOrder: 1 });

    const first = await migratePromotionsToCampaigns();

    expect(first).toEqual({
      placementsCreated: 4,
      promotionsSeen: 4,
      promotersCreated: 3, // Alliance University (once), Other College, Power Your Passion
      creativesCreated: 4,
      campaignsCreated: 4,
      associationsCreated: 4,
    });

    const promoters = await PromoterModel.find().lean();
    const alliance = promoters.find((row) => row.displayName === "Alliance University");
    expect(alliance.kind).toBe("college");
    expect(String(alliance.collegeId)).toBe(String(college._id));
    expect(promoters.find((row) => row.displayName === "Other College").collegeId).toBeNull();
    expect(promoters.find((row) => row.displayName === "Power Your Passion").kind).toBe("sponsor");

    // Both Alliance campaigns hang off the ONE promoter.
    expect(await CampaignModel.countDocuments({ promoterId: alliance._id })).toBe(2);

    // Status, ordering and timestamps survive.
    const hackday = await CampaignModel.findOne({ name: "Alliance Hackday" }).lean();
    expect(hackday).toMatchObject({ status: "archived", displayOrder: 2, publishedAt, archivedAt });
    expect(hackday.flightStartsAt).toEqual(publishedAt);
    expect(hackday.flightEndsAt.getTime()).toBeGreaterThan(publishedAt.getTime());

    const before = await snapshot();
    const second = await migratePromotionsToCampaigns();

    expect(second).toEqual({
      placementsCreated: 0,
      promotionsSeen: 4,
      promotersCreated: 0,
      creativesCreated: 0,
      campaignsCreated: 0,
      associationsCreated: 0,
    });
    expect(await snapshot()).toEqual(before);
    // The promotion collection is untouched.
    expect(await PromotionModel.countDocuments()).toBe(4);
  });

  it("lands every migrated campaign on the home carousel with empty targeting, its creative attached", async () => {
    const row = await promotion({
      title: "Fuel the Fest",
      mediaType: "video",
      videoUrl: "https://example.com/fuel.mp4",
      imageUrl: "https://example.com/poster.png",
      linkUrl: "https://example.com/deal",
      description: "Meal combos.",
      status: "published",
      publishedAt: new Date(),
    });

    await migratePromotionsToCampaigns();

    const campaign = await CampaignModel.findOne({ migratedFromPromotionId: row._id });
    expect(campaign.placementKeys).toEqual(["homeCarousel"]);
    const targeting = campaign.toJSON().targeting;
    for (const half of ["include", "exclude"]) {
      for (const dimension of ["collegeIds", "cities", "departments", "yearsOfStudy", "festIds"]) {
        expect(targeting[half][dimension]).toEqual([]);
      }
    }
    expect(campaign.priorityTier).toBe(2);
    expect(campaign.weight).toBe(1);

    const creative = await CreativeModel.findOne({ migratedFromPromotionId: row._id }).lean();
    expect(creative).toMatchObject({
      title: "Fuel the Fest",
      mediaType: "video",
      videoUrl: "https://example.com/fuel.mp4",
      imageUrl: "https://example.com/poster.png",
      linkUrl: "https://example.com/deal",
      description: "Meal combos.",
    });
    expect(String(creative.promoterId)).toBe(String(campaign.promoterId));

    const association = await CampaignCreativeModel.findOne({ campaignId: campaign._id }).lean();
    expect(String(association.creativeId)).toBe(String(creative._id));
    expect(association).toMatchObject({ rotationWeight: 1, isActive: true });

    const placements = await PlacementModel.find().lean();
    expect(placements.map((placement) => placement.key).sort()).toEqual([
      "festDetail",
      "homeCarousel",
      "passScreen",
      "postRegistration",
    ]);
    expect(placements.find((placement) => placement.key === "homeCarousel").maxPublishedCampaigns).toBe(20);
  });
});

require("dotenv").config();
const mongoose = require("mongoose");

const { applicationConfig } = require("../config/application-config");
const { PromotionModel, PROMOTION_TYPES } = require("../models/promotion-model");
const { PromoterModel, toDisplayNameKey } = require("../models/promoter-model");
const { CampaignModel } = require("../models/campaign-model");
const { CreativeModel } = require("../models/creative-model");
const { CampaignCreativeModel } = require("../models/campaign-creative-model");
const { CollegeModel } = require("../models/college-model");
const { ensurePlacements } = require("../services/campaign-service");
const {
  PROMOTER_KINDS,
  PLACEMENT_KEYS,
  CAMPAIGN_PRIORITY_TIERS,
} = require("../constants/campaign-constants");

/*
 * Operator-run, IDEMPOTENT migration from the single promotion document to
 * the promoter / campaign / creative / placement model.
 *
 * For every existing promotion:
 *   - a PROMOTER is created or reused. A college-event promotion names its
 *     college in free text, so the promoter is found by that name (case- and
 *     whitespace-insensitive) and linked to a College row when one matches;
 *     a commercial promotion has no sponsor name, so its title stands in as
 *     the sponsor's display name.
 *   - a CREATIVE is created from the media fields (mediaType, imageUrl,
 *     videoUrl, linkUrl, title, description).
 *   - a CAMPAIGN is created carrying the promotion's status, its displayOrder
 *     and its published/archived timestamps, targeting the HOME CAROUSEL
 *     placement with an EMPTY predicate — so nothing changes about who sees
 *     it once the decision engine takes over.
 *   - the two are ASSOCIATED with weight 1, active.
 *
 * Re-running changes nothing: the creative and campaign each carry
 * migratedFromPromotionId under a unique index, and the promoter is looked up
 * by name. The promotion collection is NOT touched: the old public endpoint
 * keeps serving from it until the next phase.
 *
 * Run with: npm run migrate:promotions-to-campaigns
 */

/* A migrated campaign's flight: from when it was published (or created) for
   ten years. The old promotion had no end date; giving the campaign a far
   horizon keeps it eligible exactly as long as the promotion would have been. */
const MIGRATED_FLIGHT_YEARS = 10;

function promoterDetailsFor(promotion) {
  if (promotion.promotionType === PROMOTION_TYPES.COLLEGE_EVENT && promotion.collegeName) {
    return { displayName: promotion.collegeName.trim(), kind: PROMOTER_KINDS.COLLEGE };
  }
  return { displayName: promotion.title.trim(), kind: PROMOTER_KINDS.SPONSOR };
}

async function findCollegeIdByName(displayName) {
  const pattern = new RegExp(`^${displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const college = await CollegeModel.findOne({
    $or: [{ commonName: pattern }, { collegeName: pattern }],
  })
    .select("_id")
    .lean();
  return college ? college._id : null;
}

async function ensurePromoter(promotion, report) {
  const { displayName, kind } = promoterDetailsFor(promotion);
  const existing = await PromoterModel.findOne({ displayNameKey: toDisplayNameKey(displayName) });
  if (existing) {
    return existing;
  }
  const promoter = await PromoterModel.create({
    displayName,
    kind,
    collegeId: kind === PROMOTER_KINDS.COLLEGE ? await findCollegeIdByName(displayName) : null,
    createdByUserId: promotion.createdByUserId,
  });
  report.promotersCreated += 1;
  return promoter;
}

async function ensureCreative(promotion, promoter, report) {
  const existing = await CreativeModel.findOne({ migratedFromPromotionId: promotion._id });
  if (existing) {
    return existing;
  }
  const creative = await CreativeModel.create({
    promoterId: promoter._id,
    title: promotion.title,
    mediaType: promotion.mediaType ?? "image",
    imageUrl: promotion.imageUrl ?? null,
    videoUrl: promotion.videoUrl ?? null,
    linkUrl: promotion.linkUrl ?? null,
    description: promotion.description ?? null,
    createdByUserId: promotion.createdByUserId,
    migratedFromPromotionId: promotion._id,
  });
  report.creativesCreated += 1;
  return creative;
}

async function ensureCampaign(promotion, promoter, report) {
  const existing = await CampaignModel.findOne({ migratedFromPromotionId: promotion._id });
  if (existing) {
    return existing;
  }
  const flightStartsAt = promotion.publishedAt ?? promotion.createdAt ?? new Date();
  const flightEndsAt = new Date(flightStartsAt);
  flightEndsAt.setUTCFullYear(flightEndsAt.getUTCFullYear() + MIGRATED_FLIGHT_YEARS);

  const campaign = await CampaignModel.create({
    promoterId: promoter._id,
    name: promotion.title,
    status: promotion.status,
    flightStartsAt,
    flightEndsAt,
    placementKeys: [PLACEMENT_KEYS.HOME_CAROUSEL],
    priorityTier: CAMPAIGN_PRIORITY_TIERS.STANDARD,
    weight: 1,
    targeting: {},
    displayOrder: promotion.displayOrder ?? 0,
    publishedAt: promotion.publishedAt ?? null,
    archivedAt: promotion.archivedAt ?? null,
    createdByUserId: promotion.createdByUserId,
    migratedFromPromotionId: promotion._id,
  });
  report.campaignsCreated += 1;
  return campaign;
}

async function ensureAssociation(campaign, creative, report) {
  const result = await CampaignCreativeModel.updateOne(
    { campaignId: campaign._id, creativeId: creative._id },
    { $setOnInsert: { rotationWeight: 1, isActive: true } },
    { upsert: true, timestamps: false }
  );
  if (result.upsertedCount > 0) {
    report.associationsCreated += 1;
  }
}

async function migratePromotionsToCampaigns() {
  // Reuse an already-open connection; only a bare script invocation opens one.
  const ownsConnection = mongoose.connection.readyState === 0;
  if (ownsConnection) {
    await mongoose.connect(applicationConfig.databaseUri);
  }
  try {
    const report = {
      placementsCreated: 0,
      promotionsSeen: 0,
      promotersCreated: 0,
      creativesCreated: 0,
      campaignsCreated: 0,
      associationsCreated: 0,
    };

    report.placementsCreated = (await ensurePlacements()).created;

    const promotions = await PromotionModel.find({}).sort({ createdAt: 1 }).lean();
    report.promotionsSeen = promotions.length;

    for (const promotion of promotions) {
      const promoter = await ensurePromoter(promotion, report);
      const creative = await ensureCreative(promotion, promoter, report);
      const campaign = await ensureCampaign(promotion, promoter, report);
      await ensureAssociation(campaign, creative, report);
    }

    console.log(
      `promotions → campaigns: ${report.promotionsSeen} promotions seen; created ` +
        `${report.placementsCreated} placements, ${report.promotersCreated} promoters, ` +
        `${report.creativesCreated} creatives, ${report.campaignsCreated} campaigns, ` +
        `${report.associationsCreated} associations.`
    );
    return report;
  } finally {
    if (ownsConnection) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  migratePromotionsToCampaigns()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { migratePromotionsToCampaigns };

const mongoose = require("mongoose");

const { PromoterModel } = require("../models/promoter-model");
const { PlacementModel } = require("../models/placement-model");
const { CampaignModel } = require("../models/campaign-model");
const { CreativeModel } = require("../models/creative-model");
const { CampaignCreativeModel } = require("../models/campaign-creative-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { recordAuditLog } = require("./audit-log-service");
const {
  CAMPAIGN_STATUSES,
  PLACEMENT_SEED,
  CREATIVE_STATUSES,
} = require("../constants/campaign-constants");

/*
 * Promotions phase 2: promoters, placements, campaigns, creatives and the
 * campaign-creative join. Models and their rules only — nothing here serves a
 * participant; the old promotion path keeps doing that until the decision
 * engine replaces it.
 *
 * THE RULES LIVE IN THE PUBLISH TRANSITION, not on the schema, matching where
 * the old per-type cap lived:
 *   - a campaign cannot be published without at least one ACTIVE creative
 *     association and at least one placement;
 *   - each placement declares how many campaigns may be published against it
 *     at once, and the one that would exceed it is refused;
 *   - only a draft may be deleted (the model backstops this).
 * Every mutation writes an audit log entry.
 */

function assertObjectId(value, message) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, message);
  }
}

async function audit(actorUserId, action, entityType, entityId, afterState, context) {
  await recordAuditLog({
    actorUserId,
    festId: null, // platform-wide, like promotions
    action,
    entityType,
    entityId,
    afterState,
    ...(context || {}),
  });
}

/* Idempotent: every placement in PLACEMENT_SEED exists, with its declared cap
   applied only on first creation so an admin's later adjustment survives. */
async function ensurePlacements() {
  let created = 0;
  for (const seed of PLACEMENT_SEED) {
    const result = await PlacementModel.updateOne(
      { key: seed.key },
      { $setOnInsert: seed },
      // timestamps: false — a no-op upsert must not bump updatedAt, or a
      // re-run of the migration would touch every placement row.
      { upsert: true, timestamps: false }
    );
    if (result.upsertedCount > 0) {
      created += 1;
    }
  }
  return { created, total: PLACEMENT_SEED.length };
}

/* ---------------------------------------------------------------- promoters */

async function createPromoter(adminUserId, payload, context = {}) {
  const promoter = await PromoterModel.create({
    displayName: payload.displayName,
    kind: payload.kind,
    contactName: payload.contactName ?? null,
    contactEmail: payload.contactEmail ?? null,
    contactPhone: payload.contactPhone ?? null,
    status: payload.status,
    collegeId: payload.collegeId ?? null,
    createdByUserId: adminUserId,
  });
  await audit(
    adminUserId,
    AUDIT_ACTIONS.PROMOTER_CREATED,
    AUDIT_ENTITY_TYPES.PROMOTER,
    promoter._id,
    { displayName: promoter.displayName, kind: promoter.kind },
    context
  );
  return promoter;
}

async function loadPromoterOrThrow(promoterId) {
  const promoter = mongoose.Types.ObjectId.isValid(promoterId)
    ? await PromoterModel.findById(promoterId)
    : null;
  if (!promoter) {
    throw new ApplicationError(404, ERROR_CODES.PROMOTER_NOT_FOUND, "Promoter not found.");
  }
  return promoter;
}

/* ---------------------------------------------------------------- creatives */

async function createCreative(adminUserId, payload, context = {}) {
  await loadPromoterOrThrow(payload.promoterId);
  const creative = await CreativeModel.create({
    promoterId: payload.promoterId,
    title: payload.title,
    mediaType: payload.mediaType === "video" ? "video" : "image",
    imageUrl: payload.imageUrl || null,
    videoUrl: payload.videoUrl || null,
    linkUrl: payload.linkUrl || null,
    description: payload.description || null,
    createdByUserId: adminUserId,
  });
  await audit(
    adminUserId,
    AUDIT_ACTIONS.CREATIVE_CREATED,
    AUDIT_ENTITY_TYPES.CREATIVE,
    creative._id,
    { title: creative.title, promoterId: String(creative.promoterId) },
    context
  );
  return creative;
}

/* ---------------------------------------------------------------- campaigns */

async function loadCampaignOrThrow(campaignId) {
  const campaign = mongoose.Types.ObjectId.isValid(campaignId)
    ? await CampaignModel.findById(campaignId)
    : null;
  if (!campaign) {
    throw new ApplicationError(404, ERROR_CODES.CAMPAIGN_NOT_FOUND, "Campaign not found.");
  }
  return campaign;
}

function campaignSummary(campaign) {
  return {
    name: campaign.name,
    status: campaign.status,
    promoterId: String(campaign.promoterId),
    placementKeys: [...campaign.placementKeys],
  };
}

/* Always a draft: publishing is a separate, deliberate act. */
async function createCampaign(adminUserId, payload, context = {}) {
  await loadPromoterOrThrow(payload.promoterId);
  const campaign = await CampaignModel.create({
    promoterId: payload.promoterId,
    name: payload.name,
    flightStartsAt: payload.flightStartsAt,
    flightEndsAt: payload.flightEndsAt,
    placementKeys: payload.placementKeys ?? [],
    priorityTier: payload.priorityTier,
    weight: payload.weight,
    pacing: payload.pacing ?? {},
    frequencyCap: payload.frequencyCap ?? {},
    targeting: payload.targeting ?? {},
    displayOrder: payload.displayOrder ?? 0,
    createdByUserId: adminUserId,
  });
  await audit(
    adminUserId,
    AUDIT_ACTIONS.CAMPAIGN_CREATED,
    AUDIT_ENTITY_TYPES.CAMPAIGN,
    campaign._id,
    campaignSummary(campaign),
    context
  );
  return campaign;
}

const EDITABLE_CAMPAIGN_FIELDS = [
  "name",
  "flightStartsAt",
  "flightEndsAt",
  "placementKeys",
  "priorityTier",
  "weight",
  "pacing",
  "frequencyCap",
  "targeting",
  "displayOrder",
];

/* Editable while draft or published; an archived campaign is history. */
async function updateCampaign(adminUserId, campaignId, payload, context = {}) {
  const campaign = await loadCampaignOrThrow(campaignId);
  if (campaign.status === CAMPAIGN_STATUSES.ARCHIVED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_CAMPAIGN_STATE,
      "An archived campaign cannot be edited."
    );
  }
  for (const field of EDITABLE_CAMPAIGN_FIELDS) {
    if (payload[field] !== undefined) {
      campaign[field] = payload[field];
    }
  }
  await campaign.save();
  await audit(
    adminUserId,
    AUDIT_ACTIONS.CAMPAIGN_UPDATED,
    AUDIT_ENTITY_TYPES.CAMPAIGN,
    campaign._id,
    campaignSummary(campaign),
    context
  );
  return campaign;
}

/* ----------------------------------------------------- creative association */

async function attachCreative(adminUserId, campaignId, payload, context = {}) {
  const campaign = await loadCampaignOrThrow(campaignId);
  assertObjectId(payload.creativeId, "creativeId must be a valid id.");
  const creative = await CreativeModel.findById(payload.creativeId);
  if (!creative) {
    throw new ApplicationError(404, ERROR_CODES.CREATIVE_NOT_FOUND, "Creative not found.");
  }
  if (String(creative.promoterId) !== String(campaign.promoterId)) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CREATIVE_PROMOTER_MISMATCH,
      "A campaign can only run a creative owned by its own promoter."
    );
  }
  if (creative.status === CREATIVE_STATUSES.ARCHIVED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_CREATIVE_STATE,
      "An archived creative cannot be attached to a campaign. Restore it first."
    );
  }
  const association = await CampaignCreativeModel.findOneAndUpdate(
    { campaignId: campaign._id, creativeId: creative._id },
    {
      $set: {
        rotationWeight: payload.rotationWeight ?? 1,
        isActive: payload.isActive ?? true,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
  await audit(
    adminUserId,
    AUDIT_ACTIONS.CAMPAIGN_CREATIVE_ATTACHED,
    AUDIT_ENTITY_TYPES.CAMPAIGN_CREATIVE,
    association._id,
    {
      campaignId: String(campaign._id),
      creativeId: String(creative._id),
      rotationWeight: association.rotationWeight,
      isActive: association.isActive,
    },
    context
  );
  return association;
}

/* ------------------------------------------------------------- transitions */

/*
 * The per-placement cap, checked for EVERY placement the campaign names. The
 * campaign being published is not yet counted, so "count >= cap" is exactly
 * "this one would exceed it". A placement that is inactive is also a refusal:
 * publishing onto a surface that does not render is a silent no-op an admin
 * would mistake for success.
 */
async function assertPlacementCapacity(campaign) {
  const placements = await PlacementModel.find({ key: { $in: campaign.placementKeys } }).lean();
  for (const key of campaign.placementKeys) {
    const placement = placements.find((row) => row.key === key);
    if (!placement || !placement.isActive) {
      throw new ApplicationError(
        409,
        ERROR_CODES.PLACEMENT_INACTIVE,
        `The "${key}" placement is not active; a campaign cannot be published onto it.`,
        { placementKey: key }
      );
    }
    const publishedCount = await CampaignModel.countDocuments({
      _id: { $ne: campaign._id },
      status: CAMPAIGN_STATUSES.PUBLISHED,
      placementKeys: key,
    });
    if (publishedCount >= placement.maxPublishedCampaigns) {
      throw new ApplicationError(
        409,
        ERROR_CODES.CAMPAIGN_PLACEMENT_CAP_REACHED,
        `At most ${placement.maxPublishedCampaigns} campaigns can be published on "${placement.label}" at once. Archive one first.`,
        {
          placementKey: key,
          publishedCount,
          maxPublishedCampaigns: placement.maxPublishedCampaigns,
        }
      );
    }
  }
}

/*
 * Everything that must be true before a campaign may serve: at least one
 * placement, at least one ACTIVE creative association, every named placement
 * active and under its cap. Shared by publish (draft → published) and resume
 * (paused → published), so the two can never drift and resume never has to
 * pass the row through a state it was not in. Throws; writes nothing.
 */
async function assertPublishable(campaign) {
  if (campaign.placementKeys.length === 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CAMPAIGN_NOT_PUBLISHABLE,
      "A campaign needs at least one placement before it can be published.",
      { reason: "noPlacement" }
    );
  }
  const activeCreativeCount = await CampaignCreativeModel.countDocuments({
    campaignId: campaign._id,
    isActive: true,
  });
  if (activeCreativeCount === 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CAMPAIGN_NOT_PUBLISHABLE,
      "A campaign needs at least one active creative before it can be published.",
      { reason: "noActiveCreative" }
    );
  }
  await assertPlacementCapacity(campaign);
}

async function publishCampaign(adminUserId, campaignId, context = {}) {
  const campaign = await loadCampaignOrThrow(campaignId);
  if (campaign.status === CAMPAIGN_STATUSES.PUBLISHED) {
    return campaign; // idempotent
  }
  await assertPublishable(campaign);

  campaign.status = CAMPAIGN_STATUSES.PUBLISHED;
  campaign.publishedAt = new Date();
  campaign.archivedAt = null;
  await campaign.save();
  await audit(
    adminUserId,
    AUDIT_ACTIONS.CAMPAIGN_PUBLISHED,
    AUDIT_ENTITY_TYPES.CAMPAIGN,
    campaign._id,
    { ...campaignSummary(campaign), publishedAt: campaign.publishedAt },
    context
  );
  return campaign;
}

async function archiveCampaign(adminUserId, campaignId, context = {}) {
  const campaign = await loadCampaignOrThrow(campaignId);
  campaign.status = CAMPAIGN_STATUSES.ARCHIVED;
  campaign.archivedAt = new Date();
  await campaign.save();
  await audit(
    adminUserId,
    AUDIT_ACTIONS.CAMPAIGN_ARCHIVED,
    AUDIT_ENTITY_TYPES.CAMPAIGN,
    campaign._id,
    campaignSummary(campaign),
    context
  );
  return campaign;
}

/* Hard delete, drafts only; the join rows go with it. The model backstops. */
async function deleteCampaign(adminUserId, campaignId, context = {}) {
  const campaign = await loadCampaignOrThrow(campaignId);
  if (campaign.status !== CAMPAIGN_STATUSES.DRAFT) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_CAMPAIGN_STATE,
      "Only a draft campaign can be deleted. Archive it instead — a campaign that ran is part of the record."
    );
  }
  await CampaignCreativeModel.deleteMany({ campaignId: campaign._id });
  await campaign.deleteOne();
  await audit(
    adminUserId,
    AUDIT_ACTIONS.CAMPAIGN_DELETED,
    AUDIT_ENTITY_TYPES.CAMPAIGN,
    campaign._id,
    campaignSummary(campaign),
    context
  );
  return { deleted: true };
}

module.exports = {
  ensurePlacements,
  assertPublishable,
  createPromoter,
  createCreative,
  createCampaign,
  updateCampaign,
  attachCreative,
  publishCampaign,
  archiveCampaign,
  deleteCampaign,
};

const mongoose = require("mongoose");

const { PromoterModel, toDisplayNameKey } = require("../models/promoter-model");
const { CreativeModel } = require("../models/creative-model");
const { CampaignModel } = require("../models/campaign-model");
const { CampaignCreativeModel } = require("../models/campaign-creative-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { recordAuditLog } = require("./audit-log-service");
const {
  PROMOTER_STATUSES,
  CAMPAIGN_STATUSES,
  CREATIVE_STATUSES,
  CREATIVE_MEDIA_TYPES,
} = require("../constants/campaign-constants");
const { checkDeclaredMedia } = require("../validators/promoter-validators");

/*
 * Promoter and creative management for the platform admin (phase 5).
 *
 * RULES THAT LIVE HERE, not on the schema:
 *   - a promoter's name key is unique case-insensitively; a collision names
 *     the existing promoter so the admin can use it instead;
 *   - neither a promoter nor a creative is ever deleted — archived only,
 *     because anything shown to participants is history;
 *   - archiving a promoter with PUBLISHED campaigns is refused, naming them:
 *     archive is not a way to stop delivery quietly, pausing a campaign is;
 *   - archiving a creative a PUBLISHED campaign runs is refused, naming the
 *     campaigns; one used only by drafts archives freely;
 *   - editing a creative a published campaign is serving is allowed with no
 *     review step, and the audit entry carries the previous media so a bad
 *     swap is traceable and reversible.
 * Every mutation is audited with before and after state.
 *
 * Pagination follows audit-log-service: ?page & ?limit, default 50, cap 200,
 * returned as { items, total, page, limit }.
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAXIMUM_LIMIT = 200;
const DUPLICATE_KEY_ERROR_CODE = 11000;

function normalisePagination(page, limit) {
  const safePage = Number.isInteger(page) && page > 0 ? page : DEFAULT_PAGE;
  const requestedLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  return { page: safePage, limit: Math.min(requestedLimit, MAXIMUM_LIMIT) };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function audit(actorUserId, action, entityType, entityId, beforeState, afterState, context) {
  await recordAuditLog({
    actorUserId,
    festId: null, // platform-wide, like promotions
    action,
    entityType,
    entityId,
    beforeState,
    afterState,
    ...(context || {}),
  });
}

/* ------------------------------------------------------------- promoters */

function promoterSnapshot(promoter) {
  return {
    displayName: promoter.displayName,
    kind: promoter.kind,
    status: promoter.status,
    contactName: promoter.contactName ?? null,
    contactEmail: promoter.contactEmail ?? null,
    contactPhone: promoter.contactPhone ?? null,
    collegeId: promoter.collegeId ? String(promoter.collegeId) : null,
  };
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

/*
 * A name collision is answered with the promoter that owns the name, so the
 * admin can go and use it. Checked before the insert for the message, and
 * the unique index still backstops a race — the E11000 is turned into the
 * same answer.
 */
async function assertDisplayNameAvailable(displayName, excludePromoterId = null) {
  const existing = await PromoterModel.findOne({
    displayNameKey: toDisplayNameKey(displayName),
    ...(excludePromoterId ? { _id: { $ne: excludePromoterId } } : {}),
  })
    .select("displayName kind status")
    .lean();
  if (existing) {
    throw new ApplicationError(
      409,
      ERROR_CODES.PROMOTER_NAME_TAKEN,
      `A promoter named "${existing.displayName}" already exists.`,
      {
        existingPromoterId: String(existing._id),
        existingDisplayName: existing.displayName,
        existingKind: existing.kind,
        existingStatus: existing.status,
      }
    );
  }
}

async function listPromoters(options = {}) {
  const { page, limit } = normalisePagination(options.page, options.limit);
  const filter = {};
  if (options.search) {
    filter.displayNameKey = { $regex: escapeRegex(toDisplayNameKey(options.search)) };
  }
  if (options.kind) {
    filter.kind = options.kind;
  }
  if (options.status) {
    filter.status = options.status;
  }
  const [promoters, total] = await Promise.all([
    PromoterModel.find(filter)
      .sort({ displayNameKey: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    PromoterModel.countDocuments(filter),
  ]);
  const counts = await countsForPromoters(promoters.map((row) => row._id));
  return {
    promoters: promoters.map((row) => ({ ...row.toJSON(), ...counts.get(String(row._id)) })),
    total,
    page,
    limit,
  };
}

/*
 * Creative, campaign and published-campaign counts for a PAGE of promoters
 * in two grouped aggregations — the same three figures getPromoter returns
 * for one, so a list row and its detail never disagree. Every promoter on
 * the page gets an entry, zeroes included: a promoter with nothing yet is a
 * real answer, not an absent key.
 */
async function countsForPromoters(promoterIds) {
  const counts = new Map(
    promoterIds.map((id) => [String(id), { creativeCount: 0, campaignCount: 0, publishedCampaignCount: 0 }])
  );
  if (promoterIds.length === 0) {
    return counts;
  }
  const [creativeGroups, campaignGroups] = await Promise.all([
    CreativeModel.aggregate([
      { $match: { promoterId: { $in: promoterIds } } },
      { $group: { _id: "$promoterId", count: { $sum: 1 } } },
    ]),
    CampaignModel.aggregate([
      { $match: { promoterId: { $in: promoterIds } } },
      {
        $group: {
          _id: "$promoterId",
          count: { $sum: 1 },
          published: {
            $sum: { $cond: [{ $eq: ["$status", CAMPAIGN_STATUSES.PUBLISHED] }, 1, 0] },
          },
        },
      },
    ]),
  ]);
  for (const group of creativeGroups) {
    counts.get(String(group._id)).creativeCount = group.count;
  }
  for (const group of campaignGroups) {
    const entry = counts.get(String(group._id));
    entry.campaignCount = group.count;
    entry.publishedCampaignCount = group.published;
  }
  return counts;
}

async function getPromoter(promoterId) {
  const promoter = await loadPromoterOrThrow(promoterId);
  const [creativeCount, campaignCount, publishedCampaignCount] = await Promise.all([
    CreativeModel.countDocuments({ promoterId: promoter._id }),
    CampaignModel.countDocuments({ promoterId: promoter._id }),
    CampaignModel.countDocuments({ promoterId: promoter._id, status: CAMPAIGN_STATUSES.PUBLISHED }),
  ]);
  return { ...promoter.toJSON(), creativeCount, campaignCount, publishedCampaignCount };
}

async function createPromoter(adminUserId, payload, context = {}) {
  await assertDisplayNameAvailable(payload.displayName);
  let promoter;
  try {
    promoter = await PromoterModel.create({
      displayName: payload.displayName,
      kind: payload.kind,
      contactName: payload.contactName ?? null,
      contactEmail: payload.contactEmail ?? null,
      contactPhone: payload.contactPhone ?? null,
      collegeId: payload.collegeId ?? null,
      createdByUserId: adminUserId,
    });
  } catch (error) {
    if (error?.code === DUPLICATE_KEY_ERROR_CODE) {
      await assertDisplayNameAvailable(payload.displayName); // throws the named 409
    }
    throw error;
  }
  await audit(
    adminUserId,
    AUDIT_ACTIONS.PROMOTER_CREATED,
    AUDIT_ENTITY_TYPES.PROMOTER,
    promoter._id,
    null,
    promoterSnapshot(promoter),
    context
  );
  return promoter.toJSON();
}

async function updatePromoter(adminUserId, promoterId, payload, context = {}) {
  const promoter = await loadPromoterOrThrow(promoterId);
  const beforeState = promoterSnapshot(promoter);
  if (payload.displayName !== undefined && payload.displayName !== promoter.displayName) {
    await assertDisplayNameAvailable(payload.displayName, promoter._id);
    promoter.displayName = payload.displayName;
  }
  if (payload.kind !== undefined) {
    promoter.kind = payload.kind;
  }
  for (const field of ["contactName", "contactEmail", "contactPhone", "collegeId"]) {
    if (payload[field] !== undefined) {
      promoter[field] = payload[field];
    }
  }
  await promoter.save();
  await audit(
    adminUserId,
    AUDIT_ACTIONS.PROMOTER_UPDATED,
    AUDIT_ENTITY_TYPES.PROMOTER,
    promoter._id,
    beforeState,
    promoterSnapshot(promoter),
    context
  );
  return promoter.toJSON();
}

async function archivePromoter(adminUserId, promoterId, context = {}) {
  const promoter = await loadPromoterOrThrow(promoterId);
  const published = await CampaignModel.find({
    promoterId: promoter._id,
    status: CAMPAIGN_STATUSES.PUBLISHED,
  })
    .select("name")
    .lean();
  if (published.length > 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.PROMOTER_HAS_PUBLISHED_CAMPAIGNS,
      "This promoter has published campaigns. Archive or pause those first — archiving a promoter is not a way to stop delivery.",
      { publishedCampaigns: published.map((row) => ({ id: String(row._id), name: row.name })) }
    );
  }
  if (promoter.status === PROMOTER_STATUSES.INACTIVE) {
    return promoter.toJSON(); // idempotent
  }
  const beforeState = promoterSnapshot(promoter);
  promoter.status = PROMOTER_STATUSES.INACTIVE;
  promoter.archivedAt = new Date();
  await promoter.save();
  await audit(
    adminUserId,
    AUDIT_ACTIONS.PROMOTER_ARCHIVED,
    AUDIT_ENTITY_TYPES.PROMOTER,
    promoter._id,
    beforeState,
    promoterSnapshot(promoter),
    context
  );
  return promoter.toJSON();
}

async function restorePromoter(adminUserId, promoterId, context = {}) {
  const promoter = await loadPromoterOrThrow(promoterId);
  if (promoter.status === PROMOTER_STATUSES.ACTIVE) {
    return promoter.toJSON();
  }
  const beforeState = promoterSnapshot(promoter);
  promoter.status = PROMOTER_STATUSES.ACTIVE;
  promoter.archivedAt = null;
  await promoter.save();
  await audit(
    adminUserId,
    AUDIT_ACTIONS.PROMOTER_RESTORED,
    AUDIT_ENTITY_TYPES.PROMOTER,
    promoter._id,
    beforeState,
    promoterSnapshot(promoter),
    context
  );
  return promoter.toJSON();
}

/* ------------------------------------------------------------- creatives */

function creativeSnapshot(creative) {
  return {
    promoterId: String(creative.promoterId),
    title: creative.title,
    status: creative.status,
    mediaType: creative.mediaType,
    imageUrl: creative.imageUrl ?? null,
    videoUrl: creative.videoUrl ?? null,
    linkUrl: creative.linkUrl ?? null,
    description: creative.description ?? null,
  };
}

async function loadCreativeOrThrow(creativeId) {
  const creative = mongoose.Types.ObjectId.isValid(creativeId)
    ? await CreativeModel.findById(creativeId)
    : null;
  if (!creative) {
    throw new ApplicationError(404, ERROR_CODES.CREATIVE_NOT_FOUND, "Creative not found.");
  }
  return creative;
}

/* The campaigns that run a creative, with their status and rotation weight. */
async function loadUsage(creativeIds) {
  const associations = await CampaignCreativeModel.find({ creativeId: { $in: creativeIds } }).lean();
  const campaigns = await CampaignModel.find({
    _id: { $in: associations.map((row) => row.campaignId) },
  })
    .select("name status")
    .lean();
  const campaignById = new Map(campaigns.map((row) => [String(row._id), row]));
  const usageByCreative = new Map();
  for (const association of associations) {
    const campaign = campaignById.get(String(association.campaignId));
    if (!campaign) {
      continue;
    }
    const key = String(association.creativeId);
    if (!usageByCreative.has(key)) {
      usageByCreative.set(key, []);
    }
    usageByCreative.get(key).push({
      campaignId: String(campaign._id),
      campaignName: campaign.name,
      campaignStatus: campaign.status,
      rotationWeight: association.rotationWeight,
      isActive: association.isActive,
    });
  }
  return usageByCreative;
}

async function listCreatives(options = {}) {
  await loadPromoterOrThrow(options.promoterId);
  const { page, limit } = normalisePagination(options.page, options.limit);
  const filter = { promoterId: new mongoose.Types.ObjectId(options.promoterId) };
  if (options.mediaType) {
    filter.mediaType = options.mediaType;
  }
  if (options.status) {
    filter.status = options.status;
  }
  /*
   * "In use" is membership in the association table, resolved to an id set
   * first so the page and the count agree. A promoter's creatives are tens,
   * not thousands, so the set is small.
   */
  if (options.inUse !== undefined) {
    const promoterCreativeIds = await CreativeModel.find({ promoterId: filter.promoterId })
      .select("_id")
      .lean();
    const usedIds = new Set(
      (
        await CampaignCreativeModel.find({
          creativeId: { $in: promoterCreativeIds.map((row) => row._id) },
        })
          .select("creativeId")
          .lean()
      ).map((row) => String(row.creativeId))
    );
    const matching = promoterCreativeIds
      .map((row) => row._id)
      .filter((id) => usedIds.has(String(id)) === options.inUse);
    filter._id = { $in: matching };
  }
  const [creatives, total] = await Promise.all([
    CreativeModel.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    CreativeModel.countDocuments(filter),
  ]);
  const usage = await loadUsage(creatives.map((row) => row._id));
  return {
    creatives: creatives.map((row) => ({
      ...row.toJSON(),
      campaignCount: (usage.get(String(row._id)) ?? []).length,
    })),
    total,
    page,
    limit,
  };
}

async function getCreative(creativeId) {
  const creative = await loadCreativeOrThrow(creativeId);
  const usage = await loadUsage([creative._id]);
  return { ...creative.toJSON(), campaigns: usage.get(String(creative._id)) ?? [] };
}

/* The declared medium must match the supplied media, on the merged row. */
function assertDeclaredMedia(creativeLike) {
  const details = {};
  checkDeclaredMedia(creativeLike.mediaType, creativeLike.imageUrl, creativeLike.videoUrl, details);
  if (Object.keys(details).length > 0) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "The declared media type does not match the media supplied.",
      details
    );
  }
}

async function createCreative(adminUserId, payload, context = {}) {
  const promoter = await loadPromoterOrThrow(payload.promoterId);
  if (promoter.status !== PROMOTER_STATUSES.ACTIVE) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_PROMOTER_STATE,
      "An archived promoter cannot receive new creatives. Restore it first."
    );
  }
  assertDeclaredMedia(payload);
  const creative = await CreativeModel.create({
    promoterId: promoter._id,
    title: payload.title,
    mediaType: payload.mediaType ?? CREATIVE_MEDIA_TYPES.IMAGE,
    imageUrl: payload.imageUrl ?? null,
    videoUrl: payload.videoUrl ?? null,
    linkUrl: payload.linkUrl ?? null,
    description: payload.description ?? null,
    createdByUserId: adminUserId,
  });
  await audit(
    adminUserId,
    AUDIT_ACTIONS.CREATIVE_CREATED,
    AUDIT_ENTITY_TYPES.CREATIVE,
    creative._id,
    null,
    creativeSnapshot(creative),
    context
  );
  return creative.toJSON();
}

/*
 * Allowed while a published campaign is serving it — no review step. The
 * audit entry's beforeState carries the previous media, so a bad swap can
 * be seen and put back. `servingCampaigns` in afterState says who was
 * affected at the moment of the edit.
 */
async function updateCreative(adminUserId, creativeId, payload, context = {}) {
  const creative = await loadCreativeOrThrow(creativeId);
  if (creative.status === CREATIVE_STATUSES.ARCHIVED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_CREATIVE_STATE,
      "An archived creative cannot be edited. Restore it first."
    );
  }
  const beforeState = creativeSnapshot(creative);
  for (const field of ["title", "mediaType", "imageUrl", "videoUrl", "linkUrl", "description"]) {
    if (payload[field] !== undefined) {
      creative[field] = payload[field];
    }
  }
  assertDeclaredMedia(creative);
  await creative.save();

  const usage = (await loadUsage([creative._id])).get(String(creative._id)) ?? [];
  const servingCampaigns = usage
    .filter((row) => row.campaignStatus === CAMPAIGN_STATUSES.PUBLISHED && row.isActive)
    .map((row) => ({ id: row.campaignId, name: row.campaignName }));

  await audit(
    adminUserId,
    AUDIT_ACTIONS.CREATIVE_UPDATED,
    AUDIT_ENTITY_TYPES.CREATIVE,
    creative._id,
    beforeState,
    { ...creativeSnapshot(creative), servingCampaigns },
    context
  );
  return creative.toJSON();
}

async function archiveCreative(adminUserId, creativeId, context = {}) {
  const creative = await loadCreativeOrThrow(creativeId);
  const usage = (await loadUsage([creative._id])).get(String(creative._id)) ?? [];
  const published = usage.filter((row) => row.campaignStatus === CAMPAIGN_STATUSES.PUBLISHED);
  if (published.length > 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CREATIVE_IN_PUBLISHED_CAMPAIGN,
      "This creative is running in a published campaign. Detach it or pause the campaign first.",
      { publishedCampaigns: published.map((row) => ({ id: row.campaignId, name: row.campaignName })) }
    );
  }
  if (creative.status === CREATIVE_STATUSES.ARCHIVED) {
    return creative.toJSON();
  }
  const beforeState = creativeSnapshot(creative);
  creative.status = CREATIVE_STATUSES.ARCHIVED;
  creative.archivedAt = new Date();
  await creative.save();
  await audit(
    adminUserId,
    AUDIT_ACTIONS.CREATIVE_ARCHIVED,
    AUDIT_ENTITY_TYPES.CREATIVE,
    creative._id,
    beforeState,
    creativeSnapshot(creative),
    context
  );
  return creative.toJSON();
}

async function restoreCreative(adminUserId, creativeId, context = {}) {
  const creative = await loadCreativeOrThrow(creativeId);
  if (creative.status === CREATIVE_STATUSES.ACTIVE) {
    return creative.toJSON();
  }
  const beforeState = creativeSnapshot(creative);
  creative.status = CREATIVE_STATUSES.ACTIVE;
  creative.archivedAt = null;
  await creative.save();
  await audit(
    adminUserId,
    AUDIT_ACTIONS.CREATIVE_RESTORED,
    AUDIT_ENTITY_TYPES.CREATIVE,
    creative._id,
    beforeState,
    creativeSnapshot(creative),
    context
  );
  return creative.toJSON();
}

module.exports = {
  listPromoters,
  getPromoter,
  createPromoter,
  updatePromoter,
  archivePromoter,
  restorePromoter,
  listCreatives,
  getCreative,
  createCreative,
  updateCreative,
  archiveCreative,
  restoreCreative,
};

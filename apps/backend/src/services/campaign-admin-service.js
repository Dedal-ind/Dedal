const mongoose = require("mongoose");

const { CampaignModel } = require("../models/campaign-model");
const { CampaignCreativeModel } = require("../models/campaign-creative-model");
const { CreativeModel } = require("../models/creative-model");
const { PromoterModel } = require("../models/promoter-model");
const { PlacementModel } = require("../models/placement-model");
const { DeliveryDailyRollupModel } = require("../models/delivery-rollup-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { recordAuditLog } = require("./audit-log-service");
const campaignService = require("./campaign-service");
const {
  CAMPAIGN_STATUSES,
  PROMOTER_STATUSES,
} = require("../constants/campaign-constants");

/*
 * Campaign management for the platform admin (phase 5): the lifecycle around
 * the transitions phase 2 already built, plus pause/resume, the association
 * operations, and the rules for editing a campaign that is live.
 *
 * EDITING A LIVE CAMPAIGN — the principle: an admin may RETUNE a live
 * campaign but may not rewrite what it fundamentally is, nor retroactively
 * change what already happened. "Live" here means published or paused: a
 * paused campaign is still the same commercial object with the same history.
 *
 *   Freely editable while live (retuning, audited as an ordinary update):
 *     name, displayOrder, the per-participant frequency caps, and the flight
 *     END if it moves LATER — extending a flight changes nothing that has
 *     happened. Pause state and association weights/pauses have their own
 *     operations.
 *
 *   Refused while live (rewriting what it is, or what happened):
 *     the promoter — a campaign is owned by whoever bought it; the flight
 *     START once it has passed — delivery already ran under that start; and
 *     moving the flight END EARLIER than the current moment — that would end
 *     delivery retroactively, which pause and archive exist for.
 *
 *   Editable while live but audited LOUDLY, with before and after under a
 *     distinct action: targeting, placements, priority tier, weight, pacing
 *     goal. These change who sees the campaign and how often, mid-flight, so
 *     the record must make the change unmistakable.
 *
 * PAUSE is distinct from ARCHIVE. A paused campaign stops serving at once —
 * the engine reads only status "published" — but keeps its dates and can
 * resume; resume re-runs the publish guards so a placement that filled up or
 * a creative that was archived in the meantime is caught. Archive is the end
 * of the record. Delete is for drafts only.
 */

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAXIMUM_LIMIT = 200;
const LIVE_STATUSES = [CAMPAIGN_STATUSES.PUBLISHED, CAMPAIGN_STATUSES.PAUSED];
const LOUD_FIELDS = ["targeting", "placementKeys", "priorityTier", "weight", "pacing"];

function normalisePagination(page, limit) {
  const safePage = Number.isInteger(page) && page > 0 ? page : DEFAULT_PAGE;
  const requestedLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
  return { page: safePage, limit: Math.min(requestedLimit, MAXIMUM_LIMIT) };
}

async function audit(actorUserId, action, entityType, entityId, beforeState, afterState, context) {
  await recordAuditLog({
    actorUserId,
    festId: null,
    action,
    entityType,
    entityId,
    beforeState,
    afterState,
    ...(context || {}),
  });
}

function snapshot(campaign) {
  const json = typeof campaign.toJSON === "function" ? campaign.toJSON() : campaign;
  return {
    promoterId: String(json.promoterId),
    name: json.name,
    status: json.status,
    flightStartsAt: json.flightStartsAt,
    flightEndsAt: json.flightEndsAt,
    placementKeys: [...(json.placementKeys ?? [])],
    priorityTier: json.priorityTier,
    weight: json.weight,
    pacing: { totalImpressionTarget: json.pacing?.totalImpressionTarget ?? null },
    frequencyCap: {
      maxPerDay: json.frequencyCap?.maxPerDay ?? null,
      maxPerFlight: json.frequencyCap?.maxPerFlight ?? null,
    },
    targeting: json.targeting ?? {},
    displayOrder: json.displayOrder ?? 0,
  };
}

async function loadCampaignOrThrow(campaignId) {
  const campaign = mongoose.Types.ObjectId.isValid(campaignId)
    ? await CampaignModel.findById(campaignId)
    : null;
  if (!campaign) {
    throw new ApplicationError(404, ERROR_CODES.CAMPAIGN_NOT_FOUND, "Campaign not found.");
  }
  return campaign;
}

function flightState(campaign, now) {
  if (campaign.flightStartsAt > now) {
    return "upcoming";
  }
  if (campaign.flightEndsAt <= now) {
    return "ended";
  }
  return "live";
}

/* -------------------------------------------------------------------- reads */

async function listCampaigns(options = {}, now = new Date()) {
  const { page, limit } = normalisePagination(options.page, options.limit);
  const filter = {};
  if (options.promoterId) {
    filter.promoterId = new mongoose.Types.ObjectId(options.promoterId);
  }
  if (options.status) {
    filter.status = options.status;
  }
  if (options.placementKey) {
    filter.placementKeys = options.placementKey;
  }
  /* Derived from the dates at read time, never stored. */
  if (options.flight === "live") {
    filter.flightStartsAt = { $lte: now };
    filter.flightEndsAt = { $gt: now };
  } else if (options.flight === "upcoming") {
    filter.flightStartsAt = { $gt: now };
  } else if (options.flight === "ended") {
    filter.flightEndsAt = { $lte: now };
  }

  const [campaigns, total] = await Promise.all([
    CampaignModel.find(filter)
      .sort({ flightStartsAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CampaignModel.countDocuments(filter),
  ]);
  const promoters = await PromoterModel.find({
    _id: { $in: campaigns.map((row) => row.promoterId) },
  })
    .select("displayName kind")
    .lean();
  const promoterById = new Map(promoters.map((row) => [String(row._id), row]));

  return {
    campaigns: campaigns.map((row) => ({
      ...row,
      id: String(row._id),
      flightState: flightState(row, now),
      promoter: promoterById.get(String(row.promoterId))
        ? {
            id: String(row.promoterId),
            displayName: promoterById.get(String(row.promoterId)).displayName,
            kind: promoterById.get(String(row.promoterId)).kind,
          }
        : null,
    })),
    total,
    page,
    limit,
  };
}

async function getCampaign(campaignId, now = new Date()) {
  const campaign = await loadCampaignOrThrow(campaignId);
  const [promoter, associations, placements, rollups] = await Promise.all([
    PromoterModel.findById(campaign.promoterId).select("displayName kind status").lean(),
    CampaignCreativeModel.find({ campaignId: campaign._id }).lean(),
    PlacementModel.find({ key: { $in: campaign.placementKeys } }).lean(),
    DeliveryDailyRollupModel.aggregate([
      { $match: { campaignId: campaign._id } },
      {
        $group: {
          _id: null,
          decision: { $sum: "$decision" },
          measurable: { $sum: "$measurable" },
          viewable: { $sum: "$viewable" },
          click: { $sum: "$click" },
        },
      },
    ]),
  ]);
  const creatives = await CreativeModel.find({
    _id: { $in: associations.map((row) => row.creativeId) },
  }).lean();
  const creativeById = new Map(creatives.map((row) => [String(row._id), row]));
  const counts = rollups[0] ?? null;

  return {
    ...campaign.toJSON(),
    flightState: flightState(campaign, now),
    promoter: promoter
      ? { id: String(promoter._id), displayName: promoter.displayName, kind: promoter.kind, status: promoter.status }
      : null,
    creatives: associations.map((association) => {
      const creative = creativeById.get(String(association.creativeId));
      return {
        associationId: String(association._id),
        creativeId: String(association.creativeId),
        rotationWeight: association.rotationWeight,
        isActive: association.isActive,
        title: creative?.title ?? null,
        mediaType: creative?.mediaType ?? null,
        imageUrl: creative?.imageUrl ?? null,
        videoUrl: creative?.videoUrl ?? null,
        status: creative?.status ?? null,
      };
    }),
    placements: placements.map((placement) => ({
      key: placement.key,
      label: placement.label,
      isActive: placement.isActive,
      maxPublishedCampaigns: placement.maxPublishedCampaigns,
    })),
    delivery: counts
      ? { decision: counts.decision, measurable: counts.measurable, viewable: counts.viewable, click: counts.click }
      : null,
  };
}

/* ------------------------------------------------------------------- writes */

async function createCampaign(adminUserId, payload, context = {}) {
  const promoter = await PromoterModel.findById(payload.promoterId).lean();
  if (!promoter) {
    throw new ApplicationError(404, ERROR_CODES.PROMOTER_NOT_FOUND, "Promoter not found.");
  }
  if (promoter.status !== PROMOTER_STATUSES.ACTIVE) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_PROMOTER_STATE,
      "An archived promoter cannot own a new campaign. Restore it first."
    );
  }
  const campaign = await campaignService.createCampaign(adminUserId, payload, context);
  return campaign.toJSON();
}

/*
 * The live-edit rules, applied field by field against the CURRENT row, then
 * one save. A draft takes everything. A live campaign takes the retunes,
 * refuses the rewrites, and gets the loud audit for the tuning fields.
 */
async function updateCampaign(adminUserId, campaignId, payload, context = {}, now = new Date()) {
  const campaign = await loadCampaignOrThrow(campaignId);
  if (campaign.status === CAMPAIGN_STATUSES.ARCHIVED) {
    throw new ApplicationError(409, ERROR_CODES.INVALID_CAMPAIGN_STATE, "An archived campaign cannot be edited.");
  }
  const isLive = LIVE_STATUSES.includes(campaign.status);
  const beforeState = snapshot(campaign);
  const refusals = {};

  if (payload.promoterId !== undefined && payload.promoterId !== String(campaign.promoterId)) {
    if (isLive) {
      refusals.promoterId = "cannot change once published; a campaign belongs to whoever bought it";
    } else {
      const associationCount = await CampaignCreativeModel.countDocuments({ campaignId: campaign._id });
      if (associationCount > 0) {
        refusals.promoterId = "detach its creatives first; they belong to the current promoter";
      } else {
        const promoter = await PromoterModel.findById(payload.promoterId).lean();
        if (!promoter || promoter.status !== PROMOTER_STATUSES.ACTIVE) {
          refusals.promoterId = "must name an active promoter";
        } else {
          campaign.promoterId = promoter._id;
        }
      }
    }
  }

  if (payload.flightStartsAt !== undefined) {
    const changed = payload.flightStartsAt.getTime() !== campaign.flightStartsAt.getTime();
    if (changed && isLive && campaign.flightStartsAt <= now) {
      refusals.flightStartsAt = "cannot change once the flight has started; delivery already ran under it";
    } else if (changed) {
      campaign.flightStartsAt = payload.flightStartsAt;
    }
  }

  if (payload.flightEndsAt !== undefined) {
    const changed = payload.flightEndsAt.getTime() !== campaign.flightEndsAt.getTime();
    if (changed && isLive && payload.flightEndsAt <= now) {
      refusals.flightEndsAt = "cannot move earlier than now on a live campaign; pause or archive it instead";
    } else if (changed) {
      campaign.flightEndsAt = payload.flightEndsAt;
    }
  }

  if (Object.keys(refusals).length > 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CAMPAIGN_EDIT_REFUSED_WHILE_LIVE,
      "Some of these changes are not allowed on a campaign in its current state.",
      refusals
    );
  }

  for (const field of ["name", "displayOrder", "frequencyCap", ...LOUD_FIELDS]) {
    if (payload[field] !== undefined) {
      campaign[field] = payload[field];
    }
  }
  await campaign.save();
  const afterState = snapshot(campaign);

  const loudChanges = isLive
    ? LOUD_FIELDS.filter(
        (field) => JSON.stringify(beforeState[field]) !== JSON.stringify(afterState[field])
      )
    : [];
  await audit(
    adminUserId,
    loudChanges.length > 0 ? AUDIT_ACTIONS.CAMPAIGN_RETUNED_LIVE : AUDIT_ACTIONS.CAMPAIGN_UPDATED,
    AUDIT_ENTITY_TYPES.CAMPAIGN,
    campaign._id,
    beforeState,
    loudChanges.length > 0 ? { ...afterState, liveRetunedFields: loudChanges } : afterState,
    context
  );
  return campaign.toJSON();
}

async function publishCampaign(adminUserId, campaignId, context = {}) {
  const campaign = await loadCampaignOrThrow(campaignId);
  if (campaign.status === CAMPAIGN_STATUSES.PAUSED) {
    throw new ApplicationError(409, ERROR_CODES.INVALID_CAMPAIGN_STATE, "A paused campaign is resumed, not published.");
  }
  return (await campaignService.publishCampaign(adminUserId, campaignId, context)).toJSON();
}

async function pauseCampaign(adminUserId, campaignId, context = {}) {
  const campaign = await loadCampaignOrThrow(campaignId);
  if (campaign.status === CAMPAIGN_STATUSES.PAUSED) {
    return campaign.toJSON();
  }
  if (campaign.status !== CAMPAIGN_STATUSES.PUBLISHED) {
    throw new ApplicationError(409, ERROR_CODES.INVALID_CAMPAIGN_STATE, "Only a published campaign can be paused.");
  }
  const beforeState = snapshot(campaign);
  campaign.status = CAMPAIGN_STATUSES.PAUSED;
  campaign.pausedAt = new Date();
  await campaign.save();
  await audit(adminUserId, AUDIT_ACTIONS.CAMPAIGN_PAUSED, AUDIT_ENTITY_TYPES.CAMPAIGN, campaign._id, beforeState, snapshot(campaign), context);
  return campaign.toJSON();
}

/*
 * Resume re-runs every publish guard — the world may have moved while paused
 * — through the same assertPublishable the publish transition uses. The row
 * goes paused → published directly; it never becomes a draft, and exactly
 * one audit entry (campaign.resumed) is written.
 */
async function resumeCampaign(adminUserId, campaignId, context = {}) {
  const campaign = await loadCampaignOrThrow(campaignId);
  if (campaign.status === CAMPAIGN_STATUSES.PUBLISHED) {
    return campaign.toJSON();
  }
  if (campaign.status !== CAMPAIGN_STATUSES.PAUSED) {
    throw new ApplicationError(409, ERROR_CODES.INVALID_CAMPAIGN_STATE, "Only a paused campaign can be resumed.");
  }
  await campaignService.assertPublishable(campaign);
  const beforeState = snapshot(campaign);
  campaign.status = CAMPAIGN_STATUSES.PUBLISHED;
  campaign.pausedAt = null;
  await campaign.save();
  await audit(adminUserId, AUDIT_ACTIONS.CAMPAIGN_RESUMED, AUDIT_ENTITY_TYPES.CAMPAIGN, campaign._id, beforeState, snapshot(campaign), context);
  return campaign.toJSON();
}

async function archiveCampaign(adminUserId, campaignId, context = {}) {
  return (await campaignService.archiveCampaign(adminUserId, campaignId, context)).toJSON();
}

async function deleteCampaign(adminUserId, campaignId, context = {}) {
  return campaignService.deleteCampaign(adminUserId, campaignId, context);
}

/* ------------------------------------------------------------ associations */

async function loadAssociationOrThrow(campaign, creativeId) {
  const association = mongoose.Types.ObjectId.isValid(creativeId)
    ? await CampaignCreativeModel.findOne({ campaignId: campaign._id, creativeId })
    : null;
  if (!association) {
    throw new ApplicationError(404, ERROR_CODES.CREATIVE_NOT_FOUND, "That creative is not attached to this campaign.");
  }
  return association;
}

/*
 * A published campaign must keep at least one ACTIVE association: it was
 * publishable because it had something to show, and it would otherwise be
 * live with nothing. Pausing the campaign is the way to stop it.
 */
async function assertNotLastActive(campaign, association) {
  if (campaign.status !== CAMPAIGN_STATUSES.PUBLISHED || !association.isActive) {
    return;
  }
  const otherActive = await CampaignCreativeModel.countDocuments({
    campaignId: campaign._id,
    _id: { $ne: association._id },
    isActive: true,
  });
  if (otherActive === 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CAMPAIGN_LAST_ACTIVE_CREATIVE,
      "This is the only active creative on a published campaign. Attach or activate another first, or pause the campaign."
    );
  }
}

function associationSnapshot(association) {
  return {
    campaignId: String(association.campaignId),
    creativeId: String(association.creativeId),
    rotationWeight: association.rotationWeight,
    isActive: association.isActive,
  };
}

/* Attach goes through phase 2's guarded upsert (promoter match, archived creative). */
async function attachCreative(adminUserId, campaignId, payload, context = {}) {
  const campaign = await loadCampaignOrThrow(campaignId);
  if (campaign.status === CAMPAIGN_STATUSES.ARCHIVED) {
    throw new ApplicationError(409, ERROR_CODES.INVALID_CAMPAIGN_STATE, "An archived campaign cannot be edited.");
  }
  const existing = await CampaignCreativeModel.findOne({ campaignId: campaign._id, creativeId: payload.creativeId });
  if (existing && payload.isActive === false) {
    await assertNotLastActive(campaign, existing);
  }
  const association = await campaignService.attachCreative(adminUserId, campaignId, payload, context);
  return association.toJSON();
}

async function updateAssociation(adminUserId, campaignId, creativeId, payload, context = {}) {
  const campaign = await loadCampaignOrThrow(campaignId);
  const association = await loadAssociationOrThrow(campaign, creativeId);
  const beforeState = associationSnapshot(association);
  if (payload.isActive === false && association.isActive) {
    await assertNotLastActive(campaign, association);
  }
  if (payload.rotationWeight !== undefined) {
    association.rotationWeight = payload.rotationWeight;
  }
  if (payload.isActive !== undefined) {
    association.isActive = payload.isActive;
  }
  await association.save();
  await audit(adminUserId, AUDIT_ACTIONS.CAMPAIGN_CREATIVE_UPDATED, AUDIT_ENTITY_TYPES.CAMPAIGN_CREATIVE, association._id, beforeState, associationSnapshot(association), context);
  return association.toJSON();
}

async function detachCreative(adminUserId, campaignId, creativeId, context = {}) {
  const campaign = await loadCampaignOrThrow(campaignId);
  const association = await loadAssociationOrThrow(campaign, creativeId);
  await assertNotLastActive(campaign, association);
  const beforeState = associationSnapshot(association);
  await association.deleteOne();
  await audit(adminUserId, AUDIT_ACTIONS.CAMPAIGN_CREATIVE_DETACHED, AUDIT_ENTITY_TYPES.CAMPAIGN_CREATIVE, association._id, beforeState, null, context);
  return { detached: true };
}

module.exports = {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  publishCampaign,
  pauseCampaign,
  resumeCampaign,
  archiveCampaign,
  deleteCampaign,
  attachCreative,
  updateAssociation,
  detachCreative,
  flightState,
};

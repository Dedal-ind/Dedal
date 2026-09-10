const mongoose = require("mongoose");

const { PromotionModel, PROMOTION_STATUSES, PROMOTION_TYPES } = require("../models/promotion-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { recordAuditLog } = require("./audit-log-service");

/*
 * Home-screen promotions, owned by the platform admin. Two types share this
 * service: commercial banners and college-event promotions (see
 * promotion-model for what each means).
 *
 * The 20-published cap lives HERE, in the publish transition, not on the schema:
 * it is a business rule about how much a participant should be asked to scroll
 * through, not a structural constraint. A draft or archived row is unaffected by
 * it, so an admin can prepare a dozen banners and publish them as slots free up.
 *
 * The cap is PER TYPE, not across both. The two types render as two separate
 * carousels on the participant home screen, so twenty commercial banners cost a
 * college-event promotion nothing — counting them together would let a run of
 * sponsor ads lock colleges out of a section they do not compete for.
 */
const MAXIMUM_PUBLISHED_PROMOTION_COUNT_PER_TYPE = 20;

function validatePromotionType(promotionType) {
  if (!Object.values(PROMOTION_TYPES).includes(promotionType)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Choose a promotion type.", {
      promotionType: `must be one of: ${Object.values(PROMOTION_TYPES).join(", ")}`,
    });
  }
  return promotionType;
}

/*
 * A college-event promotion without a college name is context-free — the
 * participant sees a banner and cannot tell who is promoting. Commercial
 * promotions have no college at all, so a name supplied for one is DROPPED
 * rather than rejected: the admin console hides the field on that tab, and a
 * stale value from a mistyped payload must not reach the participant app.
 */
function resolveCollegeName(promotionType, suppliedCollegeName) {
  if (promotionType !== PROMOTION_TYPES.COLLEGE_EVENT) {
    return null;
  }
  const trimmedCollegeName = (suppliedCollegeName ?? "").trim();
  if (!trimmedCollegeName) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "Name the college promoting this event.",
      { collegeName: "is required for a college event promotion" }
    );
  }
  return trimmedCollegeName;
}

async function loadPromotionOrThrow(promotionId) {
  const promotion = mongoose.Types.ObjectId.isValid(promotionId)
    ? await PromotionModel.findById(promotionId)
    : null;
  if (!promotion) {
    throw new ApplicationError(404, ERROR_CODES.PROMOTION_NOT_FOUND, "Promotion not found.");
  }
  return promotion;
}

async function recordPromotionAudit(actorUserId, promotion, action, context, afterState) {
  await recordAuditLog({
    actorUserId,
    // Platform-wide, so there is no fest to scope the row to.
    festId: null,
    action,
    entityType: AUDIT_ENTITY_TYPES.PROMOTION,
    entityId: promotion._id,
    afterState,
    ...(context || {}),
  });
}

async function createPromotion(adminUserId, payload, context = {}) {
  const promotionType = validatePromotionType(payload.promotionType);
  // Always a draft: publishing is a separate, deliberate act.
  const promotion = await PromotionModel.create({
    title: payload.title,
    promotionType,
    mediaType: payload.mediaType === "video" ? "video" : "image",
    imageUrl: payload.imageUrl || null,
    videoUrl: payload.videoUrl || null,
    linkUrl: payload.linkUrl || null,
    description: payload.description || null,
    collegeName: resolveCollegeName(promotionType, payload.collegeName),
    displayOrder: payload.displayOrder ?? 0,
    createdByUserId: adminUserId,
  });
  await recordPromotionAudit(adminUserId, promotion, AUDIT_ACTIONS.PROMOTION_CREATED, context, {
    title: promotion.title,
    promotionType: promotion.promotionType,
  });
  return promotion.toJSON();
}

/* Editable while draft OR published — fixing a typo must not need a takedown. */
async function updatePromotion(adminUserId, promotionId, payload, context = {}) {
  const promotion = await loadPromotionOrThrow(promotionId);
  if (promotion.status === PROMOTION_STATUSES.ARCHIVED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_PROMOTION_STATE,
      "An archived promotion cannot be edited. Re-publish it first."
    );
  }
  /*
   * promotionType is deliberately NOT in this list. The type decides which cap
   * a row counts against and which reorder sequence it sits in, so flipping it
   * on a published promotion would push one section over its cap and leave a
   * hole in the other's ordering. Archive and re-create instead.
   */
  for (const field of [
    "title",
    "mediaType",
    "imageUrl",
    "videoUrl",
    "linkUrl",
    "description",
    "displayOrder",
  ]) {
    if (payload[field] !== undefined) {
      promotion[field] = payload[field] === "" ? null : payload[field];
    }
  }
  if (payload.collegeName !== undefined) {
    promotion.collegeName = resolveCollegeName(promotion.promotionType, payload.collegeName);
  }
  await promotion.save();
  await recordPromotionAudit(adminUserId, promotion, AUDIT_ACTIONS.PROMOTION_UPDATED, context, {
    title: promotion.title,
    promotionType: promotion.promotionType,
  });
  return promotion.toJSON();
}

async function publishPromotion(adminUserId, promotionId, context = {}) {
  const promotion = await loadPromotionOrThrow(promotionId);
  if (promotion.status === PROMOTION_STATUSES.PUBLISHED) {
    return promotion.toJSON(); // idempotent
  }

  // Scoped to this promotion's own type — see the cap comment at the top.
  const publishedCount = await PromotionModel.countDocuments({
    promotionType: promotion.promotionType,
    status: PROMOTION_STATUSES.PUBLISHED,
  });
  if (publishedCount >= MAXIMUM_PUBLISHED_PROMOTION_COUNT_PER_TYPE) {
    throw new ApplicationError(
      409,
      ERROR_CODES.PROMOTION_PUBLISH_LIMIT_REACHED,
      `At most ${MAXIMUM_PUBLISHED_PROMOTION_COUNT_PER_TYPE} promotions of this type can be published at once. Archive one first.`,
      {
        promotionType: promotion.promotionType,
        publishedCount,
        maximumPublishedCount: MAXIMUM_PUBLISHED_PROMOTION_COUNT_PER_TYPE,
      }
    );
  }

  promotion.status = PROMOTION_STATUSES.PUBLISHED;
  promotion.publishedAt = new Date();
  promotion.archivedAt = null;
  await promotion.save();
  await recordPromotionAudit(adminUserId, promotion, AUDIT_ACTIONS.PROMOTION_PUBLISHED, context, {
    title: promotion.title,
    promotionType: promotion.promotionType,
    publishedAt: promotion.publishedAt,
  });
  return promotion.toJSON();
}

/* Hides it from the participant app immediately; re-publishable later. */
async function archivePromotion(adminUserId, promotionId, context = {}) {
  const promotion = await loadPromotionOrThrow(promotionId);
  promotion.status = PROMOTION_STATUSES.ARCHIVED;
  promotion.archivedAt = new Date();
  await promotion.save();
  await recordPromotionAudit(adminUserId, promotion, AUDIT_ACTIONS.PROMOTION_ARCHIVED, context, {
    title: promotion.title,
    promotionType: promotion.promotionType,
  });
  return promotion.toJSON();
}

/*
 * Hard delete, drafts only. The model's own guard is the backstop; this gives
 * the caller a proper 409 instead of a raw mongoose error.
 */
async function deletePromotion(adminUserId, promotionId, context = {}) {
  const promotion = await loadPromotionOrThrow(promotionId);
  if (promotion.status !== PROMOTION_STATUSES.DRAFT) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_PROMOTION_STATE,
      "Only a draft promotion can be deleted. Archive it instead — a promotion that ran is part of the record."
    );
  }
  await promotion.deleteOne();
  await recordPromotionAudit(adminUserId, promotion, AUDIT_ACTIONS.PROMOTION_DELETED, context, {
    title: promotion.title,
    promotionType: promotion.promotionType,
  });
  return { deleted: true };
}

/*
 * The admin's ordering for ONE type, applied as a whole. displayOrder becomes
 * the index in the array they submitted, so the list they see IS the list
 * participants get. Ids not named are left alone.
 *
 * Every id is checked against the named type BEFORE anything is written: the
 * two types are two independent sequences, and half-applying an order that
 * mixed them would renumber the wrong carousel with no way to tell what it
 * used to be.
 */
async function reorderPromotions(adminUserId, promotionType, orderedPromotionIds, context = {}) {
  validatePromotionType(promotionType);
  const validIds = (orderedPromotionIds ?? []).filter((promotionId) =>
    mongoose.Types.ObjectId.isValid(promotionId)
  );
  if (validIds.length === 0) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Name the promotions to order.", {
      orderedPromotionIds: "is required",
    });
  }

  const namedPromotions = await PromotionModel.find({ _id: { $in: validIds } })
    .select("promotionType")
    .lean();
  const mismatchedIds = namedPromotions
    .filter((promotion) => promotion.promotionType !== promotionType)
    .map((promotion) => String(promotion._id));
  if (mismatchedIds.length > 0) {
    throw new ApplicationError(
      409,
      ERROR_CODES.PROMOTION_TYPE_MISMATCH,
      "Promotions can only be reordered within their own type.",
      { promotionType, mismatchedPromotionIds: mismatchedIds }
    );
  }

  for (const [index, promotionId] of validIds.entries()) {
    await PromotionModel.updateOne({ _id: promotionId }, { $set: { displayOrder: index } });
  }
  await recordAuditLog({
    actorUserId: adminUserId,
    festId: null,
    action: AUDIT_ACTIONS.PROMOTION_REORDERED,
    entityType: AUDIT_ENTITY_TYPES.PROMOTION,
    entityId: null,
    afterState: { promotionType, orderedCount: validIds.length },
    ...context,
  });
  return { promotionType, orderedCount: validIds.length };
}

/* The admin console's list: every promotion of every type, whatever its state. */
async function listAllPromotions() {
  const promotions = await PromotionModel.find({})
    .sort({ promotionType: 1, status: 1, displayOrder: 1, createdAt: -1 })
    .lean();
  return { promotions: promotions.map((row) => ({ ...row, id: String(row._id) })) };
}

/*
 * The PUBLIC projection. A dedicated whitelist, not the model with fields
 * stripped client-side: an unauthenticated caller must never see
 * createdByUserId, draft rows, or the scheduling stamps.
 */
function toPublicPromotion(promotion) {
  return {
    id: String(promotion._id),
    title: promotion.title,
    promotionType: promotion.promotionType,
    mediaType: promotion.mediaType ?? "image",
    imageUrl: promotion.imageUrl ?? null,
    videoUrl: promotion.videoUrl ?? null,
    linkUrl: promotion.linkUrl ?? null,
    description: promotion.description ?? null,
    collegeName: promotion.collegeName ?? null,
    displayOrder: promotion.displayOrder,
  };
}

async function getPublishedPromotions(promotionType) {
  validatePromotionType(promotionType);
  const promotions = await PromotionModel.find({
    promotionType,
    status: PROMOTION_STATUSES.PUBLISHED,
  })
    .select("title promotionType mediaType imageUrl videoUrl linkUrl description collegeName displayOrder")
    .sort({ displayOrder: 1, createdAt: 1 })
    .lean();
  return promotions.map(toPublicPromotion);
}

/*
 * Both types in ONE query, keyed by type. The participant home screen renders
 * two independent carousels and needs both before it can lay itself out —
 * two round trips would mean two chances to fail and a visible reflow between
 * the sections.
 */
async function getPublishedPromotionsBoth() {
  const promotions = await PromotionModel.find({ status: PROMOTION_STATUSES.PUBLISHED })
    .select("title promotionType mediaType imageUrl videoUrl linkUrl description collegeName displayOrder")
    .sort({ displayOrder: 1, createdAt: 1 })
    .lean();
  return {
    [PROMOTION_TYPES.COMMERCIAL]: promotions
      .filter((promotion) => promotion.promotionType === PROMOTION_TYPES.COMMERCIAL)
      .map(toPublicPromotion),
    [PROMOTION_TYPES.COLLEGE_EVENT]: promotions
      .filter((promotion) => promotion.promotionType === PROMOTION_TYPES.COLLEGE_EVENT)
      .map(toPublicPromotion),
  };
}

module.exports = {
  createPromotion,
  updatePromotion,
  publishPromotion,
  archivePromotion,
  deletePromotion,
  reorderPromotions,
  listAllPromotions,
  getPublishedPromotions,
  getPublishedPromotionsBoth,
  MAXIMUM_PUBLISHED_PROMOTION_COUNT_PER_TYPE,
};

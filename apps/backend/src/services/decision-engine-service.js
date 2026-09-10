const crypto = require("crypto");
const mongoose = require("mongoose");

const { CampaignModel } = require("../models/campaign-model");
const { CreativeModel } = require("../models/creative-model");
const { CampaignCreativeModel } = require("../models/campaign-creative-model");
const { PlacementModel } = require("../models/placement-model");
const { PromoterModel } = require("../models/promoter-model");
const { CollegeModel } = require("../models/college-model");
const { RegistrationModel } = require("../models/registration-model");
const { EventModel } = require("../models/event-model");
const { DecisionTokenModel, DECISION_TOKEN_TTL_SECONDS } = require("../models/decision-token-model");
const { readCounts } = require("./frequency-cap-service");
const { establishAnonymousSession } = require("./anonymous-session-service");
const { recordDecisionEvent } = require("./delivery-service");
const { isUnderEighteen } = require("../helpers/age-helpers");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const {
  CAMPAIGN_STATUSES,
  PLACEMENT_KEYS,
  TARGETING_DIMENSIONS,
} = require("../constants/campaign-constants");
const { ACTIVE_REGISTRATION_STATUSES } = require("../constants/registration-constants");

/*
 * THE DECISION ENGINE: given a placement and a participant, which creative
 * (if any) to show, and a single-use token proving it was decided.
 *
 * Eligibility → cap removal → tier → weighted campaign → weighted creative.
 * Everything here is first-party and contextual. The only inputs are the
 * placement the participant is looking at and the attributes they declared
 * on their own profile; nothing about what they did, looked at or clicked is
 * read, stored or inferred.
 *
 * THIS PHASE WRITES NOTHING about the participant. The only write is the
 * decision token, which records the DECISION, not the person. Impressions,
 * clicks and the cap ledger increments belong to the delivery phase.
 */

/* Pacing can raise or damp a weight within this band, and never beyond it:
   the floor keeps an over-delivering campaign servable, the ceiling keeps an
   under-delivering one from swamping its tier. Never zero, never tier-breaking. */
const PACING_FACTOR_FLOOR = 0.25;
const PACING_FACTOR_CEILING = 4;

/* ---------------------------------------------------------------- subject */

/*
 * WHO the decision is for, as far as the cap ledger and the token are
 * concerned.
 *
 * THE AGE GATE. When the age predicate says under eighteen — OR returns null
 * because there is no date of birth — the participant is treated as a child:
 *   - targeting is not evaluated at all; only campaigns whose predicate is
 *     entirely empty are eligible (decideEligibility);
 *   - the cap ledger and the token are keyed to a SERVER-ESTABLISHED
 *     anonymous session key (anonymous-session-service), never to the
 *     participant's identity, so no per-person exposure record exists.
 * Unknown takes the same path as a minor on purpose. India's DPDP Act, 2023
 * prohibits tracking, behavioural monitoring and targeted advertising aimed
 * at children with no consent workaround, and treating an unknown age as an
 * adult is precisely the failure that carries the penalty.
 *
 * The session key is REQUIRED for a restricted subject: the caller must have
 * established one first (decide does). There is deliberately no fallback to
 * a per-request random key — that made every cap unenforceable for exactly
 * the participants the cap protects.
 */
function resolveSubject(user, sessionKey) {
  const underEighteen = isUnderEighteen(user?.dateOfBirth);
  const isAgeRestricted = underEighteen === true || underEighteen === null;
  if (isAgeRestricted) {
    if (typeof sessionKey !== "string" || sessionKey.length === 0) {
      throw new Error("An age-restricted subject needs an established anonymous session key.");
    }
    return { subjectKey: `session:${sessionKey}`, subjectKind: "session", isAgeRestricted: true };
  }
  return { subjectKey: `user:${String(user._id)}`, subjectKind: "participant", isAgeRestricted: false };
}

/* Whether the age gate applies, without needing a session yet. */
function isAgeRestrictedUser(user) {
  const underEighteen = isUnderEighteen(user?.dateOfBirth);
  return underEighteen === true || underEighteen === null;
}

/* ---------------------------------------------------------------- targeting */

function toStringSet(values) {
  return new Set((values ?? []).map((value) => String(value)));
}

function isTargetingSetEmpty(set) {
  return TARGETING_DIMENSIONS.every((dimension) => (set?.[dimension] ?? []).length === 0);
}

/* True when the predicate constrains nothing at all — the only campaigns a
   child, or a participant of unknown age, may be shown. */
function isTargetingEmpty(targeting) {
  return isTargetingSetEmpty(targeting?.include) && isTargetingSetEmpty(targeting?.exclude);
}

/*
 * The participant's DECLARED attributes, in the shape the predicate names.
 * Every value here is something they typed into their profile or an open act
 * (registering for a fest). Nothing else may be added to this object.
 *
 *   collegeIds    — their college
 *   cities        — their college's city (the only city we know)
 *   departments   — their course
 *   yearsOfStudy  — their year
 *   festIds       — fests they hold an active registration in
 */
async function loadDeclaredAttributesForUsers(users) {
  const collegeIds = [...new Set(users.map((user) => user.collegeId).filter(Boolean).map(String))];
  const colleges = collegeIds.length
    ? await CollegeModel.find({ _id: { $in: collegeIds } }).select("city").lean()
    : [];
  const cityByCollegeId = new Map(
    colleges.map((college) => [String(college._id), String(college.city ?? "").trim().toLowerCase()])
  );

  const registrations = users.length
    ? await RegistrationModel.find({
        userId: { $in: users.map((user) => user._id) },
        status: { $in: ACTIVE_REGISTRATION_STATUSES },
      })
        .select("userId festId eventId")
        .lean()
    : [];
  const eventIdsWithoutFest = registrations.filter((row) => !row.festId).map((row) => row.eventId);
  const festByEventId = new Map();
  if (eventIdsWithoutFest.length > 0) {
    const events = await EventModel.find({ _id: { $in: eventIdsWithoutFest } }).select("festId").lean();
    events.forEach((event) => festByEventId.set(String(event._id), String(event.festId)));
  }
  const festIdsByUser = new Map();
  for (const row of registrations) {
    const festId = row.festId ? String(row.festId) : festByEventId.get(String(row.eventId));
    if (!festId) {
      continue;
    }
    const key = String(row.userId);
    if (!festIdsByUser.has(key)) {
      festIdsByUser.set(key, new Set());
    }
    festIdsByUser.get(key).add(festId);
  }

  const attributesByUser = new Map();
  for (const user of users) {
    const city = user.collegeId ? cityByCollegeId.get(String(user.collegeId)) : null;
    attributesByUser.set(String(user._id), {
      collegeIds: user.collegeId ? [String(user.collegeId)] : [],
      cities: city ? [city] : [],
      departments: user.department ? [String(user.department).trim().toLowerCase()] : [],
      yearsOfStudy: Number.isInteger(user.yearOfStudy) ? [String(user.yearOfStudy)] : [],
      festIds: [...(festIdsByUser.get(String(user._id)) ?? [])],
    });
  }
  return attributesByUser;
}

/* One participant: the batch loader for a list of one, so there is exactly
   one place the attributes are sourced — the engine and the reach estimate
   (targeting-service) cannot disagree about what a person's attributes are. */
async function loadDeclaredAttributes(user) {
  return (await loadDeclaredAttributesForUsers([user])).get(String(user._id));
}

function normaliseDimensionValues(dimension, values) {
  const list = (values ?? []).map(String);
  return dimension === "cities" || dimension === "departments"
    ? list.map((value) => value.trim().toLowerCase())
    : list;
}

/*
 * Include-then-exclude over the declared dimensions only. An absent or empty
 * set means no constraint on that dimension. Every non-empty include set must
 * intersect the participant's values; any exclude intersection loses.
 */
function evaluateTargeting(targeting, attributes) {
  const include = targeting?.include ?? {};
  const exclude = targeting?.exclude ?? {};
  for (const dimension of TARGETING_DIMENSIONS) {
    const wanted = normaliseDimensionValues(dimension, include[dimension]);
    if (wanted.length > 0) {
      const own = toStringSet(attributes[dimension]);
      if (!wanted.some((value) => own.has(value))) {
        return false;
      }
    }
  }
  for (const dimension of TARGETING_DIMENSIONS) {
    const banned = normaliseDimensionValues(dimension, exclude[dimension]);
    if (banned.length > 0) {
      const own = toStringSet(attributes[dimension]);
      if (banned.some((value) => own.has(value))) {
        return false;
      }
    }
  }
  return true;
}

/* -------------------------------------------------------------- eligibility */

/*
 * The campaigns that MAY serve on this placement to this subject, each with
 * its active creative associations. A campaign is eligible when it is
 * published, names an active placement, is inside its flight window, has at
 * least one active creative, the subject satisfies its targeting (or, for an
 * age-restricted subject, its targeting is empty), and the subject is under
 * both of its frequency caps.
 */
async function listEligibleCampaigns({ placementKey, user, subject, now = new Date() }) {
  if (!Object.values(PLACEMENT_KEYS).includes(placementKey)) {
    throw new ApplicationError(400, ERROR_CODES.VALIDATION_FAILED, "Unknown placement.", {
      placementKey: String(placementKey),
    });
  }
  const placement = await PlacementModel.findOne({ key: placementKey }).lean();
  if (!placement || !placement.isActive) {
    return [];
  }

  const candidates = await CampaignModel.find({
    status: CAMPAIGN_STATUSES.PUBLISHED,
    placementKeys: placementKey,
    flightStartsAt: { $lte: now },
    flightEndsAt: { $gt: now },
  }).lean();
  if (candidates.length === 0) {
    return [];
  }

  const associations = await CampaignCreativeModel.find({
    campaignId: { $in: candidates.map((row) => row._id) },
    isActive: true,
  }).lean();
  const associationsByCampaign = new Map();
  for (const association of associations) {
    const key = String(association.campaignId);
    if (!associationsByCampaign.has(key)) {
      associationsByCampaign.set(key, []);
    }
    associationsByCampaign.get(key).push(association);
  }

  const attributes = subject.isAgeRestricted ? null : await loadDeclaredAttributes(user);

  const withTargeting = candidates.filter((campaign) => {
    if (!associationsByCampaign.has(String(campaign._id))) {
      return false;
    }
    if (subject.isAgeRestricted) {
      return isTargetingEmpty(campaign.targeting);
    }
    return evaluateTargeting(campaign.targeting, attributes);
  });
  if (withTargeting.length === 0) {
    return [];
  }

  // Caps are removed BEFORE selection, never after: a capped campaign must
  // not win the draw and then be swapped for a runner-up.
  const counts = await readCounts({
    subjectKey: subject.subjectKey,
    campaignIds: withTargeting.map((row) => row._id),
    at: now,
  });
  return withTargeting
    .filter((campaign) => {
      const seen = counts.get(String(campaign._id));
      const maxPerDay = campaign.frequencyCap?.maxPerDay ?? null;
      const maxPerFlight = campaign.frequencyCap?.maxPerFlight ?? null;
      if (maxPerDay !== null && seen.daily >= maxPerDay) {
        return false;
      }
      if (maxPerFlight !== null && seen.flight >= maxPerFlight) {
        return false;
      }
      return true;
    })
    .map((campaign) => ({
      campaign,
      associations: associationsByCampaign.get(String(campaign._id)),
    }));
}

/* ---------------------------------------------------------------- selection */

/*
 * Pacing DAMPS, it never gates. A campaign with an impression goal has an
 * expected share of its flight elapsed; running ahead of that share reduces
 * its weight, behind raises it. The factor is clamped to a band that never
 * reaches zero, and it is applied within a tier only — tier order is decided
 * before weights are looked at, so pacing can never promote a campaign past
 * a higher tier or demote it below one.
 */
function pacingFactor(campaign, now) {
  const target = campaign.pacing?.totalImpressionTarget ?? null;
  if (!target) {
    return 1;
  }
  const start = new Date(campaign.flightStartsAt).getTime();
  const end = new Date(campaign.flightEndsAt).getTime();
  if (!(end > start)) {
    return 1;
  }
  const elapsedFraction = Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
  const delivered = campaign.pacing?.deliveredImpressions ?? 0;
  const deliveredFraction = delivered / target;
  // A small epsilon keeps a brand-new flight (nothing expected, nothing
  // delivered) at exactly 1 rather than dividing zero by zero.
  const epsilon = 0.01;
  const ratio = (elapsedFraction + epsilon) / (deliveredFraction + epsilon);
  return Math.min(PACING_FACTOR_CEILING, Math.max(PACING_FACTOR_FLOOR, ratio));
}

/* Weighted random over positive weights; `random` is injectable for tests. */
function pickWeighted(items, weightOf, random) {
  const weights = items.map((item) => Math.max(weightOf(item), Number.EPSILON));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random() * total;
  for (let index = 0; index < items.length; index += 1) {
    cursor -= weights[index];
    if (cursor < 0) {
      return items[index];
    }
  }
  return items[items.length - 1];
}

function selectFromEligible(eligible, { now = new Date(), random = Math.random } = {}) {
  if (eligible.length === 0) {
    return null;
  }
  const topTier = Math.min(...eligible.map((entry) => entry.campaign.priorityTier));
  const inTier = eligible.filter((entry) => entry.campaign.priorityTier === topTier);
  const winner = pickWeighted(
    inTier,
    (entry) => entry.campaign.weight * pacingFactor(entry.campaign, now),
    random
  );
  const association = pickWeighted(
    winner.associations,
    (row) => row.rotationWeight,
    random
  );
  return { campaign: winner.campaign, association };
}

/* ------------------------------------------------------------------ tokens */

async function mintDecisionToken({ campaign, association, placementKey, subject, now }) {
  return DecisionTokenModel.create({
    token: crypto.randomBytes(24).toString("base64url"),
    campaignId: campaign._id,
    creativeId: association.creativeId,
    placementKey,
    subjectKey: subject.subjectKey,
    subjectKind: subject.subjectKind,
    decidedAt: now,
    expiresAt: new Date(now.getTime() + DECISION_TOKEN_TTL_SECONDS * 1000),
  });
}

/*
 * Consumes a token exactly once. One atomic conditional update: the row must
 * exist, be unconsumed and unexpired, and the same statement marks it
 * consumed — so two concurrent reports of the same token can never both
 * succeed. The delivery phase calls this; nothing does yet.
 */
async function consumeDecisionToken(token, now = new Date()) {
  const consumed =
    typeof token === "string" && token.length > 0
      ? await DecisionTokenModel.findOneAndUpdate(
          { token, consumedAt: null, expiresAt: { $gt: now } },
          { $set: { consumedAt: now } },
          { new: true }
        )
      : null;
  if (!consumed) {
    throw new ApplicationError(
      409,
      ERROR_CODES.DECISION_TOKEN_INVALID,
      "This decision token is unknown, already used, or expired."
    );
  }
  return consumed;
}

/* ---------------------------------------------------------------- decide */

/*
 * The whole thing, end to end. Returns { fill: true, decision } or
 * { fill: false, reason } — NO-FILL IS A NORMAL OUTCOME, NOT AN ERROR.
 *
 * For an age-restricted subject the anonymous session is established HERE:
 * a presented key is kept if the server minted it and it is live, otherwise
 * a fresh one is minted. The key in use is returned as `sessionKey` on every
 * result (fill or not) so the controller can hand it back to the client. An
 * adult never gets one — their subject is their own id — and sessionKey is
 * null for them.
 */
async function decide({ placementKey, user, sessionKey, now = new Date(), random = Math.random }) {
  let session = null;
  if (isAgeRestrictedUser(user)) {
    session = await establishAnonymousSession(sessionKey, now);
  }
  const subject = resolveSubject(user, session ? session.key : null);
  const sessionEnvelope = {
    subjectKind: subject.subjectKind,
    sessionKey: session ? session.key : null,
    sessionExpiresAt: session ? session.expiresAt : null,
  };

  const eligible = await listEligibleCampaigns({ placementKey, user, subject, now });
  const selection = selectFromEligible(eligible, { now, random });
  if (!selection) {
    return { fill: false, reason: "noEligibleCampaign", ...sessionEnvelope };
  }

  const [creative, promoter, token] = await Promise.all([
    CreativeModel.findById(selection.association.creativeId).lean(),
    PromoterModel.findById(selection.campaign.promoterId).select("displayName kind").lean(),
    mintDecisionToken({ ...selection, placementKey, subject, now }),
  ]);
  // The server's own record of what it chose — the "decision" tier. The
  // client reports the other tiers against this token.
  await recordDecisionEvent(token.toObject(), now);
  if (!creative) {
    return { fill: false, reason: "creativeMissing", ...sessionEnvelope };
  }

  return {
    fill: true,
    ...sessionEnvelope,
    decision: {
      token: token.token,
      expiresAt: token.expiresAt,
      placementKey,
      campaignId: String(selection.campaign._id),
      creative: {
        id: String(creative._id),
        mediaType: creative.mediaType,
        imageUrl: creative.imageUrl ?? null,
        videoUrl: creative.videoUrl ?? null,
        linkUrl: creative.linkUrl ?? null,
        title: creative.title,
        description: creative.description ?? null,
      },
      promoter: promoter
        ? { id: String(promoter._id), displayName: promoter.displayName, kind: promoter.kind }
        : null,
    },
  };
}

module.exports = {
  resolveSubject,
  isAgeRestrictedUser,
  loadDeclaredAttributes,
  loadDeclaredAttributesForUsers,
  evaluateTargeting,
  isTargetingEmpty,
  listEligibleCampaigns,
  pacingFactor,
  pickWeighted,
  selectFromEligible,
  mintDecisionToken,
  consumeDecisionToken,
  decide,
  PACING_FACTOR_FLOOR,
  PACING_FACTOR_CEILING,
};

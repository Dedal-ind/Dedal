const { ContingentModel } = require("../models/contingent-model");
const { ContingentClaimModel } = require("../models/contingent-claim-model");
const { EventModel } = require("../models/event-model");
const { FestModel } = require("../models/fest-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { assertAdministratorOfFest } = require("../helpers/assert-administrator-of-fest");
const { recordAuditLog } = require("../services/audit-log-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { EVENT_TYPES, EVENT_STATUSES, FEE_TYPES } = require("../constants/event-constants");
const {
  CONTINGENT_STATUSES,
  CONTINGENT_CLAIM_STATUSES,
  CONTINGENT_EVENTS_MINIMUM,
} = require("../constants/contingent-constants");

async function loadFestOrThrow(festId) {
  const fest = await FestModel.findById(festId);
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  return fest;
}

async function loadContingentOrThrow(festId, contingentId) {
  const contingent = await ContingentModel.findOne({ _id: contingentId, festId });
  if (!contingent) {
    // A contingent under a different fest is the same 404, so the endpoint
    // cannot be used to probe which contingent ids exist elsewhere.
    throw new ApplicationError(404, ERROR_CODES.CONTINGENT_NOT_FOUND, "Contingent not found.");
  }
  return contingent;
}

/*
 * C.4 — checked FIRST, before any per-sub-event validation: a contingent under a
 * paid parent event double-charges (the bundle price plus the parent's own fee).
 * The client's example parent (a "management" container like Chidaranga) is
 * expected to be free; a fee on it is an admin mistake worth its own code.
 */
/*
 * C.4 as a QUESTION, not only as a refusal. The scope read has to tell the admin
 * form "this parent charges its own fee" before anyone fills a form in, and the
 * create path has to refuse it — both ask this one predicate, so the rule has a
 * single definition. A fest-level bundle has no parent, and so no second fee to
 * collide with.
 */
function parentEventHasFee(parentEvent) {
  if (!parentEvent) {
    return false;
  }
  return parentEvent.feeType !== FEE_TYPES.FREE || parentEvent.feeAmountPaise > 0;
}

function assertParentEventHasNoFee(parentEvent) {
  /* A fest-level bundle has no parent event, so there is no second fee to
     collide with — the check simply does not apply. */
  if (parentEventHasFee(parentEvent)) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_PARENT_HAS_FEE,
      "The parent event has its own registration fee — a contingent under it would double-charge.",
      { parentEventId: String(parentEvent._id), feeAmountPaise: parentEvent.feeAmountPaise }
    );
  }
}

/*
 * C.1 — every included sub-event must sit in scope (this parent's child, or a
 * TOP-LEVEL event of the fest when the bundle is fest-level), published, and
 * SOLO. Team events inside a contingent are pathological: the attendee would
 * need to form a team, which the buyer cannot do on their behalf.
 */
/*
 * WHY ONE EVENT CANNOT GO IN A BUNDLE, as a list of plain reasons.
 *
 * Extracted so the create/publish refusal and the admin scope read cannot
 * disagree. Before this, the form re-implemented the rule in the browser —
 * greying out team events but not draft ones — so it offered choices the server
 * then refused with a generic 400. Now the form draws exactly the verdict the
 * server will reach, from the same function, and an empty array is the only
 * thing that means "eligible".
 */
function describeEventEligibilityProblems(event, parentEvent) {
  const problems = [];
  if (parentEvent) {
    if (String(event.parentEventId) !== String(parentEvent._id)) {
      problems.push("is not a sub-event of the parent event");
    }
  } else if (event.parentEventId) {
    /* A fest-level bundle covers the fest's TOP-LEVEL events. A nested event
       belongs to a container, and bundling it here would sell a seat from
       under a main event whose own contingent may already include it. */
    problems.push("is not a top-level event of this fest");
  }
  if (event.status !== EVENT_STATUSES.PUBLISHED) {
    problems.push("is not published");
  }
  if (event.eventType !== EVENT_TYPES.SOLO) {
    problems.push("is a team event — a contingent wraps solo sub-events only");
  }
  return problems;
}

async function loadIncludedEventsOrThrow(fest, parentEvent, includedEventIds) {
  const events = await EventModel.find({ _id: { $in: includedEventIds }, festId: fest._id });
  if (events.length !== includedEventIds.length) {
    throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Event not found.", {
      festId: String(fest._id),
    });
  }

  const details = {};
  for (const event of events) {
    const problems = describeEventEligibilityProblems(event, parentEvent);
    if (problems.length > 0) {
      details[String(event._id)] = problems.join("; ");
    }
  }
  if (Object.keys(details).length > 0) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "One or more sub-events cannot be included in a contingent.",
      { includedEventIds: details }
    );
  }
  return events;
}

/*
 * C.1 — no two live contingents in the SAME scope (the same parent event, or the
 * same fest for a fest-level bundle) may share a sub-event:
 * overlapping bundles make refunds ambiguous (whose purchase does the shared
 * seat belong to?). The same sub-event under a DIFFERENT parent is allowed —
 * the sub-event's own capacity is the constraint there (edge case I.7).
 */
async function assertNoPublishedOverlap(festId, parentEventId, includedEventIds, excludeContingentId) {
  const conflicting = await ContingentModel.findOne({
    /*
     * festId is in the filter because parentEventId is now nullable: without it,
     * one fest's fest-level bundle (parentEventId null) would collide with every
     * OTHER fest's fest-level bundle, which share the same null.
     */
    festId,
    parentEventId: parentEventId ?? null,
    status: CONTINGENT_STATUSES.PUBLISHED,
    includedEventIds: { $in: includedEventIds },
    ...(excludeContingentId ? { _id: { $ne: excludeContingentId } } : {}),
  })
    .select("contingentName includedEventIds")
    .lean();
  if (conflicting) {
    const sharedEventIds = conflicting.includedEventIds
      .map(String)
      .filter((eventId) => includedEventIds.map(String).includes(eventId));
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_EVENT_CONFLICT,
      `A published contingent already includes one of these sub-events: "${conflicting.contingentName}".`,
      {
        conflictingContingentId: String(conflicting._id),
        conflictingContingentName: conflicting.contingentName,
        sharedEventIds,
      }
    );
  }
}

/* C.3 — a bundle priced above the individual sum is not a discount; the admin
 * must say allowNegativeDiscount: true to prove the number is intentional. */
function assertPriceIsIntentional(pricePaise, individualTotalPaise, allowNegativeDiscount) {
  if (pricePaise > individualTotalPaise && !allowNegativeDiscount) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "The bundle price exceeds the sum of the individual fees. Set allowNegativeDiscount to confirm this is intentional.",
      { pricePaise, individualTotalPaise }
    );
  }
}

async function countClaims(contingentId) {
  return ContingentClaimModel.countDocuments({ contingentId });
}

async function createContingent(actorUserId, festId, payload, context = {}) {
  const fest = await loadFestOrThrow(festId);
  await assertAdministratorOfFest(actorUserId, fest._id);

  /*
   * Two shapes of scope, one code path. A parentEventId names the container the
   * bundle hangs under (fest → main event → verticals); null means the bundle
   * hangs off the fest itself and covers its top-level events (fest → events).
   */
  let parentEvent = null;
  if (payload.parentEventId) {
    parentEvent = await EventModel.findOne({ _id: payload.parentEventId, festId: fest._id });
    if (!parentEvent) {
      throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Parent event not found.");
    }
  }
  assertParentEventHasNoFee(parentEvent);
  const includedEvents = await loadIncludedEventsOrThrow(fest, parentEvent, payload.includedEventIds);
  await assertNoPublishedOverlap(fest._id, parentEvent?._id ?? null, payload.includedEventIds, null);

  // C.2 — recomputed server-side; a client-submitted total is never trusted.
  const individualTotalPaise = includedEvents.reduce(
    (runningTotal, event) => runningTotal + event.feeAmountPaise,
    0
  );
  assertPriceIsIntentional(payload.pricePaise, individualTotalPaise, payload.allowNegativeDiscount);

  const contingent = await ContingentModel.create({
    festId: fest._id,
    parentEventId: parentEvent ? parentEvent._id : null,
    contingentName: payload.contingentName,
    description: payload.description,
    includedEventIds: payload.includedEventIds,
    pricePaise: payload.pricePaise,
    individualTotalPaise,
    maximumBundleClaims: payload.maximumBundleClaims,
    status: CONTINGENT_STATUSES.DRAFT,
    createdByUserId: actorUserId,
  });

  await recordAuditLog({
    actorUserId,
    festId: fest._id,
    action: AUDIT_ACTIONS.CONTINGENT_CREATED,
    entityType: AUDIT_ENTITY_TYPES.CONTINGENT,
    entityId: contingent._id,
    afterState: {
      contingentName: contingent.contingentName,
      includedEventIds: contingent.includedEventIds.map(String),
      pricePaise: contingent.pricePaise,
    },
    ...context,
  });

  return contingent.toJSON();
}

async function updateContingent(actorUserId, festId, contingentId, payload, context = {}) {
  const fest = await loadFestOrThrow(festId);
  await assertAdministratorOfFest(actorUserId, fest._id);
  const contingent = await loadContingentOrThrow(fest._id, contingentId);

  const wantsStructuralEdit =
    payload.includedEventIds !== undefined ||
    payload.pricePaise !== undefined ||
    payload.maximumBundleClaims !== undefined;

  /*
   * C.5 — structural fields (included events, price, bundle cap) are editable
   * only while DRAFT with zero claims. One purchase freezes them for good; name
   * and description stay editable so copy fixes never need a second contingent.
   */
  if (wantsStructuralEdit) {
    const claimCount = await countClaims(contingent._id);
    if (contingent.status !== CONTINGENT_STATUSES.DRAFT || claimCount > 0) {
      throw new ApplicationError(
        409,
        ERROR_CODES.CONTINGENT_IMMUTABLE_AFTER_PURCHASE,
        "The included events and price are frozen once the contingent is published or purchased. Only the name and description can change.",
        { status: contingent.status, claimCount }
      );
    }
  }

  const beforeState = {
    contingentName: contingent.contingentName,
    includedEventIds: contingent.includedEventIds.map(String),
    pricePaise: contingent.pricePaise,
    maximumBundleClaims: contingent.maximumBundleClaims,
  };

  if (payload.contingentName !== undefined) {
    contingent.contingentName = payload.contingentName;
  }
  if (payload.description !== undefined) {
    contingent.description = payload.description;
  }
  if (payload.maximumBundleClaims !== undefined) {
    contingent.maximumBundleClaims = payload.maximumBundleClaims;
  }

  const parentEvent = contingent.parentEventId
    ? await EventModel.findById(contingent.parentEventId)
    : null;
  if (payload.includedEventIds !== undefined) {
    const includedEvents = await loadIncludedEventsOrThrow(fest, parentEvent, payload.includedEventIds);
    await assertNoPublishedOverlap(
      fest._id,
      contingent.parentEventId,
      payload.includedEventIds,
      contingent._id
    );
    contingent.includedEventIds = payload.includedEventIds;
    // C.2 — the snapshot follows an edit; it never follows a later fee change.
    contingent.individualTotalPaise = includedEvents.reduce(
      (runningTotal, event) => runningTotal + event.feeAmountPaise,
      0
    );
  }
  if (payload.pricePaise !== undefined) {
    contingent.pricePaise = payload.pricePaise;
  }
  if (payload.includedEventIds !== undefined || payload.pricePaise !== undefined) {
    assertPriceIsIntentional(
      contingent.pricePaise,
      contingent.individualTotalPaise,
      payload.allowNegativeDiscount
    );
  }

  await contingent.save();
  await recordAuditLog({
    actorUserId,
    festId: fest._id,
    action: AUDIT_ACTIONS.CONTINGENT_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.CONTINGENT,
    entityId: contingent._id,
    beforeState,
    afterState: {
      contingentName: contingent.contingentName,
      includedEventIds: contingent.includedEventIds.map(String),
      pricePaise: contingent.pricePaise,
      maximumBundleClaims: contingent.maximumBundleClaims,
    },
    ...context,
  });

  return contingent.toJSON();
}

async function publishContingent(actorUserId, festId, contingentId, context = {}) {
  const fest = await loadFestOrThrow(festId);
  await assertAdministratorOfFest(actorUserId, fest._id);
  const contingent = await loadContingentOrThrow(fest._id, contingentId);

  if (contingent.status !== CONTINGENT_STATUSES.DRAFT) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_EVENT_STATE,
      "Only a draft contingent can be published.",
      { currentStatus: contingent.status }
    );
  }

  /*
   * Everything is re-checked at publish, not just trusted from creation: the
   * sub-events may have been cancelled, re-fee'd, or claimed by another
   * contingent that published in the meantime.
   */
  const parentEvent = contingent.parentEventId
    ? await EventModel.findById(contingent.parentEventId)
    : null;
  assertParentEventHasNoFee(parentEvent);
  await loadIncludedEventsOrThrow(fest, parentEvent, contingent.includedEventIds.map(String));
  await assertNoPublishedOverlap(
    fest._id,
    contingent.parentEventId,
    contingent.includedEventIds,
    contingent._id
  );

  contingent.status = CONTINGENT_STATUSES.PUBLISHED;
  await contingent.save();

  await recordAuditLog({
    actorUserId,
    festId: fest._id,
    action: AUDIT_ACTIONS.CONTINGENT_PUBLISHED,
    entityType: AUDIT_ENTITY_TYPES.CONTINGENT,
    entityId: contingent._id,
    afterState: { status: contingent.status },
    ...context,
  });

  return contingent.toJSON();
}

/*
 * EVERYTHING THE ADMIN FORM NEEDS FOR ONE SCOPE, in one read.
 *
 * A scope is a Main Event (parentEventId set) or the fest itself (null). The
 * participant side has always treated a scope as holding SEVERAL bundles — the
 * public reads return a list per parent and purchase works per bundle — but the
 * admin form assumed exactly one, and could not even find that one: it read the
 * list endpoint's { contingents } envelope as if it were a bare array, never
 * matched an existing bundle, and POSTed a fresh duplicate on every save until
 * a published copy made the next save a CONTINGENT_EVENT_CONFLICT.
 *
 * So instead of the form reconstructing a scope from a flat list and
 * re-deriving the rules, the server returns the scope already resolved:
 *
 *   scope           — who it is, whether the parent's own fee blocks it, and a
 *                     machine-readable blockedReason (the client owns the copy);
 *   candidateEvents — every event that could be bundled here, each with the
 *                     same eligibility verdict create/publish will reach, and
 *                     the published bundle in THIS scope already selling it;
 *   contingents     — every non-cancelled bundle in the scope, with its claim
 *                     count and whether C.5 has frozen its structure.
 *
 * WHAT COUNTS AS A CANDIDATE. For a Main Event, its direct children. For the
 * fest, its top-level events that are not themselves containers: a container is
 * a grouping, not a seat, so bundling it would sell nothing. That is the set the
 * structure screen already offered; it is defined here now so it has one home.
 */
async function getContingentScope(actorUserId, festId, parentEventId) {
  const fest = await loadFestOrThrow(festId);
  await assertAdministratorOfFest(actorUserId, fest._id);

  let parentEvent = null;
  if (parentEventId) {
    parentEvent = await EventModel.findOne({ _id: parentEventId, festId: fest._id }).lean();
    if (!parentEvent) {
      throw new ApplicationError(404, ERROR_CODES.EVENT_NOT_FOUND, "Parent event not found.");
    }
  }

  const candidateFields = "eventName eventType status feeAmountPaise parentEventId siblingRank";
  let candidates;
  if (parentEvent) {
    candidates = await EventModel.find({ festId: fest._id, parentEventId: parentEvent._id })
      .select(candidateFields)
      .lean();
  } else {
    const [topLevelEvents, containerIds] = await Promise.all([
      EventModel.find({ festId: fest._id, parentEventId: null }).select(candidateFields).lean(),
      EventModel.distinct("parentEventId", { festId: fest._id, parentEventId: { $ne: null } }),
    ]);
    const containerKeys = new Set(containerIds.map(String));
    candidates = topLevelEvents.filter((event) => !containerKeys.has(String(event._id)));
  }

  /* Structure order, not alphabetical — the same order the rearrange table
     shows, so the form lists events where the admin just saw them. String ranks
     compare by code unit, not by locale. */
  candidates.sort((first, second) => {
    const firstRank = first.siblingRank ?? null;
    const secondRank = second.siblingRank ?? null;
    if (firstRank === secondRank) {
      return String(first.eventName).localeCompare(String(second.eventName));
    }
    if (firstRank === null) return 1;
    if (secondRank === null) return -1;
    return firstRank < secondRank ? -1 : 1;
  });

  const contingents = await ContingentModel.find({
    festId: fest._id,
    parentEventId: parentEvent ? parentEvent._id : null,
    status: { $ne: CONTINGENT_STATUSES.CANCELLED },
  }).sort({ createdAt: 1 });

  const claimGroups =
    contingents.length > 0
      ? await ContingentClaimModel.aggregate([
          { $match: { contingentId: { $in: contingents.map((contingent) => contingent._id) } } },
          { $group: { _id: "$contingentId", claimCount: { $sum: 1 } } },
        ])
      : [];
  const claimCountByContingentId = new Map(
    claimGroups.map((group) => [String(group._id), group.claimCount])
  );

  /*
   * Only PUBLISHED bundles claim an event, matching assertNoPublishedOverlap:
   * two drafts may share events while an admin is still deciding, and it is
   * publishing that makes the overlap real.
   */
  const publishedBundleByEventId = new Map();
  for (const contingent of contingents) {
    if (contingent.status !== CONTINGENT_STATUSES.PUBLISHED) {
      continue;
    }
    for (const eventId of contingent.includedEventIds) {
      const key = String(eventId);
      if (!publishedBundleByEventId.has(key)) {
        publishedBundleByEventId.set(key, {
          id: String(contingent._id),
          contingentName: contingent.contingentName,
        });
      }
    }
  }

  const candidateEvents = candidates.map((event) => {
    const problems = describeEventEligibilityProblems(event, parentEvent);
    return {
      id: String(event._id),
      eventName: event.eventName,
      eventType: event.eventType,
      status: event.status,
      feeAmountPaise: event.feeAmountPaise ?? 0,
      isEligible: problems.length === 0,
      ineligibleReasons: problems,
      inPublishedContingent: publishedBundleByEventId.get(String(event._id)) ?? null,
    };
  });

  const hasOwnFee = parentEventHasFee(parentEvent);
  const eligibleEventCount = candidateEvents.filter((event) => event.isEligible).length;
  let blockedReason = null;
  if (hasOwnFee) {
    blockedReason = "parentHasFee";
  } else if (eligibleEventCount < CONTINGENT_EVENTS_MINIMUM) {
    blockedReason = "notEnoughEligibleEvents";
  }

  return {
    scope: {
      festId: String(fest._id),
      parentEventId: parentEvent ? String(parentEvent._id) : null,
      isFestLevel: !parentEvent,
      scopeName: parentEvent ? parentEvent.eventName : fest.festName,
      parentHasFee: hasOwnFee,
      eligibleEventCount,
      minimumEventCount: CONTINGENT_EVENTS_MINIMUM,
      blockedReason,
    },
    candidateEvents,
    contingents: contingents.map((contingent) => {
      const claimCount = claimCountByContingentId.get(String(contingent._id)) ?? 0;
      return {
        ...contingent.toJSON(),
        includedEventIds: contingent.includedEventIds.map(String),
        claimCount,
        /* C.5, stated as data so the form disables the fields rather than
           letting the admin edit a price the save will refuse. */
        isStructureLocked: contingent.status !== CONTINGENT_STATUSES.DRAFT || claimCount > 0,
      };
    }),
  };
}

async function listFestContingents(actorUserId, festId) {
  const fest = await loadFestOrThrow(festId);
  await assertAdministratorOfFest(actorUserId, fest._id);
  const contingents = await ContingentModel.find({ festId: fest._id }).sort({ createdAt: -1 });
  return contingents.map((contingent) => contingent.toJSON());
}

async function getContingentDetail(actorUserId, festId, contingentId) {
  const fest = await loadFestOrThrow(festId);
  await assertAdministratorOfFest(actorUserId, fest._id);
  const contingent = await loadContingentOrThrow(fest._id, contingentId);

  const claimCountsByStatus = Object.fromEntries(
    Object.values(CONTINGENT_CLAIM_STATUSES).map((claimStatus) => [claimStatus, 0])
  );
  const groupedCounts = await ContingentClaimModel.aggregate([
    { $match: { contingentId: contingent._id } },
    { $group: { _id: "$claimStatus", claimCount: { $sum: 1 } } },
  ]);
  for (const group of groupedCounts) {
    claimCountsByStatus[group._id] = group.claimCount;
  }

  const includedEvents = await EventModel.find({ _id: { $in: contingent.includedEventIds } })
    .select("eventName eventSlug feeAmountPaise status capacity registeredCount")
    .lean();

  return {
    contingent: contingent.toJSON(),
    claimCountsByStatus,
    includedEvents: includedEvents.map((event) => ({ ...event, id: String(event._id) })),
  };
}

/*
 * The participant-facing list: PUBLISHED bundles under one parent event, with
 * the included events' names for the card. Public in the same sense the fest's
 * public event list is — no caller identity involved.
 */
/*
 * The participant-facing decoration, extracted so the per-event read and the
 * per-fest read cannot drift.
 *
 * This is the whole reason the batched endpoint is a refactor rather than a
 * second implementation: the two responses have to be byte-for-byte the same
 * shape, because the client slots the batched result into exactly the places
 * the per-event result used to fill. Two copies of this mapping is how one of
 * them quietly loses includedEvents six months from now.
 *
 * One query for every included event across every contingent in the batch, not
 * one per contingent.
 */
async function decorateContingentsWithIncludedEvents(contingents) {
  if (contingents.length === 0) {
    return [];
  }
  const allIncludedEventIds = contingents.flatMap((contingent) => contingent.includedEventIds);
  const includedEvents = await EventModel.find({ _id: { $in: allIncludedEventIds } })
    .select("eventName eventSlug feeAmountPaise")
    .lean();
  const eventById = new Map(includedEvents.map((event) => [String(event._id), event]));

  return contingents.map((contingent) => {
    const plainContingent = contingent.toJSON();
    plainContingent.includedEvents = contingent.includedEventIds
      .map((eventId) => eventById.get(String(eventId)))
      .filter(Boolean)
      .map((event) => ({
        id: String(event._id),
        eventName: event.eventName,
        eventSlug: event.eventSlug,
        feeAmountPaise: event.feeAmountPaise,
      }));
    return plainContingent;
  });
}

async function listPublicContingentsForParentEvent(parentEventId) {
  const contingents = await ContingentModel.find({
    parentEventId,
    status: CONTINGENT_STATUSES.PUBLISHED,
  }).sort({ createdAt: 1 });
  return decorateContingentsWithIncludedEvents(contingents);
}

/*
 * EVERY published bundle in one fest, in ONE request, grouped by the container
 * it hangs under.
 *
 * WHY THIS EXISTS. The fest detail screen asked
 * /public/events/:eventId/contingents once per top-level container — eight
 * requests on Alliance ONE 2026, on top of the fest and its event tree. At the
 * public limiter's real ceiling of 100 requests per 15 minutes that is ten
 * requests a page load, so roughly nine loads exhausted a browsing session.
 *
 * AND IT FIXES A BLIND SPOT, not just a request count. parentEventId is
 * NULLABLE: null means a FEST-LEVEL bundle covering the fest's top-level events
 * (see createContingent). The per-event fan-out could never ask for those —
 * there is no event id to ask under — so a fest-level bundle was invisible to
 * participants no matter how many requests the client made. Scoping the query
 * by festId is what surfaces them, which is why they are returned in their own
 * bucket rather than dropped for not fitting the grouping.
 *
 * The caller proves the fest is publicly visible before calling this; status
 * filtering here is per contingent, exactly as the per-event read does it.
 */
async function listPublicContingentsForFest(festId) {
  const contingents = await ContingentModel.find({
    festId,
    status: CONTINGENT_STATUSES.PUBLISHED,
  }).sort({ createdAt: 1 });

  const decorated = await decorateContingentsWithIncludedEvents(contingents);

  const contingentsByParentEventId = {};
  const festLevelContingents = [];
  decorated.forEach((contingent) => {
    if (!contingent.parentEventId) {
      festLevelContingents.push(contingent);
      return;
    }
    const key = String(contingent.parentEventId);
    if (!contingentsByParentEventId[key]) {
      contingentsByParentEventId[key] = [];
    }
    contingentsByParentEventId[key].push(contingent);
  });

  return { contingentsByParentEventId, festLevelContingents };
}

/*
 * Section H — cancelling a sub-event that a live contingent includes is BLOCKED:
 * the claims against it would point at an event that no longer runs. The admin
 * must unwind the contingent first. Called from event-service.cancelEvent.
 */
async function assertEventNotLockedByContingent(eventId) {
  const lockingContingent = await ContingentModel.findOne({
    includedEventIds: eventId,
    status: CONTINGENT_STATUSES.PUBLISHED,
  })
    .select("contingentName")
    .lean();
  if (lockingContingent) {
    throw new ApplicationError(
      409,
      ERROR_CODES.CONTINGENT_LOCKS_EVENT,
      `This event is part of the live contingent "${lockingContingent.contingentName}". Cancel that contingent first.`,
      {
        contingentId: String(lockingContingent._id),
        contingentName: lockingContingent.contingentName,
      }
    );
  }
}

module.exports = {
  createContingent,
  updateContingent,
  publishContingent,
  listFestContingents,
  getContingentScope,
  getContingentDetail,
  listPublicContingentsForParentEvent,
  listPublicContingentsForFest,
  assertEventNotLockedByContingent,
  loadContingentOrThrow,
};

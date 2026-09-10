const mongoose = require("mongoose");

const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { StaffAssignmentModel } = require("../models/staff-assignment-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { FEST_STATUSES, PUBLICLY_VISIBLE_FEST_STATUSES } = require("../constants/fest-constants");
const { EVENT_CATEGORY_MAX_LENGTH, EVENT_STATUSES } = require("../constants/event-constants");
const { STAFF_ROLES, STAFF_ASSIGNMENT_STATUSES } = require("../constants/staff-constants");
const { generateFestSlug } = require("../helpers/generate-fest-slug");
const { insertFestWithUniqueSlug } = require("../helpers/insert-fest-with-unique-slug");
const { assertAdministrator } = require("../helpers/administrator-helpers");
const { ensureGateCheckpoint, ensureOfferCheckpoints } = require("../helpers/checkpoint-helpers");
const { RESERVED_OFFER_KEYS } = require("../constants/fest-constants");
const { recordAuditLog } = require("./audit-log-service");
const { refreshGateAccessWindowsForFest } = require("./pass-service");
const { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } = require("../constants/audit-log-constants");
const { applicationConfig } = require("../config/application-config");

/*
 * A QR-ready link derived from the slug and the frontend base URL at read time, so
 * it can never drift from a stored copy. The frontend encodes it into a QR image.
 *
 * An EXPLICIT allowlist, not `...fest.toJSON()`: an unauthenticated caller hits
 * this, so any admin-only field on the Fest schema (createdByUserId, the
 * cancellation/archive trail, the certificate template, the allowed-college
 * targeting list) must be opted IN here to ever reach a public response —
 * added silently by a schema change is exactly the leak this replaced.
 */
function buildPublicFestResponse(fest) {
  const hasActiveOffer = (offerKey) =>
    (fest.offers ?? []).some((offer) => offer.offerKey === offerKey && offer.isActive !== false);
  const json = fest.toJSON();
  return {
    id: json.id,
    festName: json.festName,
    festSlug: json.festSlug,
    description: json.description,
    hostCollegeId: json.hostCollegeId,
    startsOn: json.startsOn,
    endsOn: json.endsOn,
    bannerImageUrl: json.bannerImageUrl,
    contactEmail: json.contactEmail,
    /*
     * contactPhone is deliberately NOT here. This response is unauthenticated,
     * and public-browse.integration asserts the organiser's number never reaches
     * it: an email address on a fest page is a desk, a mobile number is a person.
     * Administrators read it through the admin fest endpoints instead.
     */
    status: json.status,
    offers: json.offers,
    sponsors: json.sponsors,
    /*
     * Compatibility projection: the participant app still reads these two
     * booleans to decide whether registration asks the food/stay questions.
     * They are now DERIVED from the offers list (reserved keys), so behaviour is
     * unchanged while the storage generalised.
     */
    offersFood: hasActiveOffer(RESERVED_OFFER_KEYS.FOOD),
    offersAccommodation: hasActiveOffer(RESERVED_OFFER_KEYS.ACCOMMODATION),
    shareableUrl: `${applicationConfig.frontendBaseUrl}/fests/${fest.festSlug}`,
  };
}

// Only the changed fields go into an update's before/after snapshot, never the whole document.
function pickFields(source, keys) {
  return keys.reduce((accumulator, key) => {
    accumulator[key] = source[key];
    return accumulator;
  }, {});
}

/*
 * A malformed id is a miss, not a fault: findById would raise a CastError and
 * surface as a 500 rather than the 404 the caller deserves.
 */
async function findFestOrThrow(festId) {
  const fest = mongoose.Types.ObjectId.isValid(festId)
    ? await FestModel.findById(festId)
    : null;

  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  return fest;
}

async function createFest(userId, festAttributes, context = {}) {
  // Re-checked here even though the middleware already ran: defence in depth.
  await assertAdministrator(userId, festAttributes.hostCollegeId);

  const baseSlug = generateFestSlug(festAttributes.festName);
  if (baseSlug.length === 0) {
    throw new ApplicationError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      "festName must contain at least one letter or digit.",
      { festName: "produces an empty slug" }
    );
  }

  const fest = await insertFestWithUniqueSlug(
    { ...festAttributes, createdByUserId: userId },
    baseSlug
  );

  await recordAuditLog({
    actorUserId: userId,
    festId: fest._id,
    action: AUDIT_ACTIONS.FEST_CREATED,
    entityType: AUDIT_ENTITY_TYPES.FEST,
    entityId: fest._id,
    afterState: pickFields(fest, ["festName", "visibility", "startsOn", "endsOn"]),
    ...context,
  });

  return fest.toJSON();
}

/*
 * Every admin screen's fest list — 17 of them call GET /fests/mine.
 *
 * SCOPED BY ROLE, NOT BY AUTHORSHIP. This used to be find({ createdByUserId }),
 * which quietly meant "fests I personally typed in": a platformAdmin — the role
 * documented as passing every college and fest admin check — saw NOTHING, and a
 * college administrator added after a fest was created saw nothing of their own
 * college's work. Both rendered as "You have no fests yet" on a database full of
 * fests, because an empty list is indistinguishable from no access.
 *
 * The scope now matches what assertAdministratorOfFest already enforces on every
 * write, so a fest an admin can EDIT is a fest they can SEE. Those two answers
 * disagreeing is what made this look like a data problem rather than a query one.
 *
 * Revoked assignments are excluded (status must be active), so removing someone's
 * grant removes the fests from their console on their next read.
 */
async function fetchFestsForAdministrator(userId) {
  const assignments = await StaffAssignmentModel.find({
    userId,
    status: STAFF_ASSIGNMENT_STATUSES.ACTIVE,
  }).lean();

  const isPlatformAdmin = assignments.some(
    (assignment) => assignment.role === STAFF_ROLES.PLATFORM_ADMIN
  );

  let filter;
  if (isPlatformAdmin) {
    // Platform scope is the whole table; there is no owner or college to narrow by.
    filter = {};
  } else {
    /*
     * A college administrator sees their college's fests however they were
     * created, PLUS anything they authored themselves — the second half matters
     * for a fest created before the assignment existed, or hosted by a college
     * they are no longer staff of. Deduplicated because one user may hold
     * several assignments at the same college.
     *
     * Only administrator rows contribute a college: coordinator and volunteer
     * assignments are fest-scoped and carry a collegeId that means "the college
     * this fest belongs to", not "a college I administer" — reading those would
     * hand a volunteer their whole college's fest list.
     */
    const collegeIds = [
      ...new Set(
        assignments
          .filter(
            (assignment) =>
              assignment.role === STAFF_ROLES.ADMINISTRATOR && assignment.collegeId
          )
          .map((assignment) => String(assignment.collegeId))
      ),
    ].map((collegeId) => new mongoose.Types.ObjectId(collegeId));

    /*
     * With no administrator assignment there is no college half to ask about,
     * and an empty $in would match nothing anyway — so this collapses to the
     * original authorship-only behaviour for everyone else.
     */
    filter = collegeIds.length
      ? { $or: [{ createdByUserId: userId }, { hostCollegeId: { $in: collegeIds } }] }
      : { createdByUserId: userId };
  }

  const fests = await FestModel.find(filter).sort({ createdAt: -1 });
  return fests.map((fest) => fest.toJSON());
}

async function fetchFestById(userId, festId) {
  const fest = await findFestOrThrow(festId);
  await assertAdministrator(userId, fest.hostCollegeId);
  return fest.toJSON();
}

/*
 * The participant-facing list: published fests only, drafts and archived hidden.
 * Sorted by startsOn so already-running fests (an earlier startsOn) come before
 * upcoming ones. The host college is populated by name so a browse screen renders
 * it without a second call.
 */
/*
 * Categories are free text now, so there is no valid-value set to check against —
 * the browse filter has to accept whatever the participant asked for. Two
 * consequences handled below:
 *   - the match is case-insensitive and anchored, because a chip sends the
 *     lowercase suggestion value ("robotics") while an organiser who typed the
 *     category stored it as typed ("Robotics"), and both must be the same filter;
 *   - the input is regex-escaped, since it now reaches a RegExp unfiltered.
 */
function buildCategoryMatcher(rawCategory) {
  const normalisedCategory = rawCategory.replace(/\s+/g, " ").trim();
  if (normalisedCategory.length === 0 || normalisedCategory.length > EVENT_CATEGORY_MAX_LENGTH) {
    return null;
  }
  const escapedCategory = normalisedCategory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedCategory}$`, "i");
}

/*
 * The public browse list. Two optional shapers, both applied server-side so the
 * client never has to pull every fest's event tree just to filter or sort:
 *   - category: keep only fests that contain at least one event of that category
 *     (matched against descendant events, since a fest itself has no category).
 *     Matched case-insensitively against free-text categories; a blank or
 *     over-long value is ignored rather than erroring, so a stale chip never
 *     500s the browse page. A category no event uses just returns no fests.
 *   - sort: "name" orders by fest name, anything else (the default) by start date.
 * Each fest carries an eventCount — its registerable (leaf) events — for the card.
 */
async function listPublicFests({ category, sort } = {}) {
  // Solo containers wrap independent events; participants must never see the
  // wrapper as a "fest". The event itself stays reachable by direct link.
  const query = {
    status: { $in: PUBLICLY_VISIBLE_FEST_STATUSES },
    isSoloContainer: { $ne: true },
  };

  const categoryMatcher = typeof category === "string" ? buildCategoryMatcher(category) : null;
  if (categoryMatcher) {
    const festIdsWithCategory = await EventModel.distinct("festId", { category: categoryMatcher });
    query._id = { $in: festIdsWithCategory };
  }

  const sortSpec = sort === "name" ? { festName: 1 } : { startsOn: 1 };
  const fests = await FestModel.find(query)
    .sort(sortSpec)
    .populate("hostCollegeId", "commonName city");

  /*
   * One aggregation for every fest's registerable-event count AND the set of
   * categories it runs events in (leaves carry a category; container/vertical
   * events do not), rather than a query per fest.
   *
   * `categories` is additive and costs NOTHING: this aggregation already
   * matched exactly these documents and already grouped them by festId, so
   * collecting the distinct category values alongside the count is one
   * accumulator on a pipeline that was running anyway — no extra round trip,
   * no extra index, no new endpoint.
   *
   * It exists because a fest has no category of its own; its categories are a
   * property of its events. Without this field a client that wants to show
   * "only the categories that actually have fests", and to filter by them
   * instantly without a network round trip per tap, has no cheap way to do it:
   * it must either probe /public/fests?category=X once per known category, or
   * fetch every fest's event list. Both were measured at 24-30 requests on the
   * home screen. This is one.
   *
   * $addToSet, so a fest running six dance events reports "dance" once.
   */
  const festIds = fests.map((fest) => fest._id);
  const countRows = await EventModel.aggregate([
    { $match: { festId: { $in: festIds }, category: { $ne: null } } },
    {
      $group: {
        _id: "$festId",
        count: { $sum: 1 },
        categories: { $addToSet: "$category" },
      },
    },
  ]);
  const countByFestId = new Map(countRows.map((row) => [String(row._id), row.count]));
  /*
   * Case-folded here, not at the client. `category` is free text, so the same
   * category is stored as "Cultural" by one organiser and "cultural" by
   * another; the dev database currently holds both spellings of two of them.
   * The matcher on the ?category= path is already case-insensitive
   * (buildCategoryMatcher), so folding here is what makes the field the client
   * filters on agree with the field the server filters on. Display casing is
   * the client's business — formatCategoryLabel already does it.
   */
  const categoriesByFestId = new Map(
    countRows.map((row) => [
      String(row._id),
      [...new Set((row.categories ?? []).map((category) => String(category).trim().toLowerCase()))]
        .filter(Boolean)
        .sort(),
    ]),
  );

  /*
   * Through buildPublicFestResponse, NOT a bare toJSON(): the participant app
   * reads its fest from THIS list (helpers/public-catalog.js), and it gates the
   * food/stay registration questions on the derived offersFood/offersAccommodation
   * booleans. This projection used to omit them while the detail endpoint
   * included them, so a client that trusted the flag never sent the answer and
   * the backend — which reads the offers array — refused the registration with
   * "a food preference is required". One builder for every public fest payload
   * is what stops the list and the detail disagreeing again.
   */
  return fests.map((fest) => ({
    ...buildPublicFestResponse(fest),
    eventCount: countByFestId.get(String(fest._id)) ?? 0,
    /* Always an array, never undefined: a fest with no registerable events
       reports [], so no consumer has to guard the field before iterating it. */
    categories: categoriesByFestId.get(String(fest._id)) ?? [],
  }));
}

/*
 * A single fest for a participant. A draft or archived fest is reported as missing
 * rather than as forbidden, so its existence is not confirmed to an outsider.
 */
async function getPublicFestById(festId) {
  const fest = mongoose.Types.ObjectId.isValid(festId)
    ? await FestModel.findById(festId).populate("hostCollegeId", "commonName city")
    : null;

  if (!fest || !PUBLICLY_VISIBLE_FEST_STATUSES.includes(fest.status)) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  return buildPublicFestResponse(fest);
}

/*
 * The slug-based twin of getPublicFestById, for the shareable public link. Slugs
 * are stored lowercase, so the input is lowercased before the lookup.
 */
async function getPublicFestBySlug(festSlug) {
  const slug = typeof festSlug === "string" ? festSlug.trim().toLowerCase() : "";
  const fest = await FestModel.findOne({ festSlug: slug }).populate(
    "hostCollegeId",
    "commonName city"
  );

  if (!fest || !PUBLICLY_VISIBLE_FEST_STATUSES.includes(fest.status)) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  return buildPublicFestResponse(fest);
}

async function updateFest(userId, festId, festAttributes, context = {}) {
  const fest = await findFestOrThrow(festId);
  await assertAdministrator(userId, fest.hostCollegeId);

  if (fest.status === FEST_STATUSES.ARCHIVED) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_FEST_STATE,
      "An archived fest cannot be edited.",
      { currentStatus: fest.status, attemptedAction: "update" }
    );
  }

  const changedKeys = Object.keys(festAttributes);
  const beforeState = pickFields(fest, changedKeys);

  /*
   * Offer identity must survive an update. The client re-sends the whole offers
   * array without _ids (the parser derives each entry fresh), and letting
   * Mongoose mint new subdocument _ids on every PATCH would orphan the
   * checkpoints (and, in phase 2, entitlements) keyed on them. An incoming offer
   * whose offerKey matches an existing one IS that offer — its _id is carried
   * over, so a display rename that keeps the slug renames in place, and only a
   * genuinely new key creates a new identity.
   */
  if (Array.isArray(festAttributes.offers)) {
    const existingOffersByKey = new Map(
      (fest.offers ?? []).map((offer) => [offer.offerKey, offer])
    );
    festAttributes.offers = festAttributes.offers.map((offer) => {
      const existingOffer = existingOffersByKey.get(offer.offerKey);
      return existingOffer ? { ...offer, _id: existingOffer._id } : offer;
    });
  }

  /*
   * Assigning field by field, then save(), so the schema's pre('validate')
   * cross-field hook runs. findByIdAndUpdate would skip it unless every
   * interacting field were re-sent on every request.
   */
  Object.assign(fest, festAttributes);
  await fest.save();

  // A moved fest date must re-cut existing gate-access windows, not just apply to
  // new registrants; gate-access snapshots the fest's startsOn/endsOn.
  if (changedKeys.includes("startsOn") || changedKeys.includes("endsOn")) {
    await refreshGateAccessWindowsForFest(fest);
  }

  // An offer added, renamed, or deactivated after publish must still reach its
  // counter; drafts wait for publishFest to materialise theirs. The previous
  // offers ride along so only un-customised default checkpoints follow a rename.
  if (changedKeys.includes("offers") && fest.status === FEST_STATUSES.PUBLISHED) {
    await ensureOfferCheckpoints(fest, beforeState.offers ?? null);
  }

  await recordAuditLog({
    actorUserId: userId,
    festId: fest._id,
    action: AUDIT_ACTIONS.FEST_UPDATED,
    entityType: AUDIT_ENTITY_TYPES.FEST,
    entityId: fest._id,
    beforeState,
    afterState: pickFields(fest, changedKeys),
    ...context,
  });

  return fest.toJSON();
}

/*
 * Every status move lands here: fetch, authorise, check the fest is in a state
 * the move is legal from, then write. `archivedAt` is a function of the target
 * status, so unarchiving clears the stamp that archiving set.
 *
 * The 409 carries currentStatus and attemptedTransition so the caller can say
 * which move it refused rather than only that it refused one.
 */
async function transitionFest(userId, festId, allowedCurrentStatuses, nextStatus) {
  const fest = await findFestOrThrow(festId);
  await assertAdministrator(userId, fest.hostCollegeId);

  if (!allowedCurrentStatuses.includes(fest.status)) {
    throw new ApplicationError(
      409,
      ERROR_CODES.INVALID_FEST_STATE,
      `A ${fest.status} fest cannot become ${nextStatus}.`,
      { currentStatus: fest.status, attemptedTransition: nextStatus }
    );
  }

  fest.status = nextStatus;
  fest.archivedAt = nextStatus === FEST_STATUSES.ARCHIVED ? new Date() : null;
  await fest.save();
  return fest.toJSON();
}

/*
 * Anything not already archived can be archived, EXCEPT a cancelled fest: cancel
 * is irreversible, and archive's own reverse (unarchive -> DRAFT) would otherwise
 * launder a cancelled fest back into an editable draft after everyone had been
 * emailed that it was off. Only a draft can be published.
 */
const ARCHIVABLE_STATUSES = Object.values(FEST_STATUSES).filter(
  (status) => status !== FEST_STATUSES.ARCHIVED && status !== FEST_STATUSES.CANCELLED
);

async function recordFestTransitionAudit(userId, fest, action, context, extraAfterState = null) {
  await recordAuditLog({
    actorUserId: userId,
    festId: fest.id,
    action,
    entityType: AUDIT_ENTITY_TYPES.FEST,
    entityId: fest.id,
    // extraAfterState lets publish record how many events went live with the
    // fest, without every other transition growing a field it cannot fill.
    afterState: { status: fest.status, ...(extraAfterState ?? {}) },
    ...context,
  });
}

async function archiveFest(userId, festId, context = {}) {
  const fest = await transitionFest(userId, festId, ARCHIVABLE_STATUSES, FEST_STATUSES.ARCHIVED);
  await recordFestTransitionAudit(userId, fest, AUDIT_ACTIONS.FEST_ARCHIVED, context);
  return fest;
}

async function publishFest(userId, festId, context = {}) {
  const fest = await transitionFest(userId, festId, [FEST_STATUSES.DRAFT], FEST_STATUSES.PUBLISHED);
  // A published fest needs a gate to scan at; idempotent, so a later republish is a no-op.
  await ensureGateCheckpoint(fest.id);
  // Each active offer materialises its own counter, same idempotency.
  await ensureOfferCheckpoints(fest);

  /*
   * PUBLISHING THE FEST PUBLISHES ITS DRAFT EVENTS.
   *
   * Before this, an admin published the fest, saw it go live, and every event
   * under it stayed invisible — because assertEventPublishable refuses to
   * publish an event while its fest is still a draft, the only possible order
   * was fest first and then every event by hand. The fest looked published and
   * had nothing in it.
   *
   * DRAFT ONLY. cancelled and deleted events are deliberately excluded: an admin
   * who called an event off does not expect publishing the fest to bring it
   * back, and a soft-deleted event reappearing on the participant app is worse
   * than a missing one.
   *
   * This bypasses no guard. assertEventPublishable checks exactly two things —
   * that the event is DRAFT and that the fest is not draft/archived — and both
   * hold for every row this matches, because the fest has just become published.
   */
  const cascade = await EventModel.updateMany(
    /* fest.id, NOT fest._id: transitionFest returns fest.toJSON(), whose
       transform deletes _id. Filtering on the undefined field silently matched
       nothing and the cascade did quietly nothing at all. */
    { festId: fest.id, status: EVENT_STATUSES.DRAFT },
    { $set: { status: EVENT_STATUSES.PUBLISHED } }
  );
  const autoPublishedCount = cascade.modifiedCount ?? 0;
  if (autoPublishedCount > 0) {
    console.log(
      `Fest ${fest.id} published: ${autoPublishedCount} draft event(s) published with it.`
    );
  }

  await recordFestTransitionAudit(userId, fest, AUDIT_ACTIONS.FEST_PUBLISHED, context, {
    autoPublishedEventCount: autoPublishedCount,
  });
  return fest;
}

async function unarchiveFest(userId, festId, context = {}) {
  const fest = await transitionFest(userId, festId, [FEST_STATUSES.ARCHIVED], FEST_STATUSES.DRAFT);
  await recordFestTransitionAudit(userId, fest, AUDIT_ACTIONS.FEST_UNARCHIVED, context);
  return fest;
}

module.exports = {
  createFest,
  fetchFestsForAdministrator,
  fetchFestById,
  listPublicFests,
  getPublicFestById,
  getPublicFestBySlug,
  updateFest,
  archiveFest,
  publishFest,
  unarchiveFest,
};

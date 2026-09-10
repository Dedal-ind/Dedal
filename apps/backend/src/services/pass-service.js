const mongoose = require("mongoose");
const { PassModel } = require("../models/pass-model");
const { EntitlementModel } = require("../models/entitlement-model");
const { UserModel } = require("../models/user-model");
const { EventModel } = require("../models/event-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const { findFestOrThrow } = require("../helpers/assert-administrator-of-fest");
const { findEventOrThrow } = require("../helpers/pass-helpers");
const { insertPassWithUniqueSecrets } = require("../helpers/insert-pass-with-unique-secrets");
const { syncOfferEntitlements } = require("../helpers/offer-entitlement-helpers");
/*
 * Required as a MODULE OBJECT, not destructured: the no-N+1 test measures the
 * query cost with these two enrichments disabled and again with them live, and
 * it can only swap them out if the calls resolve through this object at call
 * time. Destructured bindings would freeze the pre-enrichment baseline out of
 * reach and make that assertion untestable.
 */
const passEntitlementEnrichmentHelpers = require("../helpers/pass-entitlement-enrichment-helpers");
const {
  PASS_STATUSES,
  ENTITLEMENT_TYPES,
  ENTITLEMENT_STATUSES,
  ENTITLEMENT_SOURCES,
} = require("../constants/pass-constants");

const EVENT_REFERENCE_POPULATE = {
  path: "referenceId",
  select: "eventName venue startsAt endsAt category",
  model: "Event",
};

// Events overrun; a door that shuts on the published end time turns the last
// competitors away. Two hours matches the staff access-expiry buffer, so there
// is one number for "how late is still the same event" rather than two.
const EVENT_ENTITLEMENT_TRAILING_GRACE_MINUTES = 120;
const MILLISECONDS_PER_MINUTE = 60 * 1000;

const DUPLICATE_KEY_ERROR_CODE = 11000;

/*
 * A concurrent registration for a second event in the same fest races past the
 * find-then-insert check below: both callers read no pass and both insert, so the
 * loser trips the userId+festId compound unique index. That specific collision
 * means the winner already wrote the pass, so it is re-read and returned. A
 * qrToken/backupCode secret collision is a different index that
 * insertPassWithUniqueSecrets already retries, so it must propagate untouched.
 */
function isDuplicateUserFestPass(error) {
  if (error?.code !== DUPLICATE_KEY_ERROR_CODE) return false;
  const collidedFields = Object.keys(error.keyPattern || {});
  return collidedFields.includes("userId") && collidedFields.includes("festId");
}

/*
 * A concurrent registration for the same user and event races past the
 * find-then-create pre-check below: both callers read no active entitlement and
 * both insert, so the loser trips the partial unique index scoped to
 * registration-sourced active event-entry rows
 * (index_entitlements_passId_entitlementType_referenceId). That specific collision
 * means the winner already wrote the row, so it is re-read and returned. Any other
 * duplicate-key collision — including a gate-access or pass secret index — has a
 * different key shape and must propagate untouched.
 */
function isDuplicateRegistrationEventEntry(error) {
  if (error?.code !== DUPLICATE_KEY_ERROR_CODE) return false;
  const collidedFields = Object.keys(error.keyPattern || {});
  return (
    collidedFields.includes("passId") &&
    collidedFields.includes("entitlementType") &&
    collidedFields.includes("referenceId")
  );
}

/*
 * The gate-access counterpart of the two detectors above. The loser of a
 * concurrent get-or-create trips index_entitlements_passId_gateAccess_active,
 * which means the winner has already written the row, so it is re-read rather
 * than treated as a failure.
 *
 * The key shape is (passId, entitlementType) with no referenceId, which is what
 * distinguishes it from isDuplicateRegistrationEventEntry — that index includes
 * referenceId. Anything else, including a pass secret collision, has a different
 * shape and still propagates.
 */
function isDuplicateGateAccess(error) {
  if (error?.code !== DUPLICATE_KEY_ERROR_CODE) return false;
  const collidedFields = Object.keys(error.keyPattern || {});
  return (
    collidedFields.includes("passId") &&
    collidedFields.includes("entitlementType") &&
    !collidedFields.includes("referenceId")
  );
}

/*
 * When an event-entry entitlement may be used.
 *
 * validFrom is open-ended, and that is the whole fix: a door admits people
 * BEFORE the thing starts, so a window opening at startsAt is shut at exactly
 * the moment it is needed. A lower bound protects nothing here — the
 * entitlement does not exist until the participant registers, it is single-use,
 * and cancelling revokes it. Someone scanning in early arrived early.
 *
 * validTo still binds, so an entitlement cannot outlive its event.
 */
function resolveEventEntitlementWindow(event) {
  return {
    validFrom: null,
    validTo: new Date(
      event.endsAt.getTime() + EVENT_ENTITLEMENT_TRAILING_GRACE_MINUTES * MILLISECONDS_PER_MINUTE
    ),
  };
}

/*
 * A pass always grants fest gate access for the fest's whole run; this is an
 * administrative grant, not tied to any single registration. Idempotent by design:
 * a findOne first, so calling it on every getOrCreatePassForUserInFest path costs
 * one indexed read on the happy path (passId + entitlementType + status, already a
 * compound index) and repairs a pass whose gate-access insert failed on an earlier
 * call — without which that pass would scan forever as no-entitlement at the gate.
 */
async function ensureGateAccessEntitlement(pass, fest) {
  const query = {
    passId: pass._id,
    entitlementType: ENTITLEMENT_TYPES.GATE_ACCESS,
    status: ENTITLEMENT_STATUSES.ACTIVE,
  };

  const existing = await EntitlementModel.findOne(query);
  if (existing) return existing;

  /*
   * The findOne above is a fast path, not the guarantee — it cannot be. Two
   * callers can both read no row before either insert lands, which is exactly
   * what two registrations in the same fest do, and it left one pass holding two
   * active gateAccess rows. The uniqueness is enforced by
   * index_entitlements_passId_gateAccess_active; this catch is the other half of
   * it, turning the loser's collision into a re-read.
   *
   * Same shape as the pass insert in getOrCreatePassForUserInFest below, and as
   * the event-entry insert: pre-check for the common case, unique index for
   * correctness, catch-and-re-read to make the loser's call succeed anyway. A
   * caller asked to be sure gate access exists; after the winner's insert, it
   * does, so returning it is the honest answer rather than an error.
   */
  try {
    return await EntitlementModel.create({
      passId: pass._id,
      entitlementType: ENTITLEMENT_TYPES.GATE_ACCESS,
      referenceId: null,
      maximumUses: null,
      validFrom: fest.startsOn,
      validTo: fest.endsOn,
      source: ENTITLEMENT_SOURCES.MANUAL_GRANT,
    });
  } catch (error) {
    if (!isDuplicateGateAccess(error)) throw error;
    return EntitlementModel.findOne(query);
  }
}

async function getOrCreatePassForUserInFest(userId, festId) {
  const fest = await findFestOrThrow(festId);
  let pass = await PassModel.findOne({ userId, festId: fest._id });

  if (!pass) {
    try {
      pass = await insertPassWithUniqueSecrets(userId, fest._id);
    } catch (error) {
      if (!isDuplicateUserFestPass(error)) throw error;
      // A parallel caller won the insert; re-read its pass.
      pass = await PassModel.findOne({ userId, festId: fest._id });
    }
  }

  // Runs on every path — fast-path, fresh insert, and lost race — so a pass whose
  // gate-access insert failed on an earlier call is repaired here rather than
  // fast-pathed past forever.
  await ensureGateAccessEntitlement(pass, fest);
  // Same coverage argument: every registration path (solo, team create, team
  // join, paid confirmation) lands here, so one call keeps the participant's
  // offer claims converged with what their confirmed registrations booked.
  await syncOfferEntitlements(userId, fest, pass);
  return pass;
}

/*
 * Emails the participant their pass, exactly once per (user, fest).
 *
 * The stamp is CLAIMED atomically before anything is sent — a conditional
 * update on passEmailSentAt: null — so two registrations racing on the same
 * fest cannot both dispatch. If delivery then fails the stamp is cleared, which
 * turns the failure into a retry on the participant's next registration rather
 * than a pass that is silently never emailed.
 *
 * Called from ensurePassAndEventEntitlement rather than from pass creation
 * itself: at mint time the caller's eventEntry entitlement does not exist yet,
 * so the email would list no events. By the time this runs, it does.
 */
async function sendPassEmailOnce(userId, festId) {
  const claimedPass = await PassModel.findOneAndUpdate(
    { userId, festId, passEmailSentAt: null },
    { $set: { passEmailSentAt: new Date() } },
    { new: true }
  );
  if (!claimedPass) {
    return false; // already emailed, or a parallel registration claimed it
  }

  try {
    const [user, fest, entitlements] = await Promise.all([
      // +phoneNumber is a deliberate, named request (select:false on the model):
      // the contact number is one of the fields the pass must carry.
      UserModel.findById(userId)
        .select("fullName emailAddress collegeId +phoneNumber")
        .populate({ path: "collegeId", select: "collegeName commonName", model: "College" })
        .lean(),
      findFestOrThrow(festId),
      EntitlementModel.find({ passId: claimedPass._id, status: ENTITLEMENT_STATUSES.ACTIVE }),
    ]);
    if (!user?.emailAddress) {
      throw new Error("pass owner has no email address");
    }
    await EntitlementModel.populate(entitlements, EVENT_REFERENCE_POPULATE);

    /*
     * Required at call time, not at module load. pass-service sits deep in the
     * require graph and is pulled in by test fixtures before the suite installs
     * its email mock, so a top-level capture would bind the real transport for
     * the whole run. Same late-require pattern as the contingent lock check in
     * event-service.
     */
    const { sendPassEmail } = require("./email-service");
    const wasSent = await sendPassEmail(user, fest, claimedPass, entitlements);
    if (!wasSent) {
      throw new Error("email transport reported failure");
    }
    return true;
  } catch (error) {
    // Release the claim so a later registration retries. Never rethrow: the
    // pass is valid and visible in-app whether or not the email landed.
    await PassModel.updateOne({ _id: claimedPass._id }, { $set: { passEmailSentAt: null } });
    console.error(`Pass email failed for user ${userId} at fest ${festId}: ${error.message}`);
    return false;
  }
}

/*
 * The owner's "send it to me again" action. Clears the once-stamp and re-sends,
 * so a lost or filtered email can be recovered without an administrator. Scoped
 * to the caller's own pass — a passId they do not hold is a 404, which reveals
 * nothing about whether it exists.
 */
async function resendMyPassEmail(userId, passId) {
  const pass = mongoose.Types.ObjectId.isValid(passId)
    ? await PassModel.findOne({ _id: passId, userId })
    : null;
  if (!pass) {
    throw new ApplicationError(404, ERROR_CODES.PASS_NOT_FOUND, "Pass not found.");
  }
  await PassModel.updateOne({ _id: pass._id }, { $set: { passEmailSentAt: null } });
  const wasSent = await sendPassEmailOnce(userId, pass.festId);
  if (!wasSent) {
    throw new ApplicationError(
      502,
      ERROR_CODES.EMAIL_DELIVERY_FAILED,
      "Could not send the pass email right now. Your pass is still valid in the app."
    );
  }
  return { passEmailSentAt: new Date().toISOString() };
}

async function ensurePassAndEventEntitlement(userId, festId, eventId) {
  const pass = await getOrCreatePassForUserInFest(userId, festId);
  const event = await findEventOrThrow(eventId);

  const filter = {
    passId: pass._id,
    entitlementType: ENTITLEMENT_TYPES.EVENT_ENTRY,
    referenceId: event._id,
  };
  // Scoped to the registration-sourced active row — the read-side mirror of the
  // partial unique index. A manual grant (different source) is invisible here, so
  // the registration path issues its own row alongside it rather than reusing it.
  const activeRegistrationFilter = {
    ...filter,
    source: ENTITLEMENT_SOURCES.REGISTRATION,
    status: ENTITLEMENT_STATUSES.ACTIVE,
  };
  const existing = await EntitlementModel.findOne(activeRegistrationFilter);

  let entitlement = existing;
  if (!entitlement) {
    try {
      entitlement = await EntitlementModel.create({
        ...filter,
        maximumUses: 1,
        ...resolveEventEntitlementWindow(event),
        source: ENTITLEMENT_SOURCES.REGISTRATION,
      });
    } catch (error) {
      if (!isDuplicateRegistrationEventEntry(error)) throw error;
      // A parallel registration write won the partial unique index; re-read and
      // return its row rather than double-issuing.
      entitlement = await EntitlementModel.findOne(activeRegistrationFilter);
    }
  }

  /*
   * Every registration path — solo, paid confirmation, team create, team join,
   * team roster, contingent accept — funnels through here, so this ONE trigger
   * covers all of them.
   *
   * AWAITED, not fired and forgotten. It cannot fail the registration
   * (sendPassEmailOnce swallows everything and returns a boolean), and the cost
   * on the common path is a single indexed findOneAndUpdate that returns null
   * because the pass was already emailed. Only the first registration per
   * (user, fest) actually sends, within the same timeout budget the app already
   * accepts for OTP delivery. A detached promise would have kept writing to the
   * database after the response — and after a test had moved on.
   */
  await sendPassEmailOnce(userId, festId);

  /*
   * The second, separate email: what they registered FOR (schedule, venue, fee,
   * calendar links) as opposed to how they get in (the QR above). Same choke
   * point for the same reason — every registration path reaches here — and the
   * same swallow-everything contract, so neither email can fail a registration.
   *
   * Late require: registration-email-service reaches back into pass-adjacent
   * models, and a top-level require here would close a cycle.
   */
  const { sendRegistrationConfirmationEmailOnce } = require("./registration-email-service");
  await sendRegistrationConfirmationEmailOnce(userId, eventId);

  return entitlement;
}

/*
 * Re-cuts the door window for everyone already holding a seat on this event.
 *
 * An entitlement's validTo is a snapshot, taken from the event's endsAt at the
 * moment someone registered. That is fine until the event moves — and events
 * move. Without this, a coordinator who pushes an event two hours later leaves
 * every existing entitlement expiring at the old time, and the door starts
 * refusing people it should admit. Anyone registering after the edit gets the
 * new window, so the roster would disagree with itself about when the door shuts.
 *
 * Keyed on referenceId, which is what an eventEntry entitlement points at — they
 * carry no checkpoint of their own. Revoked rows are left alone: their window is
 * meaningless and re-cutting it would only make a dead grant look live.
 */
async function refreshEventEntitlementWindows(event) {
  const outcome = await EntitlementModel.updateMany(
    {
      entitlementType: ENTITLEMENT_TYPES.EVENT_ENTRY,
      referenceId: event._id,
      status: ENTITLEMENT_STATUSES.ACTIVE,
    },
    { $set: resolveEventEntitlementWindow(event) }
  );
  return outcome.modifiedCount || 0;
}

/*
 * Re-cuts gate-access windows when the fest itself is rescheduled. Gate-access
 * entitlements snapshot the fest's startsOn/endsOn at pass-creation time, so an
 * admin moving the fest dates would otherwise leave existing participants on stale
 * bounds while new registrants get the new ones — the door refusing people on the
 * new opening day or admitting them on the old closing day.
 *
 * OFFER_CLAIM windows snapshot the same fest dates, so a reschedule re-cuts them
 * in the same sweep.
 */
async function refreshGateAccessWindowsForFest(fest) {
  const passes = await PassModel.find({ festId: fest._id }).select("_id").lean();
  const outcome = await EntitlementModel.updateMany(
    {
      passId: { $in: passes.map((pass) => pass._id) },
      entitlementType: { $in: [ENTITLEMENT_TYPES.GATE_ACCESS, ENTITLEMENT_TYPES.OFFER_CLAIM] },
      status: ENTITLEMENT_STATUSES.ACTIVE,
    },
    { $set: { validFrom: fest.startsOn, validTo: fest.endsOn } }
  );
  return outcome.modifiedCount || 0;
}

async function revokeEventEntitlementOnCancel(userId, festId, eventId) {
  const pass = await PassModel.findOne({ userId, festId });
  if (!pass) return null;

  // Scoped to the registration-sourced row: a coexisting manual grant (admin re-do)
  // is not cancellation's to touch, and matching it would leave the registration
  // entitlement active while revoking the wrong one.
  const filter = {
    passId: pass._id,
    entitlementType: ENTITLEMENT_TYPES.EVENT_ENTRY,
    referenceId: eventId,
    source: ENTITLEMENT_SOURCES.REGISTRATION,
  };
  const active = await EntitlementModel.findOne({ ...filter, status: ENTITLEMENT_STATUSES.ACTIVE });
  if (active) {
    active.status = ENTITLEMENT_STATUSES.REVOKED;
    await active.save();
    return active;
  }
  return EntitlementModel.findOne({ ...filter, status: ENTITLEMENT_STATUSES.REVOKED });
}

async function getMyPass(userId, festId) {
  const fest = await findFestOrThrow(festId);
  const pass = await PassModel.findOne({ userId, festId: fest._id, status: PASS_STATUSES.ACTIVE });
  if (!pass) {
    throw new ApplicationError(404, ERROR_CODES.PASS_NOT_FOUND, "Pass not found.");
  }
  /*
   * Fetched WITHOUT the populate first, because EVENT_REFERENCE_POPULATE
   * resolves referenceId against the Event model — and an OFFER_CLAIM's
   * referenceId is an offer subdocument id, which matches no Event, so Mongoose
   * replaces it with null. Resolving offer names after the populate therefore
   * looked every claim up under "null". The raw ids are captured here, the
   * populate runs after, and the two are merged below.
   */
  const entitlements = await EntitlementModel.find({
    passId: pass._id,
    status: ENTITLEMENT_STATUSES.ACTIVE,
  });
  const offerNameByEntitlementId = await resolveOfferNames(fest, entitlements);
  /*
   * Captured from the RAW rows, for the same reason the offer names are: the
   * populate below replaces referenceId with a document (or null), so the ids
   * the two enrichments join on have to be read before it runs.
   */
  const entitlementEventIds = entitlements
    .filter((entitlement) => entitlement.entitlementType === ENTITLEMENT_TYPES.EVENT_ENTRY)
    .map((entitlement) => entitlement.referenceId)
    .filter(Boolean);
  /*
   * BATCHED, and the batching is the point — this is the gate endpoint, and a
   * per-entitlement lookup would turn one pass read into a query per event.
   * Two queries total, whatever the participant registered for, and they are
   * independent of each other so they go out together.
   */
  const [teamNameByEventId, activeRoundByEventId] = await Promise.all([
    passEntitlementEnrichmentHelpers.buildTeamNameByEventId(pass.userId, entitlementEventIds),
    passEntitlementEnrichmentHelpers.buildActiveRoundByEventId(entitlementEventIds),
  ]);
  await EntitlementModel.populate(entitlements, EVENT_REFERENCE_POPULATE);
  await fest.populate("hostCollegeId", "commonName city");
  /*
   * The pass card shows a name, a USN and a college, and that is the whole list.
   * This is the owner's own data so a wider load was never a leak — but it was
   * the whole user document going out to render four fields, and the endpoint
   * only has to widen once for that to stop being true.
   */
  const user = await UserModel.findById(userId)
    /*
     * +phoneNumber is a deliberate, named request of a select:false field: the
     * pass must display the holder's contact number (client requirement). It is
     * the owner's OWN data on their own pass — this endpoint is scoped to
     * userId — so it is not a widening of who can see what.
     */
    .select("fullName emailAddress usn collegeId participantId +phoneNumber")
    .populate({ path: "collegeId", select: "commonName city", model: "College" });

  return {
    pass: pass.toJSON(),
    entitlements: entitlements.map((entitlement) => {
      const plainEntitlement = entitlement.toJSON();
      if (entitlement.entitlementType === ENTITLEMENT_TYPES.OFFER_CLAIM) {
        // Additive presentation only — the entitlement MODEL is untouched.
        plainEntitlement.offerName = offerNameByEntitlementId.get(String(entitlement._id)) ?? null;
      }
      if (entitlement.entitlementType === ENTITLEMENT_TYPES.EVENT_ENTRY) {
        /*
         * Additive presentation only, exactly like offerName above. Neither of
         * these is a model field: the team can be renamed and the rounds can be
         * rescheduled, and a copy stored on the entitlement would drift from the
         * document that owns the truth.
         *
         * Null on a solo registration, on a manual grant with no registration
         * behind it, and on an event with no rounds — all three are "there is
         * nothing to show", which the pass renders as absence.
         */
        const eventKey = String(plainEntitlement.referenceId?.id ?? plainEntitlement.referenceId);
        plainEntitlement.teamName = teamNameByEventId.get(eventKey) ?? null;
        plainEntitlement.activeRound = activeRoundByEventId.get(eventKey) ?? null;
      }
      return plainEntitlement;
    }),
    fest: fest.toJSON(),
    user: user.toJSON(),
  };
}

/*
 * An OFFER_CLAIM's referenceId is an OFFER subdocument id, so the pass screen
 * would otherwise render the bare enum string "offerClaim". Offers live at two
 * levels since the offers rework (fest.offers and event.offers), so both are
 * searched. Returns entitlementId -> offerName; the caller attaches it.
 *
 * MUST run before the event populate, which nulls these referenceIds out.
 */
async function resolveOfferNames(fest, entitlements) {
  const offerClaims = entitlements.filter(
    (entitlement) => entitlement.entitlementType === ENTITLEMENT_TYPES.OFFER_CLAIM
  );
  const offerNameByEntitlementId = new Map();
  if (offerClaims.length === 0) {
    return offerNameByEntitlementId;
  }

  const offerNameByOfferId = new Map(
    (fest.offers ?? []).map((offer) => [String(offer._id), offer.offerName])
  );
  const festEvents = await EventModel.find({ festId: fest._id }).select("offers").lean();
  for (const event of festEvents) {
    for (const offer of event.offers ?? []) {
      offerNameByOfferId.set(String(offer._id), offer.offerName);
    }
  }

  for (const claim of offerClaims) {
    const offerName = offerNameByOfferId.get(String(claim.referenceId));
    if (offerName) {
      offerNameByEntitlementId.set(String(claim._id), offerName);
    }
  }
  return offerNameByEntitlementId;
}

async function getMyPasses(userId) {
  const passes = await PassModel.find({ userId, status: PASS_STATUSES.ACTIVE })
    .populate("festId", "festName startsOn endsOn status");
  passes.sort((first, second) => first.festId.startsOn.getTime() - second.festId.startsOn.getTime());
  return passes.map((pass) => {
    const fest = pass.festId.toJSON();
    pass.depopulate("festId");
    return { pass: pass.toJSON(), fest };
  });
}

module.exports = {
  getOrCreatePassForUserInFest,
  sendPassEmailOnce,
  resendMyPassEmail,
  ensurePassAndEventEntitlement,
  refreshEventEntitlementWindows,
  refreshGateAccessWindowsForFest,
  revokeEventEntitlementOnCancel,
  getMyPass,
  getMyPasses,
  /*
   * For the test fixture, which builds entitlements without going through
   * registration. It calls this rather than restating the window, so it cannot
   * drift from production the way a hand-copied wide window once did — that
   * drift is what hid the door-scan bug behind green suites.
   */
  resolveEventEntitlementWindow,
  EVENT_ENTITLEMENT_TRAILING_GRACE_MINUTES,
};

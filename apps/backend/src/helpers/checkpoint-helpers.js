const { CheckpointModel } = require("../models/checkpoint-model");
const {
  CHECKPOINT_TYPES,
  CHECKPOINT_DIRECTION_MODES,
} = require("../constants/scan-constants");

/*
 * The canonical fest gate. One name, used by the creator here and by every
 * reader that looks the gate up (auto-shifts, the gate stats endpoint), so a
 * rename in one place cannot silently orphan the others.
 */
const MAIN_GATE_CHECKPOINT_NAME = "Main Gate";

/*
 * Offer keys/names that mean "this is transport TO the campus", used ONCE — when
 * an offer's counter is first materialised — to pre-set isExemptFromGateCheck.
 *
 * This is a convenience default, not the rule. The rule is the stored flag on the
 * checkpoint (see checkpoint-model): a travel desk scans people onto the bus that
 * BRINGS them to campus, so requiring a Main Gate check-in first would make the
 * shuttle unusable by the very people it carries. Matching on text is fine for
 * choosing a default an admin can then correct; it would not be fine as the thing
 * a scan consults every time, because then a fest that named its shuttle "Campus
 * Bus" would lose the exemption with nobody able to see why.
 */
const TRAVEL_OFFER_HINTS = ["travel", "shuttle", "transport", "bus", "pickup", "drop"];

function looksLikeTravelOffer(offer) {
  const haystack = `${offer?.offerKey ?? ""} ${offer?.offerName ?? ""}`.toLowerCase();
  return TRAVEL_OFFER_HINTS.some((hint) => haystack.includes(hint));
}

/*
 * Publishing a fest or an event materialises the checkpoint a scanner will need,
 * so no one has to create gates by hand. Both helpers are idempotent: a republish
 * finds the existing row and creates nothing, keyed on (fest, type) for the gate
 * and (event, type) for the event door.
 */
/*
 * ONE UPSERT, not find-then-create. Publishing a fest is not a hot path, but it
 * is reachable twice at once — a double-clicked Publish, or a publish racing the
 * event-creation flow that also materialises checkpoints — and find-then-create
 * has a window between the two statements where both callers see "no gate" and
 * both insert one. Two Main Gates for one fest is not a cosmetic duplicate: the
 * daily check-in the whole campus-access rule depends on would be recorded
 * against whichever gate the volunteer's device happened to pick, so a
 * participant could enter through gate A and be refused at every event door
 * because the rule looked at gate B.
 *
 * $setOnInsert only: a republish must never reset a gate an admin has since
 * renamed or deactivated.
 */
async function ensureGateCheckpoint(festId) {
  return CheckpointModel.findOneAndUpdate(
    { festId, checkpointType: CHECKPOINT_TYPES.GATE },
    {
      $setOnInsert: {
        festId,
        eventId: null,
        checkpointName: MAIN_GATE_CHECKPOINT_NAME,
        checkpointType: CHECKPOINT_TYPES.GATE,
        directionMode: CHECKPOINT_DIRECTION_MODES.IN_AND_OUT,
        isActive: true,
        /* The gate cannot require itself. */
        isExemptFromGateCheck: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function ensureEventEntryCheckpoint(festId, eventId, eventName) {
  const existing = await CheckpointModel.findOne({
    eventId,
    checkpointType: CHECKPOINT_TYPES.EVENT_ENTRY,
  });
  if (existing) {
    if (existing.directionMode === CHECKPOINT_DIRECTION_MODES.IN_ONLY) {
      existing.directionMode = CHECKPOINT_DIRECTION_MODES.IN_AND_OUT;
      await existing.save();
    }
    return existing;
  }

  return CheckpointModel.create({
    festId,
    eventId,
    checkpointName: `${eventName} Entry`,
    checkpointType: CHECKPOINT_TYPES.EVENT_ENTRY,
    directionMode: CHECKPOINT_DIRECTION_MODES.IN_ONLY,
    isActive: true,
  });
}

/*
 * Materialise a DEFAULT counter per ACTIVE offer — a floor, not a ceiling. An
 * offer may carry any number of admin-created checkpoints ("Food Counter A/B");
 * this helper only guarantees at least one exists, and never touches the rest:
 *
 *   · No checkpoint for an active offer → create one named after the offer.
 *   · Offer renamed → rename only checkpoints still carrying the OLD offer name
 *     (the un-customised default); an admin-customised name is never renamed out
 *     from under them. `previousOffers` supplies the old names.
 *   · Offer reactivated → reactivate only the default-named checkpoint (or
 *     create one if none exists).
 *   · Offer deactivated/removed → deactivate ALL of its checkpoints — NEVER
 *     delete. scans is append-only and every scan row carries checkpointId;
 *     deleting would orphan the gate audit trail (the same rule as the
 *     staff-assignment deletion guard and the match model's superseded-not-deleted).
 *
 * Offers live at TWO levels, so this core is scoped by owner: fest-wide offers
 * carry eventId null, an event's own offers carry that event's id. The scoping
 * is what stops a fest-level pass from deactivating an event's counters (and
 * vice versa), and it is also what keeps a volunteer scheduled at an event's
 * food counter from covering the fest-wide one.
 */
async function ensureOfferCheckpointsForOwner({ festId, eventId, offers, previousOffers }) {
  const activeOfferById = new Map(
    (offers ?? [])
      .filter((offer) => offer.isActive !== false)
      .map((offer) => [String(offer._id ?? offer.id), offer])
  );
  const previousNameByOfferId = new Map(
    (previousOffers ?? []).map((offer) => [String(offer._id ?? offer.id), offer.offerName])
  );

  const existingCheckpoints = await CheckpointModel.find({
    festId,
    eventId: eventId ?? null,
    checkpointType: CHECKPOINT_TYPES.OFFER,
  });
  const checkpointsByOfferId = new Map();
  for (const checkpoint of existingCheckpoints) {
    const key = String(checkpoint.offerId);
    if (!checkpointsByOfferId.has(key)) checkpointsByOfferId.set(key, []);
    checkpointsByOfferId.get(key).push(checkpoint);
  }

  for (const [offerId, offer] of activeOfferById) {
    const offerCheckpoints = checkpointsByOfferId.get(offerId) ?? [];
    if (offerCheckpoints.length === 0) {
      await CheckpointModel.create({
        festId,
        eventId: eventId ?? null,
        offerId,
        checkpointName: offer.offerName,
        checkpointType: CHECKPOINT_TYPES.OFFER,
        directionMode: CHECKPOINT_DIRECTION_MODES.IN_ONLY,
        isActive: true,
        /*
         * Set ONCE, here, from the offer's own wording — and never rewritten on
         * a later pass. Recomputing it on every republish would silently undo an
         * admin who had corrected it, which is the whole reason the decision is
         * stored on the checkpoint rather than re-derived at scan time.
         */
        isExemptFromGateCheck: looksLikeTravelOffer(offer),
      });
      continue;
    }
    const previousName = previousNameByOfferId.get(offerId) ?? offer.offerName;
    for (const checkpoint of offerCheckpoints) {
      let isDirty = false;
      // Only the un-customised default follows the offer's rename.
      if (checkpoint.checkpointName === previousName && checkpoint.checkpointName !== offer.offerName) {
        checkpoint.checkpointName = offer.offerName;
        isDirty = true;
      }
      // Reactivation follows the default name only; custom counters stay as the
      // admin left them.
      if (!checkpoint.isActive && checkpoint.checkpointName === offer.offerName) {
        checkpoint.isActive = true;
        isDirty = true;
      }
      if (isDirty) {
        await checkpoint.save();
      }
    }
  }

  for (const checkpoint of existingCheckpoints) {
    if (!activeOfferById.has(String(checkpoint.offerId)) && checkpoint.isActive) {
      checkpoint.isActive = false;
      await checkpoint.save();
    }
  }
}

/* Fest-wide offers (eventId null). */
async function ensureOfferCheckpoints(fest, previousOffers = null) {
  return ensureOfferCheckpointsForOwner({
    festId: fest._id ?? fest.id,
    eventId: null,
    offers: fest.offers,
    previousOffers,
  });
}

/* One event's own offers, scoped to that event. */
async function ensureEventOfferCheckpoints(event, previousOffers = null) {
  return ensureOfferCheckpointsForOwner({
    festId: event.festId?._id ?? event.festId,
    eventId: event._id ?? event.id,
    offers: event.offers,
    previousOffers,
  });
}

module.exports = {
  ensureGateCheckpoint,
  ensureEventEntryCheckpoint,
  ensureOfferCheckpoints,
  ensureEventOfferCheckpoints,
  looksLikeTravelOffer,
  MAIN_GATE_CHECKPOINT_NAME,
};

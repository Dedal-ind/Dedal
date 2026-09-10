const { EntitlementModel } = require("../models/entitlement-model");
const { EventModel } = require("../models/event-model");
const { RegistrationModel } = require("../models/registration-model");
const {
  ENTITLEMENT_TYPES,
  ENTITLEMENT_STATUSES,
  ENTITLEMENT_SOURCES,
} = require("../constants/pass-constants");
const { REGISTRATION_STATUSES } = require("../constants/registration-constants");
const { RESERVED_OFFER_KEYS } = require("../constants/fest-constants");
const { computeOfferEntitlementUses } = require("./offer-schema-helpers");

const DUPLICATE_KEY_ERROR_CODE = 11000;

/*
 * Mirror of pass-service's isDuplicateRegistrationEventEntry: a concurrent sync
 * races past the find-then-create and the loser trips the partial unique index
 * over registration-sourced active (passId, entitlementType, referenceId) rows.
 * That specific collision means the winner already wrote the row; anything else
 * propagates untouched.
 */
function isDuplicateRegistrationOfferClaim(error) {
  if (error?.code !== DUPLICATE_KEY_ERROR_CODE) return false;
  const collidedFields = Object.keys(error.keyPattern || {});
  return (
    collidedFields.includes("passId") &&
    collidedFields.includes("entitlementType") &&
    collidedFields.includes("referenceId")
  );
}

/*
 * How many uses of one offer this participant is owed, summed over their
 * CONFIRMED registrations in this fest:
 *   · the reserved food offer          → sum of foodOrderCount
 *   · the reserved accommodation offer → 1 when any row says needsAccommodation
 *   · every other offer                → sum of the selections' PEOPLE counts
 *
 * Days deliberately do not multiply here: a two-day stay for one person is one
 * head walking through the counter, not two claims. computeOfferEntitlementUses
 * owns that rule so the fee formula and the entitlement sizing cannot drift.
 *
 * Selections are matched on the offer's subdocument _id, which is unique across
 * BOTH scopes — so a fest-wide "Food" and an event-only "Food" each get their
 * own entitlement and neither absorbs the other's quantities.
 */
function computeOwedUses(offer, confirmedRegistrations) {
  const offerIdString = String(offer._id);
  if (offer.offerKey === RESERVED_OFFER_KEYS.FOOD) {
    return confirmedRegistrations.reduce(
      (total, registration) => total + (registration.foodOrderCount ?? 0),
      0
    );
  }
  if (offer.offerKey === RESERVED_OFFER_KEYS.ACCOMMODATION) {
    return confirmedRegistrations.some((registration) => registration.needsAccommodation === true)
      ? 1
      : 0;
  }
  const selections = confirmedRegistrations.flatMap((registration) =>
    (registration.offerSelections ?? []).filter(
      (selection) => String(selection.offerId) === offerIdString
    )
  );
  return selections.reduce(
    (total, selection) => total + computeOfferEntitlementUses(offer, selection.numberOfPeople),
    0
  );
}

async function syncOfferEntitlements(userId, fest, pass) {
  /*
   * Offers live at two levels, so both are swept: the fest's own plus every
   * event's. One entitlement per offer SUBDOCUMENT (its _id is the referenceId),
   * whichever level it hangs on — that is what makes an event-only "Food"
   * claimable independently of the fest-wide one.
   */
  const festEvents = await EventModel.find({ festId: fest._id ?? fest.id })
    .select("_id offers")
    .lean();
  const activeOffers = [
    ...(fest.offers ?? []),
    ...festEvents.flatMap((event) => event.offers ?? []),
  ].filter((offer) => offer.isActive !== false);
  if (activeOffers.length === 0) {
    return;
  }

  const festEventIds = festEvents;
  const confirmedRegistrations = await RegistrationModel.find({
    userId,
    eventId: { $in: festEventIds.map((event) => event._id) },
    status: REGISTRATION_STATUSES.CONFIRMED,
  })
    .select("foodOrderCount needsAccommodation offerSelections")
    .lean();

  for (const offer of activeOffers) {
    const owedUses = computeOwedUses(offer, confirmedRegistrations);
    const claimFilter = {
      passId: pass._id,
      entitlementType: ENTITLEMENT_TYPES.OFFER_CLAIM,
      referenceId: offer._id,
      source: ENTITLEMENT_SOURCES.REGISTRATION,
      status: ENTITLEMENT_STATUSES.ACTIVE,
    };
    const existing = await EntitlementModel.findOne(claimFilter);

    if (!existing) {
      if (owedUses <= 0) {
        continue; // Not selected → no entitlement at all.
      }
      try {
        await EntitlementModel.create({
          passId: pass._id,
          entitlementType: ENTITLEMENT_TYPES.OFFER_CLAIM,
          referenceId: offer._id,
          maximumUses: owedUses,
          // Same window as gate access: the offer is claimable for the fest's run.
          validFrom: fest.startsOn,
          validTo: fest.endsOn,
          source: ENTITLEMENT_SOURCES.REGISTRATION,
        });
      } catch (error) {
        if (!isDuplicateRegistrationOfferClaim(error)) throw error;
        // A parallel sync won the partial unique index; converge on its row.
        const winner = await EntitlementModel.findOne(claimFilter);
        if (winner && winner.maximumUses < owedUses) {
          winner.maximumUses = owedUses;
          await winner.save();
        }
      }
      continue;
    }

    // Clamp: the ceiling never drops below what was already served.
    const nextMaximumUses = Math.max(owedUses, existing.usedCount);
    if (nextMaximumUses <= 0) {
      // Nothing owed and nothing served — the claim is withdrawn, not deleted.
      existing.status = ENTITLEMENT_STATUSES.REVOKED;
      await existing.save();
      continue;
    }
    if (existing.maximumUses !== nextMaximumUses) {
      existing.maximumUses = nextMaximumUses;
      await existing.save();
    }
  }
}

module.exports = { syncOfferEntitlements };

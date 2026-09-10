const mongoose = require("mongoose");

const { FestModel } = require("../models/fest-model");
const { EventModel } = require("../models/event-model");
const { CheckpointModel } = require("../models/checkpoint-model");
const { ScanModel } = require("../models/scan-model");
const { RegistrationModel } = require("../models/registration-model");
const { ApplicationError } = require("../helpers/application-error");
const { ERROR_CODES } = require("../constants/error-codes");
const {
  CHECKPOINT_TYPES,
  SCAN_DIRECTIONS,
  SCAN_RESULTS,
} = require("../constants/scan-constants");
const { ACTIVE_REGISTRATION_STATUSES } = require("../constants/registration-constants");

/*
 * HOW MUCH OF WHAT WAS SOLD HAS ACTUALLY BEEN USED.
 *
 * Three numbers an organiser asks about every offer, and the gap between them is
 * the whole point: 400 people booked dinner, 260 have eaten, so 140 meals are
 * still owed and the kitchen should not pack up. Bookings come from
 * registrations, usage comes from scans, and the two are counted from different
 * collections because they are different facts — a booking is a promise, a scan
 * is a delivery.
 *
 * COUNTED IN PEOPLE, NOT ROWS. One registration can book an offer for four
 * people (offer.collectsNumberOfPeople), and four people is four meals. Counting
 * registration rows would report that group as one booking and then show four
 * check-ins against it, i.e. 400% utilisation. numberOfPeople is what the
 * entitlement's maximumUses is sized from (computeOfferEntitlementUses), so it is
 * also what the scans are drawn against.
 */

/* The offer's own definition, from whichever level owns it. */
async function loadOfferOrThrow(festId, offerId) {
  if (!mongoose.Types.ObjectId.isValid(offerId)) {
    throw new ApplicationError(404, ERROR_CODES.OFFER_NOT_FOUND, "Offer not found.");
  }
  const fest = await FestModel.findById(festId).select("offers festName").lean();
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  const festOffer = (fest.offers ?? []).find((offer) => String(offer._id) === String(offerId));
  if (festOffer) {
    return { offer: festOffer, scope: "fest", ownerEventId: null };
  }
  /*
   * Not on the fest — so it is one event's own offer. Both levels are searched
   * because the dashboard lists both under one fest, and an admin clicking a card
   * should not have to know which level it came from.
   */
  const owningEvent = await EventModel.findOne({
    festId,
    "offers._id": new mongoose.Types.ObjectId(offerId),
  })
    .select("offers eventName")
    .lean();
  const eventOffer = (owningEvent?.offers ?? []).find(
    (offer) => String(offer._id) === String(offerId)
  );
  if (!eventOffer) {
    throw new ApplicationError(404, ERROR_CODES.OFFER_NOT_FOUND, "Offer not found in this fest.");
  }
  return { offer: eventOffer, scope: "event", ownerEventId: owningEvent._id };
}

/*
 * Every offer of a fest — the fest's own plus each event's — as cards for the
 * dashboard. Flattened into one list rather than nested by level: an organiser
 * thinks in "what did we sell", not in which document the row lives on, and the
 * scope badge on the card is enough to tell two same-named offers apart.
 */
async function listFestOffers(festId) {
  const fest = await FestModel.findById(festId).select("offers festName").lean();
  if (!fest) {
    throw new ApplicationError(404, ERROR_CODES.FEST_NOT_FOUND, "Fest not found.");
  }
  const events = await EventModel.find({ festId, "offers.0": { $exists: true } })
    .select("offers eventName")
    .lean();

  const toCard = (offer, scope, event) => ({
    offerId: String(offer._id),
    offerName: offer.offerName,
    offerKey: offer.offerKey,
    scope,
    eventId: event ? String(event._id) : null,
    eventName: event ? event.eventName : null,
    isActive: offer.isActive !== false,
    isPaid: offer.isPaid === true,
    ratePaise: offer.ratePaise ?? 0,
    collectsNumberOfPeople: offer.collectsNumberOfPeople === true,
    collectsNumberOfDays: offer.collectsNumberOfDays === true,
    description: offer.description ?? null,
  });

  return {
    festName: fest.festName,
    offers: [
      ...(fest.offers ?? []).map((offer) => toCard(offer, "fest", null)),
      ...events.flatMap((event) =>
        (event.offers ?? []).map((offer) => toCard(offer, "event", event))
      ),
    ],
  };
}

/*
 * Utilisation for ONE offer.
 *
 * Check-ins are counted from the SCANS at this offer's counters rather than from
 * the entitlement's usedCount, even though the two should agree. usedCount is a
 * running total with no event attached, so it cannot answer the event-wise
 * breakdown below; scans carry the pass, which resolves to a registration, which
 * carries the event. Reading the scans is therefore the only version of this that
 * can break the number down, and having one source for both the total and the
 * breakdown is what stops the parts disagreeing with the whole.
 */
async function getOfferStats(festId, offerId) {
  const { offer, scope, ownerEventId } = await loadOfferOrThrow(festId, offerId);

  /* --------------------------------------------------------------- bookings */
  const bookingRegistrations = await RegistrationModel.find({
    status: { $in: ACTIVE_REGISTRATION_STATUSES },
    "offerSelections.offerId": new mongoose.Types.ObjectId(offerId),
  })
    .select("eventId userId offerSelections")
    .lean();

  const bookedPeopleByEventId = new Map();
  const eventIdByUserId = new Map();
  let totalBookings = 0;

  for (const registration of bookingRegistrations) {
    const selection = (registration.offerSelections ?? []).find(
      (entry) => String(entry.offerId) === String(offerId)
    );
    if (!selection) {
      continue;
    }
    // See the header: an offer that collects a head count is booked in heads.
    const people = offer.collectsNumberOfPeople ? (selection.numberOfPeople ?? 1) : 1;
    totalBookings += people;
    const eventKey = String(registration.eventId);
    bookedPeopleByEventId.set(eventKey, (bookedPeopleByEventId.get(eventKey) ?? 0) + people);
    /*
     * The pass→event link. A pass is per FEST, not per event, so a scan alone
     * cannot say which event's participant is standing at the counter; the
     * registration that bought the offer is what supplies it. Someone registered
     * for two events who bought the offer once is attributed to the registration
     * that bought it, which is the only attribution the data supports.
     */
    eventIdByUserId.set(String(registration.userId), eventKey);
  }

  /* ---------------------------------------------------------------- scans */
  const counters = await CheckpointModel.find({
    festId,
    offerId,
    checkpointType: CHECKPOINT_TYPES.OFFER,
  })
    .select("_id")
    .lean();

  let totalCheckIns = 0;
  let totalCheckOuts = 0;
  const checkInsByEventId = new Map();
  const checkOutsByEventId = new Map();

  if (counters.length > 0) {
    const scans = await ScanModel.find({
      checkpointId: { $in: counters.map((counter) => counter._id) },
      result: SCAN_RESULTS.ACCEPTED,
      passId: { $ne: null },
    })
      .select("passId direction")
      .populate({ path: "passId", select: "userId" })
      .lean();

    for (const scan of scans) {
      const userId = scan.passId?.userId ? String(scan.passId.userId) : null;
      const eventKey = userId ? eventIdByUserId.get(userId) : undefined;
      if (scan.direction === SCAN_DIRECTIONS.OUT) {
        totalCheckOuts += 1;
        if (eventKey) {
          checkOutsByEventId.set(eventKey, (checkOutsByEventId.get(eventKey) ?? 0) + 1);
        }
      } else {
        totalCheckIns += 1;
        if (eventKey) {
          checkInsByEventId.set(eventKey, (checkInsByEventId.get(eventKey) ?? 0) + 1);
        }
      }
    }
  }

  /* ------------------------------------------------------------ breakdown */
  const eventIds = [
    ...new Set([
      ...bookedPeopleByEventId.keys(),
      ...checkInsByEventId.keys(),
      ...checkOutsByEventId.keys(),
    ]),
  ];
  const events = await EventModel.find({ _id: { $in: eventIds } })
    .select("eventName")
    .lean();
  const eventNameById = new Map(events.map((event) => [String(event._id), event.eventName]));

  const eventBreakdown = eventIds
    .map((eventId) => ({
      eventId,
      eventName: eventNameById.get(eventId) ?? "—",
      bookings: bookedPeopleByEventId.get(eventId) ?? 0,
      checkIns: checkInsByEventId.get(eventId) ?? 0,
      checkOuts: checkOutsByEventId.get(eventId) ?? 0,
    }))
    .sort((first, second) => second.bookings - first.bookings);

  return {
    offerId: String(offerId),
    offerName: offer.offerName,
    scope,
    ownerEventId: ownerEventId ? String(ownerEventId) : null,
    counterCount: counters.length,
    totalBookings,
    totalCheckIns,
    totalCheckOuts,
    /*
     * Both clamped at zero. Either can legitimately be "impossible" in live data
     * — a manually granted entitlement produces a check-in with no booking behind
     * it, and a counter set to inAndOut can log an exit for someone whose entry
     * predates the counter — and a dashboard showing "-3 currently using" reads
     * as a broken screen rather than as the edge case it is.
     */
    currentlyUtilizing: Math.max(0, totalCheckIns - totalCheckOuts),
    notYetUtilized: Math.max(0, totalBookings - totalCheckIns),
    eventBreakdown,
  };
}

module.exports = { listFestOffers, getOfferStats };

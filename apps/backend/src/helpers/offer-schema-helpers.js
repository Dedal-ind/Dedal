const mongoose = require("mongoose");

/*
 * The ONE offer subdocument shape, shared by fest.offers and event.offers.
 *
 * It lives in helpers rather than in either model because both models embed it
 * and neither owns it: a fest-wide "Food" and an event-only "Food" are two
 * different offers with two different rates, but they must never drift into two
 * different shapes. Building it through a factory (rather than sharing one
 * Schema instance) keeps each model's subdocument paths independent, which is
 * what Mongoose expects when the same shape is embedded twice.
 *
 * THE PRICE FORMULA — one line, integer paise, nowhere else:
 *
 *   totalPaise = ratePaise
 *              × (collectsNumberOfPeople ? numberOfPeople : 1)
 *              × (collectsNumberOfDays   ? numberOfDays   : 1)
 *
 * Never convert to rupees before multiplying: a ₹0.01 rounding error per row on
 * a 500-participant fest is a real refund event. The frontend mirrors this exact
 * formula in helpers/fee-math.js, and the backend remains authoritative.
 */
const OFFER_NAME_MAX_LENGTH = 80;
const OFFER_DESCRIPTION_MAX_LENGTH = 200;

function buildOfferSchema() {
  return new mongoose.Schema({
    offerName: { type: String, required: true, trim: true, maxlength: OFFER_NAME_MAX_LENGTH },
    /*
     * A slug of the name (helpers/generate-fest-slug.js, reused by the offers
     * parser — never a second slugger). RESERVED_OFFER_KEYS ("food",
     * "accommodation") carry the dietary sub-question and the team-code-join
     * inheritance; every other key is free-form. The reservation is about that
     * behaviour ONLY — reserved offers use the same generic numeric axes below.
     */
    offerKey: { type: String, required: true, lowercase: true, trim: true },
    isActive: { type: Boolean, default: true },

    /*
     * A rate is meaningless without this flag: a free offer must ACTIVELY opt
     * out of price rather than lean on a zero that could equally mean "not
     * filled in yet". isPaid false forces ratePaise to 0 server-side whatever
     * the client sent; isPaid true requires a positive rate.
     */
    isPaid: { type: Boolean, default: true },
    ratePaise: { type: Number, min: 0, default: 0 },

    /*
     * The two independent quantity axes. Each is asked of the participant only
     * when its flag is on; an axis that is off contributes a factor of 1 to the
     * formula above. The bounds apply only to their own axis.
     */
    collectsNumberOfPeople: { type: Boolean, default: false },
    numberOfPeopleMinimum: { type: Number, min: 1, default: 1 },
    numberOfPeopleMaximum: { type: Number, min: 1, default: null },
    collectsNumberOfDays: { type: Boolean, default: false },
    numberOfDaysMinimum: { type: Number, min: 1, default: 1 },
    numberOfDaysMaximum: { type: Number, min: 1, default: null },

    // What the offer covers ("dinner and lunch, day 2 only").
    description: { type: String, trim: true, maxlength: OFFER_DESCRIPTION_MAX_LENGTH, default: null },
  });
}

/*
 * The price of one participant's selection of one offer. The single
 * implementation of the formula documented above — fee computation, entitlement
 * sizing and every future reader call this rather than restating the product.
 */
function computeOfferTotalPaise(offer, numberOfPeople, numberOfDays) {
  if (!offer || offer.isPaid !== true) {
    return 0;
  }
  const peopleFactor = offer.collectsNumberOfPeople ? numberOfPeople ?? 1 : 1;
  const daysFactor = offer.collectsNumberOfDays ? numberOfDays ?? 1 : 1;
  return (offer.ratePaise ?? 0) * peopleFactor * daysFactor;
}

/*
 * How many entitlement uses one selection is worth: the number of PEOPLE it
 * covers. Days lengthen the stay, they do not add scannable heads — a two-day
 * accommodation for one person is still one person walking through the door.
 */
function computeOfferEntitlementUses(offer, numberOfPeople) {
  return offer?.collectsNumberOfPeople ? numberOfPeople ?? 1 : 1;
}

module.exports = {
  buildOfferSchema,
  computeOfferTotalPaise,
  computeOfferEntitlementUses,
  OFFER_NAME_MAX_LENGTH,
  OFFER_DESCRIPTION_MAX_LENGTH,
};

// add-on-pricing.js
// The add-on arithmetic every participant screen shares — the post-join add-ons
// screen and the join-with-code screen price and submit the same offers the
// same way, so the rules live once.

/* The highest quantity a stepper offers when the offer names no maximum. */
export const ADD_ON_QUANTITY_CEILING = 20;

/*
 * Price of one selection, mirroring computeOfferTotalPaise on the server: rate x
 * people x days, where an axis the offer does not collect contributes 1. This is
 * a DISPLAY estimate only — the server reprices from the live offer before
 * charging anything, so a stale rate here cannot become a wrong charge.
 */
export function computeSelectionPaise(offer, selection) {
  if (!offer.isPaid) {
    return 0;
  }
  const people = offer.collectsNumberOfPeople ? selection.numberOfPeople : 1;
  const days = offer.collectsNumberOfDays ? selection.numberOfDays : 1;
  return offer.ratePaise * people * days;
}

/* Scope + key: a fest-wide and an event-only offer can share a key. */
export function offerKeyOf(offer) {
  return `${offer.scope}:${offer.offerKey}`;
}

/* The offerSelections body the add-ons and redeem endpoints both accept. */
export function buildOfferSelectionsPayload(offers, selections) {
  return offers
    .filter((offer) => selections[offerKeyOf(offer)])
    .map((offer) => {
      const selection = selections[offerKeyOf(offer)];
      return {
        offerKey: offer.offerKey,
        scope: offer.scope,
        ...(offer.collectsNumberOfPeople ? { numberOfPeople: selection.numberOfPeople } : {}),
        ...(offer.collectsNumberOfDays ? { numberOfDays: selection.numberOfDays } : {}),
      };
    });
}

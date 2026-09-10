// offer-form.js
// The admin offer FORM row <-> API payload mapping, kept out of
// AdminOffersEditor.jsx so that component file only exports a component (the
// fast-refresh rule). Rupees become integer paise here and nowhere else.

/* A blank row in the FORM's shape (rupees as typed text; paise on the wire). */
export function buildEmptyOffer() {
  return {
    offerName: '',
    isPaid: true,
    rateRupees: '',
    collectsNumberOfPeople: false,
    numberOfPeopleMinimum: '1',
    numberOfPeopleMaximum: '',
    collectsNumberOfDays: false,
    numberOfDaysMinimum: '1',
    numberOfDaysMaximum: '',
    description: '',
  };
}

/*
 * Form row → API payload. Rupees become integer paise here and nowhere else;
 * a free offer sends rate 0 (the backend forces it to 0 regardless, so the two
 * can never disagree). Blank bound inputs become undefined, not 0.
 */
export function toOfferPayload(offer) {
  const toOptionalInteger = (rawValue) =>
    rawValue === '' || rawValue === null || rawValue === undefined ? undefined : Number(rawValue);
  return {
    offerName: offer.offerName.trim(),
    isPaid: Boolean(offer.isPaid),
    ratePaise: offer.isPaid ? Math.max(0, Math.round(parseFloat(offer.rateRupees || '0') * 100) || 0) : 0,
    collectsNumberOfPeople: Boolean(offer.collectsNumberOfPeople),
    numberOfPeopleMinimum: offer.collectsNumberOfPeople
      ? toOptionalInteger(offer.numberOfPeopleMinimum)
      : undefined,
    numberOfPeopleMaximum: offer.collectsNumberOfPeople
      ? toOptionalInteger(offer.numberOfPeopleMaximum)
      : undefined,
    collectsNumberOfDays: Boolean(offer.collectsNumberOfDays),
    numberOfDaysMinimum: offer.collectsNumberOfDays
      ? toOptionalInteger(offer.numberOfDaysMinimum)
      : undefined,
    numberOfDaysMaximum: offer.collectsNumberOfDays
      ? toOptionalInteger(offer.numberOfDaysMaximum)
      : undefined,
    description: offer.description?.trim() || null,
    isActive: offer.isActive !== false,
  };
}

/* API row → form row, for the edit screens. */
export function toOfferFormRow(offer) {
  return {
    offerName: offer.offerName ?? '',
    isPaid: offer.isPaid !== false,
    rateRupees: offer.ratePaise ? String(offer.ratePaise / 100) : '',
    collectsNumberOfPeople: Boolean(offer.collectsNumberOfPeople),
    numberOfPeopleMinimum: String(offer.numberOfPeopleMinimum ?? 1),
    numberOfPeopleMaximum: offer.numberOfPeopleMaximum ? String(offer.numberOfPeopleMaximum) : '',
    collectsNumberOfDays: Boolean(offer.collectsNumberOfDays),
    numberOfDaysMinimum: String(offer.numberOfDaysMinimum ?? 1),
    numberOfDaysMaximum: offer.numberOfDaysMaximum ? String(offer.numberOfDaysMaximum) : '',
    description: offer.description ?? '',
    isActive: offer.isActive !== false,
  };
}


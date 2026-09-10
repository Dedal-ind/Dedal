// fee-math.js
// FRONTEND MIRROR of the backend's price formula, which lives in
// backend/src/helpers/offer-schema-helpers.js (computeOfferTotalPaise) and is
// summed by registration-payment-helpers.js computeRegistrationFee. THAT is the
// source of truth; the backend recomputes authoritatively on submit, and this
// copy exists ONLY so the running total on the registration form matches it
// without an estimate round-trip. Any change there MUST be mirrored here.
// All arithmetic is INTEGER PAISE; format to rupees only at the leaves.
//
//   offerTotalPaise = ratePaise
//                   × (collectsNumberOfPeople ? numberOfPeople : 1)
//                   × (collectsNumberOfDays   ? numberOfDays   : 1)
//
// A free offer (isPaid false) contributes zero however large the quantities.

function computeEventFeePaise(event, teamSize) {
  if (!event || event.feeType === 'free' || !event.feeAmountPaise) {
    return 0;
  }
  if (event.feeType === 'perTeam') {
    return event.feeAmountPaise;
  }
  return event.feeAmountPaise * teamSize;
}

export function computeOfferTotalPaise(offer, numberOfPeople, numberOfDays) {
  if (!offer || offer.isPaid !== true) {
    return 0;
  }
  const peopleFactor = offer.collectsNumberOfPeople ? numberOfPeople ?? 1 : 1;
  const daysFactor = offer.collectsNumberOfDays ? numberOfDays ?? 1 : 1;
  return (offer.ratePaise ?? 0) * peopleFactor * daysFactor;
}

/*
 * selections: [{ offer, numberOfPeople, numberOfDays }] — the already-chosen
 * rows, from EITHER scope (the caller has combined fest and event offers and
 * knows which are ticked). Returns the same envelope the backend returns.
 */
export function computeRegistrationFeePaise(event, teamSize, selections) {
  const eventFeePaise = computeEventFeePaise(event, teamSize);
  const breakdown = [
    { label: 'Registration', quantity: 1, unitPaise: eventFeePaise, subtotalPaise: eventFeePaise },
  ];
  let offersFeePaise = 0;
  for (const selection of selections ?? []) {
    const { offer } = selection;
    if (!offer || offer.isActive === false) {
      continue;
    }
    const subtotalPaise = computeOfferTotalPaise(
      offer,
      selection.numberOfPeople,
      selection.numberOfDays,
    );
    if (subtotalPaise <= 0) {
      continue;
    }
    offersFeePaise += subtotalPaise;
    // The multiplied-out unit count, matching the backend's breakdown line.
    const quantity =
      (offer.collectsNumberOfPeople ? selection.numberOfPeople ?? 1 : 1) *
      (offer.collectsNumberOfDays ? selection.numberOfDays ?? 1 : 1);
    breakdown.push({
      label: offer.offerName,
      quantity,
      unitPaise: offer.ratePaise ?? 0,
      subtotalPaise,
    });
  }
  return { eventFeePaise, offersFeePaise, totalFeePaise: eventFeePaise + offersFeePaise, breakdown };
}

export function formatPaiseAsRupees(paise) {
  return `₹${((paise ?? 0) / 100).toLocaleString('en-IN')}`;
}

/*
 * The price line for an offer, in all FOUR permutations of the two axes. The
 * per-unit wording is DERIVED, never stored — an offer that collects neither
 * axis is a flat charge, so it reads "total" rather than a bogus "per person".
 * Shared by the participant card and the admin form's live suffix, so the two
 * can never describe the same offer differently.
 */
export function formatOfferRateLabel(offer, copy) {
  if (!offer || offer.isPaid !== true) {
    return copy.offerFree;
  }
  const rupees = ((offer.ratePaise ?? 0) / 100).toLocaleString('en-IN');
  if (offer.collectsNumberOfPeople && offer.collectsNumberOfDays) {
    return copy.ratePerPersonPerDay(rupees);
  }
  if (offer.collectsNumberOfPeople) {
    return copy.ratePerPerson(rupees);
  }
  if (offer.collectsNumberOfDays) {
    return copy.ratePerDay(rupees);
  }
  return copy.rateTotal(rupees);
}

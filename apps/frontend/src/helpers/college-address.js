// college-address.js
// One place that knows how a structured college address is shaped, so the
// application form, the verifier's read-only block, and the CSV export cannot
// drift apart about field order or what counts as empty.

export const EMPTY_COLLEGE_ADDRESS = {
  addressLine1: '',
  addressLine2: '',
  addressLine3: '',
  addressLine4: '',
  city: '',
  townOrLocality: '',
  district: '',
  state: '',
  pinCode: '',
  country: 'India',
};

/*
 * Mirrors the backend's college-address-validator: line 1, city, state and PIN
 * are mandatory. District is NOT — the form stopped asking for it, so requiring
 * it here would block every submission on a field with no input to fill it.
 *
 * The formatter below still prints district, addressLine3 and addressLine4 when
 * an older application carries them; they are display-only history now.
 */
export const REQUIRED_COLLEGE_ADDRESS_FIELDS = [
  'addressLine1',
  'city',
  'state',
  'pinCode',
];

/*
 * First digit 1–8 per India Post zone codes — the same rule the backend
 * enforces, repeated here only so the applicant is told before they submit.
 * The backend remains the authority.
 */
export const INDIAN_PIN_CODE_PATTERN = /^[1-9]\d{5}$/;

/* The verifier's block: one line per postal line, then the standard tail. */
export function formatCollegeAddressLines(address) {
  if (!address) {
    return [];
  }
  const cityAndDistrict = [address.city, address.district].filter(Boolean).join(', ');
  const stateAndPin = [address.state, address.pinCode].filter(Boolean).join(' - ');
  return [
    address.addressLine1,
    address.addressLine2,
    address.addressLine3,
    address.addressLine4,
    address.townOrLocality,
    cityAndDistrict,
    stateAndPin,
    address.country,
  ].filter((line) => typeof line === 'string' && line.trim().length > 0);
}

/* Trims every value and turns blanks into null, matching what the API stores. */
export function toCollegeAddressPayload(addressForm) {
  const payload = {};
  for (const [fieldName, rawValue] of Object.entries(addressForm)) {
    const trimmedValue = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    payload[fieldName] = trimmedValue === '' ? null : trimmedValue;
  }
  return payload;
}

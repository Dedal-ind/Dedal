// generate-offer-key.js
// Frontend mirror of backend/src/helpers/generate-fest-slug.js — that file is
// the source of truth; the backend re-derives the key server-side, this copy
// only shows the admin what the system will call the offer.
export function generateOfferKey(offerName) {
  if (typeof offerName !== 'string') {
    return '';
  }
  return offerName
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

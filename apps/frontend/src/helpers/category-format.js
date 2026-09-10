// category-format.js
// Read-time display mapping for the event category, the sibling of
// department-format.js and there for the same reason.
//
// The category used to be a closed enum whose values were stored lowercase
// ("technical"). It is free text now, so an organiser who types "Culinary Arts"
// stores exactly that, while every row written before the change still holds a
// lowercase slug. Both must render the same way, and there is NO database
// migration — mapping at read time is the whole fix.

import { EVENT_CATEGORIES } from '../brand/brand-copy.js';

/*
 * Built from the suggestion list itself so the canonical labels can never drift
 * from the values the admin autocomplete offers. Keyed lowercase because that is
 * how the legacy rows were stored.
 */
const CANONICAL_CATEGORY_LABELS = new Map(
  EVENT_CATEGORIES.map((category) => [category.value.toLowerCase(), category.label]),
);

/*
 * Title-cases a value that is not on the suggestion list. Word-by-word so
 * "culinary arts" reads "Culinary Arts"; the rest of each word is left alone
 * rather than lowercased, so an organiser's deliberate "AI & ML" survives
 * instead of being flattened to "Ai & Ml".
 */
function titleCaseCategory(value) {
  return value.replace(/\S+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

export function formatCategoryLabel(storedCategory) {
  if (typeof storedCategory !== 'string') {
    return null;
  }
  const normalisedCategory = storedCategory.replace(/\s+/g, ' ').trim();
  if (normalisedCategory.length === 0) {
    return null;
  }
  return (
    CANONICAL_CATEGORY_LABELS.get(normalisedCategory.toLowerCase()) ??
    titleCaseCategory(normalisedCategory)
  );
}

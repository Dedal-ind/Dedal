// sponsor-hierarchy.js
// Who gets to appear on a given surface, and why.
//
// Sponsorship on this platform is a THREE-LEVEL INHERITANCE, and the rule is
// always "the most specific sponsor wins, then fall back outwards":
//
//   event  →  category (the top-level vertical the event hangs under)  →  fest
//
// The levels exist because that is how an Indian college fest is actually sold.
// A title sponsor buys the whole fest and expects to be on the hero. A brand
// buys "Cultural" and expects to be on every cultural event. A single event may
// carry its own sponsor, and on ITS card that sponsor outranks the category's —
// which is the specific thing an event sponsor is paying for.
//
// The tier order is the sales hierarchy, not an alphabet: a title sponsor
// outranks a presenting one, which outranks associate, which outranks partner.
// Where a level holds several sponsors, the highest tier represents that level.
//
// This lives in one module because the fest page, the event card and the event
// page all have to agree. Two implementations of "which logo goes here" is how
// a brand that paid for the category ends up missing from half the cards.

// Ordered by what a sponsor paid for, most senior first. Index IS the priority.
export const SPONSOR_TIERS = ['title', 'presenting', 'associate', 'partner'];

// Tiers senior enough to represent a whole category on every card beneath it.
// Associate and partner buy presence, not the right to badge someone else's
// event — so a category with only those stays silent on the cards.
const CATEGORY_BADGE_TIERS = ['title', 'presenting'];

function tierRank(sponsor) {
  const index = SPONSOR_TIERS.indexOf(sponsor?.tier);
  // An unknown or missing tier sorts last rather than first: legacy rows
  // predate the field entirely, and a sponsor added before tiers existed must
  // not silently outrank one somebody deliberately marked as title.
  return index === -1 ? SPONSOR_TIERS.length : index;
}

function usableSponsors(sponsors) {
  return (Array.isArray(sponsors) ? sponsors : []).filter((sponsor) => sponsor?.imageUrl);
}

/*
 * The list, ordered by tier priority, for a strip that shows everyone. Stable
 * within a tier: equal tiers keep the order the organiser arranged them in,
 * because that order is itself a decision somebody made in the admin screen.
 */
export function sortedByTier(sponsors) {
  return usableSponsors(sponsors)
    .map((sponsor, index) => ({ sponsor, index }))
    .sort((first, second) => {
      const byTier = tierRank(first.sponsor) - tierRank(second.sponsor);
      return byTier !== 0 ? byTier : first.index - second.index;
    })
    .map((entry) => entry.sponsor);
}

// The single sponsor that represents a level — its most senior one.
export function topSponsor(sponsors) {
  return sortedByTier(sponsors)[0] ?? null;
}

// The fest's title sponsor specifically: the hero and the "Presented by" line
// are a title slot, not a general logo slot. A fest whose best sponsor is an
// associate has NO title sponsor, and the hero stays clean rather than
// promoting someone who did not buy the position.
export function festTitleSponsor(fest) {
  return sortedByTier(fest?.sponsors).find((sponsor) => sponsor.tier === 'title') ?? null;
}

// The sponsor a category may stamp on every card beneath it.
export function categoryBadgeSponsor(categoryNode) {
  return (
    sortedByTier(categoryNode?.sponsors).find((sponsor) =>
      CATEGORY_BADGE_TIERS.includes(sponsor.tier),
    ) ?? null
  );
}

/*
 * The logo for ONE CARD in the grid. The event's own sponsor replaces the
 * category's — that is the whole point of buying an event — and there is no
 * fest-level fallback here on purpose: stamping the fest's title sponsor onto
 * forty cards devalues the hero placement that sponsor actually paid for.
 */
export function cardSponsor(event, categoryNode) {
  return topSponsor(event?.sponsors) ?? categoryBadgeSponsor(categoryNode);
}

/*
 * The line under the hero on the event page, where the rule inverts: this
 * surface ALWAYS names someone if anyone in the chain exists, because it is the
 * one place the inheritance is meant to pay out. Returns the level too, so the
 * caller can say "Sponsored by" against a brand that bought this event and the
 * same phrase against one that bought the fest without claiming more than was
 * sold.
 */
export function eventPageSponsor(event, categoryNode, fest) {
  const own = topSponsor(event?.sponsors);
  if (own) {
    return { sponsor: own, level: 'event' };
  }
  const category = topSponsor(categoryNode?.sponsors);
  if (category) {
    return { sponsor: category, level: 'category' };
  }
  const festLevel = topSponsor(fest?.sponsors);
  if (festLevel) {
    return { sponsor: festLevel, level: 'fest' };
  }
  return null;
}

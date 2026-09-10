// search-catalog.js
// The one place search knows what it is searching, for both the desktop modal
// and the mobile /search page. Neither surface implements matching or trending
// of its own — they render what this returns.
//
// THERE IS NO SEARCH ENDPOINT. This was checked, not assumed: the backend
// exposes GET /public/fests (whole list, no pagination, optional ?category=)
// and GET /public/events/independent, and nothing that takes a text query.
// So matching happens in memory over the catalog the app already loads.
//
// THAT IS FINE TODAY AND WILL NOT BE FOREVER. It is correct while the whole
// published catalogue fits comfortably in a phone's memory — currently 24 fests
// and ~100 events. It stops being correct at the point where the fest list
// alone is a slow download, because every search then pays for the entire
// catalogue before it can match one word of it. WHEN THE CATALOGUE OUTGROWS
// MEMORY, THE FIX IS A REAL SEARCH ENDPOINT — something like
// GET /public/search?q=&limit=, matching server-side across fests and events —
// and the only thing that changes on this side is `searchCatalog` below. The
// two surfaces call it and would not notice.

import apiClient from '../api-client/api-client.js';

/* Every third slot in the trending grid, per the brief. */
const PROMOTION_EVERY = 3;

/* Enough to fill the grid twice without becoming a directory. */
export const TRENDING_LIMIT = 12;

function readHost(fest) {
  const host = fest?.hostCollegeId;
  if (host && typeof host === 'object') {
    return { name: host.commonName ?? host.collegeName ?? '', city: host.city ?? '' };
  }
  return { name: fest?.hostCollegeName ?? '', city: '' };
}

/*
 * One shape for everything the grid renders, so the row component never has to
 * ask what kind of thing it is holding. `kind` survives only to pick the icon
 * and to route the tap.
 */
function festToItem(fest) {
  const host = readHost(fest);
  return {
    kind: 'fest',
    key: `fest-${fest.festSlug}`,
    title: fest.festName,
    typeLabel: 'Fest',
    subtitle: [host.name, host.city].filter(Boolean).join(', '),
    imageUrl: fest.bannerImageUrl ?? null,
    startsAt: fest.startsOn ?? null,
    endsAt: fest.endsOn ?? null,
    categories: Array.isArray(fest.categories) ? fest.categories : [],
    route: `/fests/${fest.festSlug}`,
    isPromoted: false,
  };
}

function eventToItem(event) {
  return {
    kind: 'event',
    key: `event-${event.eventSlug}`,
    title: event.eventName,
    typeLabel: 'Event',
    subtitle: event.hostCollegeName ?? event.festName ?? '',
    imageUrl: event.posterImageUrl ?? null,
    startsAt: event.startsAt ?? null,
    endsAt: event.endsAt ?? null,
    categories: event.category ? [String(event.category).trim().toLowerCase()] : [],
    route: `/events/${event.eventSlug}`,
    routeState: { festSlug: event.festSlug },
    isPromoted: false,
  };
}

export function promotionToItem(promotion, index) {
  return {
    kind: 'promotion',
    /* The slot index is in the key: one creative legitimately appears more than
       once in a long grid, and two children cannot share a key. */
    key: `promotion-${promotion.id}-${index}`,
    title: promotion.title,
    typeLabel: promotion.promoterName ?? promotion.collegeName ?? 'Sponsored',
    subtitle: promotion.description ?? '',
    imageUrl: promotion.imageUrl ?? null,
    startsAt: null,
    endsAt: null,
    categories: [],
    href: promotion.linkUrl ?? null,
    isPromoted: true,
    promotion,
  };
}

/*
 * The catalogue, fetched once per page load and shared by both surfaces.
 *
 * Cached in a module-level promise rather than in component state: the modal
 * and the mobile page are different trees, and without this the second one to
 * open would re-download a list the first already has. The cache lives for the
 * page load only — there is no revalidation and no TTL, because a fest list
 * does not change during a browsing session and a stale-cache bug is worse
 * than a re-fetch on the next navigation.
 *
 * IT TAKES NO AbortSignal, AND THAT IS THE POINT. A shared request must not be
 * cancellable by one of its consumers. The first version accepted a signal and
 * deadlocked immediately: React StrictMode mounts, the effect starts the fetch
 * and caches the promise, the cleanup aborts it, the effect runs again and gets
 * handed the SAME already-doomed promise from the cache — which rejects with
 * AbortError, is correctly ignored as "we navigated away", and the panel sits
 * on "loading" forever with an empty grid. Reproduced in the browser: chips 0,
 * rows 0, no grid.
 *
 * Callers drop late results with an isActive flag instead. The request itself
 * is cheap and shared; there is nothing worth cancelling.
 */
let catalogPromise = null;

export function loadSearchCatalog() {
  if (!catalogPromise) {
    catalogPromise = Promise.all([
      apiClient.get('/public/fests'),
      apiClient.get('/public/events/independent').catch(() => []),
    ])
      .then(([fests, events]) => ({
        fests: Array.isArray(fests) ? fests : (fests?.fests ?? []),
        events: Array.isArray(events) ? events : (events?.events ?? []),
      }))
      .catch((error) => {
        /* A failed load must not poison the cache — the next open should try
           again rather than replay the rejection forever. */
        catalogPromise = null;
        throw error;
      });
  }
  return catalogPromise;
}

/*
 * TRENDING. Deliberately NOT an invented ranking.
 *
 * The brief asked for popularity or nearest start date, from data that already
 * exists. There is no registration count on the public fest payload — the only
 * count it carries is `eventCount`, which is how much is ON at a fest, not how
 * many people are going. So the order is: anything running right now, then
 * whatever starts soonest. That is a fact about the data, not a guess about
 * popularity, and it is the order a person browsing actually wants.
 */
export function selectTrending(catalog, nowTs, { limit = TRENDING_LIMIT } = {}) {
  const items = [
    ...catalog.fests.map(festToItem),
    ...catalog.events.map(eventToItem),
  ].filter((item) => {
    if (!item.endsAt) return true;
    return new Date(item.endsAt).getTime() >= nowTs;
  });

  const isLive = (item) => {
    if (!item.startsAt) return false;
    const start = new Date(item.startsAt).getTime();
    const end = item.endsAt ? new Date(item.endsAt).getTime() : start;
    return start <= nowTs && end >= nowTs;
  };

  return items
    .sort((a, b) => {
      const liveDifference = Number(isLive(b)) - Number(isLive(a));
      if (liveDifference !== 0) return liveDifference;
      return new Date(a.startsAt ?? 0).getTime() - new Date(b.startsAt ?? 0).getTime();
    })
    .slice(0, limit);
}

/*
 * MATCHING — ranked, not filtered, and deliberately NOT helpers/fuzzy-match.js.
 *
 * That helper scores an order-insensitive BAG OF CHARACTERS: a query matches if
 * 60% of its letters appear anywhere in the target, in any order. For a short
 * picker list that is forgiving; for a catalogue it is meaningless. Measured
 * here: the query "saar" returned 26 of 26 items, because "Alliance University,
 * Bengaluru" happens to contain an s, two a's and an r somewhere among its
 * letters. Every result was a match, so no result meant anything.
 *
 * The helper is NOT changed, because CategoryEventsScreen still uses it and
 * this task is not licensed to alter that screen's behaviour. Search gets its
 * own matcher instead.
 *
 * The rules, strongest first — a query has to appear as a RUN of characters,
 * never as scattered letters:
 *   4  the title starts with the query            "saar" → Saarang
 *   3  a word in the title starts with the query  "fest" → Spring Fest
 *   2  the query appears anywhere in the title
 *   1  the query appears in the college or city   "bengaluru" → every fest there
 * Score 0 is not a match and is dropped.
 *
 * Typo tolerance is one edit, allowed only on queries of four characters or
 * more and only against whole words — enough to survive "saarang"/"sarang",
 * not enough to make three-letter queries match everything.
 */
const TYPO_MIN_QUERY_LENGTH = 4;

/* Levenshtein with an early exit at distance > 1: the full matrix is wasted
   work when the only question is "is this within one edit". */
function isWithinOneEdit(a, b) {
  if (a === b) return true;
  const lengthDifference = Math.abs(a.length - b.length);
  if (lengthDifference > 1) return false;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let shortIndex = 0;
  let longIndex = 0;
  let edited = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    if (edited) return false;
    edited = true;
    /* Same length means a substitution; different means a deletion from the
       longer string. Either way only the longer index always advances. */
    if (shorter.length === longer.length) shortIndex += 1;
    longIndex += 1;
  }
  return true;
}

function scoreText(needle, title, secondary) {
  const name = String(title ?? '').toLowerCase();
  if (name.startsWith(needle)) return 4;
  if (name.split(/\s+/).some((word) => word.startsWith(needle))) return 3;
  if (name.includes(needle)) return 2;

  const support = String(secondary ?? '').toLowerCase();
  if (support.includes(needle)) return 1;

  if (needle.length >= TYPO_MIN_QUERY_LENGTH) {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.some((word) => isWithinOneEdit(needle, word))) return 1;
  }
  return 0;
}

export function searchCatalog(catalog, query, { limit = 24 } = {}) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const scored = [
    ...catalog.fests.map((fest) => {
      const item = festToItem(fest);
      return { item, score: scoreText(needle, item.title, item.subtitle) };
    }),
    ...catalog.events.map((event) => {
      const item = eventToItem(event);
      return { item, score: scoreText(needle, item.title, item.subtitle) };
    }),
  ].filter((entry) => entry.score > 0);

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      /* Equal relevance: the sooner thing first, which is the tie-break a
         person browsing a fest catalogue actually wants. */
      return new Date(a.item.startsAt ?? 0).getTime() - new Date(b.item.startsAt ?? 0).getTime();
    })
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function filterByCategory(items, category) {
  if (!category) return items;
  return items.filter((item) => item.categories.includes(category));
}

/*
 * Promotions mixed into the grid at every third position. Same rule as the
 * feed, same "Promoted" label, and the same measurement hooks fire from the
 * row component — a sponsored recommendation in search is the same object as a
 * promotion in the feed, in a smaller box.
 */
export function injectPromotions(items, promotions) {
  if (promotions.length === 0) return items;
  const output = [];
  let promotionIndex = 0;
  items.forEach((item, index) => {
    if (index > 0 && index % PROMOTION_EVERY === 0) {
      output.push(
        promotionToItem(promotions[promotionIndex % promotions.length], index),
      );
      promotionIndex += 1;
    }
    output.push(item);
  });
  return output;
}

/* Category values present in a set of items, most common first — the same
   rule the Discover chips use, so the two strips agree. */
export function categoriesOf(items) {
  const counts = new Map();
  items.forEach((item) => {
    item.categories.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value);
}

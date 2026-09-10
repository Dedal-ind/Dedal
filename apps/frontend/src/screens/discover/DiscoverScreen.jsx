// DiscoverScreen.jsx
// Route: /discover — the home screen, and the app's default route.
//
// THE SHAPE IS FIXED; ONLY THE CONTENT VARIES. Hero, live-now strip, category
// chips, feed. With ten fests and with five hundred it is the same four
// sections in the same order — a section with nothing to say is absent from
// the DOM rather than rendered empty, so the screen never has a heading over a
// blank space and never reflows as a late response lands.
//
// SCALE. /public/fests has no pagination: it returns every published fest in
// one response, and there is no limit, offset or cursor on the endpoint (this
// was checked, not assumed). So the paging here is over the list already in
// memory — a sentinel near the bottom of the feed reveals the next page of
// cards. That is the correct shape for the API as it stands, it keeps the DOM
// small on a 500-fest platform, and on the day the endpoint learns to paginate
// only `loadFests` changes. The AbortController is on the network fetch, where
// there is actually a request to cancel.
//
// PROMOTIONS. The decision engine, the session key, useViewability and the
// delivery reporter are untouched and do the same work against the same
// tokens; DECISION_ENGINE_SLIDES_ENABLED still decides whether decisions or
// the public list fill the slots. Promotions render as cards in the feed and,
// when there is no fest to lead with, as the hero.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import { markSharedFestPoster } from '../../components/route-transition/shared-fest-poster.js';
import apiClient from '../../api-client/api-client.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { fetchDistinctDecisions, toPromotionSlide } from '../../helpers/decision-session.js';
import { formatCategoryLabel } from '../../helpers/category-format.js';
import { isFestLive } from '../../helpers/feed-format.js';
import DiscoverSearchBar from '../../components/search/DiscoverSearchBar.jsx';
import FeedHero from '../../components/feed-hero/FeedHero.jsx';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { selectHero } from '../../components/feed-hero/select-hero.js';
import {
  FeedCardSkeleton,
  FestFeedCard,
  PromotionFeedCard,
  StandaloneEventFeedCard,
} from '../../components/feed-card/FeedCard.jsx';
import './discover.css';

/* Unchanged, and it still means what it meant. */
const DECISION_ENGINE_SLIDES_ENABLED = true;

/* A promotion at every 4th position, starting at the 4th. */
const PROMOTION_EVERY = 4;

/* One screenful and a bit, so the sentinel is below the fold on first paint
   and the next page is revealed before anyone reaches the end of this one. */
const PAGE_SIZE = 12;

const SKELETON_COUNT = 3;
const DECISION_COUNT = 3;

/* Seven days. Past that a deadline is not news and does not reorder anything. */
const DEADLINE_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

const COPY = {
  offline: 'You are offline. Showing what was already loaded.',
  errorText: 'Could not load fests.',
  retry: 'Try again',
  empty: 'Fests will show up here when they go live.',
  emptyCategory: (label) => `No fests in ${label} right now.`,
  emptyCategoryAction: 'Show all fests',
  allChip: 'All',
  liveNow: 'Live now',
  feedLabel: 'Fests and promotions',
  categoriesLabel: 'Categories',
  loadingMore: 'Loading more',
};

/*
 * THE SORT. Three tiers, in this order:
 *   1. live right now
 *   2. registration closing within seven days, soonest deadline first
 *   3. everything else, soonest start first
 *
 * Ties inside a tier fall back to start date, so the order is total and
 * stable: two renders of the same data can never produce two different feeds,
 * which is what stops a card moving out from under a thumb mid-tap.
 *
 * Note on tier 2: fests do not currently carry a registration deadline in the
 * public payload (only events do), so today this tier only ever fires for
 * standalone events. It is written for the field rather than for what happens
 * to be populated, so it starts working the day the fest payload carries one.
 */
function sortForFeed(entries, nowTs) {
  const tierOf = (entry) => {
    if (entry.isLive) return 0;
    const remaining = entry.closesTs === null ? null : entry.closesTs - nowTs;
    if (remaining !== null && remaining > 0 && remaining <= DEADLINE_HORIZON_MS) return 1;
    return 2;
  };
  return [...entries].sort((a, b) => {
    const tierA = tierOf(a);
    const tierB = tierOf(b);
    if (tierA !== tierB) return tierA - tierB;
    if (tierA === 1 && a.closesTs !== b.closesTs) return a.closesTs - b.closesTs;
    return a.startTs - b.startTs;
  });
}

/*
 * Fests and standalone events normalised into one comparable shape. They are
 * different records opening different screens, but to someone browsing they
 * are both "a thing happening on a date", and the sort has to be able to weigh
 * one against the other.
 */
function toEntries(fests, standaloneEvents, nowTs) {
  const festEntries = fests.map((fest) => ({
    kind: 'fest',
    key: `fest-${fest.festSlug}`,
    startTs: new Date(fest.startsOn).getTime(),
    closesTs: fest.registrationClosesAt ? new Date(fest.registrationClosesAt).getTime() : null,
    isLive: isFestLive(fest.startsOn, fest.endsOn, nowTs),
    /* Already lower-cased and de-duplicated by the server. */
    categories: Array.isArray(fest.categories) ? fest.categories : [],
    fest,
  }));

  const eventEntries = standaloneEvents
    /* Anything already finished drops off on its own. */
    .filter((event) => !event.endsAt || new Date(event.endsAt).getTime() >= nowTs)
    .map((event) => ({
      kind: 'event',
      key: `event-${event.eventSlug}`,
      startTs: new Date(event.startsAt).getTime(),
      closesTs: event.registrationClosesAt ? new Date(event.registrationClosesAt).getTime() : null,
      isLive: isFestLive(event.startsAt, event.endsAt, nowTs),
      /* Folded here to match what the server does for fests, so one category
         string means the same thing on both kinds of entry. */
      categories: event.category ? [String(event.category).trim().toLowerCase()] : [],
      event,
    }));

  return [...festEntries, ...eventEntries];
}

/*
 * Promotions injected at every 4th position. Pure: same inputs, same feed.
 * Promotions cycle when there are fewer of them than there are slots, which is
 * the normal case — three creatives and forty fests is ten slots filled by
 * three promotions, not seven gaps.
 */
function injectPromotions(entries, promotions) {
  if (promotions.length === 0) return entries;
  const items = [];
  let promotionIndex = 0;
  entries.forEach((entry, index) => {
    if (index > 0 && index % PROMOTION_EVERY === 0) {
      const promotion = promotions[promotionIndex % promotions.length];
      items.push({
        kind: 'promotion',
        /* The slot index is in the key: the same creative legitimately appears
           more than once in a long feed, and two children cannot share a key. */
        key: `promotion-${promotion.id}-${index}`,
        promotion,
      });
      promotionIndex += 1;
    }
    items.push(entry);
  });
  return items;
}

function DiscoverScreen() {
  const navigate = useTransitionNavigate();
  const { isAuthenticated } = useAuthentication();
  const isOnline = useOnlineStatus();

  const [fests, setFests] = useState([]);
  const [standaloneEvents, setStandaloneEvents] = useState([]);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [category, setCategory] = useState(null); // null === All
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [publicPromotions, setPublicPromotions] = useState([]);
  const [decisionPromotions, setDecisionPromotions] = useState([]);

  const sentinelRef = useRef(null);

  /* Reference clock, stamped when data lands and never read during render:
     Date.now() in a render body makes "is this live" answer differently on two
     renders of identical data. */
  const [nowTs, setNowTs] = useState(() => Date.now());

  const shouldRequestDecisions = isAuthenticated && DECISION_ENGINE_SLIDES_ENABLED;


  // ── Data ────────────────────────────────────────────────────────────────

  const loadFests = useCallback(async (signal) => {
    setLoadState('loading');
    try {
      const [payload, independentPayload] = await Promise.all([
        apiClient.get('/public/fests', { signal }),
        apiClient.get('/public/events/independent', { signal }).catch(() => []),
      ]);
      const list = Array.isArray(payload) ? payload : (payload?.fests ?? []);
      setFests(list);
      setStandaloneEvents(
        Array.isArray(independentPayload) ? independentPayload : (independentPayload?.events ?? []),
      );
      setNowTs(Date.now());
      setLoadState('ready');
    } catch (error) {
      /*
       * An aborted request is not a failure — it is this component going away.
       * Showing "Could not load fests" because the person navigated on is a
       * lie, and on a fast back-and-forth it is the error the next visit
       * inherits before its own request has even resolved.
       */
      if (error?.name === 'CanceledError' || error?.name === 'AbortError' || signal?.aborted) {
        return;
      }
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFests(controller.signal);
    return () => controller.abort();
  }, [loadFests]);

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .get('/public/promotions', { signal: controller.signal })
      .then((payload) => {
        const commercial = Array.isArray(payload?.commercial) ? payload.commercial : [];
        const collegeEvent = Array.isArray(payload?.collegeEvent) ? payload.collegeEvent : [];
        /* One stream where there used to be two carousels. Commercial leads —
           that is the inventory the platform sold — but they are the same card
           as everything else. */
        setPublicPromotions([...commercial, ...collegeEvent]);
      })
      /* Silent. A home screen never shows an error because an advertisement
         did not load. */
      .catch(() => setPublicPromotions([]));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let isActive = true;
    const pending = shouldRequestDecisions
      ? fetchDistinctDecisions('homeCarousel', DECISION_COUNT)
      : Promise.resolve([]);
    pending.then((decisions) => {
      if (isActive) setDecisionPromotions(decisions.map(toPromotionSlide));
    });
    return () => {
      isActive = false;
    };
  }, [shouldRequestDecisions]);

  // ── Derived ─────────────────────────────────────────────────────────────

  const promotions =
    DECISION_ENGINE_SLIDES_ENABLED && decisionPromotions.length > 0
      ? decisionPromotions
      : publicPromotions;

  const allEntries = useMemo(
    () => toEntries(fests, standaloneEvents, nowTs),
    [fests, standaloneEvents, nowTs],
  );

  /*
   * Only categories that actually have something. Built from the `categories`
   * array the fest list now carries, so this is a read over data already in
   * memory — no request per chip, and no chip that leads to an empty screen.
   * Ordered by how many entries carry them, so the busiest categories are the
   * ones reachable without scrolling the strip.
   */
  const categoryChips = useMemo(() => {
    const counts = new Map();
    allEntries.forEach((entry) => {
      entry.categories.forEach((value) => {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      });
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value]) => ({ value, label: formatCategoryLabel(value) ?? value }));
  }, [allEntries]);

  /*
   * Instant and client-side, for both filters: a chip tap and a keystroke are
   * each an array filter over data already in memory, not a round trip.
   */
  const filteredEntries = useMemo(
    () =>
      category === null
        ? allEntries
        : allEntries.filter((entry) => entry.categories.includes(category)),
    [allEntries, category],
  );

  const liveEntries = useMemo(
    () => filteredEntries.filter((entry) => entry.isLive),
    [filteredEntries],
  );

  const heroSelection = useMemo(
    () => selectHero(fests, promotions, nowTs),
    [fests, promotions, nowTs],
  );

  /*
   * The hero's fest is removed from the feed below it. Showing the same fest
   * twice, once enormous and once small, within one screen of scrolling reads
   * as a bug rather than as emphasis.
   */
  const heroKey = heroSelection?.kind === 'fest' ? `fest-${heroSelection.fest.festSlug}` : null;

  const feedItems = useMemo(() => {
    const withoutHero = heroKey
      ? filteredEntries.filter((entry) => entry.key !== heroKey)
      : filteredEntries;
    return injectPromotions(sortForFeed(withoutHero, nowTs), promotions);
  }, [filteredEntries, heroKey, promotions, nowTs]);

  const visibleItems = feedItems.slice(0, visibleCount);
  const hasMore = visibleCount < feedItems.length;

  /* A new filter is a new list; paging starts again at the top of it. */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleCount(PAGE_SIZE);
  }, [category]);

  // ── Infinite scroll ─────────────────────────────────────────────────────

  /*
   * One observer on one sentinel. It reveals the next page from the list
   * already in memory — see the file header for why there is no request here.
   * Re-armed whenever `hasMore` changes so it stops observing at the end of
   * the list rather than firing forever against a slice that cannot grow.
   */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => count + PAGE_SIZE);
        }
      },
      /* The same 200px look-ahead the media uses, so the next page is being
         built while the last one is still being read. */
      { rootMargin: '200px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, feedItems.length]);

  // ── Actions ─────────────────────────────────────────────────────────────

  /*
   * THE ONE SHARED-ELEMENT NAVIGATION IN THE APP.
   *
   * `cardElement` is the card the thumb actually landed on — passed up from
   * FeedCard rather than looked up by slug, because the name must go on ONE
   * node and a querySelector by slug is a promise that no two cards in the
   * feed ever describe the same fest. markSharedFestPoster does the rest: it
   * checks the poster is really on screen, tags exactly that node, and arms
   * the handoff the fest hero consumes on its first render. If any of that
   * fails — no poster, scrolled out of view, no API support — it returns false
   * and this is an ordinary forward slide, which is a fine outcome and not an
   * error path.
   */
  function openFest(fest, cardElement) {
    const isMorphing = markSharedFestPoster(cardElement ?? null, fest.festSlug ?? null);
    navigate(`/fests/${fest.festSlug}`, {
      /*
       * The poster travels with the navigation, so the fest page can paint the
       * hero on its FIRST render rather than after the fetch — which is the
       * only window in which the morph can land. Sent only when the morph is
       * actually armed: without it the fest page shows its normal skeleton,
       * and a preview poster with no transition behind it would just be an
       * image that flickers and is replaced.
       */
      state: isMorphing ? { posterPreviewUrl: fest.bannerImageUrl ?? null } : undefined,
    });
  }

  function openStandaloneEvent(event) {
    navigate(`/events/${event.eventSlug}`, { state: { festSlug: event.festSlug } });
  }

  const categoryLabel = categoryChips.find((chip) => chip.value === category)?.label ?? '';
  const isEmptyPlatform = loadState === 'ready' && allEntries.length === 0;
  const isEmptyCategory = loadState === 'ready' && category !== null && filteredEntries.length === 0;

  return (
    <div className="dsc-shell">
      {!isOnline ? (
        <div className="dsc-offline" role="status">
          <span className="dsc-col">{COPY.offline}</span>
        </div>
      ) : null}

      <main className="dsc-col">
        {/* Mobile only — search.css hides it at >=1024px, where the header icon
            opens the modal instead. */}
        <DiscoverSearchBar />

        {loadState === 'ready' ? (
          <FeedHero selection={heroSelection} nowTs={nowTs} onOpenFest={openFest} />
        ) : null}

        {/* Absent from the DOM when nothing is live — not hidden. */}
        {liveEntries.length > 0 ? (
          <section aria-label={COPY.liveNow}>
            <p className="dsc-sectionlabel">{COPY.liveNow}</p>
            <div className="dsc-livestrip">
              {liveEntries.map((entry) => (
                <button
                  key={`live-${entry.key}`}
                  type="button"
                  className="dsc-livechip"
                  onClick={() =>
                    entry.kind === 'fest' ? openFest(entry.fest) : openStandaloneEvent(entry.event)
                  }
                >
                  <span className="dsc-live__dot" aria-hidden="true" />
                  <span className="dsc-livechip__name">
                    {entry.kind === 'fest' ? entry.fest.festName : entry.event.eventName}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* Chips only when there is more than one thing to choose between. */}
        {categoryChips.length > 1 ? (
          <div className="dsc-chips" role="group" aria-label={COPY.categoriesLabel}>
            <button
              type="button"
              className="dsc-chip"
              aria-pressed={category === null}
              onClick={() => setCategory(null)}
            >
              {COPY.allChip}
            </button>
            {categoryChips.map((chip) => (
              <button
                key={chip.value}
                type="button"
                className="dsc-chip"
                aria-pressed={category === chip.value}
                onClick={() => setCategory(chip.value)}
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}

        {loadState === 'loading' ? (
          <div className="dsc-feed" aria-busy="true" aria-label={COPY.feedLabel}>
            {Array.from({ length: SKELETON_COUNT }, (unused, index) => (
              <FeedCardSkeleton key={index} />
            ))}
          </div>
        ) : null}

        {loadState === 'error' ? (
          <div className="dsc-state">
            <div className="dsc-state--error">
              <p className="dsc-state__text">{COPY.errorText}</p>
            </div>
            <button type="button" className="dsc-button" onClick={() => loadFests(undefined)}>
              {COPY.retry}
            </button>
          </div>
        ) : null}


        {isEmptyPlatform ? (
          <EmptyState line={COPY.empty} className="dsc-empty" />
        ) : null}

        {/* A filter that matched nothing is a different situation from an empty
            platform, and it has an obvious way out. */}
        {isEmptyCategory ? (
          <div className="dsc-state">
            <p className="dsc-state__text">{COPY.emptyCategory(categoryLabel)}</p>
            <button type="button" className="dsc-button" onClick={() => setCategory(null)}>
              {COPY.emptyCategoryAction}
            </button>
          </div>
        ) : null}

        {loadState === 'ready' && visibleItems.length > 0 ? (
          <div className="dsc-feed" aria-label={COPY.feedLabel}>
            {visibleItems.map((item) => {
              if (item.kind === 'fest') {
                return (
                  <FestFeedCard
                    key={item.key}
                    fest={item.fest}
                    nowTs={nowTs}
                    onOpen={(cardElement) => openFest(item.fest, cardElement)}
                  />
                );
              }
              if (item.kind === 'event') {
                return (
                  <StandaloneEventFeedCard
                    key={item.key}
                    event={item.event}
                    nowTs={nowTs}
                    onOpen={() => openStandaloneEvent(item.event)}
                  />
                );
              }
              return (
                <PromotionFeedCard
                  key={item.key}
                  promotion={item.promotion}
                  /* A sponsor card routes INWARD to the fest it sponsors, never
                     outward to the web. Inert until the payload carries one. */
                  onOpenFest={(slug) => navigate(`/fests/${slug}`)}
                />
              );
            })}

            {hasMore ? (
              <>
                <div className="dsc-sentinel" ref={sentinelRef} aria-hidden="true" />
                <p className="dsc-loadmore" role="status">
                  <span className="dsc-spinner" aria-hidden="true" />
                  {COPY.loadingMore}
                </p>
              </>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default DiscoverScreen;

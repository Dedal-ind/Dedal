// CategoryEventsScreen.jsx
// Route: /explore — the fest browser.
// Lists actual FESTS (not the events inside them) as a poster grid. The
// category chips filter fests by whether they CONTAIN an event of that category
// (resolved server-side via GET /public/fests?category=...); the sort control
// re-orders client-side by date or name; ?q= narrows by fest/college name.
// Tapping a fest opens its detail page, exactly like Discover.
//
// Every endpoint, query parameter, observer and piece of state below is exactly
// as it was; this was a visual migration onto the design system.
//
// TWO THINGS CHANGED SHAPE, both for density. The fest list was a single
// stacked column of cards at a fixed width, which on a laptop showed four fests
// and a thousand pixels of empty page; it is now an intrinsic grid that follows
// the window. And the tiles are drawn locally rather than through the shared
// FestCard, which is still on the Heritage palette and is not this task's to
// migrate — the data shown is identical.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import apiClient from '../../api-client/api-client.js';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { fetchPublicCatalog } from '../../helpers/public-catalog.js';
import { fuzzyMatchAny } from '../../helpers/fuzzy-match.js';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import {
  ChevronIcon,
  CloseIcon,
  FilterIcon,
  OfflineIcon,
  RetryIcon,
  SearchIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import {
  CATEGORY_EVENTS_COPY,
  COMMON_EVENT_CATEGORIES,
  EVENT_CATEGORIES,
  CONNECTION_COPY,
} from '../../brand/brand-copy.js';
import '../../design/category-events.css';

/*
 * THE RESULT TAGS ARE LOCAL, NOT SEARCH_COPY.
 *
 * SEARCH_COPY.festTag / .eventTag are 'FEST' and 'EVENT' — the retired stamped
 * uppercase — and they are also read by /search, which is not this task's to
 * migrate. Changing them at source would silently restyle a screen I do not
 * own, so they are overridden here and the shared keys are left alone.
 */
const RESULT_TAGS = {
  category: 'Category',
  fest: 'Fest',
  event: 'Event',
};

/* Sentence case, and matching the shared no-results line without borrowing the
   uppercase tags above it. */
const NO_MATCHES_LINE = 'Try a different fest, event, or college.';

const REVEAL_PAGE_SIZE = 8;

const SORT_ORDERS = [
  { value: 'date', label: CATEGORY_EVENTS_COPY.sortByDate },
  { value: 'name', label: CATEGORY_EVENTS_COPY.sortByName },
];

/*
 * Fest dates, in IST, formatted here.
 *
 * NOT formatFestDateRange from helpers/event-format.js: it returns the stamped
 * uppercase of the retired palette ("JUL 17 – JUL 20") and joins the two ends
 * with an en dash, both of which this surface has retired. The helper is still
 * correct for the screens that have not moved and is left untouched.
 *
 * The formatter is constructed once at module scope because an
 * Intl.DateTimeFormat is expensive to build and this runs once per tile on
 * every render of a grid that can hold fifty.
 */
const FEST_DATE_FORMAT = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Kolkata',
});

function formatFestDates(startsOn, endsOn) {
  const start = startsOn ? new Date(startsOn) : null;
  const end = endsOn ? new Date(endsOn) : null;
  if (!start || Number.isNaN(start.getTime())) {
    return '';
  }
  const startLabel = FEST_DATE_FORMAT.format(start);
  if (!end || Number.isNaN(end.getTime())) {
    return startLabel;
  }
  const endLabel = FEST_DATE_FORMAT.format(end);
  /* "to", not a dash of any kind. */
  return startLabel === endLabel ? startLabel : `${startLabel} to ${endLabel}`;
}

function readCollegeName(fest) {
  if (fest.hostCollegeId && typeof fest.hostCollegeId === 'object') {
    return fest.hostCollegeId.commonName ?? fest.hostCollegeId.collegeName ?? '';
  }
  return fest.hostCollegeName ?? '';
}

/*
 * The tile. A full-bleed poster with the identity overlaid, which is how a fest
 * is drawn everywhere else in the app. A missing banner and a banner that 404s
 * land on the same --accent-to--ink fallback, so the overlaid text always has
 * something it can be read against.
 */
function FestTile({ fest, onOpen }) {
  const [hasImageFailed, setHasImageFailed] = useState(false);
  const showImage = Boolean(fest.bannerImageUrl) && !hasImageFailed;
  const collegeName = readCollegeName(fest);
  const dateLabel = formatFestDates(fest.startsOn, fest.endsOn);

  return (
    <button type="button" onClick={onOpen} className="dce-fest">
      {showImage ? (
        <img
          className="dce-fest__image"
          src={fest.bannerImageUrl}
          alt=""
          loading="lazy"
          onError={() => setHasImageFailed(true)}
        />
      ) : (
        <span className="dce-fest__fallback" aria-hidden="true" />
      )}
      <span className="dce-fest__scrim" aria-hidden="true" />
      <span className="dce-fest__body">
        <span className="dce-fest__name">{fest.festName}</span>
        {collegeName ? <span className="dce-fest__college">{collegeName}</span> : null}
        {dateLabel ? <span className="dce-fest__dates">{dateLabel}</span> : null}
      </span>
    </button>
  );
}

/*
 * The escape hatch from the chip row. Chips cover the categories participants
 * actually browse by; an event can carry ANY category string an organiser typed
 * ("Robotics", "Culinary Arts"), and no fixed chip row will ever show those.
 * So: type it.
 *
 * The sliders icon on the left toggles a panel of category tiles plus the sort
 * control, tucked behind one tap so it does not push the fest grid down on
 * first load.
 */
function CategorySearchField({
  activeCategory,
  onSelectCategory,
  navigate,
  sortOrder,
  onSortChange,
  sortOrders,
  resultCount,
}) {
  const [queryText, setQueryText] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [catalog, setCatalog] = useState({ fests: [], events: [] });
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const inputReference = useRef(null);
  const containerReference = useRef(null);

  // Lazy-load the catalog on first focus so the page stays fast.
  function handleFocus() {
    setIsActive(true);
    setIsFilterOpen(false);
    if (!catalogLoaded) {
      fetchPublicCatalog()
        .then((nextCatalog) => {
          setCatalog(nextCatalog);
          setCatalogLoaded(true);
        })
        .catch(() => {
          setCatalogLoaded(true);
        });
    }
  }

  // Close dropdowns when clicking outside.
  useEffect(() => {
    function handleDocumentClick(clickEvent) {
      if (containerReference.current && !containerReference.current.contains(clickEvent.target)) {
        setIsActive(false);
        setIsFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  // Combined results: categories + fests + events (with fuzzy matching)
  const results = useMemo(() => {
    const normalisedQuery = queryText.trim().toLowerCase();
    if (!normalisedQuery) return [];

    const categoryMatches = EVENT_CATEGORIES.filter((category) =>
      fuzzyMatchAny(normalisedQuery, [category.label]),
    ).map((category) => ({
      key: `cat-${category.value}`,
      type: 'category',
      name: category.label,
      subtitle: '',
      value: category.value,
    }));

    const festMatches = catalog.fests
      .filter((fest) => fuzzyMatchAny(normalisedQuery, [fest.festName, readCollegeName(fest)]))
      .map((fest) => ({
        key: `fest-${fest.festSlug}`,
        type: 'fest',
        name: fest.festName,
        subtitle: readCollegeName(fest),
        festSlug: fest.festSlug,
      }));

    const eventMatches = catalog.events
      .filter((event) =>
        fuzzyMatchAny(normalisedQuery, [event.eventName, event.festName, event.collegeName]),
      )
      .map((event) => ({
        key: `event-${event.festSlug}-${event.eventSlug}`,
        type: 'event',
        name: event.eventName,
        subtitle: event.festName,
        festSlug: event.festSlug,
        eventSlug: event.eventSlug,
      }));

    return [...categoryMatches, ...festMatches, ...eventMatches];
  }, [catalog, queryText]);

  function openResult(result) {
    setIsActive(false);
    setQueryText('');
    if (result.type === 'category') {
      onSelectCategory(result.value);
    } else if (result.type === 'fest') {
      navigate(`/fests/${result.festSlug}`);
    } else {
      navigate(`/events/${result.eventSlug}`, { state: { festSlug: result.festSlug } });
    }
  }

  function applyCategory(categoryValue) {
    setIsFilterOpen(false);
    setIsActive(false);
    setQueryText('');
    onSelectCategory(categoryValue.trim());
  }

  const hasQuery = queryText.trim() !== '';

  return (
    <div ref={containerReference}>
      <div className="dce-field">
        {/*
         * Sliders, not a funnel: this panel sets a category AND a sort order,
         * which is two controls. (lucide-react 1.42 has no `Filter` export
         * anyway — see DetailIcons.)
         */}
        <button
          type="button"
          onClick={() => {
            setIsFilterOpen((previous) => !previous);
            setIsActive(false);
          }}
          aria-label="Filter and sort"
          aria-expanded={isFilterOpen}
          className="dce-field__button"
        >
          <FilterIcon size="sm" />
        </button>

        <input
          ref={inputReference}
          type="text"
          value={queryText}
          onChange={(changeEvent) => {
            setQueryText(changeEvent.target.value);
            setIsActive(true);
            setIsFilterOpen(false);
          }}
          onFocus={handleFocus}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === 'Escape') {
              setIsActive(false);
              setIsFilterOpen(false);
              inputReference.current?.blur();
            }
          }}
          placeholder="Search fests, events and colleges"
          aria-label="Search fests, events and colleges"
          autoComplete="off"
          spellCheck={false}
          className="dce-field__input"
          data-search-input
        />

        {hasQuery ? (
          <button
            type="button"
            onClick={() => setQueryText('')}
            aria-label="Clear the search"
            className="dce-field__button"
          >
            <CloseIcon size="sm" />
          </button>
        ) : null}

        <span className="dce-field__icon" aria-hidden="true">
          <SearchIcon size="sm" />
        </span>
      </div>

      {/* Suggestions */}
      {isActive && hasQuery ? (
        <div className="dce-drop">
          {results.length === 0 ? (
            <p className="dce-drop__empty">{NO_MATCHES_LINE}</p>
          ) : (
            results.slice(0, 8).map((result) => (
              <button
                key={result.key}
                type="button"
                onClick={() => openResult(result)}
                className="dce-drop__row"
              >
                <span
                  className={
                    result.type === 'fest' ? 'dce-drop__tag dce-drop__tag--fest' : 'dce-drop__tag'
                  }
                >
                  {RESULT_TAGS[result.type]}
                </span>
                <span className="dce-drop__text">
                  <span className="dce-drop__name">{result.name}</span>
                  {result.subtitle ? (
                    <span className="dce-drop__sub">{result.subtitle}</span>
                  ) : null}
                </span>
                <span className="dce-drop__chevron">
                  <ChevronIcon size="sm" />
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}

      {/*
       * The filter panel. ALWAYS RENDERED, shown by class rather than mounted on
       * open — a panel that unmounts can only ever animate in, so keeping it
       * mounted is what buys the exit. (Reasoning carried over from the screen
       * this replaces.)
       */}
      <div
        aria-hidden={isFilterOpen ? undefined : 'true'}
        className={
          isFilterOpen ? 'dce-panel dce-panel--open' : 'dce-panel dce-panel--closed'
        }
      >
        <div className="dce-panel__grid">
          {COMMON_EVENT_CATEGORIES.slice(0, 8).map((category) => {
            const isActiveCategory =
              activeCategory.toLowerCase() === category.value.toLowerCase();
            return (
              <button
                key={category.value}
                type="button"
                onClick={() => applyCategory(category.value)}
                tabIndex={isFilterOpen ? 0 : -1}
                aria-pressed={isActiveCategory}
                className={isActiveCategory ? 'dce-tile dce-tile--active' : 'dce-tile'}
              >
                {category.label}
              </button>
            );
          })}
        </div>

        {/*
         * Sort lives here rather than in a row of its own under the chips. It
         * was costing a full band of the screen — permanently visible, on a
         * control most people set once if ever — directly above the cards it was
         * pushing down. This panel is already "change what this list shows",
         * which is the same job.
         */}
        <div className="dce-panel__sort">
          <div className="dce-panel__sorthead">
            <span>Sort</span>
            {resultCount != null ? (
              <span>
                {resultCount} {resultCount === 1 ? 'fest' : 'fests'}
              </span>
            ) : null}
          </div>
          <div className="dce-panel__sortrow">
            {sortOrders.map((order) => (
              <button
                key={order.value}
                type="button"
                onClick={() => onSortChange(order.value)}
                tabIndex={isFilterOpen ? 0 : -1}
                aria-pressed={sortOrder === order.value}
                className={sortOrder === order.value ? 'dce-sort dce-sort--active' : 'dce-sort'}
              >
                {order.label}
              </button>
            ))}
          </div>
        </div>

        {activeCategory ? (
          <button
            type="button"
            onClick={() => applyCategory('')}
            tabIndex={isFilterOpen ? 0 : -1}
            className="dce-panel__clear"
          >
            Clear the filter
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CategoryEventsScreen() {
  const navigate = useTransitionNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = searchParams.get('category') ?? '';
  const searchText = searchParams.get('q') ?? '';

  const [fests, setFests] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const isOnline = useOnlineStatus();
  const [sortOrder, setSortOrder] = useState('date');
  const [visibleCount, setVisibleCount] = useState(REVEAL_PAGE_SIZE);
  const sentinelReference = useRef(null);

  // Category filtering is resolved server-side (a fest is kept when any of its
  // events matches), so the fest list is re-fetched when the category changes.
  const loadFests = useCallback(async () => {
    setLoadState('loading');
    try {
      const params = {};
      if (activeCategory) {
        params.category = activeCategory;
      }
      const payload = await apiClient.get('/public/fests', { params });
      setFests(Array.isArray(payload) ? payload : []);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [activeCategory]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFests();
  }, [loadFests]);

  // Text search + sort are applied client-side over the (category-filtered) fests.
  const visibleFests = useMemo(() => {
    const normalisedQuery = searchText.trim().toLowerCase();
    const filtered = fests.filter((fest) => {
      if (!normalisedQuery) {
        return true;
      }
      return [fest.festName, readCollegeName(fest)]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(normalisedQuery));
    });
    return [...filtered].sort((firstFest, secondFest) =>
      sortOrder === 'name'
        ? (firstFest.festName ?? '').localeCompare(secondFest.festName ?? '')
        : new Date(firstFest.startsOn) - new Date(secondFest.startsOn),
    );
  }, [fests, searchText, sortOrder]);

  // Reset the reveal window whenever the filtered/sorted list changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleCount(REVEAL_PAGE_SIZE);
  }, [activeCategory, searchText, sortOrder]);

  // Infinite-scroll reveal: grow the window when the sentinel scrolls into view.
  useEffect(() => {
    const sentinel = sentinelReference.current;
    if (!sentinel) {
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount((previousCount) => previousCount + REVEAL_PAGE_SIZE);
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleFests.length]);

  function selectCategory(categoryValue) {
    const nextParams = {};
    if (categoryValue) {
      nextParams.category = categoryValue;
    }
    if (searchText) {
      nextParams.q = searchText;
    }
    setSearchParams(nextParams);
  }

  function openFest(festSlug) {
    navigate(`/fests/${festSlug}`);
  }

  const shownFests = visibleFests.slice(0, visibleCount);
  const hasMore = visibleCount < visibleFests.length;

  return (
    <div className="dce-screen">
      {/* The bar IS the heading — no <h1> below it. */}
      <ScreenHeader title="Explore" />

      <div className="dce-bar">
        <div className="dce-bar__inner">
          <CategorySearchField
            activeCategory={activeCategory}
            onSelectCategory={selectCategory}
            navigate={navigate}
            sortOrder={sortOrder}
            onSortChange={setSortOrder}
            sortOrders={SORT_ORDERS}
            resultCount={loadState === 'ready' ? visibleFests.length : null}
          />

          <div className="dce-chips">
            <button
              type="button"
              onClick={() => selectCategory('')}
              aria-pressed={activeCategory === ''}
              className={activeCategory ? 'dce-chip' : 'dce-chip dce-chip--active'}
            >
              {CATEGORY_EVENTS_COPY.categoryAll}
            </button>
            {COMMON_EVENT_CATEGORIES.map((category) => {
              const isActive = activeCategory.toLowerCase() === category.value.toLowerCase();
              return (
                <button
                  key={category.value}
                  type="button"
                  onClick={() => selectCategory(category.value)}
                  aria-pressed={isActive}
                  className={isActive ? 'dce-chip dce-chip--active' : 'dce-chip'}
                >
                  {category.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="dce-col">
        {loadState === 'loading' ? (
          <ul className="dce-grid" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
              <li key={index} className="dce-grid__cell">
                <div className="dce-skeleton" />
              </li>
            ))}
          </ul>
        ) : null}

        {/* Offline gets its own words, since retrying will not help until the
            connection is back. */}
        {loadState === 'error' ? (
          <div className="dce-error">
            <p className="dce-error__line">
              {isOnline ? CATEGORY_EVENTS_COPY.errorMessage : CONNECTION_COPY.offlineMessage}
            </p>
            <button type="button" onClick={loadFests} className="dce-error__retry">
              {isOnline ? <RetryIcon size="sm" /> : <OfflineIcon size="sm" />}
              {CONNECTION_COPY.errorRetry}
            </button>
          </div>
        ) : null}

        {loadState === 'ready' && visibleFests.length === 0 ? (
          <EmptyState className="dce-empty" line="No fests match this filter right now." />
        ) : null}

        {loadState === 'ready' && visibleFests.length > 0 ? (
          <>
            <ul className="dce-grid">
              {shownFests.map((fest) => (
                <li key={fest.festSlug ?? fest.id} className="dce-grid__cell">
                  <FestTile fest={fest} onOpen={() => openFest(fest.festSlug)} />
                </li>
              ))}
            </ul>
            {hasMore ? (
              <p ref={sentinelReference} className="dce-more">
                {CATEGORY_EVENTS_COPY.loadingMore}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default CategoryEventsScreen;

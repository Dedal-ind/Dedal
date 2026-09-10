// SearchPanel.jsx
// The search experience itself — input, chips, trending, results — with no
// opinion about whether it is inside a desktop modal or a mobile page.
//
// ONE IMPLEMENTATION, TWO CONTAINERS. The desktop modal and the /search page
// differ in how they arrive on screen and nothing else: same field, same
// debounce, same chips, same two-column grid, same rows. Building them
// separately would mean fixing every search bug twice and watching them drift.
// The container owns the chrome (a scrim and a box, or a back arrow and a
// heading); this owns the behaviour.
//
// The rotating placeholder is here rather than in the container because it is
// part of the field, and the mobile Discover bar shows the SAME rotation while
// not being a field at all — see useRotatingPlaceholder, which both import.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCategoryLabel } from '../../helpers/category-format.js';
import { formatFeedDateRange } from '../../helpers/feed-format.js';
import { useViewability } from '../../hooks/use-viewability/use-viewability.js';
import { DELIVERY_EVENT_KINDS, reportDeliveryEvent } from '../../helpers/delivery-reporter.js';
import {
  categoriesOf,
  filterByCategory,
  injectPromotions,
  loadSearchCatalog,
  searchCatalog,
  selectTrending,
} from '../../helpers/search-catalog.js';
import RotatingPlaceholder from './RotatingPlaceholder.jsx';
import './search.css';

/* Long enough that a fast typist sends one request per word rather than one
   per keystroke; short enough that a pause feels answered. */
const DEBOUNCE_MS = 300;

const COPY = {
  clear: 'Clear search',
  trending: 'Trending',
  trendingIn: (city) => `Trending in ${city}`,
  results: 'Results',
  noResults: (q) => `Nothing matches "${q}".`,
  loading: 'Loading',
  promoted: 'Promoted',
  allChip: 'All',
};

function ClearGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/*
 * A promoted row reports the same three things a promotion card in the feed
 * reports, against the same token, through the same hook and reporter. A
 * sponsored recommendation that is seen in search is delivery just as much as
 * one seen in the feed; not reporting it would quietly under-count what the
 * platform sold.
 */
function useRowMeasurement(item, rowRef) {
  const decisionToken = item.isPromoted ? (item.promotion?.decisionToken ?? null) : null;
  useViewability({
    elementRef: rowRef,
    decisionKey: decisionToken,
    mediaType: 'image',
    onViewable: useCallback(
      (token) => reportDeliveryEvent(token, DELIVERY_EVENT_KINDS.VIEWABLE),
      [],
    ),
  });
  return {
    onRendered: () => {
      if (decisionToken) reportDeliveryEvent(decisionToken, DELIVERY_EVENT_KINDS.MEASURABLE);
    },
    onActivate: () => {
      if (decisionToken) reportDeliveryEvent(decisionToken, DELIVERY_EVENT_KINDS.CLICK);
    },
  };
}

function ResultRow({ item, onNavigate }) {
  const rowRef = useRef(null);
  const { onRendered, onActivate } = useRowMeasurement(item, rowRef);

  const dateLine =
    item.kind === 'event' && item.startsAt
      ? formatFeedDateRange(item.startsAt, item.endsAt, Date.parse(item.startsAt))
      : null;

  const body = (
    <>
      <span className="dsr-row__thumb">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" loading="lazy" decoding="async" onLoad={onRendered} />
        ) : (
          /* No artwork: the one place --accent appears at this size. Repeating
             the title inside the square would say it twice. */
          <span className="dsr-row__thumb-fallback" aria-hidden="true" />
        )}
      </span>
      <span className="dsr-row__text">
        <span className="dsr-row__title">{item.title}</span>
        <span className="dsr-row__type">
          {item.typeLabel}
          {item.isPromoted ? <span className="dsr-promoted">{COPY.promoted}</span> : null}
        </span>
        {dateLine ? <span className="dsr-row__date">{dateLine}</span> : null}
        {!dateLine && item.subtitle ? (
          <span className="dsr-row__date">{item.subtitle}</span>
        ) : null}
      </span>
    </>
  );

  /* A promotion leaves the app, so it is an anchor; everything else routes
     inside it, so it is a button. A link that goes nowhere still takes a tab
     stop and still announces itself as a link. */
  if (item.isPromoted) {
    return item.href ? (
      <a
        ref={rowRef}
        className="dsr-row"
        href={item.href}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={onActivate}
      >
        {body}
      </a>
    ) : (
      <div ref={rowRef} className="dsr-row dsr-row--inert">
        {body}
      </div>
    );
  }

  return (
    <button ref={rowRef} type="button" className="dsr-row" onClick={() => onNavigate(item)}>
      {body}
    </button>
  );
}

function SearchPanel({
  query,
  onQueryChange,
  onDismiss,
  placeholder,
  placeholderPrefix = null,
  placeholderTerm = null,
  autoFocus = true,
  city = null,
  promotions = [],
  inputRef: externalInputRef,
  /*
   * What sits at the head of the field. The desktop modal leaves it undefined
   * and gets the magnifier; the mobile page passes its back arrow.
   *
   * On a full-page search the magnifier is decoration — you are looking at a
   * search page, in a search field, with the keyboard already up; nothing about
   * it is in doubt. The slot it was occupying is the best place on the screen
   * for the one control that is genuinely needed there, which is the way out.
   */
  leading = null,
}) {
  const navigate = useNavigate();
  const internalInputRef = useRef(null);
  const inputRef = externalInputRef ?? internalInputRef;

  const [catalog, setCatalog] = useState({ fests: [], events: [] });
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [category, setCategory] = useState(null);
  /* The query the results reflect, which lags the field by the debounce. */
  const [settledQuery, setSettledQuery] = useState(query);
  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => {
    /* An isActive flag, not an AbortController: the catalogue request is shared
       between this panel and any other, so one unmount must not cancel it for
       everyone. See loadSearchCatalog. */
    let isActive = true;
    loadSearchCatalog()
      .then((next) => {
        if (!isActive) return;
        setCatalog(next);
        setNowTs(Date.now());
        setLoadState('ready');
      })
      .catch(() => {
        if (isActive) setLoadState('error');
      });
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus, inputRef]);

  /* The debounce. Every keystroke restarts it, so the results update once the
     typing stops rather than on the way through. */
  useEffect(() => {
    const timer = setTimeout(() => setSettledQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const trending = useMemo(
    () => (loadState === 'ready' ? selectTrending(catalog, nowTs) : []),
    [catalog, nowTs, loadState],
  );

  const chips = useMemo(() => {
    const values = categoriesOf(trending);
    return values.map((value) => ({ value, label: formatCategoryLabel(value) ?? value }));
  }, [trending]);

  const hasQuery = settledQuery.trim().length > 0;

  const rows = useMemo(() => {
    const base = hasQuery ? searchCatalog(catalog, settledQuery) : trending;
    return injectPromotions(filterByCategory(base, category), promotions);
  }, [hasQuery, settledQuery, catalog, trending, category, promotions]);

  function handleNavigate(item) {
    onDismiss?.();
    navigate(item.route, item.routeState ? { state: item.routeState } : undefined);
  }

  const heading = hasQuery
    ? COPY.results
    : city
      ? COPY.trendingIn(city)
      : COPY.trending;

  return (
    <div className="dsr-panel">
      <div className="dsr-field">
        {/*
          No magnifier by default. Inside a modal whose only content is a search
          field, or on a page that is nothing but search, the icon labels
          something already unambiguous and steals the one slot worth having —
          which is why the mobile page puts its back arrow here instead.
        */}
        {leading}
        <span className="dsr-field__slot">
          {/*
            The animated suggestion, shown only while the field is empty — the
            moment there is a query the field speaks for itself, and a ghost
            under real text would be two strings in one box.
          */}
          {!query && placeholderTerm ? (
            <RotatingPlaceholder prefix={placeholderPrefix} term={placeholderTerm} />
          ) : null}
          <input
            ref={inputRef}
            className="dsr-field__input"
            type="search"
            value={query}
            onChange={(changeEvent) => onQueryChange(changeEvent.target.value)}
            /* Empty: the visible suggestion is the element above. The full
               sentence is still the accessible name, and it does NOT rotate —
               a screen reader must not hear the field rename itself while
               somebody is deciding what to type. */
            placeholder=""
            autoComplete="off"
            spellCheck={false}
            aria-label={placeholder}
          />
        </span>
        {query ? (
          <button
            type="button"
            className="dsr-field__clear"
            onClick={() => {
              onQueryChange('');
              inputRef.current?.focus();
            }}
            aria-label={COPY.clear}
          >
            <ClearGlyph />
          </button>
        ) : null}
      </div>

      {chips.length > 1 ? (
        <div className="dsr-chips" role="group" aria-label="Categories">
          <button
            type="button"
            className="dsr-chip"
            aria-pressed={category === null}
            onClick={() => setCategory(null)}
          >
            {COPY.allChip}
          </button>
          {chips.map((chip) => (
            <button
              key={chip.value}
              type="button"
              className="dsr-chip"
              aria-pressed={category === chip.value}
              onClick={() => setCategory(chip.value)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}

      <p className="dsr-heading">{heading}</p>

      {loadState === 'loading' ? <p className="dsr-note">{COPY.loading}</p> : null}

      {loadState === 'ready' && rows.length === 0 ? (
        <p className="dsr-note">
          {hasQuery ? COPY.noResults(settledQuery.trim()) : COPY.trending}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="dsr-grid">
          {rows.map((item) => (
            <ResultRow key={item.key} item={item} onNavigate={handleNavigate} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default SearchPanel;

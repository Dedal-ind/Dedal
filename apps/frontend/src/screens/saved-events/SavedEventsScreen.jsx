// SavedEventsScreen.jsx
// Route: /saved — the events this participant bookmarked, on the dedal design
// system.
//
// WHAT CHANGED, AND WHAT DID NOT.
//
// Not the data. It is the same single call to GET /users/me/saved-events, the
// same filter against the live id set from useSavedEvents, and the same
// unsaveEvent + brief toast. Nothing about the endpoints, the payloads or the
// state machine moved.
//
// The layout did. The screen was a single stacked column of 320px-tall poster
// cards at any width, which on a desktop stranded one narrow strip in the
// middle of the window and turned six saved events into three screenfuls of
// scrolling. It is now an intrinsic grid — see saved-events.css — one column on
// a phone and as many as the window can hold above that.
//
// The title lives in ScreenHeader, which also stands the app header down (see
// screen-title-context.jsx), so this screen renders NO heading of its own and
// reserves no space above the content.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { useSavedEvents } from '../../hooks/use-saved-events/use-saved-events.js';
import { useExitTransition } from '../../hooks/use-exit-transition/use-exit-transition.js';
import { apiClient } from '../../api-client/api-client.js';
import {
  BookmarkIcon,
  OfflineIcon,
  UnsaveIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { SAVED_COPY, CONNECTION_COPY } from '../../brand/brand-copy.js';

/*
 * SENTENCE CASE, SPELLED OUT LOCALLY.
 *
 * The design system is sentence case; brand-copy.js still holds the stamped
 * uppercase strings the Heritage frames were drawn with ("REMOVED FROM SAVED"),
 * and brand-copy.js is not this screen's file to edit. Rather than shouting on
 * a redesigned surface or faking it with `text-transform` — which would leave
 * the wrong string in the accessibility tree and in any copy-paste — the two
 * affected labels are written here.
 *
 * DELETE THIS BLOCK once SAVED_COPY.removedToast reads 'Removed from saved' at
 * source; every other SAVED_COPY key this screen uses is already sentence case
 * and is read straight from the module.
 */
const SENTENCE_CASE = {
  removedToast: 'Removed from saved',
};

/* The card's one line of meta. formatDateVenue() would be the obvious helper
   and is deliberately not used: it upper-cases its output, which is the stamped
   register this surface is moving off. Same two fields, same separator. */
const SAVED_DATE = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
});

function formatSavedDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : SAVED_DATE.format(date);
}

function metaLine(event) {
  /*
   * Sentence case, and a comma rather than a middle dot. formatShortDate is the
   * retired stamped-uppercase helper ("JUL 29"), and "A · B" is the meta-string
   * tic that makes every card in an app look like every other one. On a 186px
   * card the venue is usually elided anyway, so the date carries the line.
   */
  return [formatSavedDate(event.startsAt), event.venue].filter(Boolean).join(', ');
}

/*
 * One saved event.
 *
 * The poster button and the unsave button are SIBLINGS, never nested: a button
 * inside a button is invalid HTML, and browsers resolve it by dropping one —
 * which is how a tap on unsave ends up opening the event instead.
 */
function SavedEventCard({ event, isOnline, onOpen, onRemove }) {
  const imageUrl = event.posterImageUrl || event.bannerImageUrl || null;
  const meta = metaLine(event);

  return (
    <article className="dse-card">
      <button type="button" className="dse-card__open" onClick={onOpen}>
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" className="dse-card__image" />
        ) : (
          <span className="dse-card__placeholder">
            <BookmarkIcon size="lg" />
          </span>
        )}
        <span className="dse-card__scrim" aria-hidden="true" />
        <span className="dse-card__body">
          <span className="dse-card__name">{event.eventName}</span>
          {event.festName ? <span className="dse-card__meta">{event.festName}</span> : null}
          {meta ? <span className="dse-card__meta">{meta}</span> : null}
        </span>
      </button>

      <button
        type="button"
        className="dse-card__unsave"
        onClick={onRemove}
        /* Removing a save is a write. Offline it cannot succeed, so it is
           disabled with the reason stated rather than failing after the tap. */
        disabled={!isOnline}
        aria-label={
          isOnline
            ? `Remove ${event.eventName} from saved`
            : `Cannot remove ${event.eventName} while offline`
        }
        title={isOnline ? undefined : CONNECTION_COPY.offlineTitle}
      >
        <UnsaveIcon />
      </button>
    </article>
  );
}

/* The loading shape, not a loading animation: six cells in the real grid at the
   real aspect ratio, so nothing jumps when the cards arrive. */
const SKELETON_CELLS = [0, 1, 2, 3, 4, 5];

function SavedEventsScreen() {
  const navigate = useTransitionNavigate();
  const { savedEventIds, unsaveEvent } = useSavedEvents();
  const [allEvents, setAllEvents] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const isOnline = useOnlineStatus();
  /*
   * THE TEXT AND THE VISIBILITY ARE SEPARATE. This was a single string that was
   * set to '' to dismiss, which meant the words disappeared on the exact frame
   * the toast began leaving — so the pill sank away empty. Keeping the text and
   * clearing only `isShown` lets the message stay readable for the whole 180ms
   * it takes to go.
   */
  const [toast, setToast] = useState({ text: '', isShown: false });
  /*
   * The toast rose into place and then vanished mid-air, because it was
   * rendered only while `toastMessage` was truthy. It now stays mounted for the
   * exit and sinks back the way it came. `lastToastRef` keeps the words on
   * screen for those 180ms — an empty pill fading out is worse than no pill.
   */
  const {
    isMounted: isToastMounted,
    isVisible: isToastVisible,
    ref: toastRef,
  } = useExitTransition(toast.isShown);

  /*
   * The saved list comes from the server already resolved, so there is no need
   * to pull the whole public catalogue and filter it client-side — that fetched
   * every event in every fest to show a handful. It also self-heals: an event
   * deleted since it was saved simply is not returned.
   */
  const loadSaved = useCallback(async () => {
    setLoadState('loading');
    try {
      const result = await apiClient.get('/users/me/saved-events');
      setAllEvents(Array.isArray(result?.events) ? result.events : []);
      setLoadState('ready');
    } catch {
      /* The list is NOT cleared. Walking into a lift with this screen open
         would otherwise replace readable cards with an error panel; only the
         unsave behind them needs the network. */
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSaved();
  }, [loadSaved]);

  /* Filtered against the live id set so a removal disappears immediately
   * rather than waiting for a refetch. */
  const savedEvents = useMemo(
    () => allEvents.filter((event) => savedEventIds.includes(String(event.id))),
    [allEvents, savedEventIds],
  );

  function handleRemove(event) {
    unsaveEvent(event.id);
    setToast({ text: SENTENCE_CASE.removedToast, isShown: true });
    /* Only `isShown` flips; the text stays so the exit is not a blank pill. */
    window.setTimeout(() => setToast((previous) => ({ ...previous, isShown: false })), 2000);
  }

  const hasCached = savedEvents.length > 0;
  /* A failure with nothing behind it is a full state; a failure with cards
     already on screen is a note above them. */
  const showFailureState = loadState === 'error' && !hasCached;

  return (
    <div className="dse-screen">
      <ScreenHeader title="Saved events" />

      <div className="dse-col">
        {showFailureState ? (
          <div className="dse-state" role="status">
            <h2 className="dse-state__title">
              {isOnline ? CONNECTION_COPY.errorTitle : CONNECTION_COPY.offlineTitle}
            </h2>
            <p className="dse-state__body">
              {isOnline ? SAVED_COPY.errorMessage : CONNECTION_COPY.offlineMessage}
            </p>
            <button type="button" className="dse-state__action" onClick={loadSaved}>
              {CONNECTION_COPY.errorRetry}
            </button>
          </div>
        ) : null}

        {loadState === 'error' && hasCached ? (
          <p className="dse-notice">
            <OfflineIcon size="sm" />
            <span>
              {isOnline ? SAVED_COPY.errorMessage : CONNECTION_COPY.offlineMessage}{' '}
              <button type="button" className="dse-notice__retry" onClick={loadSaved}>
                {CONNECTION_COPY.errorRetry}
              </button>
            </span>
          </p>
        ) : null}

        {loadState === 'loading' ? (
          <ul className="dse-grid" role="list" aria-hidden="true">
            {SKELETON_CELLS.map((cell) => (
              <li key={cell} className="dse-grid__cell">
                <div className="dse-skeleton" />
              </li>
            ))}
          </ul>
        ) : null}

        {/* One sentence, one action, centred in the room the screen has left.
            The action leads outwards: there is nothing to retry on an empty
            bookmark list — only somewhere else to be. */}
        {loadState === 'ready' && !hasCached ? (
          <EmptyState
            line="Events you save will show up here."
            actionLabel="Browse fests"
            onAction={() => navigate('/explore')}
          />
        ) : null}

        {hasCached ? (
          <ul className="dse-grid" role="list">
            {savedEvents.map((event) => (
              <li className="dse-grid__cell" key={`${event.festSlug}-${event.eventSlug}`}>
                <SavedEventCard
                  event={event}
                  isOnline={isOnline}
                  onOpen={() =>
                    navigate(`/events/${event.eventSlug}`, { state: { festSlug: event.festSlug } })
                  }
                  onRemove={() => handleRemove(event)}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* role="status" so the removal is announced, not only drawn: a card
          silently leaving a grid is no feedback at all off-screen. */}
      {isToastMounted ? (
        <p
          ref={toastRef}
          className={`dse-toast${isToastVisible ? ' dse-toast--in' : ''}`}
          role="status"
        >
          {toast.text}
        </p>
      ) : null}
    </div>
  );
}

export default SavedEventsScreen;

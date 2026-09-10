// EventScheduleScreen.jsx
// Route: /schedule/:festId — the day-by-day running order for one fest.
//
// NO NEW ENDPOINT. This reads the same public event list the fest detail page
// already loads and does every split — by day, by hour, by live/upcoming/ended —
// on the client. LEAF EVENTS ONLY: verticals are dropped (their children carry
// the real slots). THE CLOCK IS CAPTURED ONCE PER LOAD, never during render.
// All of that is unchanged from the Heritage version of this screen; what
// changed is only what it looks like.
//
// THE LAYOUT MOVED FROM A RAIL TO A GRID OF HOURS. The rail — a 56px time
// gutter, a status dot per event, one card per row — was a single narrow column
// however wide the window was, which on a laptop stranded a thin ribbon in the
// middle of an empty page and turned a thirty-event fest into four screens of
// scrolling. Events were ALREADY grouped by their starting hour here, for the
// live-first sort; that grouping is now the unit of layout, and the hour blocks
// flow into an intrinsic grid. See design/event-schedule.css for the full
// argument.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import apiClient from '../../api-client/api-client.js';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { ClockIcon, VenueIcon, RetryIcon, OfflineIcon } from '../../components/detail-icons/DetailIcons.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { computeCapacityState } from '../../helpers/event-format.js';
import { buildMapsUrl } from '../../helpers/venue-map-link.js';
import { SCHEDULE_COPY, CONNECTION_COPY } from '../../brand/brand-copy.js';
import '../../design/event-schedule.css';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/*
 * ── DATES AND TIMES, IN IST, LOCALLY ────────────────────────────────────────
 *
 * NOT helpers/event-format.js. formatShortDate there returns "SEP 11" — the
 * stamped uppercase of the retired palette — and formatClockTime returns
 * "09:00 AM" for the same reason. Both are still correct for the screens that
 * have not been migrated, so they are left alone and this screen formats its
 * own.
 *
 * The formatters are module-level constants rather than per-call
 * `toLocaleString` invocations because an Intl.DateTimeFormat is expensive to
 * construct and this screen formats one label per event on every render of a
 * day that can hold fifty.
 *
 * Asia/Kolkata explicitly, on every one of them: a fest runs in India, and a
 * participant opening the schedule from a phone whose timezone is still set to
 * wherever they last travelled must not be shown a running order shifted by
 * five and a half hours.
 */
const IST_TIME_ZONE = 'Asia/Kolkata';

const TAB_DATE_FORMAT = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: IST_TIME_ZONE,
});

const CLOCK_FORMAT = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: IST_TIME_ZONE,
});

const HOUR_FORMAT = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  hour12: true,
  timeZone: IST_TIME_ZONE,
});

/*
 * en-IN renders the meridiem as "am"/"pm" in some engines and "AM"/"PM" in
 * others, and Chrome emits a narrow no-break space before it. Both are
 * normalised so a time reads the same on every device: "9:00 am".
 *
 * `\s` rather than a class naming U+202F and U+00A0 outright: JS's \s already
 * covers both, and a literal narrow no-break space written into source is
 * invisible to whoever reads it next (and lint-flagged, correctly).
 */
function toSentenceCaseTime(formatted) {
  return formatted.replace(/\s+/g, ' ').toLowerCase();
}

function formatClock(dateValue) {
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? '' : toSentenceCaseTime(CLOCK_FORMAT.format(date));
}

function formatHourHeading(dateValue) {
  const date = new Date(dateValue);
  return Number.isNaN(date.getTime()) ? '' : toSentenceCaseTime(HOUR_FORMAT.format(date));
}

/* "Sat, 11 Sep". Sentence case, and never uppercased. */
function formatDayTabDate(dayKey) {
  const date = new Date(`${dayKey}T00:00:00`);
  return Number.isNaN(date.getTime()) ? '' : TAB_DATE_FORMAT.format(date);
}

/* A stable key for "which calendar day is this", in the viewer's own timezone. */
function toDayKey(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/*
 * The days the fest spans, from its own start and end dates rather than from
 * the events. A fest whose middle day has nothing scheduled still gets a tab —
 * a missing Day 2 reads as a loading bug, an empty Day 2 reads as a rest day.
 */
function buildFestDayKeys(fest) {
  const start = new Date(fest?.startsOn);
  const end = new Date(fest?.endsOn ?? fest?.startsOn);
  if (Number.isNaN(start.getTime())) {
    return [];
  }
  const dayKeys = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const lastDay = Number.isNaN(end.getTime())
    ? cursor
    : new Date(end.getFullYear(), end.getMonth(), end.getDate());
  // Bounded so a bad endsOn (or one before startsOn) cannot spin forever.
  while (cursor <= lastDay && dayKeys.length < 60) {
    dayKeys.push(toDayKey(cursor));
    cursor.setTime(cursor.getTime() + MILLISECONDS_PER_DAY);
  }
  return dayKeys;
}

function resolveEventStatus(event, nowMs) {
  const startMs = new Date(event.startsAt).getTime();
  const endMs = event.endsAt ? new Date(event.endsAt).getTime() : startMs;
  if (Number.isNaN(startMs)) {
    return 'upcoming';
  }
  if (startMs <= nowMs && nowMs <= endMs) {
    return 'live';
  }
  return nowMs > endMs ? 'ended' : 'upcoming';
}

function LiveBadge() {
  return (
    <span className="dsk-live">
      {/* A CSS pulse over a static dot — never a JS timer for a decoration. */}
      <span className="dsk-live__dot" aria-hidden="true" />
      {SCHEDULE_COPY.statusLive}
    </span>
  );
}

function CapacityBar({ event }) {
  const capacityState = computeCapacityState(event);
  if (capacityState.isUnlimited) {
    return null;
  }
  return (
    <div className="dsk-capacity">
      <div className="dsk-capacity__track">
        <div className="dsk-capacity__fill" style={{ width: `${capacityState.percent}%` }} />
      </div>
      <p
        className={
          capacityState.isFillingFast
            ? 'dsk-capacity__label dsk-capacity__label--urgent'
            : 'dsk-capacity__label'
        }
      >
        {capacityState.isFillingFast
          ? SCHEDULE_COPY.fillingFast
          : `${capacityState.percent}${SCHEDULE_COPY.bookedSuffix}`}
      </p>
    </div>
  );
}

/*
 * The venue line. Rendered here rather than through the shared VenueLink,
 * which is still on the Heritage palette and draws a Material Symbols ligature
 * for its pin. The rule it encodes is kept exactly: an event with no venue text
 * is PLAIN TEXT, never an anchor pointing at an empty Maps search.
 */
function VenueRow({ venue }) {
  const mapsUrl = buildMapsUrl(venue);
  return (
    <span className="dsk-event__meta">
      <VenueIcon size="sm" />
      {mapsUrl ? (
        <a
          className="dsk-event__maps"
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          /* Stops the link triggering the card button it sits inside. */
          onClick={(clickEvent) => clickEvent.stopPropagation()}
        >
          {venue}
        </a>
      ) : (
        <span className="dsk-event__venue">{venue || SCHEDULE_COPY.noVenue}</span>
      )}
    </span>
  );
}

const STATUS_MODIFIERS = {
  live: 'dsk-event dsk-event--live',
  upcoming: 'dsk-event dsk-event--upcoming',
  ended: 'dsk-event dsk-event--ended',
};

function EventCard({ event, status, onOpen }) {
  const posterUrl = event.posterImageUrl || event.bannerImageUrl || null;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={STATUS_MODIFIERS[status] ?? STATUS_MODIFIERS.upcoming}
      >
        {posterUrl ? (
          <img className="dsk-event__poster" src={posterUrl} alt="" loading="lazy" />
        ) : null}
        <span className="dsk-event__body">
          <span className="dsk-event__top">
            <span className="dsk-event__name">{event.eventName}</span>
            {status === 'live' ? (
              <LiveBadge />
            ) : (
              <span className="dsk-event__time">{formatClock(event.startsAt)}</span>
            )}
          </span>
          <VenueRow venue={event.venue} />
          {event.category ? <span className="dsk-event__category">{event.category}</span> : null}
          <CapacityBar event={event} />
        </span>
      </button>
    </li>
  );
}

/* The skeleton IS the hour grid: three blocks, each a label bar and two cards.
   Static — see the stylesheet. */
function ScheduleSkeleton() {
  return (
    <ul className="dsk-hours" aria-hidden="true">
      {[0, 1, 2].map((blockIndex) => (
        <li key={blockIndex} className="dsk-hour">
          <div className="dsk-skeleton__label" />
          <div className="dsk-hour__list">
            <div className="dsk-skeleton__card" />
            <div className="dsk-skeleton__card" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EventScheduleScreen() {
  const { festId } = useParams();
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();
  const tabRefs = useRef([]);

  const [fest, setFest] = useState(null);
  const [events, setEvents] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [selectedDayKey, setSelectedDayKey] = useState(null);
  // Stamped in the loader, never during render — see the file header.
  const [nowMs, setNowMs] = useState(0);

  const loadSchedule = useCallback(async () => {
    setLoadState('loading');
    try {
      const [festDetail, festEvents] = await Promise.all([
        apiClient.get(`/public/fests/${festId}`),
        apiClient.get(`/public/fests/${festId}/events?includeChildren=true`),
      ]);
      const loadedEvents = Array.isArray(festEvents) ? festEvents : [];
      setFest(festDetail);
      setEvents(loadedEvents);
      setNowMs(Date.now());
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSchedule();
  }, [loadSchedule]);

  // Verticals own sub-events; only the leaves have a real time and place.
  const scheduledEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          event.startsAt && !events.some((candidate) => candidate.parentEventId === event.id),
      ),
    [events],
  );

  const dayKeys = useMemo(() => {
    const festDays = buildFestDayKeys(fest);
    /*
     * An event scheduled outside the fest's own declared window still needs a
     * tab to live under, or it would silently vanish from the schedule.
     */
    const strayDays = scheduledEvents
      .map((event) => toDayKey(event.startsAt))
      .filter((dayKey) => dayKey && !festDays.includes(dayKey));
    return [...new Set([...festDays, ...strayDays])].sort();
  }, [fest, scheduledEvents]);

  /*
   * Today if the fest is running, otherwise the first day. Held in an effect
   * rather than derived so a participant's tab choice survives re-renders.
   */
  useEffect(() => {
    if (dayKeys.length === 0 || selectedDayKey) {
      return;
    }
    const todayKey = toDayKey(nowMs || Date.now());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedDayKey(dayKeys.includes(todayKey) ? todayKey : dayKeys[0]);
  }, [dayKeys, selectedDayKey, nowMs]);

  /*
   * The selected day's events, grouped by the hour they start in. Inside each
   * hour, LIVE sorts to the top — someone opening this screen mid-fest is
   * looking for what is on right now, not for what started at 10:00 sharp.
   *
   * This grouping used to exist only to order a flat list. It is now also the
   * layout: one block per hour, blocks in a grid.
   */
  const hourGroups = useMemo(() => {
    const dayEvents = scheduledEvents.filter(
      (event) => toDayKey(event.startsAt) === selectedDayKey,
    );
    const byHour = new Map();
    for (const event of dayEvents) {
      const hour = new Date(event.startsAt).getHours();
      if (!byHour.has(hour)) {
        byHour.set(hour, []);
      }
      byHour.get(hour).push(event);
    }
    return [...byHour.entries()]
      .sort(([firstHour], [secondHour]) => firstHour - secondHour)
      .map(([hour, hourEvents]) => ({
        hour,
        events: hourEvents.sort((first, second) => {
          const firstStatus = resolveEventStatus(first, nowMs);
          const secondStatus = resolveEventStatus(second, nowMs);
          if (firstStatus === 'live' && secondStatus !== 'live') {
            return -1;
          }
          if (secondStatus === 'live' && firstStatus !== 'live') {
            return 1;
          }
          return new Date(first.startsAt) - new Date(second.startsAt);
        }),
      }));
  }, [scheduledEvents, selectedDayKey, nowMs]);

  const dayEvents = useMemo(() => hourGroups.flatMap((group) => group.events), [hourGroups]);
  const selectedDayEventCount = dayEvents.length;
  const liveCount = dayEvents.filter((event) => resolveEventStatus(event, nowMs) === 'live').length;
  const upcomingCount = dayEvents.filter(
    (event) => resolveEventStatus(event, nowMs) === 'upcoming',
  ).length;

  /*
   * Arrow-key navigation across the tablist, per the WAI-ARIA tabs pattern:
   * Left/Right move and wrap, Home/End jump to the ends, and focus follows the
   * selection so the panel below matches what was just announced.
   */
  function handleTabKeyDown(keyEvent, index) {
    const lastIndex = dayKeys.length - 1;
    let nextIndex = null;
    if (keyEvent.key === 'ArrowRight') {
      nextIndex = index === lastIndex ? 0 : index + 1;
    } else if (keyEvent.key === 'ArrowLeft') {
      nextIndex = index === 0 ? lastIndex : index - 1;
    } else if (keyEvent.key === 'Home') {
      nextIndex = 0;
    } else if (keyEvent.key === 'End') {
      nextIndex = lastIndex;
    }
    if (nextIndex === null) {
      return;
    }
    keyEvent.preventDefault();
    setSelectedDayKey(dayKeys[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  }

  function openEvent(event) {
    navigate(`/events/${event.eventSlug}`, { state: { festSlug: fest?.festSlug } });
  }

  const hasSchedule = loadState === 'ready' && scheduledEvents.length > 0;

  return (
    <div className="dsk-screen">
      {/*
       * The bar IS the heading. Passing a title registers the screen with
       * screen-title-context, which stands the app header down, so this page
       * carries one bar rather than two — and therefore no top padding
       * anywhere below.
       */}
      <ScreenHeader title={SCHEDULE_COPY.title} />

      {hasSchedule && dayKeys.length > 0 ? (
        <div className="dsk-daybar">
          <div className="dsk-daybar__inner">
            {/* Whose schedule. A caption, not a second heading. */}
            {fest?.festName ? <p className="dsk-fest">{fest.festName}</p> : null}

            <div role="tablist" aria-label={SCHEDULE_COPY.dayTabsLabel} className="dsk-tabs">
              {dayKeys.map((dayKey, index) => {
                const isSelected = dayKey === selectedDayKey;
                return (
                  <button
                    key={dayKey}
                    ref={(element) => {
                      tabRefs.current[index] = element;
                    }}
                    type="button"
                    role="tab"
                    id={`schedule-tab-${dayKey}`}
                    aria-selected={isSelected}
                    aria-controls={`schedule-panel-${dayKey}`}
                    aria-label={`${SCHEDULE_COPY.dayTabPrefix} ${index + 1}, ${formatDayTabDate(dayKey)}`}
                    // Roving tabindex: one stop for the whole tablist, then arrows.
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => setSelectedDayKey(dayKey)}
                    onKeyDown={(keyEvent) => handleTabKeyDown(keyEvent, index)}
                    className="dsk-tab"
                  >
                    <span className="dsk-tab__ordinal">
                      {SCHEDULE_COPY.dayTabPrefix} {index + 1}
                    </span>
                    <span className="dsk-tab__date">{formatDayTabDate(dayKey)}</span>
                  </button>
                );
              })}
            </div>

            {/*
             * The tally, as a sentence. The live count is the only part in
             * --primary, and it is omitted entirely when it is zero rather than
             * rendered as "0 live now" — a red zero is a mark that draws the
             * eye to nothing.
             */}
            {selectedDayKey ? (
              <p className="dsk-tally">
                {selectedDayEventCount} {SCHEDULE_COPY.statTotal}
                {liveCount > 0 ? (
                  <>
                    {', '}
                    <span className="dsk-tally__live">
                      {liveCount} {SCHEDULE_COPY.statLive}
                    </span>
                  </>
                ) : null}
                {upcomingCount > 0 ? `, ${upcomingCount} ${SCHEDULE_COPY.statUpcoming}` : null}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="dsk-col">
        {loadState === 'loading' ? (
          <div className="dsk-panel">
            <ScheduleSkeleton />
          </div>
        ) : null}

        {/* Offline gets its own words: retrying will not help until the
            connection is back, so saying "try again" alone would be a lie. */}
        {loadState === 'error' ? (
          <div className="dsk-error">
            <p className="dsk-error__line">
              {isOnline ? SCHEDULE_COPY.errorMessage : CONNECTION_COPY.offlineMessage}
            </p>
            <button type="button" onClick={loadSchedule} className="dsk-error__retry">
              {isOnline ? <RetryIcon size="sm" /> : <OfflineIcon size="sm" />}
              {CONNECTION_COPY.errorRetry}
            </button>
          </div>
        ) : null}

        {loadState === 'ready' && scheduledEvents.length === 0 ? (
          <EmptyState line="This fest has not published its schedule yet." />
        ) : null}

        {hasSchedule && selectedDayKey ? (
          <main
            role="tabpanel"
            id={`schedule-panel-${selectedDayKey}`}
            aria-labelledby={`schedule-tab-${selectedDayKey}`}
            // Named with the day AND its count, so selecting a tab announces how
            // much is on rather than just which day was chosen.
            aria-label={SCHEDULE_COPY.dayPanelLabel(
              formatDayTabDate(selectedDayKey),
              selectedDayEventCount,
            )}
            tabIndex={-1}
            className="dsk-panel"
          >
            {dayEvents.length === 0 ? (
              <EmptyState className="dsk-empty-day" line={SCHEDULE_COPY.emptyDaySubtext} />
            ) : (
              <ul className="dsk-hours">
                {hourGroups.map((group) => (
                  <li key={group.hour} className="dsk-hour">
                    <h2 className="dsk-hour__label">
                      <ClockIcon size="sm" />
                      {formatHourHeading(group.events[0].startsAt)}
                    </h2>
                    <ul className="dsk-hour__list">
                      {group.events.map((event) => (
                        <EventCard
                          key={event.id}
                          event={event}
                          status={resolveEventStatus(event, nowMs)}
                          onOpen={() => openEvent(event)}
                        />
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </main>
        ) : null}
      </div>
    </div>
  );
}

export default EventScheduleScreen;

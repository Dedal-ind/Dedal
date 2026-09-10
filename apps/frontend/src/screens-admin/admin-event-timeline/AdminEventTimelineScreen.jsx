// AdminEventTimelineScreen.jsx
// Route: /admin/events/timeline — a LIVE progress board for a fest's schedule.
//
// WHAT CHANGED AND WHY. This screen used to be one shared SVG time axis with a
// row per VENUE, so six events booked into the same room at the same hour were
// drawn as six overlapping rectangles on one line and read as a single smear.
// The whole point of opening the screen — "where are we right now?" — was the
// one question it could not answer.
//
// So the unit is now the EVENT, never the venue. Every event owns one bar,
// always, even when six of them share a room and an hour. Venue is a grouping
// heading above the bars, not a lane that merges them.
//
// The bar is a CLOCK, not a length. It fills left to right with the share of
// its scheduled time that has already passed, and the fill is a slice of one
// red → amber → green ramp: a bar that has not started shows nothing, a bar
// mid-way shows red through amber, a finished bar shows the whole ramp ending
// green. Colour and length carry the same fact, so the state of a hall is
// legible from across a room and at a glance.
//
// READ-ONLY, DELIBERATELY. No drag-to-reschedule. Moving an event has real
// consequences — registration windows, shifts, checkpoints, notifications — and
// a drag gesture is a very easy way to trigger all of them by accident. The
// admin reads the state here and changes the schedule on the event edit screen,
// where the change is explicit and validated.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapPin, TriangleAlert } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminHierarchyFilter from '../../components-admin/admin-hierarchy-filter/AdminHierarchyFilter.jsx';
import { useAdminHierarchyScope } from '../../hooks/useAdminHierarchyScope.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import { ADMIN_EVENT_TIMELINE_COPY as COPY } from '../../brand-admin/brand-copy.js';
import { formatCategoryLabel } from '../../helpers/category-format.js';

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/*
 * The clock ticks every 30 seconds. Not every second: nothing on this board
 * moves perceptibly inside a minute (the shortest realistic event still takes
 * ~200 ticks to cross the bar), and a per-second re-render of fifty bars is a
 * cost paid for no information.
 */
const PROGRESS_TICK_MILLISECONDS = 30 * 1000;

/* A gap longer than this at one venue is worth pointing out. */
const GAP_THRESHOLD_HOURS = 2;

/*
 * The ramp every bar is a slice of. Held as explicit stops rather than Tailwind
 * classes because the fill is clipped at an arbitrary percentage — the colour at
 * the clip edge has to be a real interpolation, which only a gradient gives.
 *
 * Read left to right: not started (nothing shown) → underway (red, then amber)
 * → done (green). The stops are the console's own status colours so this board
 * agrees with every status pill in the product.
 */
const PROGRESS_RAMP =
  'linear-gradient(90deg, #DC2626 0%, #EA580C 30%, #F59E0B 55%, #84CC16 80%, #16A34A 100%)';

// Local strings for the rebuild. brand-copy.js keeps the keys the old screen
// used; these are the ones the progress board added.
const LOCAL_COPY = {
  notStarted: 'Not started',
  inProgress: 'Underway',
  completed: 'Completed',
  startLabel: 'Starts',
  endLabel: 'Ends',
  nowLabel: 'now',
  singleEventNote: (eventName) => `Showing ${eventName} only. Clear the event filter to see the whole fest.`,
  legend: 'Each bar fills with the share of its own scheduled time that has passed.',
  liveNote: 'Updates every 30 seconds.',
};

function toTimestamp(value) {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function formatClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDayLabel(timestamp) {
  return new Date(timestamp).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/*
 * How far through its own scheduled window an event is, as a percentage.
 *
 * Clamped at both ends on purpose: before the start there is no progress to
 * report (0), after the end the event is done and stays done (100). A zero- or
 * negative-length window would divide by zero, so it resolves to whichever end
 * the clock is on rather than NaN.
 */
function computeProgressPercent(startMs, endMs, nowMs) {
  if (nowMs <= startMs) {
    return 0;
  }
  if (nowMs >= endMs) {
    return 100;
  }
  const span = endMs - startMs;
  if (span <= 0) {
    return 100;
  }
  return Math.min(100, Math.max(0, ((nowMs - startMs) / span) * 100));
}

function resolveProgressState(progressPercent) {
  if (progressPercent <= 0) {
    return { key: 'notStarted', label: LOCAL_COPY.notStarted };
  }
  if (progressPercent >= 100) {
    return { key: 'completed', label: LOCAL_COPY.completed };
  }
  return { key: 'inProgress', label: LOCAL_COPY.inProgress };
}

/*
 * Venue → its events, for HEADINGS only.
 *
 * This groups; it never merges. Every event keeps its own bar inside the group,
 * so six events in one room at one hour render as six bars under one heading —
 * the case the old venue-lane chart collapsed into an unreadable overlap.
 *
 * Events with no venue share a single "no venue" group rather than getting one
 * each: two events with no room are not in the same room, they are in no room.
 */
function groupByVenue(events) {
  const byVenue = new Map();
  for (const event of events) {
    const venueKey = (event.venue ?? '').trim() || COPY.noVenueLane;
    if (!byVenue.has(venueKey)) {
      byVenue.set(venueKey, []);
    }
    byVenue.get(venueKey).push(event);
  }
  return [...byVenue.entries()]
    .map(([venueName, venueEvents]) => ({
      venueName,
      isRealVenue: venueName !== COPY.noVenueLane,
      events: [...venueEvents].sort((first, second) => first.startMs - second.startMs),
    }))
    .sort((first, second) => first.venueName.localeCompare(second.venueName));
}

/*
 * Two events overlap when each starts before the other ends. Touching endpoints
 * (one ends exactly as the next begins) are NOT a conflict — back-to-back
 * scheduling is normal and flagging it would bury the real clashes.
 *
 * Only reported for real venues: the finding is "this room is double-booked",
 * which is meaningless for events that have no room.
 */
function findVenueConflicts(groups) {
  const conflicts = [];
  for (const group of groups) {
    if (!group.isRealVenue) {
      continue;
    }
    for (let index = 0; index < group.events.length; index += 1) {
      for (let other = index + 1; other < group.events.length; other += 1) {
        const first = group.events[index];
        const second = group.events[other];
        // Sorted by start, so once one starts after this ends, so do the rest.
        if (second.startMs >= first.endMs) {
          break;
        }
        conflicts.push({
          venueName: group.venueName,
          firstEventName: first.eventName,
          secondEventName: second.eventName,
          atLabel: formatClock(Math.max(first.startMs, second.startMs)),
        });
      }
    }
  }
  return conflicts;
}

/* Idle stretches at a real venue, measured between consecutive events. */
function findVenueGaps(groups) {
  const gaps = [];
  for (const group of groups) {
    if (!group.isRealVenue) {
      continue;
    }
    for (let index = 0; index < group.events.length - 1; index += 1) {
      const current = group.events[index];
      const next = group.events[index + 1];
      const gapHours = (next.startMs - current.endMs) / MILLISECONDS_PER_HOUR;
      if (gapHours >= GAP_THRESHOLD_HOURS) {
        gaps.push({
          venueName: group.venueName,
          gapHours: Math.round(gapHours * 10) / 10,
          fromLabel: formatClock(current.endMs),
          toLabel: formatClock(next.startMs),
        });
      }
    }
  }
  return gaps;
}

/*
 * ONE event, ONE bar. Never shared, never stacked with another event's bar.
 *
 * The times sit ABOVE the track, at the ends they belong to, so the bar is read
 * the way a clock face is: the left label is when it started, the right label is
 * when it is due to finish, and the fill between them is how much of that is
 * spent. The fill is the ramp clipped at the progress point, so its right edge
 * is the live colour — the one pixel that says how far along this is.
 */
function EventProgressBar({ event, nowMs }) {
  const progressPercent = computeProgressPercent(event.startMs, event.endMs, nowMs);
  const state = resolveProgressState(progressPercent);
  const roundedPercent = Math.round(progressPercent);
  const spansDays = formatDayLabel(event.startMs) !== formatDayLabel(event.endMs);

  return (
    <li className="flex flex-col gap-1.5 py-3">
      {/* The event's own name, above its own bar — the label the old chart could
          not fit inside a 4px-wide rectangle. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-admin-body text-[14px] font-semibold leading-5 text-admin-neutral-ink">
          {event.eventName}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span
            className={[
              'rounded-full px-2 py-0.5 font-admin-body text-[12px] font-semibold',
              state.key === 'completed'
                ? 'bg-admin-status-success-green/10 text-admin-status-success-green'
                : state.key === 'inProgress'
                  ? 'bg-admin-status-warning-amber/15 text-admin-status-warning-amber'
                  : 'bg-admin-slate-200 text-admin-slate-600',
            ].join(' ')}
          >
            {state.label}
          </span>
          <span className="font-admin-mono text-[12px] tabular-nums text-admin-slate-600">
            {roundedPercent}%
          </span>
        </span>
      </div>

      {/* Start and end, above the track, at their own ends of it. */}
      <div className="flex items-baseline justify-between font-admin-mono text-[11px] text-admin-slate-600">
        <span>
          {LOCAL_COPY.startLabel} {formatClock(event.startMs)}
          <span className="ml-1 text-admin-slate-600/70">{formatDayLabel(event.startMs)}</span>
        </span>
        <span>
          {LOCAL_COPY.endLabel} {formatClock(event.endMs)}
          {/* The day is repeated on the right only when the event crosses one —
              otherwise it is noise on every single row. */}
          {spansDays ? (
            <span className="ml-1 text-admin-slate-600/70">{formatDayLabel(event.endMs)}</span>
          ) : null}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label={`${event.eventName} — ${state.label}`}
        aria-valuenow={roundedPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-admin-slate-200"
      >
        {/*
         * The ramp is laid across the FULL track width and then clipped to the
         * progress point, rather than a progress-width box painted with its own
         * gradient. That difference is the whole effect: clipping keeps every
         * bar's colour anchored to the same scale, so 40% is the same amber on a
         * two-hour event as on a ten-minute one. A per-bar gradient would make
         * every bar end green the moment it started.
         */}
        <span
          aria-hidden="true"
          className="absolute inset-0 transition-[clip-path] duration-700 ease-out motion-reduce:transition-none"
          style={{
            backgroundImage: PROGRESS_RAMP,
            clipPath: `inset(0 ${100 - progressPercent}% 0 0)`,
          }}
        />
      </div>

      {event.category ? (
        <span className="font-admin-mono text-[11px] text-admin-slate-600">
          {formatCategoryLabel(event.category)}
        </span>
      ) : null}
    </li>
  );
}

function AdminEventTimelineScreen() {
  const { scope, handleScopeChange, activeEventId } = useAdminHierarchyScope();
  const festId = scope.festId;

  const [fests, setFests] = useState([]);
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('idle');
  const [loadError, setLoadError] = useState('');

  /*
   * The clock the whole board reads. Held in state so a tick re-renders every
   * bar; nothing else on the screen depends on it, so the tick is cheap.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = setInterval(() => setNowMs(Date.now()), PROGRESS_TICK_MILLISECONDS);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    let isActive = true;
    apiClient
      // The admin fest list is /fests/mine — a bare /fests does not exist, and
      // fetching it left the selector permanently empty.
      .get('/fests/mine')
      .then((result) => isActive && setFests(Array.isArray(result) ? result : result?.fests ?? []))
      .catch(() => isActive && setFests([]));
    return () => {
      isActive = false;
    };
  }, []);

  const loadEvents = useCallback(async () => {
    if (!festId) {
      setEvents([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    setLoadError('');
    try {
      const result = await apiClient.get(`/fests/${festId}/events/all`);
      setEvents(Array.isArray(result) ? result : result?.events ?? []);
      setStatus('ready');
    } catch (error) {
      setLoadError(error?.message || COPY.loadFailed);
      setStatus('error');
    }
  }, [festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEvents();
  }, [loadEvents]);

  /*
   * Only events that actually occupy time. A vertical (a grouping node) has no
   * slot of its own — its children do — and an event with no start cannot be
   * placed against a clock at all.
   */
  const scheduledEvents = useMemo(
    () =>
      events
        .map((event) => {
          const startMs = toTimestamp(event.startsAt);
          const endMs = toTimestamp(event.endsAt);
          if (startMs === null) {
            return null;
          }
          return {
            id: event.id,
            eventName: event.eventName,
            venue: event.venue,
            category: event.category ?? '',
            startMs,
            // A missing or inverted end is treated as a one-hour block: the bar
            // still has to be able to fill, and a zero-length window would sit
            // at 100% from the instant it began.
            endMs: endMs !== null && endMs > startMs ? endMs : startMs + MILLISECONDS_PER_HOUR,
          };
        })
        .filter(Boolean),
    [events],
  );

  /*
   * The cascade narrows the board to ONE event when one is chosen. This is the
   * behaviour the screen was missing: picking an event used to leave every other
   * event of the fest on screen beside it, so "show me this event" was not a
   * thing the timeline could do.
   *
   * A chosen EVENT keeps its sub-events (the includeDescendants meaning applied
   * to a list the screen already holds); a chosen SUB-EVENT stands alone.
   */
  const visibleEvents = useMemo(() => {
    if (scope.subEventId) {
      return scheduledEvents.filter((event) => event.id === scope.subEventId);
    }
    if (scope.eventId) {
      const childIds = new Set(
        events
          .filter((event) => String(event.parentEventId?.id ?? event.parentEventId ?? '') === scope.eventId)
          .map((event) => event.id),
      );
      return scheduledEvents.filter((event) => event.id === scope.eventId || childIds.has(event.id));
    }
    return scheduledEvents;
  }, [scheduledEvents, events, scope.eventId, scope.subEventId]);

  const venueGroups = useMemo(() => groupByVenue(visibleEvents), [visibleEvents]);
  // Findings are about the WHOLE fest's schedule, so they are computed on every
  // scheduled event — narrowing to one event would hide the clash it is in.
  const allVenueGroups = useMemo(() => groupByVenue(scheduledEvents), [scheduledEvents]);
  const conflicts = useMemo(() => findVenueConflicts(allVenueGroups), [allVenueGroups]);
  const gaps = useMemo(() => findVenueGaps(allVenueGroups), [allVenueGroups]);

  const selectedEventName =
    activeEventId && visibleEvents.length > 0
      ? (visibleEvents.find((event) => event.id === activeEventId)?.eventName ?? null)
      : null;

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-6">
      <div>
        <p className="mt-1 font-admin-body text-[14px] leading-5 text-admin-slate-600">
          {LOCAL_COPY.legend} {LOCAL_COPY.liveNote}
        </p>
      </div>

      <AdminHierarchyFilter
        fests={fests}
        selectedFestId={scope.festId}
        selectedEventId={scope.eventId}
        selectedSubEventId={scope.subEventId}
        onChange={handleScopeChange}
      />

      <AdminErrorBanner message={loadError} />

      {!festId ? (
        <AdminExecutiveCard>
          <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.chooseFest}</p>
        </AdminExecutiveCard>
      ) : null}

      {festId && status === 'ready' && visibleEvents.length === 0 ? (
        <AdminExecutiveCard>
          <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.noScheduled}</p>
        </AdminExecutiveCard>
      ) : null}

      {festId && status === 'ready' && visibleEvents.length > 0 ? (
        <>
          {/* Findings ABOVE the board: they are the reason to open this screen,
              and a warning below the fold is a warning nobody reads. */}
          {conflicts.length > 0 ? (
            <AdminExecutiveCard>
              <h2 className="flex items-center gap-2 font-admin-body text-[14px] font-semibold text-admin-status-error-red">
                <TriangleAlert size={15} />
                {COPY.conflictsHeading(conflicts.length)}
              </h2>
              <ul className="mt-2 flex flex-col gap-1">
                {conflicts.map((conflict, index) => (
                  <li
                    key={`${conflict.venueName}-${index}`}
                    className="font-admin-body text-[13px] text-admin-neutral-ink"
                  >
                    {COPY.conflictLine(
                      conflict.venueName,
                      conflict.firstEventName,
                      conflict.secondEventName,
                      conflict.atLabel,
                    )}
                  </li>
                ))}
              </ul>
            </AdminExecutiveCard>
          ) : null}

          {gaps.length > 0 ? (
            <AdminExecutiveCard>
              <h2 className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">
                {COPY.gapsHeading(gaps.length)}
              </h2>
              <ul className="mt-2 flex flex-col gap-1">
                {gaps.map((gap, index) => (
                  <li
                    key={`${gap.venueName}-${index}`}
                    className="font-admin-body text-[13px] text-admin-slate-600"
                  >
                    {COPY.gapLine(gap.gapHours, gap.venueName, gap.fromLabel, gap.toLabel)}
                  </li>
                ))}
              </ul>
            </AdminExecutiveCard>
          ) : null}

          {selectedEventName ? (
            <p className="font-admin-body text-[13px] text-admin-slate-600">
              {LOCAL_COPY.singleEventNote(selectedEventName)}
            </p>
          ) : null}

          {venueGroups.map((group) => (
            <AdminExecutiveCard key={group.venueName} bodyClassName="p-0">
              <div className="flex items-center justify-between gap-3 border-b border-admin-slate-200 px-5 py-3">
                <span className="flex min-w-0 items-center gap-2">
                  <MapPin size={15} className="shrink-0 text-admin-slate-600" />
                  <span className="truncate font-admin-body text-[14px] font-semibold text-admin-neutral-ink">
                    {group.venueName}
                  </span>
                </span>
                <span className="shrink-0 font-admin-mono text-[12px] text-admin-slate-600">
                  {group.events.length} {group.events.length === 1 ? 'event' : 'events'}
                </span>
              </div>
              {/* One <li> per event. Six events in this room at this hour make
                  six rows here — they are never combined into one bar. */}
              <ul className="divide-y divide-admin-slate-200 px-5">
                {group.events.map((event) => (
                  <EventProgressBar key={event.id} event={event} nowMs={nowMs} />
                ))}
              </ul>
            </AdminExecutiveCard>
          ))}

          <p className="font-admin-body text-[12px] italic text-admin-slate-600">
            {COPY.readOnlyNote}
          </p>
        </>
      ) : null}
    </div>
  );
}

export default AdminEventTimelineScreen;

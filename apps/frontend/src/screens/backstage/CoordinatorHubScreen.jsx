// CoordinatorHubScreen.jsx
// Route: /backstage/coordinator-hub — the coordinator's own assignments.
//
// WHAT THIS SCREEN IS FOR: a coordinator arriving at a fest with two or three
// grants, deciding which one to open. That is a LIST, and the retired version
// made it a wall of 180px olive gradient posters with a glass overlay and a
// glowing red LIVE badge — decoration on a chooser, and it pushed the third
// assignment off a phone screen entirely.
//
// It is now a table: one 44px row per assignment, the scope on the left, the
// shift window and the live word on the right. Live rows sort to the top, as
// before.
//
// ON THE DEDAL DESIGN SYSTEM (`dop-`). The two fetches, the administrator /
// platform-admin inclusion rule, the shift-window arithmetic, the 30-second
// clock tick and the fest-wide fallback to /backstage are unchanged and moved
// verbatim.
//
// STATE WORDS. "Live now" in --primary with a dot, for an assignment whose
// shift covers this instant. Everything else says nothing at all rather than
// "Not live" — an absent badge on a list where one row is red is unambiguous,
// and a column of "Not live" is noise on the rows that need no attention.
//
// COPY. BACKSTAGE_COPY.festWide is also read by BackstageScreen and
// VolunteerHubScreen, which another migration owns, so the fest-wide label is
// overridden LOCALLY here rather than changed at source.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import apiClient from '../../api-client/api-client.js';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { formatCategoryLabel } from '../../helpers/category-format.js';

const STAFF_ROLES = {
  COORDINATOR: 'coordinator',
  ADMINISTRATOR: 'administrator',
  PLATFORM_ADMIN: 'platformAdmin',
};

/* Sentence case, IST. Not formatClockTime, which is the padded uppercase one. */
const IST_CLOCK = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function clock(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? '' : IST_CLOCK.format(date).toLowerCase();
}

/* Overridden locally; the shared key is consumed by screens another migration
   owns. "Fest-wide" is what the grant actually is: every event in the fest. */
const FEST_WIDE_LABEL = 'Every event in this fest';

function CoordinatorHubScreen() {
  const navigate = useTransitionNavigate();
  const [assignments, setAssignments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadData = useCallback(async () => {
    setLoadState('loading');
    try {
      const [assignmentList, shiftPayload] = await Promise.all([
        apiClient.get('/staff-assignments/mine'),
        apiClient.get('/shifts/mine').catch(() => ({ shifts: [] })),
      ]);
      /*
       * An administrator's fest-wide grant covers coordination too, so their
       * row belongs in this list — filtering to `coordinator` alone would show
       * an admin an empty hub for a fest they own.
       */
      setAssignments(
        (Array.isArray(assignmentList) ? assignmentList : []).filter(
          (a) =>
            a.role === STAFF_ROLES.COORDINATOR ||
            a.role === STAFF_ROLES.ADMINISTRATOR ||
            a.role === STAFF_ROLES.PLATFORM_ADMIN,
        ),
      );
      setShifts(Array.isArray(shiftPayload?.shifts) ? shiftPayload.shifts : []);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  // Refresh "now" every 30 seconds so live status updates automatically.
  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Build flat rows from assignments. Each assignment becomes one row showing
  // the event names it covers (or "every event in this fest"), the fest it
  // belongs to, whether it has an active shift right now, and the shift times.
  const cards = useMemo(() => {
    return assignments.map((assignment) => {
      const fest = assignment.festId;
      const festId = fest?.id ?? '';
      const eventNames = (assignment.eventIds ?? []).map((e) => e.eventName).filter(Boolean);
      const scopeLabel =
        eventNames.length > 0 ? eventNames.join(', ') : (fest?.festName ?? FEST_WIDE_LABEL);
      const category = (assignment.eventIds ?? []).find((e) => e.category)?.category ?? null;

      // Find shifts for this fest.
      const assignmentShifts = shifts.filter(
        (shift) => (shift.festId?.id ?? shift.festId) === festId && shift.status !== 'cancelled',
      );

      // Is any shift active right now?
      const activeShift = assignmentShifts.find((shift) => {
        const start = shift.startsAt ? new Date(shift.startsAt).getTime() : null;
        const end = shift.endsAt ? new Date(shift.endsAt).getTime() : null;
        return start !== null && end !== null && nowMs >= start && nowMs <= end;
      });

      // Next upcoming shift (for timing display).
      const nextShift = assignmentShifts
        .filter((shift) => shift.startsAt && new Date(shift.startsAt).getTime() >= nowMs)
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0];

      const displayShift = activeShift ?? nextShift ?? assignmentShifts[0] ?? null;
      const timeLabel = displayShift
        ? `${clock(displayShift.startsAt)} to ${clock(displayShift.endsAt)}`
        : null;

      /*
       * The event page is event-scoped, so the row must carry a real event id.
       * An assignment covering several events still has one primary event to
       * open; a fest-wide grant has none and falls back to the panel.
       */
      const primaryEventId = (assignment.eventIds ?? [])[0]?.id ?? null;

      return {
        id: assignment.id,
        eventId: primaryEventId,
        festId,
        scopeLabel,
        category,
        timeLabel,
        isLive: !!activeShift,
        festName: fest?.festName ?? '',
        festSlug: fest?.festSlug ?? '',
        eventSlug: (assignment.eventIds ?? [])[0]?.eventSlug ?? null,
      };
    });
  }, [assignments, shifts, nowMs]);

  // Live assignments first, then the rest.
  const sortedCards = useMemo(
    () => [...cards].sort((a, b) => (b.isLive ? 1 : 0) - (a.isLive ? 1 : 0)),
    [cards],
  );

  const totalAssigned = assignments.length;
  const liveCount = cards.filter((c) => c.isLive).length;

  return (
    <div className="dop-screen">
      <ScreenHeader title="My assignments" />

      <div className="dop-page">
        {loadState === 'loading' ? (
          <>
            <div className="dop-stats">
              <span className="dop-sk dop-sk--block" />
              <span className="dop-sk dop-sk--block" />
            </div>
            <div className="dop-skstack">
              <span className="dop-sk dop-sk--row" />
              <span className="dop-sk dop-sk--row" />
              <span className="dop-sk dop-sk--row" />
            </div>
          </>
        ) : null}

        {loadState === 'error' ? (
          <div className="dop-retry">
            <p className="dop-retry__text">Could not load my assignments.</p>
            <button type="button" className="dop-btn" onClick={loadData}>
              Try again
            </button>
          </div>
        ) : null}

        {loadState === 'ready' ? (
          <>
            <div className="dop-stats">
              <div className="dop-stat">
                <span className="dop-stat__value">{totalAssigned}</span>
                <span className="dop-stat__label">Assignments</span>
              </div>
              <div className="dop-stat">
                <span className="dop-stat__value">{liveCount}</span>
                <span className="dop-stat__label">Live now</span>
              </div>
            </div>

            {sortedCards.length === 0 ? (
              <EmptyState line="No coordinator assignments yet." />
            ) : (
              <div className="dop-table">
                {sortedCards.map((card) => (
                  <button
                    type="button"
                    key={card.id}
                    className="dop-row dop-row--button"
                    onClick={() =>
                      navigate(
                        card.eventId
                          ? `/backstage/coordinator-event?eventId=${card.eventId}&festId=${card.festId}`
                          : '/backstage',
                      )
                    }
                  >
                    <span className="dop-row__main">
                      <span className="dop-row__name">{card.scopeLabel}</span>
                      <span className="dop-row__meta">
                        {[
                          card.festName,
                          card.category
                            ? (formatCategoryLabel(card.category) ?? card.category)
                            : null,
                          card.timeLabel,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="dop-row__end">
                      {card.isLive ? (
                        <span className="dop-state dop-state--live">
                          <span className="dop-state__dot" aria-hidden="true" />
                          Live now
                        </span>
                      ) : null}
                      <ChevronRight size={16} aria-hidden="true" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default CoordinatorHubScreen;

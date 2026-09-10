// VolunteerHubScreen.jsx
// Route: /backstage/volunteer-hub — the volunteer's assignments, on the dedal
// design system.
//
// DATA IS UNCHANGED: GET /staff-assignments/mine, GET /shifts/mine (tolerated
// failure) and GET /backstage/volunteer/summary (tolerated failure) in one
// Promise.all, the same role filter (volunteer, administrator, platformAdmin),
// the same 30-second clock, the same card derivation, the same checkpoint
// pairing (event-name match, then the fest-wide gate), the same live-first sort
// and the same client-built CSV with the same columns and the same filename.
//
// ONE REAL FIX, and it was a crash. `handleDownloadShifts` was declared ABOVE
// `cards` with `[cards, shifts, isDownloading]` as its dependency array. A
// dependency array is evaluated during render, `cards` is a `const` declared
// later in the same scope, so every render of this screen threw
// "Cannot access 'cards' before initialization" and the route rendered nothing.
// The callback now sits after the memo it depends on. Nothing else about it
// moved.
//
// THE CARDS. They were 180px olive gradient posters with a blur layer, a
// black-to-transparent scrim and a red LIVE badge whose text pulsed. None of
// that survived: a volunteer is looking for which post is theirs and when, so
// the card is now the assignment name, the fest, the shift window in words, and
// a status chip that SAYS "On now" or "Scheduled" rather than glowing. They sit
// in an intrinsic grid, so a laptop fills the row instead of stacking one
// column of wide ribbons.

import { useCallback, useEffect, useMemo, useState } from 'react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import apiClient from '../../api-client/api-client.js';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { formatCategoryLabel } from '../../helpers/category-format.js';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { CheckIcon, DownloadIcon } from '../../components/detail-icons/DetailIcons.jsx';
import '../../design/backstage.css';

const STAFF_ROLES = {
  VOLUNTEER: 'volunteer',
  ADMINISTRATOR: 'administrator',
  PLATFORM_ADMIN: 'platformAdmin',
};

/*
 * Local copy. BACKSTAGE_COPY is shared with CoordinatorHubScreen (not part of
 * this change) and its strings are stamped uppercase, so the sentence-case
 * versions live here rather than being changed underneath that screen. The one
 * key still read from the shared block is `festWide`, and it is read through a
 * local sentence-case constant for the same reason.
 */
const COPY = {
  title: 'Volunteer',
  festWide: 'Fest wide',
  assignmentsTitle: 'My assignments',
  onNow: 'On now',
  scheduled: 'Scheduled',
  noShift: 'No shift scheduled yet',
  totalLabel: 'assignments',
  liveLabel: 'shifts on now',
  empty: 'You have no volunteer assignments yet. Your fest admin adds them.',
  errorMessage: 'Could not load your assignments.',
  retry: 'Try again',
  downloadLabel: 'Download my shifts as a CSV file',
  offline: 'You are offline, so this is the last version loaded. It will refresh when you are back on a network.',
};

/* IST, sentence case, local. Not formatShortDate — that is the retired
   stamped-uppercase helper. */
const CLOCK = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function formatClock(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : CLOCK.format(date);
}

function VolunteerHubScreen() {
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();
  const [assignments, setAssignments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [scope, setScope] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);

  const loadData = useCallback(async () => {
    setLoadState('loading');
    try {
      /*
       * The scope list is what the event screen actually keys off: a volunteer
       * card must carry a real checkpointId, not an assignment id, or every
       * card opens the same (first) checkpoint.
       */
      const [assignmentList, shiftPayload, summary] = await Promise.all([
        apiClient.get('/staff-assignments/mine'),
        apiClient.get('/shifts/mine').catch(() => ({ shifts: [] })),
        apiClient.get('/backstage/volunteer/summary').catch(() => ({ scope: [] })),
      ]);
      setScope(Array.isArray(summary?.scope) ? summary.scope : []);
      setAssignments(
        (Array.isArray(assignmentList) ? assignmentList : []).filter(
          (a) =>
            a.role === STAFF_ROLES.VOLUNTEER ||
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

  // Build flat cards from assignments. Each assignment becomes one card showing
  // the event names it covers (or the fest), whether it has an active shift
  // right now, and the next/current shift times.
  const cards = useMemo(() => {
    return assignments.map((assignment) => {
      const fest = assignment.festId;
      const festId = fest?.id ?? '';
      const eventNames = (assignment.eventIds ?? []).map((e) => e.eventName).filter(Boolean);
      const scopeLabel =
        eventNames.length > 0 ? eventNames.join(' · ') : (fest?.festName ?? COPY.festWide);
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
        ? `${formatClock(displayShift.startsAt)} to ${formatClock(displayShift.endsAt)}`
        : null;

      /*
       * Pair the assignment with the checkpoint the volunteer would actually
       * scan at: prefer an event-name match, fall back to the fest-wide gate.
       */
      const matchingCheckpoint =
        scope.find((cp) => cp.eventName && eventNames.includes(cp.eventName)) ??
        scope.find((cp) => cp.festName === fest?.festName && !cp.eventName) ??
        null;

      return {
        id: assignment.id,
        checkpointId: matchingCheckpoint?.checkpointId ?? null,
        scopeLabel,
        category,
        timeLabel,
        isLive: !!activeShift,
        festName: fest?.festName ?? '',
        festSlug: fest?.festSlug ?? '',
        eventSlug: (assignment.eventIds ?? [])[0]?.eventSlug ?? null,
      };
    });
  }, [assignments, shifts, scope, nowMs]);

  /*
   * Download shifts as CSV. Debounced via the isDownloading flag — rapid taps
   * are ignored while a download is in flight, and the control shows a tick for
   * 1.5s afterwards. DECLARED AFTER `cards` on purpose; see the file header.
   */
  const handleDownloadShifts = useCallback(async () => {
    if (isDownloading) return; // debounce
    setIsDownloading(true);
    setDownloadDone(false);
    try {
      // Build a simple CSV from the loaded data — no extra API call needed.
      const header = 'Event,Checkpoint,Shift Start,Shift End,Status';
      const rows = cards.map((card) => {
        const shift = shifts.find((s) => s.checkpointId === card.checkpointId);
        return [
          card.eventName?.replace(/,/g, ' ') ?? '',
          card.scopeLabel?.replace(/,/g, ' ') ?? '',
          shift?.startsAt ? new Date(shift.startsAt).toLocaleString() : '',
          shift?.endsAt ? new Date(shift.endsAt).toLocaleString() : '',
          card.isLive ? 'LIVE' : 'Scheduled',
        ].join(',');
      });
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `dedal-volunteer-shifts-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setDownloadDone(true);
      setTimeout(() => setDownloadDone(false), 1500);
    } catch {
      // silent — the button returns to its download state
    } finally {
      setIsDownloading(false);
    }
  }, [cards, shifts, isDownloading]);

  // Live events first, then the rest.
  const sortedCards = useMemo(
    () => [...cards].sort((a, b) => (b.isLive ? 1 : 0) - (a.isLive ? 1 : 0)),
    [cards],
  );

  const totalAssigned = assignments.length;
  const liveCount = cards.filter((c) => c.isLive).length;

  return (
    <div className="dbk-screen">
      <ScreenHeader
        title={COPY.title}
        action={
          <button
            type="button"
            className="dbk-iconbtn"
            onClick={handleDownloadShifts}
            disabled={isDownloading}
            aria-label={COPY.downloadLabel}
          >
            {/* A tick for a moment after the file is written: the one piece of
                motion-free feedback that confirms the tap did something. */}
            {downloadDone ? <CheckIcon /> : <DownloadIcon />}
          </button>
        }
      />

      <div className="dbk-col">
        {!isOnline ? <p className="dbk-offline">{COPY.offline}</p> : null}

        {loadState === 'loading' ? (
          <>
            <div className="dbk-stats">
              <div className="dbk-skel dbk-skel--stat" />
              <div className="dbk-skel dbk-skel--stat" />
            </div>
            <div className="dbk-grid">
              <div className="dbk-skel dbk-skel--card" />
              <div className="dbk-skel dbk-skel--card" />
            </div>
          </>
        ) : null}

        {loadState === 'error' ? (
          <div className="dbk-error">
            <p className="dbk-error__message">{COPY.errorMessage}</p>
            <button type="button" className="dbk-error__retry" onClick={loadData}>
              {COPY.retry}
            </button>
          </div>
        ) : null}

        {loadState === 'ready' ? (
          <>
            <div className="dbk-stats">
              <div className="dbk-stat">
                <span className="dbk-stat__value">{totalAssigned}</span>
                <span className="dbk-stat__label">{COPY.totalLabel}</span>
              </div>
              <div className="dbk-stat">
                <span
                  className={
                    liveCount > 0 ? 'dbk-stat__value dbk-stat__value--now' : 'dbk-stat__value'
                  }
                >
                  {liveCount}
                </span>
                <span className="dbk-stat__label">{COPY.liveLabel}</span>
              </div>
            </div>

            {sortedCards.length === 0 ? (
              <EmptyState line={COPY.empty} />
            ) : (
              <section className="dbk-section">
                <h2 className="dbk-section__title">{COPY.assignmentsTitle}</h2>
                <div className="dbk-grid">
                  {sortedCards.map((card) => (
                    <button
                      type="button"
                      key={card.id}
                      className="dbk-card"
                      onClick={() =>
                        navigate(
                          card.checkpointId
                            ? `/backstage/volunteer-event?checkpointId=${card.checkpointId}`
                            : '/backstage/volunteer-event',
                        )
                      }
                    >
                      {/*
                       * STATUS IN WORDS. "On now" carries --primary and a dot;
                       * "Scheduled" and "No shift scheduled yet" are --muted.
                       * With the colour removed the three still read apart.
                       */}
                      <span
                        className={card.isLive ? 'dbk-status dbk-status--now' : 'dbk-status'}
                      >
                        {card.isLive ? (
                          <span className="dbk-status__dot" aria-hidden="true" />
                        ) : null}
                        {card.isLive
                          ? COPY.onNow
                          : card.timeLabel
                            ? COPY.scheduled
                            : COPY.noShift}
                      </span>
                      <span className="dbk-card__name">{card.scopeLabel}</span>
                      <span className="dbk-card__meta">
                        {card.festName ? (
                          <span className="dbk-card__meta-item">{card.festName}</span>
                        ) : null}
                        {card.category ? (
                          <span className="dbk-card__meta-item">
                            {formatCategoryLabel(card.category) ?? card.category}
                          </span>
                        ) : null}
                        {card.timeLabel ? (
                          <span className="dbk-card__meta-item">{card.timeLabel}</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default VolunteerHubScreen;

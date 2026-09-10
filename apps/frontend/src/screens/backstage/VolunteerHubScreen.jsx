// VolunteerHubScreen.jsx
// Route: /backstage/volunteer-hub — the posts this volunteer works.
//
// WHAT THIS REPLACED. One card per ASSIGNMENT, and an assignment is fest-scoped:
// its label was every event name in the grant joined with a middle dot. Measured
// on this account at 1536px — 975 characters wrapping to a 696px-tall label
// inside a 313px column, giving a single card 795px tall. Worse than the
// coordinator hub's version of the same bug, because this one wrapped instead of
// ellipsing.
//
// It is now ONE CARD PER CHECKPOINT, which is the unit a volunteer is actually
// posted to and the unit the scanner opens.
//
// THE DATA WAS ALREADY RIGHT; ONLY THE RENDERING WAS NOT.
// GET /backstage/volunteer/summary returns `scope`: one entry per checkpoint,
// each carrying checkpointName, checkpointType, festId/festName, eventName,
// eventType and the event window. That is the whole card. It was previously
// used for one thing only — finding a single checkpointId to attach to the
// merged card — and everything else on it was thrown away.
//
// THE SHIFT JOIN IS NOW ON checkpointId. It used to pair a card to a checkpoint
// by matching event NAMES between two payloads, falling back to the fest-wide
// gate. Both payloads carry checkpointId, so the join is exact and two events
// sharing a name can no longer collide.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, QrCode } from 'lucide-react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import apiClient from '../../api-client/api-client.js';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { dayChip, isToday, whenLabel } from '../../helpers/backstage-time.js';
import '../../design/backstage.css';

const COPY = {
  title: 'Volunteer',
  empty: 'No assignments yet.',
  errorMessage: 'Could not load your assignments.',
  retry: 'Try again',
  offline:
    'You are offline, so this is the last version loaded. It will refresh when you are back on a network.',
  downloadLabel: 'Download my shifts as a CSV file',
  checkpointsLabel: 'checkpoints',
  activeLabel: 'on now',
  todayLabel: 'today',
  activeNow: 'Active now',
  scheduled: 'Scheduled',
  completed: 'Completed',
  noShift: 'No shift yet',
};

/*
 * The checkpoint kinds this surface can be posted to, in words. An unknown
 * kind falls back to its own key rather than to nothing: a badge reading
 * `offerCounter` is still more use than a blank where a badge should be.
 */
const CHECKPOINT_LABELS = {
  gate: 'Gate',
  eventEntry: 'Event entry',
  offerCounter: 'Offer counter',
  mealCounter: 'Meal counter',
};

/*
 * The shift's state, from the clock and the stored status together. `completed`
 * is trusted when the server says so; otherwise an end time in the past is what
 * makes a shift finished.
 */
function shiftPhase(shift, nowMs) {
  if (!shift) return 'none';
  if (shift.status === 'completed') return 'completed';
  const start = shift.startsAt ? new Date(shift.startsAt).getTime() : null;
  const end = shift.endsAt ? new Date(shift.endsAt).getTime() : null;
  if (start !== null && end !== null && nowMs >= start && nowMs <= end) return 'active';
  if (end !== null && nowMs > end) return 'completed';
  return 'scheduled';
}

const PHASE_RANK = { active: 0, scheduled: 1, none: 2, completed: 3 };

function VolunteerHubScreen() {
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();
  const [scope, setScope] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);

  const loadData = useCallback(async () => {
    setLoadState('loading');
    try {
      const [summary, shiftPayload] = await Promise.all([
        apiClient.get('/backstage/volunteer/summary'),
        apiClient.get('/shifts/mine').catch(() => ({ shifts: [] })),
      ]);
      setScope(Array.isArray(summary?.scope) ? summary.scope : []);
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

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  /* checkpointId → the live-or-soonest shift at that post. */
  const shiftByCheckpoint = useMemo(() => {
    const map = new Map();
    for (const shift of shifts) {
      if (!shift?.checkpointId || shift.status === 'cancelled') continue;
      const existing = map.get(shift.checkpointId);
      if (!existing) {
        map.set(shift.checkpointId, shift);
        continue;
      }
      /* An active shift always wins; otherwise the one starting sooner does. */
      const existingRank = PHASE_RANK[shiftPhase(existing, nowMs)];
      const candidateRank = PHASE_RANK[shiftPhase(shift, nowMs)];
      if (
        candidateRank < existingRank ||
        (candidateRank === existingRank &&
          new Date(shift.startsAt ?? 0) < new Date(existing.startsAt ?? 0))
      ) {
        map.set(shift.checkpointId, shift);
      }
    }
    return map;
  }, [shifts, nowMs]);

  const cards = useMemo(
    () =>
      scope.map((checkpoint) => {
        const shift = shiftByCheckpoint.get(checkpoint.checkpointId) ?? null;
        return {
          checkpointId: checkpoint.checkpointId,
          festId: checkpoint.festId ?? '',
          festName: checkpoint.festName ?? '',
          /* The event is the name a volunteer is looking for; the checkpoint's
             own name repeats it ("Manthan Entry") and is used only as a
             fallback for a post that belongs to no event, like a fest gate. */
          name: checkpoint.eventName || checkpoint.checkpointName || '',
          typeLabel:
            CHECKPOINT_LABELS[checkpoint.checkpointType] ?? checkpoint.checkpointType ?? '',
          shift,
          phase: shiftPhase(shift, nowMs),
          startsAt: shift?.startsAt ?? checkpoint.eventStartsAt ?? null,
          endsAt: shift?.endsAt ?? checkpoint.eventEndsAt ?? null,
        };
      }),
    [scope, shiftByCheckpoint, nowMs],
  );

  /* Grouped by fest, active first, then upcoming by time, then completed. */
  const groups = useMemo(() => {
    const byFest = new Map();
    for (const card of cards) {
      const key = card.festId || card.festName;
      if (!byFest.has(key)) {
        byFest.set(key, { key, festName: card.festName, cards: [] });
      }
      byFest.get(key).cards.push(card);
    }
    return [...byFest.values()].map((group) => ({
      ...group,
      cards: group.cards.sort((first, second) => {
        const byPhase = PHASE_RANK[first.phase] - PHASE_RANK[second.phase];
        if (byPhase !== 0) return byPhase;
        return new Date(first.startsAt ?? 0) - new Date(second.startsAt ?? 0);
      }),
    }));
  }, [cards]);

  /*
   * DECLARED AFTER `cards`, deliberately. A previous version listed `cards` in
   * this callback's dependency array while declaring the callback above it —
   * dependency arrays are evaluated during render, so every render threw
   * "Cannot access 'cards' before initialization" and the route rendered
   * nothing.
   */
  const handleDownloadShifts = useCallback(async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    setDownloadDone(false);
    try {
      const header = 'Event,Checkpoint,Type,Shift start,Shift end,Status';
      const clean = (value) => String(value ?? '').replace(/,/g, ' ');
      const rows = cards.map((card) =>
        [
          clean(card.name),
          clean(card.shift?.checkpointName),
          clean(card.typeLabel),
          card.shift?.startsAt ? new Date(card.shift.startsAt).toLocaleString() : '',
          card.shift?.endsAt ? new Date(card.shift.endsAt).toLocaleString() : '',
          clean(card.phase),
        ].join(','),
      );
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'dedal-volunteer-shifts-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setDownloadDone(true);
      window.setTimeout(() => setDownloadDone(false), 1500);
    } catch {
      // silent — the control returns to its download state
    } finally {
      setIsDownloading(false);
    }
  }, [cards, isDownloading]);

  const totalCheckpoints = cards.length;
  const activeCount = cards.filter((card) => card.phase === 'active').length;
  const todayCount = cards.filter((card) => isToday(card.startsAt, nowMs)).length;
  const showFestHeaders = groups.length > 1;

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
            {downloadDone ? (
              <Check size={20} aria-hidden="true" />
            ) : (
              <Download size={20} aria-hidden="true" />
            )}
          </button>
        }
      />

      <div className="dbh-page">
        {!isOnline ? <p className="dbk-offline">{COPY.offline}</p> : null}

        {loadState === 'loading' ? (
          <>
            <div className="dbh-stats">
              <div className="dbh-skel dbh-skel--stat" />
              <div className="dbh-skel dbh-skel--stat" />
              <div className="dbh-skel dbh-skel--stat" />
            </div>
            <div className="dbh-list">
              <div className="dbh-skel dbh-skel--card" />
              <div className="dbh-skel dbh-skel--card" />
              <div className="dbh-skel dbh-skel--card" />
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
          totalCheckpoints === 0 ? (
            <p className="dbh-empty">{COPY.empty}</p>
          ) : (
            <>
              <div className="dbh-stats">
                <div className="dbh-stat">
                  <span className="dbh-stat__value">{totalCheckpoints}</span>
                  <span className="dbh-stat__label">{COPY.checkpointsLabel}</span>
                </div>
                <div className="dbh-stat">
                  <span
                    className={
                      activeCount > 0 ? 'dbh-stat__value dbh-stat__value--now' : 'dbh-stat__value'
                    }
                  >
                    {activeCount}
                  </span>
                  <span className="dbh-stat__label">{COPY.activeLabel}</span>
                </div>
                <div className="dbh-stat">
                  <span className="dbh-stat__value">{todayCount}</span>
                  <span className="dbh-stat__label">{COPY.todayLabel}</span>
                </div>
              </div>

              {groups.map((group) => (
                <section className="dbh-section" key={group.key}>
                  {showFestHeaders ? (
                    <h2 className="dbh-section__title">{group.festName}</h2>
                  ) : null}

                  <div className="dbh-list">
                    {group.cards.map((card) => {
                      const chip = dayChip(card.startsAt, nowMs);
                      return (
                        <div className="dbh-card" key={card.checkpointId}>
                          <button
                            type="button"
                            className="dbh-card__open"
                            onClick={() =>
                              navigate(
                                '/backstage/volunteer-event?checkpointId=' + card.checkpointId,
                              )
                            }
                          >
                            <span
                              className={
                                chip.isToday ? 'dbh-when dbh-when--today' : 'dbh-when'
                              }
                            >
                              <span className="dbh-when__day">{chip.day}</span>
                              <span className="dbh-when__month">{chip.month}</span>
                            </span>

                            <span className="dbh-card__body">
                              <span className="dbh-card__name">{card.name}</span>
                              <span className="dbh-card__time">
                                {whenLabel(card.startsAt, card.endsAt, nowMs)}
                              </span>
                              <span className="dbh-card__meta">
                                {card.phase === 'active' ? (
                                  <span className="dbh-status dbh-status--now">
                                    <span className="dbh-status__dot" aria-hidden="true" />
                                    {COPY.activeNow}
                                  </span>
                                ) : null}
                                {card.phase === 'completed' ? (
                                  <span className="dbh-status">
                                    <Check size={12} aria-hidden="true" />
                                    {COPY.completed}
                                  </span>
                                ) : null}
                                {card.phase === 'scheduled' ? (
                                  <span className="dbh-status">{COPY.scheduled}</span>
                                ) : null}
                                {card.phase === 'none' ? (
                                  <span className="dbh-status">{COPY.noShift}</span>
                                ) : null}
                                {card.typeLabel ? (
                                  <>
                                    <span className="dbh-card__sep" aria-hidden="true">
                                      {' · '}
                                    </span>
                                    {card.typeLabel}
                                  </>
                                ) : null}
                              </span>
                            </span>
                          </button>

                          {/* The scanner, one tap from the list. This is what a
                              volunteer standing at the post came to open. */}
                          <button
                            type="button"
                            className="dbh-card__qr"
                            aria-label={'Open the scanner for ' + card.name}
                            onClick={() =>
                              navigate(
                                '/backstage/scanner?checkpointId=' + card.checkpointId,
                              )
                            }
                          >
                            <QrCode size={20} aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </>
          )
        ) : null}
      </div>
    </div>
  );
}

export default VolunteerHubScreen;

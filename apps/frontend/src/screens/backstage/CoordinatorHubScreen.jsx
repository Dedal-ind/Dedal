// CoordinatorHubScreen.jsx
// Route: /backstage/coordinator-hub — the events this coordinator runs.
//
// WHAT THIS REPLACED, and why it had to go.
//
// The screen rendered ONE row per assignment, and an assignment is fest-scoped:
// its label was every event name in the grant joined with a comma. Measured on
// this account at 1536px — 913 characters in a 1258px box with an intrinsic
// width of 6250px, ellipsed after the fifth event. Sixty-two of the sixty-three
// events were also unreachable: the row's tap opened `eventIds[0]` and nothing
// else could be selected.
//
// It is now ONE CARD PER EVENT, which is the unit a coordinator opens. One
// action per card; no reading a wall of text to find the row.
//
// WHERE THE EVENT DETAIL COMES FROM. /staff-assignments/mine populates events
// with `eventName status` only — no type, no dates, no counts — so it can say
// WHICH events are granted but carries nothing worth putting on a card. The
// fest's own event list has all of it (eventType, startsAt/endsAt,
// registeredCount), and BackstageScreen already reads that same endpoint. So
// the assignment supplies the GRANT, the fest supplies the DETAIL, and the two
// are joined on event id here. No backend change was needed.
//
// A fest-wide grant (empty eventIds) means every event in the fest, so the
// intersection is skipped for it rather than yielding nothing.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { QrCode } from 'lucide-react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import apiClient from '../../api-client/api-client.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { dayChip, isToday, whenLabel } from '../../helpers/backstage-time.js';
import '../../design/backstage.css';

const STAFF_ROLES = {
  COORDINATOR: 'coordinator',
  ADMINISTRATOR: 'administrator',
  PLATFORM_ADMIN: 'platformAdmin',
};

const COPY = {
  title: 'My assignments',
  empty: 'No assignments yet.',
  errorMessage: 'Could not load your assignments.',
  retry: 'Try again',
  offline:
    'You are offline, so this is the last version loaded. It will refresh when you are back on a network.',
  eventsLabel: 'events',
  liveLabel: 'live now',
  todayLabel: 'on today',
  live: 'Live now',
  done: 'Finished',
  team: 'Team',
  solo: 'Solo',
  registered: 'registered',
};

/* Three states, derived from the clock rather than stored anywhere. */
function eventPhase(event, nowMs) {
  const start = event.startsAt ? new Date(event.startsAt).getTime() : null;
  const end = event.endsAt ? new Date(event.endsAt).getTime() : null;
  if (start !== null && end !== null && nowMs >= start && nowMs <= end) return 'live';
  if (end !== null && nowMs > end) return 'done';
  return 'upcoming';
}

const PHASE_RANK = { live: 0, upcoming: 1, done: 2 };

function CoordinatorHubScreen() {
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();
  const [groups, setGroups] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadData = useCallback(async () => {
    setLoadState('loading');
    try {
      const assignmentList = await apiClient.get('/staff-assignments/mine');
      /*
       * An administrator's fest-wide grant covers coordination too, so their
       * fests belong here — filtering to `coordinator` alone would show an
       * admin an empty hub for a fest they own.
       */
      const mine = (Array.isArray(assignmentList) ? assignmentList : []).filter(
        (assignment) =>
          assignment.role === STAFF_ROLES.COORDINATOR ||
          assignment.role === STAFF_ROLES.ADMINISTRATOR ||
          assignment.role === STAFF_ROLES.PLATFORM_ADMIN,
      );

      /*
       * Collapsed to one entry per FEST before fetching: two grants on the same
       * fest would otherwise request the same event list twice.
       */
      const byFest = new Map();
      for (const assignment of mine) {
        const fest = assignment.festId;
        if (!fest?.id) continue;
        const grantedIds = (assignment.eventIds ?? []).map((event) => event.id).filter(Boolean);
        const existing = byFest.get(fest.id);
        if (existing) {
          // A fest-wide grant on either row widens the pair to the whole fest.
          existing.festWide = existing.festWide || grantedIds.length === 0;
          grantedIds.forEach((id) => existing.grantedIds.add(id));
        } else {
          byFest.set(fest.id, {
            festId: fest.id,
            festName: fest.festName ?? '',
            festWide: grantedIds.length === 0,
            grantedIds: new Set(grantedIds),
          });
        }
      }

      const built = await Promise.all(
        [...byFest.values()].map(async (fest) => {
          /* One fest's event list failing drops that section, not the screen. */
          const payload = await apiClient
            .get('/public/fests/' + fest.festId + '/events?includeChildren=true')
            .catch(() => null);
          const all = Array.isArray(payload?.events)
            ? payload.events
            : Array.isArray(payload)
              ? payload
              : [];
          const events = fest.festWide
            ? all
            : all.filter((event) => fest.grantedIds.has(event.id));
          return { festId: fest.festId, festName: fest.festName, events };
        }),
      );

      setGroups(built.filter((group) => group.events.length > 0));
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  // Live status is read from the clock, so the clock has to move.
  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  /* Live first, then upcoming by start time, then finished. */
  const sortedGroups = useMemo(
    () =>
      groups.map((group) => ({
        ...group,
        events: [...group.events].sort((first, second) => {
          const byPhase =
            PHASE_RANK[eventPhase(first, nowMs)] - PHASE_RANK[eventPhase(second, nowMs)];
          if (byPhase !== 0) return byPhase;
          return new Date(first.startsAt ?? 0) - new Date(second.startsAt ?? 0);
        }),
      })),
    [groups, nowMs],
  );

  const allEvents = useMemo(
    () => sortedGroups.flatMap((group) => group.events),
    [sortedGroups],
  );
  const totalEvents = allEvents.length;
  const liveCount = allEvents.filter((event) => eventPhase(event, nowMs) === 'live').length;
  const todayCount = allEvents.filter((event) => isToday(event.startsAt, nowMs)).length;
  /* A single header over the only group names something already known. */
  const showFestHeaders = sortedGroups.length > 1;

  return (
    <div className="dbk-screen">
      <ScreenHeader title={COPY.title} />

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
          totalEvents === 0 ? (
            <p className="dbh-empty">{COPY.empty}</p>
          ) : (
            <>
              <div className="dbh-stats">
                <div className="dbh-stat">
                  <span className="dbh-stat__value">{totalEvents}</span>
                  <span className="dbh-stat__label">{COPY.eventsLabel}</span>
                </div>
                <div className="dbh-stat">
                  <span
                    className={
                      liveCount > 0 ? 'dbh-stat__value dbh-stat__value--now' : 'dbh-stat__value'
                    }
                  >
                    {liveCount}
                  </span>
                  <span className="dbh-stat__label">{COPY.liveLabel}</span>
                </div>
                <div className="dbh-stat">
                  <span className="dbh-stat__value">{todayCount}</span>
                  <span className="dbh-stat__label">{COPY.todayLabel}</span>
                </div>
              </div>

              {sortedGroups.map((group) => (
                <section className="dbh-section" key={group.festId}>
                  {showFestHeaders ? (
                    <h2 className="dbh-section__title">{group.festName}</h2>
                  ) : null}

                  <div className="dbh-list">
                    {group.events.map((event) => {
                      const phase = eventPhase(event, nowMs);
                      const chip = dayChip(event.startsAt, nowMs);
                      const meta = [
                        event.eventType === 'team' ? COPY.team : COPY.solo,
                        (event.registeredCount ?? 0) + ' ' + COPY.registered,
                        phase === 'done' ? COPY.done : null,
                      ].filter(Boolean);
                      return (
                        <div className="dbh-card" key={event.id}>
                          <button
                            type="button"
                            className="dbh-card__open"
                            onClick={() =>
                              navigate(
                                '/backstage/coordinator-event?eventId=' +
                                  event.id +
                                  '&festId=' +
                                  group.festId,
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
                              <span className="dbh-card__name">{event.eventName}</span>
                              <span className="dbh-card__time">
                                {whenLabel(event.startsAt, event.endsAt, nowMs)}
                              </span>
                              <span className="dbh-card__meta">
                                {phase === 'live' ? (
                                  <span className="dbh-status dbh-status--now">
                                    <span className="dbh-status__dot" aria-hidden="true" />
                                    {COPY.live}
                                  </span>
                                ) : null}
                                {phase === 'live' && meta.length > 0 ? (
                                  <span className="dbh-card__sep" aria-hidden="true">
                                    ·
                                  </span>
                                ) : null}
                                {meta.map((piece, index) => (
                                  <span key={piece}>
                                    {index > 0 ? (
                                      <span className="dbh-card__sep" aria-hidden="true">
                                        {' · '}
                                      </span>
                                    ) : null}
                                    {piece}
                                  </span>
                                ))}
                              </span>
                            </span>
                          </button>

                          {/* The thing a coordinator at a door actually wants,
                              previously three taps away. */}
                          <button
                            type="button"
                            className="dbh-card__qr"
                            aria-label={'Scan passes for ' + event.eventName}
                            onClick={() =>
                              navigate('/backstage/scanner?eventId=' + event.id)
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

export default CoordinatorHubScreen;

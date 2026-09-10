// BackstageScreen.jsx
// Route: /backstage — the crew access hub, on the dedal design system.
//
// DATA AND PERMISSIONS ARE UNCHANGED. It still loads GET /staff-assignments/mine
// and GET /shifts/mine, still fetches the event tree per fest that carries a
// coordinator assignment (GET /public/fests/:festId/events?includeChildren=true),
// still re-reads the clock every 30 seconds, and still treats an administrator
// or platformAdmin as holding both crew roles. The routing rules — coordinator
// to the coordinator hub, volunteer to the volunteer hub, anyone without the
// role to /backstage/no-access — are the same three lines they were.
//
// WHAT CHANGED IS THE PRESENTATION.
//
// The two doors used to be olive gradient blocks with the word "Coordinator" or
// "Volunteer" set in a display face across them: a poster for a destination. A
// staff member taps one of these while walking, so they are now plain cards
// with the name, one sentence saying what is behind the door, and the counts
// that matter — and they are tiles in an intrinsic grid, so a laptop shows both
// side by side instead of two ribbons stacked down the left.
//
// "LIVE" IS NOW A SENTENCE. The retired screen had a `live-glow-active` class
// pulsing a count and nothing else; a glow is not a message, and this system has
// no green or amber to build a status palette from anyway. On duty is stated:
// "On duty now" plus the checkpoint or event name, with --primary as the second
// signal behind the words.
//
// NO BACK CONTROL, deliberately, and this is load-bearing: /backstage is a nav
// ROOT and the sign-in redirect target for staff, so both arrivals start with
// EMPTY history and navigate(-1) is a silent no-op. It also passes NO title to
// ScreenHeader, because a title suppresses the global app header — right for a
// pushed screen, wrong for a root, which would lose its only way out.

import { useCallback, useEffect, useMemo, useState } from 'react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import apiClient from '../../api-client/api-client.js';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';

import '../../design/backstage.css';

const STAFF_ROLES = {
  COORDINATOR: 'coordinator',
  VOLUNTEER: 'volunteer',
  ADMINISTRATOR: 'administrator',
  PLATFORM_ADMIN: 'platformAdmin',
};

/*
 * COPY, OVERRIDDEN LOCALLY RATHER THAN AT SOURCE.
 *
 * BACKSTAGE_COPY in brand/brand-copy.js is shared with CoordinatorHubScreen,
 * which is not part of this change, and every string this screen needs from it
 * is stamped uppercase ("CREW ACCESS", "SCAN →", "LIVE · ON DUTY"). Editing the
 * shared block would have restyled a screen somebody else is mid-way through.
 * These four are sentence case, no dashes, and "My" for the things the signed-in
 * volunteer owns.
 */
const COPY = {
  heading: 'Crew access',
  coordinator: 'Coordinator',
  coordinatorHint: 'Rosters, rounds, scores and announcements for the events you run.',
  volunteer: 'Volunteer',
  volunteerHint: 'My shifts, my checkpoints and the pass scanner.',
  assignmentsLabel: (count) => (count === 1 ? 'assignment' : 'assignments'),
  shiftsOnNow: 'shifts on now',
  shiftsAhead: 'shifts still to come',
  onDutyNow: 'On duty now',
  openScanner: 'Open the scanner',
  errorMessage: 'Could not load your crew access.',
  retry: 'Try again',
  offline: 'You are offline, so this is the last version loaded. It will refresh when you are back on a network.',
};

/*
 * IST, sentence case, via a local formatter. helpers/event-format.js's
 * formatShortDate is the retired stamped-uppercase helper that returns
 * "SEP 11" and is deliberately not used anywhere on these screens.
 */
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

// The /shifts/mine DTO is FLAT (checkpointId is a string with checkpointName as
// a sibling — see the backend shift serializer helpers). The populated-object
// branch stays only as a guard; assuming it exclusively is why the scan button
// never rendered even during an active shift.
function readShiftCheckpoint(shift) {
  if (shift.checkpointId && typeof shift.checkpointId === 'object') {
    return shift.checkpointId;
  }
  if (shift.checkpointId) {
    return { id: shift.checkpointId, checkpointName: shift.checkpointName ?? null };
  }
  return null;
}

// The leaf events a coordinator assignment covers: fest-wide (empty eventIds) =
// every leaf; otherwise leaves that are, or descend from, a covered event.
function coveredLeafEvents(assignment, events) {
  const coveredIds = new Set((assignment.eventIds ?? []).map((event) => event.id ?? event));
  const childrenByParent = new Map();
  events.forEach((event) => {
    const key = event.parentEventId ?? 'root';
    if (!childrenByParent.has(key)) {
      childrenByParent.set(key, []);
    }
    childrenByParent.get(key).push(event);
  });
  const isLeaf = (event) => (childrenByParent.get(event.id) ?? []).length === 0;

  function isCovered(event) {
    if (coveredIds.size === 0) {
      return true; // fest-wide
    }
    let current = event;
    const byId = new Map(events.map((candidate) => [candidate.id, candidate]));
    while (current) {
      if (coveredIds.has(current.id)) {
        return true;
      }
      current = current.parentEventId ? byId.get(current.parentEventId) : null;
    }
    return false;
  }

  return events.filter((event) => isLeaf(event) && isCovered(event));
}

/*
 * One door. A tile, not a poster: the name, the sentence that says what is
 * behind it, and the counts. The counts are inside the tile rather than in a
 * separate row beneath it, so a wide window can put the two doors side by side
 * without the numbers drifting away from what they count.
 */
function RoleTile({ name, hint, counts, onOpen }) {
  return (
    <button type="button" className="dbk-tile" onClick={onOpen}>
      <span className="dbk-tile__name">{name}</span>
      <span className="dbk-tile__hint">{hint}</span>
      <span className="dbk-tile__hint">{counts}</span>
    </button>
  );
}

function BackstageScreen() {
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();
  const [assignments, setAssignments] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [eventsByFest, setEventsByFest] = useState({});
  const [loadState, setLoadState] = useState('loading');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadBackstage = useCallback(async () => {
    setLoadState('loading');
    try {
      const [assignmentList, shiftPayload] = await Promise.all([
        apiClient.get('/staff-assignments/mine'),
        apiClient.get('/shifts/mine').catch(() => ({ shifts: [] })),
      ]);
      const activeAssignments = Array.isArray(assignmentList?.data)
        ? assignmentList.data
        : Array.isArray(assignmentList)
          ? assignmentList
          : [];
      setAssignments(activeAssignments);
      setShifts(Array.isArray(shiftPayload?.shifts) ? shiftPayload.shifts : []);

      // Fetch the event tree for each fest that has a coordinator assignment.
      const coordinatorFestIds = [
        ...new Set(
          activeAssignments
            .filter(
              (assignment) =>
                assignment.role === STAFF_ROLES.COORDINATOR && assignment.festId?.id,
            )
            .map((assignment) => assignment.festId.id),
        ),
      ];
      const treeEntries = await Promise.all(
        coordinatorFestIds.map((festId) =>
          apiClient
            .get(`/public/fests/${festId}/events?includeChildren=true`)
            .then((events) => [festId, Array.isArray(events) ? events : []])
            .catch(() => [festId, []]),
        ),
      );
      setEventsByFest(Object.fromEntries(treeEntries));
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBackstage();
  }, [loadBackstage]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  const activeShift = useMemo(
    () =>
      shifts.find((shift) => {
        if (shift.status === 'cancelled') {
          return false;
        }
        const start = shift.startsAt ? new Date(shift.startsAt).getTime() : null;
        const end = shift.endsAt ? new Date(shift.endsAt).getTime() : null;
        return start !== null && end !== null && nowMs >= start && nowMs <= end;
      }) ?? null,
    [shifts, nowMs],
  );

  /*
   * The coordinator's version of "on duty". Shifts are a VOLUNTEER concept —
   * the server refuses to create one for a coordinator — so the shift-based
   * banner could never light up for them, which read as "coordinator access is
   * not working". For coordinators, being on duty means one of their covered
   * events is running right now.
   */
  /*
   * Written as a chain of pure array operations rather than a for/continue loop
   * with early returns: the React Compiler cannot preserve the memoization of a
   * useMemo whose body breaks out of a loop, and `npx eslint` fails the file for
   * it (react-hooks/preserve-manual-memoization). The result is identical — the
   * FIRST active coordinator assignment with a covered event running now.
   */
  const liveCoordinatorEvent = useMemo(
    () =>
      assignments
        .filter(
          (assignment) =>
            assignment.role === STAFF_ROLES.COORDINATOR && assignment.status === 'active',
        )
        .map((assignment) => {
          const events = eventsByFest[assignment.festId?.id] ?? [];
          const live = coveredLeafEvents(assignment, events).find((event) => {
            const start = event.startsAt ? new Date(event.startsAt).getTime() : null;
            const end = event.endsAt ? new Date(event.endsAt).getTime() : null;
            return start !== null && end !== null && nowMs >= start && nowMs <= end;
          });
          return live ? { event: live, fest: assignment.festId } : null;
        })
        .find(Boolean) ?? null,
    [assignments, eventsByFest, nowMs],
  );

  const { upcomingShiftCount, activeShiftCount } = useMemo(() => {
    let upcoming = 0;
    let active = 0;
    shifts.forEach((shift) => {
      if (shift.status === 'cancelled') {
        return;
      }
      const start = shift.startsAt ? new Date(shift.startsAt).getTime() : null;
      const end = shift.endsAt ? new Date(shift.endsAt).getTime() : null;
      if (start !== null && end !== null && nowMs >= start && nowMs <= end) {
        active += 1;
      } else if (start !== null && start > nowMs) {
        upcoming += 1;
      }
    });
    return { upcomingShiftCount: upcoming, activeShiftCount: active };
  }, [shifts, nowMs]);

  /*
   * An administrator (college admin) or platform admin holds the superset of
   * every crew permission: if they can create the fest, they can stand at its
   * gate. Without this an admin who never assigned themselves a coordinator row
   * taps Coordinator on their own fest and lands on "no access", which reads as
   * a bug rather than a policy.
   */
  const isAdmin = assignments.some(
    (a) => a.role === STAFF_ROLES.ADMINISTRATOR || a.role === STAFF_ROLES.PLATFORM_ADMIN,
  );
  const hasCoordinatorRole = isAdmin || assignments.some((a) => a.role === STAFF_ROLES.COORDINATOR);
  const hasVolunteerRole = isAdmin || assignments.some((a) => a.role === STAFF_ROLES.VOLUNTEER);

  const coordinatorCount = assignments.filter((a) => a.role === STAFF_ROLES.COORDINATOR).length;
  const volunteerCount = assignments.filter((a) => a.role === STAFF_ROLES.VOLUNTEER).length;

  const activeCheckpoint = activeShift ? readShiftCheckpoint(activeShift) : null;

  function openScanner(checkpointId) {
    navigate(`/backstage/scanner?checkpointId=${checkpointId}`);
  }

  return (
    <div className="dbk-screen">
      <ScreenHeader showBack={false} />

      <div className="dbk-col">
        <h1 className="dbk-h1">{COPY.heading}</h1>

        {!isOnline ? <p className="dbk-offline">{COPY.offline}</p> : null}

        {loadState === 'loading' ? (
          <div className="dbk-grid">
            <div className="dbk-skel dbk-skel--tile" />
            <div className="dbk-skel dbk-skel--tile" />
          </div>
        ) : null}

        {loadState === 'error' ? (
          <div className="dbk-error">
            <p className="dbk-error__message">{COPY.errorMessage}</p>
            <button type="button" className="dbk-error__retry" onClick={loadBackstage}>
              {COPY.retry}
            </button>
          </div>
        ) : null}

        {loadState === 'ready' ? (
          <>
            {/*
             * ON DUTY, IN WORDS. A shift running right now for a volunteer, or
             * a covered event running right now for a coordinator. --primary is
             * on the chip beside the sentence, not instead of it.
             */}
            {activeShift || liveCoordinatorEvent ? (
              <section className="dbk-section">
                <div className="dbk-duty" aria-live="polite">
                  <span className="dbk-status dbk-status--now">
                    <span className="dbk-status__dot" aria-hidden="true" />
                    {COPY.onDutyNow}
                  </span>
                  <span className="dbk-card__name">
                    {activeCheckpoint?.checkpointName ??
                      liveCoordinatorEvent?.event?.eventName ??
                      liveCoordinatorEvent?.fest?.festName ??
                      ''}
                  </span>
                  {activeShift ? (
                    <span className="dbk-card__meta">
                      <span className="dbk-card__meta-item">
                        {formatClock(activeShift.startsAt)} to {formatClock(activeShift.endsAt)}
                      </span>
                    </span>
                  ) : null}
                  {activeShift && activeCheckpoint ? (
                    <button
                      type="button"
                      className="dbk-cta"
                      onClick={() => openScanner(activeCheckpoint.id)}
                    >
                      {COPY.openScanner}
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}

            <div className="dbk-grid">
              <RoleTile
                name={COPY.coordinator}
                hint={COPY.coordinatorHint}
                counts={`${coordinatorCount} ${COPY.assignmentsLabel(coordinatorCount)}`}
                onOpen={() =>
                  hasCoordinatorRole
                    ? navigate('/backstage/coordinator-hub')
                    : navigate('/backstage/no-access')
                }
              />
              <RoleTile
                name={COPY.volunteer}
                hint={COPY.volunteerHint}
                counts={`${volunteerCount} ${COPY.assignmentsLabel(volunteerCount)}`}
                onOpen={() =>
                  hasVolunteerRole
                    ? navigate('/backstage/volunteer-hub')
                    : navigate('/backstage/no-access')
                }
              />
            </div>

            <div className="dbk-stats">
              <div className="dbk-stat">
                <span
                  className={
                    activeShiftCount > 0 ? 'dbk-stat__value dbk-stat__value--now' : 'dbk-stat__value'
                  }
                >
                  {activeShiftCount}
                </span>
                <span className="dbk-stat__label">{COPY.shiftsOnNow}</span>
              </div>
              <div className="dbk-stat">
                <span className="dbk-stat__value">{upcomingShiftCount}</span>
                <span className="dbk-stat__label">{COPY.shiftsAhead}</span>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default BackstageScreen;

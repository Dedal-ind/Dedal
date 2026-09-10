// CoordinatorPanelScreen.jsx
// Route: /backstage/coordinator/:eventId — the coordinator's per-event command
// centre. One scrollable page: who is registered, the bracket and its match
// results, what participants said, the event's own details, and certificates.
// The staff event endpoints are keyed by festId, so festId is read from router
// state (passed by Backstage).
//
// ALL logic is unchanged from the Heritage version and moved verbatim: the
// details PATCH and its paise/rupee and datetime-local conversions, the roster
// fetch with flattenEventParticipants and its pendingInvites split, inline
// non-bracket score entry with optimistic concurrency (expectedVersion, and a
// MATCH_CONCURRENT_UPDATE 409 reloading the row rather than overwriting),
// bracket match saving with the same version contract and the tie block,
// certificate generate/release, NotifyParticipants and EventFeedbackSummary.
// Publish, cancel and generate-bracket are admin-only and intentionally absent.
//
// ON THE DEDAL DESIGN SYSTEM (`dop-`). What changed, and why:
//
//   · THE ROSTER IS A TABLE. It was one bordered, shadowed 4-line card per
//     person for solo events and a padded card per team. A coordinator with 180
//     registrations was scrolling a kilometre of card padding. 44px rows, one
//     border around the list, names left, score box right, aligned.
//   · The stats rail was three 128px snap-scroll cards for two or three
//     numbers, on a page that is 1440px wide on a laptop. They are a plain grid
//     now and the page uses its width.
//   · THE LIVE PULSE IS DELETED, along with the inline <style> block that
//     injected its keyframes. "Live now" is --primary text with a static dot.
//     Nothing on this screen animates.
//   · The round timeline's "in progress" state was a primary-container fill
//     with no word for it. It now reads "In progress · 3 of 8 matches decided"
//     and the marker takes --primary.
//   · The certificates confirmation is the app's BottomSheet. Generating and
//     releasing certificates are irreversible and were behind a hand-rolled
//     centred modal that could not animate out and did not trap focus.
//   · The dirty-form save bar was position:fixed at max-width 480px, centred —
//     a phone-shaped strip stranded in the middle of a wide window. It is a
//     sticky full-width bar sharing the page's own column.
//
// STATE WORDS on this screen: "Live now" (--primary, with a dot), "Not started"
// and "Finished" for the event; "Done", "In progress" (--primary) and "Not
// started" for a bracket round; "Winner" plus the name under a decided match,
// with the winning side inset in --accent because it is a result the
// coordinator entered.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { Check, LoaderCircle, Megaphone, ScanLine, Search, Star, Trophy } from 'lucide-react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import BottomSheet from '../../components/bottom-sheet/BottomSheet.jsx';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import apiClient from '../../api-client/api-client.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { flattenEventParticipants } from '../../helpers/event-roster.js';
import { formatEventTypeFull, formatScoringFormat } from '../../helpers/event-format.js';
import { formatCertificateErrorMessage } from '../../helpers/certificate-error-messages.js';
import { COORDINATOR_COPY, TEAM_CAPTAIN_COPY } from '../../brand/brand-copy.js';
import { formatCategoryLabel } from '../../helpers/category-format.js';
import VenueLink from '../../components/venue-link/VenueLink.jsx';
import EventFeedbackSummary from '../../components/event-feedback-summary/EventFeedbackSummary.jsx';
import NotifyParticipants from '../../components/notify-participants/NotifyParticipants.jsx';

// ISO <-> the value a datetime-local input expects (local time, no seconds).
function toLocalInput(iso) {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}
function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}

function buildDetailForm(event) {
  return {
    startsAt: toLocalInput(event.startsAt),
    endsAt: toLocalInput(event.endsAt),
    registrationOpensAt: toLocalInput(event.registrationOpensAt),
    registrationClosesAt: toLocalInput(event.registrationClosesAt),
    venue: event.venue ?? '',
    capacity: event.capacity ?? '',
    feeRupees: event.feeAmountPaise ? String(event.feeAmountPaise / 100) : '',
    description: event.description ?? '',
    rules: event.rules ?? '',
    isLeaderboardVisible: Boolean(event.isLeaderboardVisible),
  };
}

/* A label and a hairline. The page's own name lives in ScreenHeader. */
function SectionHead({ children, trailing = null }) {
  return (
    <div className="dop-section__head">
      <h2 className="dop-section__title">{children}</h2>
      {trailing ? <span className="dop-section__meta">{trailing}</span> : null}
    </div>
  );
}

/* --accent when on: this is a setting the coordinator chose, not a state of
   the world. The word beside it says "On" or "Off" either way. */
function OperatorSwitch({ isOn, onToggle, labelOn, labelOff }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      onClick={() => onToggle(!isOn)}
      className="dop-switch"
    >
      <span
        className={['dop-switch__track', isOn ? 'dop-switch__track--on' : ''].join(' ')}
        aria-hidden="true"
      >
        <span className="dop-switch__knob" />
      </span>
      {isOn ? labelOn : labelOff}
    </button>
  );
}

/*
 * The captain is flattened onto every row of the team by the roster endpoint, so
 * any member's row carries it — the first one is as good as the last.
 */
function teamCaptainOf(team) {
  return team.members.find((member) => member.teamCaptain)?.teamCaptain ?? null;
}

function RosterAvatar({ fullName, imageUrl }) {
  if (imageUrl) {
    return <img src={imageUrl} alt="" className="dop-avatar" />;
  }
  const initials = (fullName ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
  return <span className="dop-avatar">{initials || '?'}</span>;
}

function CoordinatorPanelScreen() {
  const navigate = useTransitionNavigate();
  const location = useLocation();
  const { eventId } = useParams();
  const festId = location.state?.festId;
  const isOnline = useOnlineStatus();

  const { isAdministrator } = useAuthentication();
  const [event, setEvent] = useState(null);
  const [loadState, setLoadState] = useState('loading');

  // Details
  const [detailForm, setDetailForm] = useState(null);
  const [originalForm, setOriginalForm] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // The clock the live-status line reads. Captured on mount (and whenever the
  // event reloads) rather than on every render, per the purity rule.
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Roster + matches
  const [participants, setParticipants] = useState([]);
  // Paid contingent claims whose attendee has not accepted yet — a reserved seat
  // without a confirmed participant, rendered as its own distinct block.
  const [pendingInvites, setPendingInvites] = useState([]);
  const [matches, setMatches] = useState([]);
  const [rosterQuery, setRosterQuery] = useState('');
  // The round shown in the matches section; the round timeline also drives
  // this. Defaults to the first round.
  const [activeRound, setActiveRound] = useState(null);

  // Scroll targets.
  const matchesRef = useRef(null);
  const certificatesRef = useRef(null);
  const announcementRef = useRef(null);

  const loadEvent = useCallback(async () => {
    if (!festId) {
      setLoadState('error');
      return;
    }
    setLoadState('loading');
    try {
      const eventDetail = await apiClient.get(`/fests/${festId}/events/${eventId}`);
      setNowMs(Date.now());
      setEvent(eventDetail);
      setDetailForm(buildDetailForm(eventDetail));
      setOriginalForm(buildDetailForm(eventDetail));
      setLoadState('ready');
      apiClient
        .get(`/fests/${festId}/events/${eventId}/participants`)
        .then((roster) => {
          const { participants: rows, pendingInvites: invites } = flattenEventParticipants(roster);
          setParticipants(rows);
          setPendingInvites(invites);
        })
        .catch(() => {
          setParticipants([]);
          setPendingInvites([]);
        });
      apiClient
        .get(`/fests/${festId}/events/${eventId}/bracket`)
        .then((list) => setMatches(Array.isArray(list) ? list : []))
        .catch(() => setMatches([]));
    } catch {
      setLoadState('error');
    }
  }, [festId, eventId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEvent();
  }, [loadEvent]);

  const isDirty = useMemo(
    () => detailForm && originalForm && JSON.stringify(detailForm) !== JSON.stringify(originalForm),
    [detailForm, originalForm],
  );

  function setDetailField(field, value) {
    setDetailForm((previous) => ({ ...previous, [field]: value }));
  }

  async function handleSaveDetails() {
    if (!isDirty || isSaving) {
      return;
    }
    setSaveError('');
    setIsSaving(true);
    try {
      const updated = await apiClient.patch(`/fests/${festId}/events/${eventId}`, {
        startsAt: fromLocalInput(detailForm.startsAt),
        endsAt: fromLocalInput(detailForm.endsAt),
        registrationOpensAt: fromLocalInput(detailForm.registrationOpensAt),
        registrationClosesAt: fromLocalInput(detailForm.registrationClosesAt),
        venue: detailForm.venue,
        capacity: detailForm.capacity === '' ? null : Number(detailForm.capacity),
        feeAmountPaise:
          detailForm.feeRupees === '' ? 0 : Math.round(Number(detailForm.feeRupees) * 100),
        description: detailForm.description,
        rules: detailForm.rules || null,
        isLeaderboardVisible: detailForm.isLeaderboardVisible,
      });
      const savedEvent = updated.event ?? updated;
      setEvent(savedEvent);
      setOriginalForm(buildDetailForm(savedEvent));
      setDetailForm(buildDetailForm(savedEvent));
    } catch (patchError) {
      setSaveError(patchError.message || COORDINATOR_COPY.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  if (loadState === 'loading') {
    return (
      <div className="dop-screen">
        <ScreenHeader title="Event" />
        <div className="dop-page">
          <span className="dop-sk dop-sk--line" />
          <div className="dop-stats">
            <span className="dop-sk dop-sk--block" />
            <span className="dop-sk dop-sk--block" />
          </div>
          <div className="dop-skstack">
            <span className="dop-sk dop-sk--row" />
            <span className="dop-sk dop-sk--row" />
            <span className="dop-sk dop-sk--row" />
          </div>
        </div>
      </div>
    );
  }
  if (loadState === 'error' || !event) {
    return (
      <div className="dop-screen">
        <ScreenHeader title="Event" />
        <div className="dop-page">
          <div className="dop-retry">
            <p className="dop-retry__text">{COORDINATOR_COPY.errorMessage}</p>
            <button type="button" className="dop-btn" onClick={loadEvent}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const capacityPercent =
    event.capacity && event.capacity > 0
      ? Math.min(100, Math.round(((event.registeredCount ?? 0) / event.capacity) * 100))
      : 0;

  // MATCHES only makes sense on a bracket event; other formats score inline on
  // the roster.
  const isBracketEvent = event.scoringFormat === 'bracketSingleElimination';

  // Live status from the event's own clock.
  const startsMs = event.startsAt ? new Date(event.startsAt).getTime() : null;
  const endsMs = event.endsAt ? new Date(event.endsAt).getTime() : null;
  const isLive = startsMs !== null && endsMs !== null && nowMs >= startsMs && nowMs <= endsMs;
  const isCompleted = endsMs !== null && nowMs > endsMs;

  // Round grouping — shared by the timeline and the matches section.
  const byRound = new Map();
  matches.forEach((match) => {
    const round = match.roundNumber ?? 1;
    if (!byRound.has(round)) {
      byRound.set(round, []);
    }
    byRound.get(round).push(match);
  });
  const sortedRounds = [...byRound.keys()].sort((first, second) => first - second);
  const teamCount = groupByTeam(participants).length;

  function scrollToRef(sectionRef) {
    sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleTimelineSelect(round) {
    setActiveRound(round);
    scrollToRef(matchesRef);
  }

  return (
    <div className="dop-screen">
      <ScreenHeader title={event.eventName} />

      <main className="dop-page">
        {/* Event identity: what it is, and whether it is happening now. */}
        <div className="dop-ident">
          <span
            className={['dop-state', isLive ? 'dop-state--live' : 'dop-state--done'].join(' ')}
          >
            {isLive ? <span className="dop-state__dot" aria-hidden="true" /> : null}
            {isLive
              ? COORDINATOR_COPY.statusLive
              : isCompleted
                ? COORDINATOR_COPY.statusCompleted
                : COORDINATOR_COPY.statusUpcoming}
          </span>
          <div className="dop-ident__tags">
            {event.category ? (
              <span className="dop-tag">{formatCategoryLabel(event.category)}</span>
            ) : null}
            <span className="dop-tag">{formatEventTypeFull(event)}</span>
            {event.scoringFormat ? (
              <span className="dop-tag">{formatScoringFormat(event)}</span>
            ) : null}
          </div>
          {isAdministrator ? (
            <button
              type="button"
              className="dop-btn dop-btn--sm"
              onClick={() => navigate(`/admin/events/assignments?festId=${festId}`)}
            >
              {COORDINATOR_COPY.manageStaffForEvent}
            </button>
          ) : null}
        </div>

        {!isOnline ? (
          <p className="dop-offline" role="status">
            You are offline, so saving details, entering results and certificate actions are
            turned off until the connection is back.
          </p>
        ) : null}

        {/* Real, derivable numbers only — check-in counts live on the volunteer
            dashboard, not in this payload. */}
        <div className="dop-stats">
          <div className="dop-stat">
            <span className="dop-stat__value">{participants.length}</span>
            <span className="dop-stat__label">{COORDINATOR_COPY.statRegistered}</span>
          </div>
          {event.eventType === 'team' ? (
            <div className="dop-stat">
              <span className="dop-stat__value">{teamCount}</span>
              <span className="dop-stat__label">{COORDINATOR_COPY.statTeams}</span>
            </div>
          ) : null}
          {isBracketEvent && sortedRounds.length > 0 ? (
            <div className="dop-stat">
              <span className="dop-stat__value">{sortedRounds.length}</span>
              <span className="dop-stat__label">{COORDINATOR_COPY.statRounds}</span>
            </div>
          ) : null}
        </div>

        <section className="dop-section">
          <SectionHead>{COORDINATOR_COPY.commandCenterTitle}</SectionHead>
          <div className="dop-tiles">
            <button
              type="button"
              className="dop-tile"
              onClick={() => navigate('/backstage/scanner')}
            >
              <ScanLine size={20} className="dop-tile__icon" aria-hidden="true" />
              <span className="dop-tile__label">{COORDINATOR_COPY.actionOpenScanner}</span>
            </button>
            {isBracketEvent ? (
              <button
                type="button"
                className="dop-tile"
                onClick={() => scrollToRef(matchesRef)}
              >
                <Trophy size={20} className="dop-tile__icon" aria-hidden="true" />
                <span className="dop-tile__label">{COORDINATOR_COPY.actionAdvanceRound}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="dop-tile"
              onClick={() => scrollToRef(certificatesRef)}
            >
              <Star size={20} className="dop-tile__icon" aria-hidden="true" />
              <span className="dop-tile__label">{COORDINATOR_COPY.actionPushCertificates}</span>
            </button>
            <button
              type="button"
              className="dop-tile"
              onClick={() => scrollToRef(announcementRef)}
            >
              <Megaphone size={20} className="dop-tile__icon" aria-hidden="true" />
              <span className="dop-tile__label">{COORDINATOR_COPY.actionPostAnnouncement}</span>
            </button>
          </div>
        </section>

        {/* Round timeline — bracket events with a bracket only. Status is
            derived from real match results: a round is done when every match
            has a winner, in progress when it is the first undecided round,
            not started after that. */}
        {isBracketEvent && sortedRounds.length > 0 ? (
          <section className="dop-section">
            <SectionHead>{COORDINATOR_COPY.roundManagementTitle}</SectionHead>
            <RoundTimeline
              sortedRounds={sortedRounds}
              byRound={byRound}
              onSelectRound={handleTimelineSelect}
            />
          </section>
        ) : null}

        <section className="dop-section">
          <SectionHead
            trailing={`${participants.length} ${COORDINATOR_COPY.registeredSuffix}`}
          >
            {COORDINATOR_COPY.participantsTitle}
          </SectionHead>
          <RosterSection
            festId={festId}
            eventId={eventId}
            event={event}
            participants={participants}
            pendingInvites={pendingInvites}
            query={rosterQuery}
            setQuery={setRosterQuery}
            isOnline={isOnline}
          />
        </section>

        {isBracketEvent ? (
          <section ref={matchesRef} className="dop-section" style={{ scrollMarginTop: '16px' }}>
            <SectionHead>{COORDINATOR_COPY.matchesSectionTitle}</SectionHead>
            <MatchesSection
              festId={festId}
              eventId={eventId}
              matches={matches}
              byRound={byRound}
              sortedRounds={sortedRounds}
              activeRound={activeRound}
              setActiveRound={setActiveRound}
              onReload={loadEvent}
              isOnline={isOnline}
            />
          </section>
        ) : null}

        <div ref={announcementRef} style={{ scrollMarginTop: '16px' }}>
          {/* What participants said. Renders nothing until someone has rated. */}
          <EventFeedbackSummary eventId={event.id} />
        </div>
        {/* Bulk message to confirmed participants. Rate-limited to three a day
            per event; the button shows what is left of that budget. */}
        <NotifyParticipants festId={festId} eventId={event.id} eventName={event.eventName} />

        <section className="dop-section">
          <SectionHead>{COORDINATOR_COPY.detailsSectionTitle}</SectionHead>
          <DetailsSection
            form={detailForm}
            setField={setDetailField}
            capacityPercent={capacityPercent}
            registeredCount={event.registeredCount ?? 0}
            capacity={event.capacity}
          />
        </section>

        <section ref={certificatesRef} className="dop-section" style={{ scrollMarginTop: '16px' }}>
          <SectionHead>{COORDINATOR_COPY.certificatesSectionTitle}</SectionHead>
          <CertificatesSection
            festId={festId}
            eventId={eventId}
            eventName={event.eventName}
            isOnline={isOnline}
          />
        </section>
      </main>

      {/* The save bar appears only when the form is dirty, and shares the
          page's own column rather than a 480px strip in the middle of it. */}
      {isDirty ? (
        <div className="dop-bar">
          <div className="dop-bar__inner">
            {saveError ? (
              <p className="dop-alert" role="alert">
                {saveError}
              </p>
            ) : null}
            <button
              type="button"
              onClick={handleSaveDetails}
              disabled={!isDirty || isSaving || !isOnline}
              className="dop-btn dop-btn--block dop-btn--accent"
            >
              {isSaving ? <LoaderCircle size={16} aria-hidden="true" /> : null}
              {COORDINATOR_COPY.saveChanges}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/*
 * The round timeline: one row per bracket round, its marker carrying the round
 * number and its button carrying the state in words. Tapping a round selects it
 * in the matches section below.
 */
function RoundTimeline({ sortedRounds, byRound, onSelectRound }) {
  const decidedByRound = new Map(
    sortedRounds.map((round) => [
      round,
      byRound.get(round).filter((match) => match.winnerTeamId?.id ?? match.winnerUserId?.id).length,
    ]),
  );
  const firstIncomplete = sortedRounds.find(
    (round) => decidedByRound.get(round) < byRound.get(round).length,
  );

  return (
    <div className="dop-timeline">
      {sortedRounds.map((round) => {
        const total = byRound.get(round).length;
        const decided = decidedByRound.get(round);
        const isRoundComplete = decided === total;
        const isInProgress = round === firstIncomplete;
        const statusText = isRoundComplete
          ? COORDINATOR_COPY.roundStatusCompleted
          : isInProgress
            ? `${COORDINATOR_COPY.roundStatusInProgress} · ${COORDINATOR_COPY.roundMatchesDecided(decided, total)}`
            : COORDINATOR_COPY.roundStatusUpcoming;
        return (
          <div key={round} className="dop-timeline__row">
            <span
              className={[
                'dop-timeline__marker',
                isRoundComplete ? 'dop-timeline__marker--done' : '',
                isInProgress ? 'dop-timeline__marker--live' : '',
              ].join(' ')}
              aria-hidden="true"
            >
              {isRoundComplete ? <Check size={16} /> : round}
            </span>
            <button
              type="button"
              onClick={() => onSelectRound(round)}
              className="dop-timeline__button"
            >
              <span className="dop-timeline__name">
                {COORDINATOR_COPY.roundPrefix} {round}
              </span>
              <span
                className={[
                  'dop-state',
                  isInProgress ? 'dop-state--live' : '',
                  isRoundComplete ? 'dop-state--done' : '',
                ].join(' ')}
              >
                {statusText}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function RosterSection({
  festId,
  eventId,
  event,
  participants,
  pendingInvites,
  query,
  setQuery,
  isOnline,
}) {
  const isTeamEvent = event.eventType === 'team';
  const normalisedQuery = query.trim().toLowerCase();

  /*
   * Inline NON-BRACKET score entry (bracket events keep their matches section
   * and never show this). Parallel implementation to AdminScoringScreen's score
   * editor — same endpoints, same optimistic-concurrency contract (PATCH sends
   * the row's version as expectedVersion; a 409 MATCH_CONCURRENT_UPDATE reloads
   * the row rather than overwriting). Not extracted into a shared hook: the
   * fetch-rows + initialize + conflict-reload cluster is well over the
   * agreed extraction budget, so the admin screen remains the named parallel.
   * Finalize and award stay admin-only — enforced by the routes; no buttons here.
   */
  const isScorableEvent =
    Boolean(event.scoringFormat) && event.scoringFormat !== 'bracketSingleElimination';
  // registrationId → { score, version, isFinalized } | null (no row yet)
  const [scoreRows, setScoreRows] = useState(null);
  const [scoreNotice, setScoreNotice] = useState('');
  const [isInitializingScores, setIsInitializingScores] = useState(false);

  const loadScoreRows = useCallback(async () => {
    const entries = await Promise.all(
      participants.map((registration) =>
        apiClient
          .get(`/fests/${festId}/events/${eventId}/scores/${registration.id}`)
          .then((row) => [registration.id, row])
          .catch(() => [registration.id, null]),
      ),
    );
    setScoreRows(new Map(entries));
  }, [festId, eventId, participants]);

  useEffect(() => {
    if (isScorableEvent && participants.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadScoreRows();
    }
  }, [isScorableEvent, participants, loadScoreRows]);

  const hasAnyScoreRow = scoreRows !== null && [...scoreRows.values()].some((row) => row !== null);

  async function initializeScores() {
    setIsInitializingScores(true);
    setScoreNotice('');
    try {
      await apiClient.post(`/fests/${festId}/events/${eventId}/scores/initialize`);
      await loadScoreRows();
    } catch (initializeError) {
      setScoreNotice(initializeError.message || COORDINATOR_COPY.saveFailed);
    } finally {
      setIsInitializingScores(false);
    }
  }

  async function saveScore(registrationId, rawValue) {
    const row = scoreRows?.get(registrationId);
    const parsedScore = Number(rawValue);
    if (!row || rawValue === '' || Number.isNaN(parsedScore) || parsedScore === row.score) {
      return;
    }
    setScoreNotice('');
    try {
      const updated = await apiClient.patch(
        `/fests/${festId}/events/${eventId}/scores/${registrationId}`,
        { score: parsedScore, expectedVersion: row.version },
      );
      setScoreRows((previous) => new Map(previous).set(registrationId, updated));
    } catch (saveScoreError) {
      if (saveScoreError.code === 'MATCH_CONCURRENT_UPDATE') {
        // Someone else saved first: reload the row, keep their value visible.
        const freshRow = await apiClient
          .get(`/fests/${festId}/events/${eventId}/scores/${registrationId}`)
          .catch(() => null);
        setScoreRows((previous) => new Map(previous).set(registrationId, freshRow));
        setScoreNotice(COORDINATOR_COPY.scoreConflictReloaded);
        return;
      }
      setScoreNotice(saveScoreError.message || COORDINATOR_COPY.saveFailed);
    }
  }

  function renderScoreInput(registrationId) {
    if (!isScorableEvent || !hasAnyScoreRow) {
      return null;
    }
    const row = scoreRows?.get(registrationId);
    if (!row) {
      return null; // e.g. registered after initialize — re-run initialize to add
    }
    return (
      <input
        type="text"
        inputMode="decimal"
        defaultValue={row.score}
        key={`${registrationId}-v${row.version}`}
        disabled={row.isFinalized || !isOnline}
        aria-label={COORDINATOR_COPY.scoreInputLabel}
        onBlur={(blurEvent) => saveScore(registrationId, blurEvent.target.value)}
        className="dop-input dop-input--num"
      />
    );
  }

  const filtered = participants.filter((registration) => {
    if (!normalisedQuery) {
      return true;
    }
    const name = registration.userId?.fullName ?? '';
    const usn = registration.userId?.usn ?? '';
    const teamName = registration.teamId?.teamName ?? '';
    return [name, usn, teamName].some((field) => field.toLowerCase().includes(normalisedQuery));
  });

  return (
    <>
      <div className="dop-search">
        <Search size={16} aria-hidden="true" />
        <input
          value={query}
          onChange={(changeEvent) => setQuery(changeEvent.target.value)}
          placeholder={COORDINATOR_COPY.rosterSearchPlaceholder}
          aria-label={COORDINATOR_COPY.rosterSearchPlaceholder}
          data-search-input
        />
      </div>

      {/* Non-bracket score entry: create the sheet once, then inline inputs. */}
      {isScorableEvent && scoreRows !== null && !hasAnyScoreRow && participants.length > 0 ? (
        <div className="dop-retry">
          <p className="dop-retry__text">{COORDINATOR_COPY.scoresNotInitialized}</p>
          <button
            type="button"
            onClick={initializeScores}
            disabled={isInitializingScores || !isOnline}
            className="dop-btn"
          >
            {COORDINATOR_COPY.initializeScoresButton}
          </button>
        </div>
      ) : null}
      {scoreNotice ? (
        <p className="dop-alert" role="alert">
          {scoreNotice}
        </p>
      ) : null}

      {/* Reserved-but-unconfirmed contingent seats. Their own block, because on
          race day these seats are taken but nobody has accepted them yet. */}
      {pendingInvites.length > 0 ? (
        <>
          <p className="dop-detail__label">{COORDINATOR_COPY.pendingInvitesHeading}</p>
          <div className="dop-table">
            {pendingInvites.map((invite) => (
              <div key={invite.id} className="dop-row">
                <span className="dop-row__main">
                  <span className="dop-row__name">{invite.attendeeFullName}</span>
                  <span className="dop-row__meta">
                    {COORDINATOR_COPY.pendingInviteLine(invite.attendeeEmailAddress)} ·{' '}
                    {COORDINATOR_COPY.contingentViaPrefix} {invite.contingentName ?? 'unnamed'} ·{' '}
                    {COORDINATOR_COPY.contingentBuyerPrefix} {invite.buyerFullName ?? 'unknown'}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          line={
            participants.length === 0
              ? 'Nobody has registered for this event yet.'
              : 'No one on the roster matches that search.'
          }
        />
      ) : isTeamEvent ? (
        groupByTeam(filtered).map((team) => (
          <div key={team.teamId} className="dop-team">
            <div className="dop-team__head">
              <h3 className="dop-team__name">{team.teamName}</h3>
              <span className="dop-section__meta">
                {team.members.length} member{team.members.length === 1 ? '' : 's'}
              </span>
            </div>

            {/* The one person to call, on their own line with the number
                tappable: on race day this is the only row in the card a
                coordinator actually needs to act on. */}
            {teamCaptainOf(team) ? (
              <p className="dop-team__captain">
                <span className="dop-tag">{TEAM_CAPTAIN_COPY.captainLabel}</span>
                <strong>{teamCaptainOf(team).fullName ?? 'Unnamed'}</strong>
                {teamCaptainOf(team).phoneNumber ? (
                  <a href={`tel:${teamCaptainOf(team).phoneNumber}`}>
                    {teamCaptainOf(team).phoneNumber}
                  </a>
                ) : null}
              </p>
            ) : null}

            {team.members.map((member) => (
              <div key={member.id} className="dop-row">
                <span className="dop-row__main">
                  <span className="dop-row__name">{member.userId?.fullName ?? 'Unnamed'}</span>
                  <span className="dop-row__meta">
                    {[member.userId?.usn, member.status].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="dop-row__end">{renderScoreInput(member.id)}</span>
              </div>
            ))}

            {formatFoodOrderLine(team.members) ? (
              <p className="dop-team__captain">{formatFoodOrderLine(team.members)}</p>
            ) : null}
          </div>
        ))
      ) : (
        <div className="dop-table">
          {filtered.map((registration) => (
            <div key={registration.id} className="dop-row">
              <RosterAvatar
                fullName={registration.userId?.fullName}
                imageUrl={registration.userId?.profilePictureUrl}
              />
              <span className="dop-row__main">
                <span className="dop-row__name">
                  {registration.userId?.fullName ?? 'Unnamed'}
                </span>
                <span className="dop-row__meta">
                  {[
                    registration.userId?.usn,
                    registration.status,
                    registration.registrationType === 'contingent'
                      ? [COORDINATOR_COPY.contingentTag, registration.contingentName]
                          .filter(Boolean)
                          .join(' ')
                      : null,
                    formatFoodOrderLine([registration]) || null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="dop-row__end">{renderScoreInput(registration.id)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function DetailsSection({ form, setField, capacityPercent, registeredCount, capacity }) {
  return (
    <>
      <p className="dop-detail__label">{COORDINATOR_COPY.sectionTiming}</p>
      <div className="dop-grid2">
        {[
          { field: 'startsAt', label: COORDINATOR_COPY.labelStartsAt },
          { field: 'endsAt', label: COORDINATOR_COPY.labelEndsAt },
          { field: 'registrationOpensAt', label: COORDINATOR_COPY.labelRegOpens },
          { field: 'registrationClosesAt', label: COORDINATOR_COPY.labelRegCloses },
        ].map((item) => (
          <label key={item.field} className="dop-field">
            <span className="dop-field__label">{item.label}</span>
            <input
              type="datetime-local"
              className="dop-input"
              value={form[item.field]}
              onChange={(changeEvent) => setField(item.field, changeEvent.target.value)}
            />
          </label>
        ))}
      </div>

      <p className="dop-detail__label">{COORDINATOR_COPY.sectionVenueCapacity}</p>
      <label className="dop-field">
        <span className="dop-field__label">{COORDINATOR_COPY.labelVenue}</span>
        <input
          className="dop-input"
          value={form.venue}
          onChange={(e) => setField('venue', e.target.value)}
        />
        {/* The venue here is an editable field, not a display line — so the
            Maps link sits beside it, checking what is currently typed. */}
        {form.venue.trim() ? <VenueLink venue={form.venue} iconSize={12} /> : null}
      </label>

      <div className="dop-grid2">
        <label className="dop-field">
          <span className="dop-field__label">{COORDINATOR_COPY.labelCapacity}</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            className="dop-input"
            value={form.capacity}
            onChange={(e) => setField('capacity', e.target.value)}
          />
          {capacity ? (
            <>
              <span className="dop-meter" aria-hidden="true">
                <span className="dop-meter__fill" style={{ width: `${capacityPercent}%` }} />
              </span>
              <span className="dop-count" style={{ alignSelf: 'flex-start' }}>
                {registeredCount} of {capacity} {COORDINATOR_COPY.filledSuffix}, {capacityPercent}%
              </span>
            </>
          ) : null}
        </label>
        <label className="dop-field">
          <span className="dop-field__label">{COORDINATOR_COPY.labelFee}</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            className="dop-input"
            value={form.feeRupees}
            onChange={(e) => setField('feeRupees', e.target.value)}
          />
          <span className="dop-count" style={{ alignSelf: 'flex-start' }}>
            {COORDINATOR_COPY.feeHelper}
          </span>
        </label>
      </div>

      <div className="dop-switchrow">
        <span className="dop-field__label">{COORDINATOR_COPY.labelLeaderboard}</span>
        <OperatorSwitch
          isOn={form.isLeaderboardVisible}
          onToggle={(next) => setField('isLeaderboardVisible', next)}
          labelOn={COORDINATOR_COPY.toggleOn}
          labelOff={COORDINATOR_COPY.toggleOff}
        />
      </div>

      <p className="dop-detail__label">{COORDINATOR_COPY.sectionContent}</p>
      <label className="dop-field">
        <span className="dop-field__label">{COORDINATOR_COPY.labelDescription}</span>
        <textarea
          rows={4}
          className="dop-textarea"
          value={form.description}
          onChange={(e) => setField('description', e.target.value)}
        />
      </label>
      <label className="dop-field">
        <span className="dop-field__label">{COORDINATOR_COPY.labelRules}</span>
        <textarea
          rows={4}
          className="dop-textarea"
          value={form.rules}
          onChange={(e) => setField('rules', e.target.value)}
        />
      </label>
    </>
  );
}

// "Veg · 3 meals" from the row(s) that carry a food booking — for a team that is
// the registering leader's row; joined members' rows are null and contribute nothing.
function formatFoodOrderLine(registrations) {
  const bookingRow = registrations.find(
    (registration) => registration.foodPreference || registration.foodOrderCount != null,
  );
  if (!bookingRow) {
    return '';
  }
  const parts = [];
  if (bookingRow.foodPreference) {
    parts.push(bookingRow.foodPreference);
  }
  if (bookingRow.foodOrderCount != null && bookingRow.foodOrderCount > 0) {
    parts.push(`${bookingRow.foodOrderCount} ${COORDINATOR_COPY.mealsSuffix}`);
  }
  return parts.join(' · ');
}

/*
 * The coordinator's event-scoped certificate actions. Every call names exactly
 * this event (eventIds: [eventId]) — the backend additionally verifies the
 * coordinator's assignment covers it. NO TEMPLATE CONTROLS HERE, and none should
 * be added "for consistency": the certificate template is fest-wide branding and
 * stays administrator-only in AdminScoringScreen — a coordinator restyling every
 * other event's certificates from their own panel is the blast radius avoided.
 */
function CertificatesSection({ festId, eventId, eventName, isOnline }) {
  const [pendingAction, setPendingAction] = useState(null); // 'generate' | 'release' | null
  const [isBusy, setIsBusy] = useState(false);
  const [resultMessage, setResultMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  async function runPendingAction() {
    if (!pendingAction || isBusy) {
      return;
    }
    setIsBusy(true);
    setErrorMessage('');
    setResultMessage('');
    try {
      const result = await apiClient.post(`/fests/${festId}/certificates/${pendingAction}`, {
        eventIds: [eventId],
      });
      if (pendingAction === 'generate') {
        const generatedCount = result?.generatedCount ?? 0;
        const skippedCount = result?.skippedCount ?? 0;
        setResultMessage(
          generatedCount === 0 && skippedCount === 0
            ? COORDINATOR_COPY.certNoCandidates
            : COORDINATOR_COPY.certGenerateResult(generatedCount, skippedCount),
        );
      } else {
        setResultMessage(COORDINATOR_COPY.certReleaseResult(result?.releasedCount ?? 0));
      }
      setPendingAction(null);
    } catch (actionError) {
      setErrorMessage(formatCertificateErrorMessage(actionError, COORDINATOR_COPY.certActionFailed));
      setPendingAction(null);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <>
      {/* Unambiguous scope: this event, nothing else. */}
      <p className="dop-note dop-note--ink">{COORDINATOR_COPY.certScopeLine(eventName)}</p>

      {errorMessage ? (
        <p className="dop-alert" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {resultMessage ? (
        <p className="dop-receipt" role="status">
          {resultMessage}
        </p>
      ) : null}

      <div className="dop-table">
        <div className="dop-row">
          <span className="dop-row__main">
            <span className="dop-row__name">{COORDINATOR_COPY.certGenerate}</span>
            <span className="dop-row__meta">{COORDINATOR_COPY.certGenerateConfirmBody}</span>
          </span>
          <span className="dop-row__end">
            <button
              type="button"
              onClick={() => setPendingAction('generate')}
              disabled={!isOnline}
              className="dop-btn dop-btn--sm"
            >
              Generate
            </button>
          </span>
        </div>
        <div className="dop-row">
          <span className="dop-row__main">
            <span className="dop-row__name">{COORDINATOR_COPY.certRelease}</span>
            <span className="dop-row__meta">{COORDINATOR_COPY.certReleaseConfirmBody}</span>
          </span>
          <span className="dop-row__end">
            <button
              type="button"
              onClick={() => setPendingAction('release')}
              disabled={!isOnline}
              className="dop-btn dop-btn--sm"
            >
              Release
            </button>
          </span>
        </div>
      </div>

      <BottomSheet
        isOpen={Boolean(pendingAction)}
        onClose={() => (isBusy ? undefined : setPendingAction(null))}
        title={
          pendingAction === 'release'
            ? COORDINATOR_COPY.certRelease
            : COORDINATOR_COPY.certGenerate
        }
      >
        <div className="dop-sheet">
          <p className="dop-sheet__body">
            {pendingAction === 'generate'
              ? COORDINATOR_COPY.certGenerateConfirmBody
              : COORDINATOR_COPY.certReleaseConfirmBody}
          </p>
          <p className="dop-note">{COORDINATOR_COPY.certScopeLine(eventName)}</p>
          <div className="dop-actions">
            <button
              type="button"
              onClick={() => setPendingAction(null)}
              disabled={isBusy}
              className="dop-btn"
            >
              {COORDINATOR_COPY.certCancel}
            </button>
            <button
              type="button"
              onClick={runPendingAction}
              disabled={isBusy || !isOnline}
              className="dop-btn dop-btn--primary"
            >
              {isBusy ? <LoaderCircle size={16} aria-hidden="true" /> : null}
              {COORDINATOR_COPY.certConfirm}
            </button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}

function groupByTeam(registrations) {
  const teams = new Map();
  registrations.forEach((registration) => {
    const team = registration.teamId;
    if (!team) {
      return;
    }
    const teamId = team.id ?? team;
    if (!teams.has(teamId)) {
      teams.set(teamId, { teamId, teamName: team.teamName ?? 'Unnamed team', members: [] });
    }
    teams.get(teamId).members.push(registration);
  });
  return [...teams.values()];
}

function competitorName(userSide, teamSide) {
  if (teamSide && typeof teamSide === 'object') {
    return teamSide.teamName ?? 'Unnamed team';
  }
  if (userSide && typeof userSide === 'object') {
    return userSide.fullName ?? 'Unnamed';
  }
  return 'To be decided';
}

function MatchCard({ festId, eventId, match, onReload, isOnline }) {
  const [scoreA, setScoreA] = useState(
    match.participantAScore !== null && match.participantAScore !== undefined
      ? String(match.participantAScore)
      : '',
  );
  const [scoreB, setScoreB] = useState(
    match.participantBScore !== null && match.participantBScore !== undefined
      ? String(match.participantBScore)
      : '',
  );
  const [isSaving, setIsSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  // A knockout match cannot end level — a tie recorded here would silently pick a
  // winner. Block the save and tell the coordinator instead.
  const [tieBlocked, setTieBlocked] = useState(false);

  const nameA = competitorName(match.participantAUserId, match.participantATeamId);
  const nameB = competitorName(match.participantBUserId, match.participantBTeamId);
  const winnerId = match.winnerTeamId?.id ?? match.winnerUserId?.id ?? null;
  const aIsWinner =
    winnerId &&
    (match.participantATeamId?.id === winnerId || match.participantAUserId?.id === winnerId);
  const bIsWinner =
    winnerId &&
    (match.participantBTeamId?.id === winnerId || match.participantBUserId?.id === winnerId);
  const hasResult = Boolean(winnerId);

  async function handleSave() {
    if (scoreA === '' || scoreB === '' || isSaving) {
      return;
    }
    if (Number(scoreA) === Number(scoreB)) {
      setTieBlocked(true);
      return;
    }
    setTieBlocked(false);
    setIsSaving(true);
    setConflict(false);
    const aWins = Number(scoreA) > Number(scoreB);
    const body = {
      participantAScore: Number(scoreA),
      participantBScore: Number(scoreB),
      expectedVersion: match.version,
    };
    const winnerUser = aWins ? match.participantAUserId : match.participantBUserId;
    const winnerTeam = aWins ? match.participantATeamId : match.participantBTeamId;
    if (winnerTeam?.id) {
      body.winnerTeamId = winnerTeam.id;
    } else if (winnerUser?.id) {
      body.winnerUserId = winnerUser.id;
    }
    try {
      await apiClient.patch(`/fests/${festId}/events/${eventId}/matches/${match.id}`, body);
      onReload();
    } catch (error) {
      if (error.code === 'MATCH_CONCURRENT_UPDATE') {
        setConflict(true);
      }
    } finally {
      setIsSaving(false);
    }
  }

  function competitorRow(name, isWinner, scoreValue, setScoreValue, label) {
    return (
      <div
        className={['dop-match__side', isWinner ? 'dop-match__side--won' : ''].join(' ')}
      >
        <span className={['dop-match__name', isWinner ? 'dop-match__name--won' : ''].join(' ')}>
          {name}
        </span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label={label}
          value={scoreValue}
          disabled={!isOnline}
          onChange={(e) => {
            setScoreValue(e.target.value);
            setTieBlocked(false);
          }}
          className="dop-input dop-input--num"
        />
      </div>
    );
  }

  return (
    <div className="dop-match">
      <div className="dop-match__head">
        <span>
          {hasResult
            ? `${COORDINATOR_COPY.winnerPrefix}: ${aIsWinner ? nameA : nameB}`
            : 'No result yet'}
        </span>
        <span>Version {match.version}</span>
      </div>

      {competitorRow(nameA, aIsWinner, scoreA, setScoreA, `Score for ${nameA}`)}
      <span className="dop-match__vs">{COORDINATOR_COPY.versusLabel}</span>
      {competitorRow(nameB, bIsWinner, scoreB, setScoreB, `Score for ${nameB}`)}

      {tieBlocked ? (
        <p className="dop-alert" role="alert">
          {COORDINATOR_COPY.matchTie}
        </p>
      ) : null}

      {conflict ? (
        <div className="dop-actions">
          <p className="dop-alert" role="alert">
            {COORDINATOR_COPY.matchConflict}
          </p>
          <button type="button" onClick={onReload} className="dop-btn dop-btn--sm">
            {COORDINATOR_COPY.reload}
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleSave}
        disabled={scoreA === '' || scoreB === '' || isSaving || !isOnline}
        className="dop-btn dop-btn--block dop-btn--accent"
      >
        {isSaving ? <LoaderCircle size={16} aria-hidden="true" /> : null}
        {hasResult ? COORDINATOR_COPY.updateResult : COORDINATOR_COPY.saveResult}
      </button>
    </div>
  );
}

function MatchesSection({
  festId,
  eventId,
  matches,
  byRound,
  sortedRounds,
  activeRound,
  setActiveRound,
  onReload,
  isOnline,
}) {
  if (matches.length === 0) {
    return <EmptyState line={COORDINATOR_COPY.noBracketSubtext} />;
  }

  const shownRound =
    activeRound !== null && byRound.has(activeRound) ? activeRound : sortedRounds[0];

  return (
    <>
      {/* Round chips — one round at a time keeps a phone-width bracket readable. */}
      <div className="dop-strip">
        {sortedRounds.map((round) => (
          <button
            key={round}
            type="button"
            onClick={() => setActiveRound(round)}
            aria-pressed={round === shownRound}
            className={['dop-chip', round === shownRound ? 'dop-chip--on' : ''].join(' ')}
          >
            {COORDINATOR_COPY.roundPrefix} {round}
          </button>
        ))}
      </div>

      <div className="dop-cards">
        {byRound.get(shownRound).map((match) => (
          <MatchCard
            key={match.id}
            festId={festId}
            eventId={eventId}
            match={match}
            onReload={onReload}
            isOnline={isOnline}
          />
        ))}
      </div>
    </>
  );
}

export default CoordinatorPanelScreen;

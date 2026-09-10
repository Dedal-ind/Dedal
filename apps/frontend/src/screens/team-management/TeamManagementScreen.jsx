// TeamManagementScreen.jsx
// Route: /my-teams — the teams this participant is on, and the one place to
// create another or join one with an invite code.
//
// ── WHAT MOVED, AND WHAT DID NOT ──────────────────────────────────────────
//
// Nothing behavioural. Every endpoint, payload, guard and branch below is the
// Heritage version's, moved across unchanged: GET /teams/mine +
// fetchPublicCatalog() + GET /registrations/mine in one Promise.all; the
// live-status intersection that stops the picker offering an event the backend
// would refuse; POST /teams for a create; GET /invite-codes/:code/inspect on a
// COMPLETE code only; POST /invite-codes/redeem for a vertical code and POST
// /registrations/mine/join-team for a team one, chosen by what the SERVER said
// the code was; the checkout / add-ons / refresh-in-place routing after a join;
// the MEDICAL_DECLARATION_REQUIRED retry; the captaincy opt-in.
//
// The card, its captaincy row and its invite code moved to TeamCard.jsx and the
// code boxes to the shared components/team-code-entry/TeamCodeEntry.jsx, which
// the event-detail screen renders too. This file went from 792 lines to
// something you can read in one screen.
//
// The layout changed. It was one narrow stacked column at every width: two
// composer panels ate the fold and the teams you are on — the reason most
// people open this screen — started below them. It is now two panes from 1024
// up (composer left, roster grid right) and the roster is an intrinsic grid. On
// a phone it is still one column in the same order.
//
// The title lives in ScreenHeader, which stands the app header down (see
// screen-title-context.jsx). No heading of our own, and no header clearance.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import apiClient from '../../api-client/api-client.js';
import { fetchPublicCatalog } from '../../helpers/public-catalog.js';
import { formatTeamErrorMessage } from '../../helpers/team-error-messages.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import {
  CheckCircleIcon,
  CreateTeamIcon,
  ExpandIcon,
  JoinTeamIcon,
  OfflineIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { INVITE_CODE_LENGTH } from '../../constants/registration-constants.js';
import {
  TEAMS_COPY,
  PARTICIPANT_CONTINGENT_COPY,
  TEAM_CAPTAIN_COPY,
  CONNECTION_COPY,
} from '../../brand/brand-copy.js';
import TeamCard from './TeamCard.jsx';
import TeamCodeEntry from '../../components/team-code-entry/TeamCodeEntry.jsx';

/*
 * SENTENCE CASE, SPELLED OUT LOCALLY.
 *
 * The design system is sentence case; brand-copy.js still holds the stamped
 * uppercase strings the Heritage frames were drawn with ("CREATE →", "SQUAD
 * NAME", "YOU JOINED THE TEAM"), and brand-copy.js is not this screen's file to
 * edit. Faking it with `text-transform` was rejected: it leaves the shouting
 * string in the accessibility tree and in anything copied off the page.
 *
 * DELETE THIS BLOCK once TEAMS_COPY carries sentence case at source. Every key
 * not listed here is already sentence case and is read straight from the
 * module.
 */
const SENTENCE_CASE = {
  createNameLabel: 'Squad name',
  createSubmit: 'Create team',
  yourTeams: 'Your teams',
  joinSuccessTitle: 'You joined the team',
};

/* Stated on the control itself rather than surfacing after a failed tap. */
const OFFLINE_WRITE_REASON = 'You are offline. Reconnect to make changes to a team.';

/*
 * The live verdict under the code boxes. Four states, deliberately distinct:
 * "fully claimed" and "you already joined" are both refusals but need different
 * actions from the participant (find another code vs. nothing to do), and
 * collapsing them into one red line is how somebody re-asks their organiser for
 * a code they cannot use.
 */
function CodeFeedback({ inspection }) {
  if (!inspection || inspection.kind === 'team') {
    return null;
  }
  if (inspection.kind === 'invalid') {
    return (
      <p className="dtm-verdict dtm-verdict--bad">{PARTICIPANT_CONTINGENT_COPY.codeInvalid}</p>
    );
  }

  const toneByStatus = {
    available: 'dtm-verdict--good',
    exhausted: 'dtm-verdict--bad',
    alreadyClaimed: '',
  };
  const messageByStatus = {
    available: PARTICIPANT_CONTINGENT_COPY.codeAvailable(
      inspection.eventName,
      inspection.remainingSlots,
    ),
    exhausted: PARTICIPANT_CONTINGENT_COPY.codeExhausted,
    alreadyClaimed: PARTICIPANT_CONTINGENT_COPY.codeAlreadyJoined,
  };

  return (
    <p className={['dtm-verdict', toneByStatus[inspection.status] ?? ''].join(' ').trim()}>
      {messageByStatus[inspection.status] ?? ''}
      {inspection.parentEventName ? (
        <span className="dtm-verdict__note">
          {' '}
          {PARTICIPANT_CONTINGENT_COPY.underParent(inspection.parentEventName)}
        </span>
      ) : null}
    </p>
  );
}

/* The loading shape, not a loading animation: three cards at the real height,
   in the real grid, with the title line, the status pill and two member rows
   where they will actually be. */
function RosterSkeleton() {
  return (
    <ul className="dtm-grid" role="list" aria-hidden="true">
      {[0, 1, 2].map((cell) => (
        <li key={cell}>
          <div className="dtm-skeleton">
            <div className="dtm-skeleton__line dtm-skeleton__line--title" />
            <div className="dtm-skeleton__line dtm-skeleton__line--short" />
            <div className="dtm-skeleton__row">
              <div className="dtm-skeleton__avatar" />
              <div className="dtm-skeleton__line" style={{ flex: 1 }} />
            </div>
            <div className="dtm-skeleton__row">
              <div className="dtm-skeleton__avatar" />
              <div className="dtm-skeleton__line" style={{ flex: 1 }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function TeamManagementScreen() {
  const navigate = useTransitionNavigate();
  const location = useLocation();
  const { currentUser } = useAuthentication();
  const isOnline = useOnlineStatus();

  const [teams, setTeams] = useState([]);
  const [teamEvents, setTeamEvents] = useState([]);
  const [loadState, setLoadState] = useState('loading');

  const [openPanel, setOpenPanel] = useState(null); // 'create' | 'join' | null
  const [createEventId, setCreateEventId] = useState('');
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isEventListOpen, setIsEventListOpen] = useState(false);
  const eventPickerReference = useRef(null);

  const [joinError, setJoinError] = useState('');
  /*
   * What the server says the currently-typed code is. Held here rather than in
   * the code-entry component because the submit handler needs it to choose an
   * endpoint.
   */
  const [codeInspection, setCodeInspection] = useState(null);
  // Opt-in to captain the team, offered while the post is still vacant.
  const [wantsCaptaincy, setWantsCaptaincy] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  // /my-teams cannot know the event before the code resolves, so the declaration
  // checkbox appears only after the backend refuses with MEDICAL_DECLARATION_REQUIRED.
  const [joinNeedsMedicalDeclaration, setJoinNeedsMedicalDeclaration] = useState(false);

  // Set when an event-screen join succeeded but carried no registration id to
  // land on — this screen then shows the explicit success state instead.
  const showJoinSuccess = Boolean(location.state?.justJoined);

  const loadTeams = useCallback(async () => {
    setLoadState('loading');
    try {
      const [teamList, catalog, registrationList] = await Promise.all([
        apiClient.get('/teams/mine'),
        fetchPublicCatalog().catch(() => ({ events: [] })),
        apiClient.get('/registrations/mine').catch(() => []),
      ]);
      setTeams(Array.isArray(teamList) ? teamList : []);
      /*
       * A team can only be created for an event the user is ALREADY registered
       * for: the catalog's team events are intersected with the live (non-
       * cancelled) registrations, so the dropdown never offers an event the
       * backend would refuse.
       */
      const liveStatuses = new Set(['confirmed', 'attended', 'waitlisted', 'pendingPayment']);
      const registeredEventIds = new Set(
        (Array.isArray(registrationList) ? registrationList : [])
          .filter((registration) => liveStatuses.has(registration.status))
          .map((registration) => registration.eventId?.id ?? registration.eventId)
          .filter(Boolean),
      );
      setTeamEvents(
        (catalog.events ?? []).filter(
          (event) => event.eventType === 'team' && registeredEventIds.has(event.id),
        ),
      );
      setLoadState('ready');
    } catch {
      /* The roster is deliberately NOT cleared. Losing the connection with this
         screen open would otherwise replace readable teams — names, codes,
         rosters — with an error panel; only the writes behind them need the
         network, and those are disabled separately. */
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTeams();
  }, [loadTeams]);

  // Close the event dropdown on an outside tap, mirroring CollegeSelect.
  useEffect(() => {
    function handleDocumentClick(clickEvent) {
      if (eventPickerReference.current && !eventPickerReference.current.contains(clickEvent.target)) {
        setIsEventListOpen(false);
      }
    }
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  // Team events the user does not already have a team for.
  const creatableEvents = useMemo(() => {
    const teamedEventIds = new Set(
      teams.map((team) => team.eventId?.id ?? team.eventId).filter(Boolean),
    );
    return teamEvents.filter((event) => !teamedEventIds.has(event.id));
  }, [teamEvents, teams]);

  const selectedEvent = creatableEvents.find((event) => event.id === createEventId) ?? null;

  async function handleCreate() {
    if (!createEventId || createName.trim().length < 2 || isCreating) {
      return;
    }
    setCreateError('');
    setIsCreating(true);
    try {
      await apiClient.post('/teams', { eventId: createEventId, teamName: createName.trim() });
      setCreateName('');
      setCreateEventId('');
      setOpenPanel(null);
      await loadTeams();
    } catch (error) {
      setCreateError(formatTeamErrorMessage(error, TEAMS_COPY.createFailed));
    } finally {
      setIsCreating(false);
    }
  }

  /*
   * Looks a code up as it is typed. Only fires on a COMPLETE code — a partial
   * one is not a wrong code, and flashing "invalid" at somebody halfway through
   * typing is noise that trains them to ignore the line that will later carry
   * the real refusal.
   */
  const handleCodeChange = useCallback(async (inviteCode) => {
    if (inviteCode.length !== INVITE_CODE_LENGTH) {
      setCodeInspection(null);
      return;
    }
    try {
      const result = await apiClient.get(`/invite-codes/${inviteCode}/inspect`);
      setCodeInspection(result);
    } catch {
      // A failed lookup is not a verdict: stay silent and let submit decide.
      setCodeInspection(null);
    }
  }, []);

  async function handleJoin(inviteCode, hasAcceptedMedicalDeclaration) {
    if (isJoining) {
      return;
    }
    setJoinError('');
    setIsJoining(true);
    try {
      /*
       * One box, two kinds of code. A contingent vertical code is redeemed
       * against the contingent endpoint; anything else falls through to the
       * team join below completely unchanged, so every existing team code
       * behaves exactly as it did.
       *
       * The kind is decided by the SERVER (inspect), not by the shape of the
       * string: the two formats are deliberately identical so a participant
       * types one kind of thing, which means the client cannot tell them apart.
       */
      if (codeInspection?.kind === 'vertical') {
        const redeemed = await apiClient.post('/invite-codes/redeem', { inviteCode });
        setOpenPanel(null);
        /*
         * Straight to the add-on step rather than to a success page. Somebody
         * who joins by code never sees the registration form, so this is their
         * only chance to buy food or a bed before the fest — and the screen
         * itself offers Skip, so it costs nothing to pass through.
         */
        const redeemedRegistrationId = redeemed?.registration?.id ?? null;
        if (redeemedRegistrationId) {
          navigate(`/registrations/${redeemedRegistrationId}/add-ons`);
          return;
        }
        navigate('/my-registrations', {
          state: {
            justJoinedVertical: {
              eventName: redeemed?.eventName ?? '',
              parentEventName: codeInspection.parentEventName ?? '',
            },
          },
        });
        return;
      }

      const joined = await apiClient.post('/registrations/mine/join-team', {
        inviteCode,
        ...(hasAcceptedMedicalDeclaration !== undefined ? { hasAcceptedMedicalDeclaration } : {}),
        // Volunteering during the join, rather than hunting for a second button
        // afterwards. The server ignores it if the post is already taken.
        ...(wantsCaptaincy ? { claimCaptain: true } : {}),
      });
      setOpenPanel(null);
      setJoinNeedsMedicalDeclaration(false);
      setWantsCaptaincy(false);

      /*
       * Announced only when it was NOT asked for: the last person into a full
       * team becomes captain whether they volunteered or not, and being told
       * afterwards is the difference between a duty and a surprise.
       */
      const captaincyNotice = joined?.captainAutoAssigned === true;

      /*
       * A PAID event's join leaves the registration in pendingPayment and hands
       * back a payment group — that has to go to checkout, and add-ons cannot be
       * bought against an unconfirmed seat anyway. Only a free join (already
       * confirmed) goes to the add-on step.
       */
      if (joined?.payment?.paymentGroupId) {
        navigate(`/checkout/${joined.payment.paymentGroupId}`, {
          state: { registrationId: joined?.registration?.id ?? null, captaincyNotice },
        });
        return;
      }

      const joinedRegistrationId = joined?.registration?.id ?? null;
      if (joinedRegistrationId && joined?.registration?.status === 'confirmed') {
        navigate(`/registrations/${joinedRegistrationId}/add-ons`, {
          state: { captaincyNotice },
        });
        return;
      }
      // Anything else falls back to the old refresh-in-place behaviour rather
      // than guessing at a route.
      await loadTeams();
    } catch (error) {
      if (error?.code === 'MEDICAL_DECLARATION_REQUIRED') {
        setJoinNeedsMedicalDeclaration(true);
      }
      setJoinError(formatTeamErrorMessage(error, TEAMS_COPY.joinFailed));
    } finally {
      setIsJoining(false);
    }
  }

  /* The picker's own placeholder does double duty as the "nothing to pick"
     sentence, which is why it is computed rather than inlined three times. */
  const hasNoCreatableEvents = creatableEvents.length === 0 && loadState === 'ready';
  const pickerLabel = selectedEvent
    ? selectedEvent.eventName
    : hasNoCreatableEvents
      ? teamEvents.length > 0
        ? TEAMS_COPY.allEventsHaveTeams
        : TEAMS_COPY.noEventsToCreate
      : TEAMS_COPY.createEventPlaceholder;

  const hasCached = teams.length > 0;
  /* A failure with nothing behind it is a full state; a failure with teams
     already on screen is a note above them. */
  const showFailureState = loadState === 'error' && !hasCached;

  return (
    <div className="dtm-screen">
      <ScreenHeader title="Teams" />

      <div className="dtm-col">
        <div className="dtm-layout">
          {/* ── The composer ─────────────────────────────────────────────
              First in the DOM, and therefore first on a phone: creating or
              joining is the errand people arrive with, and a phone screenful
              is one thing at a time. On desktop it is the sticky left pane. */}
          <div className="dtm-compose">
            <section className="dtm-panel">
              <h2 className="dtm-panel__title">{TEAMS_COPY.stepSelectEvent}</h2>

              <div className="dtm-picker" ref={eventPickerReference}>
                <button
                  type="button"
                  className="dtm-picker__button"
                  onClick={() => setIsEventListOpen((previous) => !previous)}
                  aria-expanded={isEventListOpen}
                  aria-haspopup="listbox"
                  disabled={hasNoCreatableEvents}
                >
                  <span
                    className={[
                      'dtm-picker__value',
                      selectedEvent ? '' : 'dtm-picker__value--empty',
                    ]
                      .join(' ')
                      .trim()}
                  >
                    {pickerLabel}
                  </span>
                  <span className="dtm-picker__chevron">
                    <ExpandIcon size="sm" />
                  </span>
                </button>

                {isEventListOpen && creatableEvents.length > 0 ? (
                  <ul className="dtm-picker__list" role="listbox">
                    {creatableEvents.map((event) => {
                      const isSelected = event.id === createEventId;
                      return (
                        <li key={event.id} role="option" aria-selected={isSelected}>
                          <button
                            type="button"
                            className="dtm-picker__option"
                            onClick={() => {
                              setCreateEventId(event.id);
                              setIsEventListOpen(false);
                            }}
                          >
                            <span style={{ minWidth: 0 }}>
                              <span className="dtm-picker__name">{event.eventName}</span>
                              {event.festName ? (
                                <span className="dtm-picker__fest">{event.festName}</span>
                              ) : null}
                            </span>
                            {isSelected ? (
                              <span className="dtm-picker__check">
                                <CheckCircleIcon size="sm" />
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            </section>

            <section className="dtm-panel">
              <h2 className="dtm-panel__title">{TEAMS_COPY.stepYourTeam}</h2>

              {/* Two toggles, one choice. aria-pressed rather than aria-expanded:
                  these select a mode for the panel below, and only one can be on. */}
              <div className="dtm-modes">
                <button
                  type="button"
                  className="dtm-mode"
                  aria-pressed={openPanel === 'create'}
                  onClick={() => setOpenPanel(openPanel === 'create' ? null : 'create')}
                >
                  <CreateTeamIcon />
                  {TEAMS_COPY.createTeam}
                </button>
                <button
                  type="button"
                  className="dtm-mode"
                  aria-pressed={openPanel === 'join'}
                  onClick={() => setOpenPanel(openPanel === 'join' ? null : 'join')}
                >
                  <JoinTeamIcon />
                  {TEAMS_COPY.joinTeam}
                </button>
              </div>

              {/* Create flow */}
              {openPanel === 'create' ? (
                <div className="dtm-form">
                  {!createEventId ? (
                    <p className="dtm-hint">{TEAMS_COPY.selectEventFirst}</p>
                  ) : null}
                  <label className="dtm-label" htmlFor="team-name-input">
                    {SENTENCE_CASE.createNameLabel}
                  </label>
                  <input
                    id="team-name-input"
                    className="dtm-input"
                    type="text"
                    value={createName}
                    maxLength={60}
                    onChange={(changeEvent) => setCreateName(changeEvent.target.value)}
                    placeholder={TEAMS_COPY.createNamePlaceholder}
                  />
                  {createError ? (
                    <p className="dtm-error" role="alert">
                      {createError}
                    </p>
                  ) : null}
                  {!isOnline ? <p className="dtm-hint">{OFFLINE_WRITE_REASON}</p> : null}
                  <button
                    type="button"
                    className="dtm-submit"
                    onClick={handleCreate}
                    /* The 2-character minimum and the event requirement are the
                       Heritage validation, unchanged; only the offline guard is
                       new, and it disables rather than alters the rule. */
                    disabled={
                      !createEventId || createName.trim().length < 2 || isCreating || !isOnline
                    }
                  >
                    {isCreating ? 'Creating…' : SENTENCE_CASE.createSubmit}
                  </button>
                </div>
              ) : null}

              {/* Join flow */}
              {openPanel === 'join' ? (
                <div className="dtm-form">
                  {/* Offered on the way in. The server decides whether it sticks
                      — if somebody already holds it, this is simply ignored. */}
                  <label className="dtm-check">
                    <input
                      type="checkbox"
                      checked={wantsCaptaincy}
                      onChange={(changeEvent) => setWantsCaptaincy(changeEvent.target.checked)}
                    />
                    <span>{TEAM_CAPTAIN_COPY.claimOnJoin}</span>
                  </label>

                  <TeamCodeEntry
                    onSubmit={handleJoin}
                    isJoining={isJoining}
                    errorMessage={joinError}
                    showMedicalDeclaration={joinNeedsMedicalDeclaration}
                    onCodeChange={handleCodeChange}
                    feedback={<CodeFeedback inspection={codeInspection} />}
                    disabledReason={isOnline ? '' : OFFLINE_WRITE_REASON}
                  />
                </div>
              ) : null}
            </section>

            {/* Explicit success state for a join that could not deep-link to
                its registration. */}
            {showJoinSuccess ? (
              <div className="dtm-success" role="status">
                <p className="dtm-success__title">{SENTENCE_CASE.joinSuccessTitle}</p>
                <p className="dtm-success__body">{TEAMS_COPY.joinSuccessBody}</p>
              </div>
            ) : null}
          </div>

          {/* ── The roster ───────────────────────────────────────────────── */}
          <section className="dtm-roster" aria-label={SENTENCE_CASE.yourTeams}>
            <div className="dtm-roster__head">
              <h2 className="dtm-roster__title">{SENTENCE_CASE.yourTeams}</h2>
              {hasCached ? <span className="dtm-roster__count">{teams.length}</span> : null}
            </div>

            {loadState === 'error' && hasCached ? (
              <p className="dtm-notice">
                <OfflineIcon size="sm" />
                <span>
                  {isOnline ? TEAMS_COPY.errorMessage : CONNECTION_COPY.offlineMessage}{' '}
                  <button type="button" className="dtm-notice__retry" onClick={loadTeams}>
                    {CONNECTION_COPY.errorRetry}
                  </button>
                </span>
              </p>
            ) : null}

            {loadState === 'loading' ? <RosterSkeleton /> : null}

            {showFailureState ? (
              <div className="dtm-state" role="status">
                <h3 className="dtm-state__title">
                  {isOnline ? CONNECTION_COPY.errorTitle : CONNECTION_COPY.offlineTitle}
                </h3>
                <p className="dtm-state__body">
                  {isOnline ? TEAMS_COPY.errorMessage : CONNECTION_COPY.offlineMessage}
                </p>
                <button type="button" className="dtm-state__action" onClick={loadTeams}>
                  {CONNECTION_COPY.errorRetry}
                </button>
              </div>
            ) : null}

            {loadState === 'ready' && !hasCached ? (
              /* One sentence, no action: the way out of an empty roster is the
                 create-or-join composer that is already on this screen, a few
                 hundred pixels up. A second button pointing at it would be a
                 button pointing at the same page. */
              <EmptyState
                line="Teams you create or join will show up here."
                className="dtm-empty"
              />
            ) : null}

            {hasCached ? (
              <ul className="dtm-grid" role="list">
                {teams.map((team) => (
                  <li key={team.id}>
                    <TeamCard
                      team={team}
                      currentUserId={currentUser?.id}
                      isOnline={isOnline}
                      offlineReason={OFFLINE_WRITE_REASON}
                      onChanged={loadTeams}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

export default TeamManagementScreen;

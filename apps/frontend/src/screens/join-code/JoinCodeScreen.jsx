// JoinCodeScreen.jsx
// Route: /join-code — reached from "Join with code" on any event page.
//
// ONE BOX FOR EVERY CODE. A participant types the code they were given and it
// is looked up the moment the last box fills:
//
//   · a CONTINGENT code (a group bought it and shared it) → the event it opens,
//     the add-ons on offer, and — for a team code — the team choices this
//     person is allowed or required to make. Joining is free unless they add
//     paid extras; the buyer already paid for the place.
//   · a TEAM INVITE code (someone formed a team and shared its code) → the
//     event, then the ordinary team join, exactly as it worked before.
//
// Nothing is written until the participant presses Join. A code that cannot be
// used says why in one plain sentence, and a full event says the code is still
// good for later.

import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import TeamCodeEntry from '../../components/team-code-entry/TeamCodeEntry.jsx';
import DrawnCheck from '../../components/drawn-check/DrawnCheck.jsx';
import AddOnStepper from '../../components/add-on-stepper/AddOnStepper.jsx';
import {
  BackIcon,
  DateIcon,
  OfflineIcon,
  TeamIcon,
  VenueIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { formatPaiseAmount, formatShortDate } from '../../helpers/event-format.js';
import {
  ADD_ON_QUANTITY_CEILING,
  buildOfferSelectionsPayload,
  computeSelectionPaise,
  offerKeyOf,
} from '../../helpers/add-on-pricing.js';
import { describeCodeRefusal } from '../../helpers/contingent-code-status.js';
import { formatTeamErrorMessage } from '../../helpers/team-error-messages.js';
import { REGISTRATION_FORM_COPY } from '../../brand/brand-copy.js';
import '../../design/team-code-entry.css';
import '../../design/post-join-addons.css';
import '../../design/join-code.css';

const TEAM_NAME_MIN_LENGTH = 2;
const TEAM_NAME_MAX_LENGTH = 60;

const COPY = {
  title: 'Join with code',
  lede: 'Enter the code you were given. You’ll see the event before you join.',
  checking: 'Checking your code…',
  offline: 'You’re offline — joining needs a connection.',
  lookupFailed: 'We couldn’t check that code. Try again.',
  legacyCode: 'This code is from an older contingent. Ask the person who shared it for a new code.',
  cannotUse: 'This code can’t be used right now.',
  addOnsTitle: 'Add-ons',
  addOnsLede: 'Optional extras from the fest. You pay only for what you pick.',
  free: 'Free',
  people: 'People',
  days: 'Days',
  total: 'Add-ons total',
  teamFirst: 'You’re the first to join with this code.',
  teamMiddleNamed: (teamName) => `Join ${teamName}’s team`,
  teamMiddle: 'Join this team',
  teamLast: 'You’re the last member — name your team and confirm as captain.',
  joinedCount: (count, maximum) => `${count} of ${maximum} joined`,
  teamNameLabel: 'Team name',
  teamNameOptional: 'Optional — you or a teammate can name it later.',
  captainLabel: 'I’ll be the team captain',
  captainHint: 'The captain is who the organisers call on the day.',
  captainForced: 'A full team needs a captain, so that’s you.',
  nameRequired: 'Name your team to join.',
  nameLength: `Team names are ${TEAM_NAME_MIN_LENGTH} to ${TEAM_NAME_MAX_LENGTH} characters.`,
  medicalRequired: 'Accept the medical declaration to join.',
  join: 'Join',
  joinTeam: 'Join team',
  pay: (amount) => `Pay ${amount}`,
  joining: 'Joining…',
  differentCode: 'Use a different code',
  joinFailed: 'Joining didn’t work. Try again.',
  teamInviteKicker: 'Team invite',
  joinedTitle: 'You’re in',
  yourTeam: 'Your team',
  captainSuffix: ' (Captain)',
  spots: (count) => `${count} ${count === 1 ? 'spot' : 'spots'} remaining`,
  teamComplete: 'Team complete',
  seePass: 'See your pass',
};

function EventSummary({ kicker, event, festName }) {
  if (!event) {
    return null;
  }
  const dateLabel = event.startsAt ? formatShortDate(event.startsAt) : null;
  return (
    <section className="djc-card">
      {kicker ? <p className="djc-kicker">{kicker}</p> : null}
      <h1 className="djc-event">{event.eventName}</h1>
      {festName ? <p className="djc-fest">{festName}</p> : null}
      {dateLabel || event.venue ? (
        <ul className="djc-meta">
          {dateLabel ? (
            <li>
              <DateIcon size="sm" />
              {dateLabel}
            </li>
          ) : null}
          {event.venue ? (
            <li>
              <VenueIcon size="sm" />
              {event.venue}
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

function MedicalCheck({ checked, onChange }) {
  return (
    <label className="djc-check">
      <input type="checkbox" checked={checked} onChange={(changeEvent) => onChange(changeEvent.target.checked)} />
      <span>{REGISTRATION_FORM_COPY.medicalLabel}</span>
    </label>
  );
}

function JoinCodeScreen() {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();

  // entry | preview | teamInvite | joined
  const [step, setStep] = useState('entry');
  const [entryKey, setEntryKey] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [entryError, setEntryError] = useState('');

  const [inspection, setInspection] = useState(null);
  const [teamInvite, setTeamInvite] = useState(null);
  const [selections, setSelections] = useState({});
  const [teamName, setTeamName] = useState('');
  const [wantsCaptaincy, setWantsCaptaincy] = useState(false);
  const [hasAcceptedMedical, setHasAcceptedMedical] = useState(false);
  const [needsMedicalForInvite, setNeedsMedicalForInvite] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [joined, setJoined] = useState(null);

  const startOver = useCallback(() => {
    setStep('entry');
    setEntryKey((key) => key + 1);
    setEntryError('');
    setInspection(null);
    setTeamInvite(null);
    setJoinError('');
  }, []);

  /* Not a contingent code: perhaps a team's own invite code. */
  const lookUpTeamInvite = useCallback(async (code) => {
    try {
      const verdict = await apiClient.get(`/invite-codes/${code}/inspect`);
      if (verdict?.kind === 'team' && verdict.eventId) {
        const event = await apiClient.get(`/public/events/${verdict.eventId}`).catch(() => null);
        setTeamInvite({ code, event });
        setNeedsMedicalForInvite(Boolean(event?.requiresMedicalDeclaration));
        setHasAcceptedMedical(false);
        setJoinError('');
        setStep('teamInvite');
        return;
      }
      setEntryError(verdict?.kind === 'vertical' ? COPY.legacyCode : describeCodeRefusal('INVITE_CODE_NOT_FOUND'));
    } catch {
      setEntryError(describeCodeRefusal('INVITE_CODE_NOT_FOUND'));
    }
  }, []);

  const lookUpCode = useCallback(
    async (code) => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setEntryError(COPY.offline);
        return;
      }
      setEntryError('');
      setIsChecking(true);
      try {
        const result = await apiClient.get(`/contingents/codes/${code}/inspect`);
        if (!result?.redeemable) {
          setEntryError(describeCodeRefusal(result?.refusal?.code, result?.refusal?.message || COPY.cannotUse));
          return;
        }
        setInspection(result);
        setSelections({});
        setTeamName('');
        setWantsCaptaincy(Boolean(result.team?.captainRequired));
        setHasAcceptedMedical(false);
        setJoinError('');
        setStep('preview');
      } catch (error) {
        if (error?.code === 'INVITE_CODE_NOT_FOUND') {
          await lookUpTeamInvite(code);
          return;
        }
        setEntryError(
          error?.code === 'VALIDATION_FAILED' ? describeCodeRefusal('VALIDATION_FAILED') : COPY.lookupFailed,
        );
      } finally {
        setIsChecking(false);
      }
    },
    [lookUpTeamInvite],
  );

  const event = inspection?.event ?? null;
  const team = inspection?.team ?? null;
  const offers = useMemo(() => inspection?.addOns ?? [], [inspection]);

  /*
   * Which team moment this is. "Last" wins: the person who fills the team must
   * supply whatever is still missing, even if they are also the first to arrive.
   */
  let teamMode = null;
  if (team) {
    if (team.captainRequired || team.teamNameRequired) {
      teamMode = 'last';
    } else if (team.memberCount === 0) {
      teamMode = 'first';
    } else {
      teamMode = 'middle';
    }
  }

  const { chosenLines, totalPaise } = useMemo(() => {
    const lines = [];
    let runningTotal = 0;
    for (const offer of offers) {
      const selection = selections[offerKeyOf(offer)];
      if (!selection) {
        continue;
      }
      const amountPaise = computeSelectionPaise(offer, selection);
      runningTotal += amountPaise;
      lines.push({ key: offerKeyOf(offer), offerName: offer.offerName, amountPaise });
    }
    return { chosenLines: lines, totalPaise: runningTotal };
  }, [offers, selections]);

  function toggleOffer(offer) {
    const key = offerKeyOf(offer);
    setSelections((previous) => {
      const next = { ...previous };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = {
          numberOfPeople: offer.numberOfPeopleMinimum ?? 1,
          numberOfDays: offer.numberOfDaysMinimum ?? 1,
        };
      }
      return next;
    });
  }

  function setQuantity(offer, axis, value) {
    const key = offerKeyOf(offer);
    setSelections((previous) =>
      previous[key] ? { ...previous, [key]: { ...previous[key], [axis]: value } } : previous,
    );
  }

  const trimmedTeamName = teamName.trim();
  let joinBlockedReason = '';
  if (!isOnline) {
    joinBlockedReason = COPY.offline;
  } else if (team?.teamNameRequired && trimmedTeamName.length < TEAM_NAME_MIN_LENGTH) {
    joinBlockedReason = COPY.nameRequired;
  } else if (
    trimmedTeamName &&
    (trimmedTeamName.length < TEAM_NAME_MIN_LENGTH || trimmedTeamName.length > TEAM_NAME_MAX_LENGTH)
  ) {
    joinBlockedReason = COPY.nameLength;
  } else if (event?.requiresMedicalDeclaration && !hasAcceptedMedical) {
    joinBlockedReason = COPY.medicalRequired;
  }

  async function handleJoin() {
    if (isJoining || joinBlockedReason || !inspection) {
      return;
    }
    setJoinError('');
    setIsJoining(true);
    try {
      const offerSelections = buildOfferSelectionsPayload(offers, selections);
      const result = await apiClient.post(`/contingents/codes/${inspection.code}/redeem`, {
        ...(offerSelections.length > 0 ? { offerSelections } : {}),
        ...(team && team.canSetTeamName && trimmedTeamName ? { teamName: trimmedTeamName } : {}),
        ...(team ? { claimCaptain: team.captainRequired ? true : wantsCaptaincy } : {}),
        ...(event?.requiresMedicalDeclaration ? { hasAcceptedMedicalDeclaration: hasAcceptedMedical } : {}),
      });
      const registrationId = result?.registration?.id ?? null;

      // Paid extras: the place is already confirmed; the add-ons go through checkout.
      if (result?.addOns?.paid && result.addOns.paymentGroupId) {
        navigate(`/checkout/${result.addOns.paymentGroupId}`, {
          state: {
            registrationId,
            isAddOnPurchase: true,
            event: { eventName: event?.eventName ?? '', festName: inspection.fest?.festName ?? '' },
          },
        });
        return;
      }

      if (!result?.team) {
        navigate(`/registration-success/${registrationId}`, { replace: true });
        return;
      }

      /* A team join ends on the roster so far — who is in, who captains, how
         many places are left — before the pass. */
      let roster = [];
      let maximumTeamSize = result.team.maximumTeamSize ?? team?.maximumTeamSize ?? 0;
      let finalTeamName = result.team.isTeamNameChosen ? result.team.teamName : null;
      try {
        const teamsPayload = await apiClient.get('/teams/mine');
        const teams = Array.isArray(teamsPayload) ? teamsPayload : (teamsPayload?.teams ?? []);
        const mine = teams.find((candidate) => candidate.id === result.team.id);
        if (mine) {
          const captainId = String(mine.captainUserId?.id ?? mine.captainUserId ?? '');
          roster = (mine.memberUserIds ?? []).map((member) => {
            const memberId = String(member?.id ?? member);
            return {
              key: memberId,
              name: member?.fullName || 'A participant',
              isCaptain: captainId !== '' && memberId === captainId,
            };
          });
          maximumTeamSize = mine.maximumTeamSize ?? maximumTeamSize;
        }
      } catch {
        // The join happened; a missing roster is not a failure.
      }
      setJoined({
        eventName: event?.eventName ?? '',
        registrationId,
        teamName: finalTeamName,
        roster,
        spotsRemaining: Math.max(0, maximumTeamSize - (roster.length || result.team.memberCount || 0)),
      });
      setStep('joined');
    } catch (error) {
      setJoinError(describeCodeRefusal(error?.code, error?.message || COPY.joinFailed));
    } finally {
      setIsJoining(false);
    }
  }

  async function handleTeamInviteJoin() {
    if (isJoining || !teamInvite) {
      return;
    }
    if (needsMedicalForInvite && !hasAcceptedMedical) {
      setJoinError(COPY.medicalRequired);
      return;
    }
    setJoinError('');
    setIsJoining(true);
    try {
      const result = await apiClient.post('/registrations/mine/join-team', {
        inviteCode: teamInvite.code,
        ...(needsMedicalForInvite ? { hasAcceptedMedicalDeclaration: hasAcceptedMedical } : {}),
      });
      const registrationId = result?.registration?.id;
      if (result?.payment?.paymentGroupId) {
        // A paid event: the joiner pays their own share before the seat confirms.
        navigate(`/checkout/${result.payment.paymentGroupId}`, {
          state: { registrationId: registrationId ?? null, event: teamInvite.event, team: result.team ?? null },
        });
      } else if (typeof registrationId === 'string' && registrationId !== '') {
        navigate(`/registration-success/${registrationId}`, { replace: true });
      } else {
        navigate('/my-teams', { state: { justJoined: true } });
      }
    } catch (error) {
      if (error?.code === 'MEDICAL_DECLARATION_REQUIRED') {
        setNeedsMedicalForInvite(true);
      }
      setJoinError(formatTeamErrorMessage(error, COPY.joinFailed));
    } finally {
      setIsJoining(false);
    }
  }

  const onBack = step === 'preview' || step === 'teamInvite' ? startOver : () => navigate(-1);

  return (
    <div className="djc-screen">
      <div className="djc-backbar">
        <button type="button" className="djc-backbar__button" onClick={onBack} aria-label="Go back">
          <BackIcon size="lg" />
        </button>
      </div>

      <main className="djc-page">
        {!isOnline ? (
          <p className="djc-offline" role="status">
            <OfflineIcon size="sm" />
            {COPY.offline}
          </p>
        ) : null}

        {step === 'entry' ? (
          <>
            <header className="djc-head">
              <h1 className="djc-title">{COPY.title}</h1>
              <p className="djc-lede">{COPY.lede}</p>
            </header>
            <TeamCodeEntry
              key={entryKey}
              onSubmit={lookUpCode}
              autoSubmit
              hideSubmit
              isJoining={isChecking}
              errorMessage={entryError}
            />
            {isChecking ? (
              <p className="djc-checking" role="status">
                {COPY.checking}
              </p>
            ) : null}
          </>
        ) : null}

        {step === 'preview' && inspection ? (
          <>
            <EventSummary
              kicker={[inspection.contingent?.parentEventName, inspection.contingent?.contingentName]
                .filter(Boolean)
                .filter((value, index, all) => all.indexOf(value) === index)
                .join(' · ')}
              event={event}
              festName={inspection.fest?.festName}
            />

            {team ? (
              <section className="djc-card djc-team">
                <p className="djc-team__head">
                  <TeamIcon size="sm" />
                  <span>
                    {teamMode === 'first'
                      ? COPY.teamFirst
                      : teamMode === 'last'
                        ? COPY.teamLast
                        : team.teamName
                          ? COPY.teamMiddleNamed(team.teamName)
                          : COPY.teamMiddle}
                  </span>
                </p>
                <p className="djc-team__count">{COPY.joinedCount(team.memberCount, team.maximumTeamSize)}</p>

                {team.canSetTeamName ? (
                  <div className="djc-field">
                    <label className="djc-field__label" htmlFor="djc-team-name">
                      {COPY.teamNameLabel}
                    </label>
                    <input
                      id="djc-team-name"
                      className="djc-input"
                      type="text"
                      value={teamName}
                      maxLength={TEAM_NAME_MAX_LENGTH}
                      required={team.teamNameRequired}
                      aria-required={team.teamNameRequired || undefined}
                      onChange={(changeEvent) => setTeamName(changeEvent.target.value)}
                    />
                    {!team.teamNameRequired ? <p className="djc-field__hint">{COPY.teamNameOptional}</p> : null}
                  </div>
                ) : null}

                {team.canClaimCaptain ? (
                  <label className="djc-check">
                    <input
                      type="checkbox"
                      checked={team.captainRequired ? true : wantsCaptaincy}
                      disabled={team.captainRequired}
                      onChange={(changeEvent) => setWantsCaptaincy(changeEvent.target.checked)}
                    />
                    <span>
                      {COPY.captainLabel}
                      <span className="djc-check__hint">
                        {team.captainRequired ? COPY.captainForced : COPY.captainHint}
                      </span>
                    </span>
                  </label>
                ) : null}
              </section>
            ) : null}

            {offers.length > 0 ? (
              <section className="djc-section">
                <h2 className="djc-section__title">{COPY.addOnsTitle}</h2>
                <p className="djc-lede">{COPY.addOnsLede}</p>
                <ul className="dpj-offers">
                  {offers.map((offer) => {
                    const key = offerKeyOf(offer);
                    const selection = selections[key];
                    const isSelected = Boolean(selection);
                    return (
                      <li key={key} className={isSelected ? 'dpj-offer dpj-offer--selected' : 'dpj-offer'}>
                        <label className="dpj-offer__label">
                          <input
                            type="checkbox"
                            className="dpj-offer__box"
                            checked={isSelected}
                            onChange={() => toggleOffer(offer)}
                          />
                          <span className="dpj-offer__text">
                            <span className="dpj-offer__head">
                              <span className="dpj-offer__name">{offer.offerName}</span>
                              <span className="dpj-offer__price">
                                {offer.isPaid ? formatPaiseAmount(offer.ratePaise) : COPY.free}
                              </span>
                            </span>
                            {offer.description ? (
                              <span className="dpj-offer__description">{offer.description}</span>
                            ) : null}
                          </span>
                        </label>
                        {isSelected && (offer.collectsNumberOfPeople || offer.collectsNumberOfDays) ? (
                          <div className="dpj-offer__axes">
                            {offer.collectsNumberOfPeople ? (
                              <AddOnStepper
                                label={COPY.people}
                                value={selection.numberOfPeople}
                                minimum={offer.numberOfPeopleMinimum ?? 1}
                                maximum={offer.numberOfPeopleMaximum ?? ADD_ON_QUANTITY_CEILING}
                                onChange={(value) => setQuantity(offer, 'numberOfPeople', value)}
                              />
                            ) : null}
                            {offer.collectsNumberOfDays ? (
                              <AddOnStepper
                                label={COPY.days}
                                value={selection.numberOfDays}
                                minimum={offer.numberOfDaysMinimum ?? 1}
                                maximum={offer.numberOfDaysMaximum ?? ADD_ON_QUANTITY_CEILING}
                                onChange={(value) => setQuantity(offer, 'numberOfDays', value)}
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {chosenLines.length > 0 ? (
                  <div className="djc-total">
                    <span>{COPY.total}</span>
                    <span>{totalPaise === 0 ? COPY.free : formatPaiseAmount(totalPaise)}</span>
                  </div>
                ) : null}
              </section>
            ) : null}

            {event?.requiresMedicalDeclaration ? (
              <MedicalCheck checked={hasAcceptedMedical} onChange={setHasAcceptedMedical} />
            ) : null}

            {joinError ? (
              <p className="djc-error" role="alert">
                {joinError}
              </p>
            ) : null}

            <div className="djc-actions">
              <button
                type="button"
                className="djc-button djc-button--primary"
                onClick={handleJoin}
                disabled={isJoining || Boolean(joinBlockedReason)}
              >
                {isJoining ? COPY.joining : totalPaise > 0 ? COPY.pay(formatPaiseAmount(totalPaise)) : COPY.join}
              </button>
              {joinBlockedReason ? <p className="djc-reason">{joinBlockedReason}</p> : null}
              <button type="button" className="djc-button" onClick={startOver} disabled={isJoining}>
                {COPY.differentCode}
              </button>
            </div>
          </>
        ) : null}

        {step === 'teamInvite' && teamInvite ? (
          <>
            <EventSummary kicker={COPY.teamInviteKicker} event={teamInvite.event} />
            {needsMedicalForInvite ? (
              <MedicalCheck checked={hasAcceptedMedical} onChange={setHasAcceptedMedical} />
            ) : null}
            {joinError ? (
              <p className="djc-error" role="alert">
                {joinError}
              </p>
            ) : null}
            <div className="djc-actions">
              <button
                type="button"
                className="djc-button djc-button--primary"
                onClick={handleTeamInviteJoin}
                disabled={isJoining || !isOnline}
              >
                {isJoining ? COPY.joining : COPY.joinTeam}
              </button>
              <button type="button" className="djc-button" onClick={startOver} disabled={isJoining}>
                {COPY.differentCode}
              </button>
            </div>
          </>
        ) : null}

        {step === 'joined' && joined ? (
          <>
            <div className="djc-celebrate">
              <DrawnCheck label="Joined" />
              <h1 className="djc-title">{COPY.joinedTitle}</h1>
              <p className="djc-lede">{joined.eventName}</p>
            </div>

            <section className="djc-card">
              <h2 className="djc-section__title">{joined.teamName ?? COPY.yourTeam}</h2>
              {joined.roster.length > 0 ? (
                <ul className="djc-roster">
                  {joined.roster.map((member) => (
                    <li key={member.key}>
                      {member.name}
                      {member.isCaptain ? COPY.captainSuffix : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="djc-team__count">
                {joined.spotsRemaining > 0 ? COPY.spots(joined.spotsRemaining) : COPY.teamComplete}
              </p>
            </section>

            <div className="djc-actions">
              <button
                type="button"
                className="djc-button djc-button--primary"
                onClick={() => navigate(`/registration-success/${joined.registrationId}`, { replace: true })}
              >
                {COPY.seePass}
              </button>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

export default JoinCodeScreen;

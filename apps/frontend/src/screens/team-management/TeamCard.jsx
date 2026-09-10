// TeamCard.jsx
// One team on /my-teams: the event it is for, its status, its roster, its
// invite code while the code can still be redeemed, the captaincy control, and
// — for the leader of a forming team — the lock.
//
// SPLIT OUT OF TeamManagementScreen.jsx, WHICH WAS 792 LINES. The screen now
// owns the composer and the load; this file owns a card. Every piece of logic
// here — the two captaincy endpoints, the lock endpoint, the
// TEAM_BELOW_MINIMUM_SIZE branch that names how many members are missing, the
// captainId/leaderId comparisons — is the Heritage version's, moved verbatim.
// Nothing about what is called, with what, or in what order has changed.

import { useState } from 'react';
import apiClient from '../../api-client/api-client.js';
import { formatTeamErrorMessage } from '../../helpers/team-error-messages.js';
import UserAvatar from '../../components/user-avatar/UserAvatar.jsx';
import {
  CaptainIcon,
  CheckIcon,
  CopyIcon,
  LockIcon,
  TeamIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { TEAMS_COPY, TEAM_CAPTAIN_COPY } from '../../brand/brand-copy.js';

/*
 * SENTENCE CASE, SPELLED OUT LOCALLY — see the same block in
 * TeamManagementScreen.jsx for why. brand-copy.js still stamps these in caps
 * for the Heritage frames and is not this screen's file to edit. Delete this
 * block once TEAMS_COPY carries sentence case at source.
 */
const SENTENCE_CASE = {
  statusForming: 'Forming',
  statusLocked: 'Locked',
  statusDisqualified: 'Disqualified',
  membersSuffix: 'members',
  youAreLeader: 'Leader',
  inviteCodeLabel: 'Invite code',
  copyCode: 'Copy',
  copied: 'Copied',
  lockTeam: 'Lock team',
};

/*
 * Three statuses, three tones. --accent for forming (in progress, not at risk —
 * this system has no warning colour and does not want one here), flat ink for
 * locked (the ordinary end state), --primary for disqualified.
 */
const STATUS_META = {
  forming: { label: SENTENCE_CASE.statusForming, className: 'dtm-status--forming' },
  locked: { label: SENTENCE_CASE.statusLocked, className: 'dtm-status--locked' },
  disqualified: {
    label: SENTENCE_CASE.statusDisqualified,
    className: 'dtm-status--disqualified',
  },
};

function InviteCodeRow({ inviteCode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="dtm-invite">
      <span>
        <span className="dtm-invite__label">{SENTENCE_CASE.inviteCodeLabel}</span>
        <span className="dtm-invite__code">{inviteCode}</span>
      </span>
      <button
        type="button"
        className="dtm-copy"
        onClick={() => {
          navigator.clipboard?.writeText(inviteCode).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            },
            () => {},
          );
        }}
      >
        {copied ? <CheckIcon size="sm" /> : <CopyIcon size="sm" />}
        {copied ? SENTENCE_CASE.copied : SENTENCE_CASE.copyCode}
      </button>
    </div>
  );
}

/*
 * The captaincy control.
 *
 * Claimed rather than assigned: whoever on the roster steps forward first takes
 * it, and the field then closes. So this renders one of three things and never a
 * button that cannot work — a claim button offered to a member of a team that
 * already has a captain would only ever produce a refusal.
 *
 * The server is the enforcement (team-service rejects a second claimant); this
 * is the matching UI, not the rule.
 */
function CaptainRow({ team, currentUserId, isOnline, onChanged }) {
  const [isWorking, setIsWorking] = useState(false);
  const [captainError, setCaptainError] = useState('');

  const captainId = team.captainUserId
    ? String(team.captainUserId.id ?? team.captainUserId)
    : null;
  const isCaptain = captainId && String(currentUserId) === captainId;
  const captainName =
    typeof team.captainUserId === 'object' ? team.captainUserId?.fullName ?? '' : '';

  async function runCaptainAction(action) {
    if (isWorking) {
      return;
    }
    setCaptainError('');
    setIsWorking(true);
    try {
      if (action === 'claim') {
        await apiClient.post(`/teams/${team.id}/claim-captain`);
      } else {
        await apiClient.delete(`/teams/${team.id}/claim-captain`);
      }
      await onChanged();
    } catch (error) {
      setCaptainError(error?.message || TEAM_CAPTAIN_COPY.claimFailed);
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div>
      <div className="dtm-captain">
        {isCaptain ? (
          <>
            <span className="dtm-captain__state dtm-captain__state--mine">
              <CaptainIcon size="sm" />
              {TEAM_CAPTAIN_COPY.youAreCaptain}
            </span>
            <button
              type="button"
              className="dtm-captain__resign"
              onClick={() => runCaptainAction('resign')}
              disabled={isWorking || !isOnline}
            >
              {TEAM_CAPTAIN_COPY.resign}
            </button>
          </>
        ) : captainId ? (
          <span className="dtm-captain__state">
            <CaptainIcon size="sm" />
            <span className="dtm-member__name">
              {TEAM_CAPTAIN_COPY.captainIs(captainName || '—')}
            </span>
          </span>
        ) : (
          <button
            type="button"
            className="dtm-ghost"
            onClick={() => runCaptainAction('claim')}
            disabled={isWorking || !isOnline}
          >
            <CaptainIcon size="sm" />
            {TEAM_CAPTAIN_COPY.becomeCaptain}
          </button>
        )}
      </div>

      {captainError ? (
        <p className="dtm-error" role="alert" style={{ marginTop: 'var(--s2)' }}>
          {captainError}
        </p>
      ) : null}
    </div>
  );
}

function TeamCard({ team, currentUserId, isOnline, offlineReason, onChanged }) {
  const event = team.eventId ?? {};
  const fest = event.festId ?? {};
  const isLeader = team.leaderUserId?.id === currentUserId;
  const statusMeta = STATUS_META[team.status] ?? STATUS_META.forming;

  const [isLocking, setIsLocking] = useState(false);
  const [lockError, setLockError] = useState('');

  async function handleLock() {
    if (isLocking) {
      return;
    }
    setLockError('');
    setIsLocking(true);
    try {
      await apiClient.post(`/teams/${team.id}/lock`);
      await onChanged();
    } catch (error) {
      if (error?.code === 'TEAM_BELOW_MINIMUM_SIZE' && error.details?.minimumTeamSize) {
        const missingCount = error.details.minimumTeamSize - (error.details.currentSize ?? 0);
        setLockError(TEAMS_COPY.needMoreMembers(missingCount));
      } else {
        setLockError(formatTeamErrorMessage(error, TEAMS_COPY.lockFailed));
      }
    } finally {
      setIsLocking(false);
    }
  }

  return (
    <article className="dtm-card">
      <div className="dtm-card__head">
        <div style={{ minWidth: 0 }}>
          <h3 className="dtm-card__event">{event.eventName}</h3>
          {fest.festName ? <p className="dtm-card__fest">{fest.festName}</p> : null}
        </div>
        <span className={`dtm-status ${statusMeta.className}`}>{statusMeta.label}</span>
      </div>

      <div className="dtm-facts">
        <span className="dtm-fact">
          <TeamIcon size="sm" />
          {team.teamName}
        </span>
        <span className="dtm-fact dtm-fact--muted">
          {team.memberUserIds?.length ?? 0}/{event.maximumTeamSize ?? '—'}{' '}
          {SENTENCE_CASE.membersSuffix}
        </span>
        {isLeader ? <span className="dtm-badge">{SENTENCE_CASE.youAreLeader}</span> : null}
      </div>

      {/* Members: a real list, because it is one. The leader carries the mark. */}
      <ul className="dtm-members" role="list">
        {(team.memberUserIds ?? []).map((member) => (
          <li className="dtm-member" key={member.id ?? member.participantId}>
            <UserAvatar user={member} size="small" />
            <span className="dtm-member__name">{member.fullName ?? member.participantId}</span>
            {member.id === team.leaderUserId?.id ? (
              <span className="dtm-member__mark" title={SENTENCE_CASE.youAreLeader}>
                <CaptainIcon size="sm" />
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {/* The code is shown only while it can still be redeemed — a FORMING team
          whose registration window closed would otherwise show a dead code. */}
      {team.isJoinable && team.inviteCode ? <InviteCodeRow inviteCode={team.inviteCode} /> : null}

      <CaptainRow
        team={team}
        currentUserId={currentUserId}
        isOnline={isOnline}
        onChanged={onChanged}
      />

      {isLeader && team.status === 'forming' ? (
        <div className="dtm-form" style={{ marginTop: 0 }}>
          {lockError ? (
            <p className="dtm-error" role="alert">
              {lockError}
            </p>
          ) : null}
          {!isOnline ? <p className="dtm-hint">{offlineReason}</p> : null}
          <button
            type="button"
            className="dtm-ghost"
            onClick={handleLock}
            disabled={isLocking || !isOnline}
          >
            <LockIcon size="sm" />
            {SENTENCE_CASE.lockTeam}
          </button>
        </div>
      ) : null}
    </article>
  );
}

export default TeamCard;

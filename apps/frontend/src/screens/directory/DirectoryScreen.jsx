// DirectoryScreen.jsx
// Route: /backstage/coordinator/events/:eventId/directory
//
// Everyone on one event, with the two things a coordinator actually does with a
// roster on the day: message them and call them. Solo events list people; team
// events list teams, and the card's call target is the CAPTAIN — leaderUserId,
// whoever registered the team and got the code — because they are the person a
// coordinator needs when the team is late.
//
// This screen shows phone numbers, which the public roster never does. Its data
// route sits behind the coordinator gate, so the numbers exist only here.
//
// THE ENDPOINT AND THE BROADCAST PAYLOAD ARE UNCHANGED. What changed is the
// markup around them, and one thing that was a genuine bug: the broadcast
// control used to be a `role="button"` span NESTED INSIDE the expand button,
// with a hand-rolled Enter handler. A button inside a button is invalid HTML,
// browsers resolve it inconsistently, and the span could not be activated with
// Space at all. The three controls are siblings now.

import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import {
  CollegeIcon,
  ExpandIcon,
  MailIcon,
  NotificationBroadcastIcon,
  PersonIcon,
  PhoneIcon,
  RetryIcon,
  TeamIcon,
} from '../../components/detail-icons/DetailIcons.jsx';

import { apiClient } from '../../api-client/api-client.js';
import '../../design/directory.css';

function initialsOf(name) {
  return (name ?? '')
    .split(' ')
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function DirectoryScreen() {
  const navigate = useTransitionNavigate();
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const festId = searchParams.get('festId') ?? '';

  const [entries, setEntries] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [openKeys, setOpenKeys] = useState(() => new Set());

  const loadDirectory = useCallback(async () => {
    setLoadState('loading');
    try {
      const result = await apiClient.get(`/fests/${festId}/events/${eventId}/directory`);
      setEntries(Array.isArray(result?.entries) ? result.entries : []);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [eventId, festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDirectory();
  }, [loadDirectory]);

  function toggleOpen(key) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /*
   * Broadcast pre-aimed at this card. The target rides in navigation state so
   * the Broadcast page can skip its audience sheet — the choice was already
   * made by which card was tapped.
   */
  function openBroadcast(entry) {
    const recipientUserIds =
      entry.kind === 'team' ? entry.memberUserIds : [entry.userId];
    navigate(`/backstage/coordinator/events/${eventId}/broadcast?festId=${festId}`, {
      state: {
        directTarget: {
          label: entry.kind === 'team' ? entry.teamName : entry.fullName,
          kind: entry.kind,
          memberCount: entry.kind === 'team' ? entry.members.length : 1,
          recipientUserIds,
        },
      },
    });
  }

  return (
    <div className="ddr-screen">
      {/* The bar IS the heading, so there is no <h1> below it. No bell either:
          this is a task page, not a destination. */}
      <ScreenHeader title="Directory" />

      <div className="ddr-col">
        {loadState === 'loading' ? (
          <ul className="ddr-list" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <li key={index} className="ddr-skeleton" />
            ))}
          </ul>
        ) : null}

        {loadState === 'error' ? (
          <div className="ddr-error">
            <p className="ddr-error__line">Could not load the directory.</p>
            <button type="button" onClick={loadDirectory} className="ddr-error__retry">
              <RetryIcon size="sm" />
              Try again
            </button>
          </div>
        ) : null}

        {loadState === 'ready' && entries.length === 0 ? (
          <EmptyState line="Nobody has registered for this event yet." />
        ) : null}

        {loadState === 'ready' && entries.length > 0 ? (
          <ul className="ddr-list">
            {entries.map((entry) => {
              const key = entry.kind === 'team' ? `team-${entry.teamId}` : `solo-${entry.userId}`;
              const isOpen = openKeys.has(key);
              const displayName = entry.kind === 'team' ? entry.teamName : entry.fullName;
              const rows = entry.kind === 'team' ? entry.members : [{ ...entry, isLeader: false }];

              return (
                <li key={key} className="ddr-entry">
                  <div className="ddr-entry__head">
                    <button
                      type="button"
                      onClick={() => toggleOpen(key)}
                      aria-expanded={isOpen}
                      aria-controls={`directory-panel-${key}`}
                      className="ddr-entry__toggle"
                    >
                      <span className="ddr-entry__text">
                        <span className="ddr-entry__name">{displayName}</span>
                        <span className="ddr-entry__meta">
                          {entry.kind === 'team' ? (
                            <TeamIcon size="sm" />
                          ) : (
                            <PersonIcon size="sm" />
                          )}
                          {entry.kind === 'team'
                            ? `${entry.members.length} members`
                            : 'Registered on their own'}
                        </span>
                      </span>
                      <span
                        className={
                          isOpen
                            ? 'ddr-entry__chevron ddr-entry__chevron--open'
                            : 'ddr-entry__chevron'
                        }
                      >
                        <ExpandIcon size="sm" />
                      </span>
                    </button>

                    {/* A real sibling <button>, not a span inside the one above. */}
                    <button
                      type="button"
                      onClick={() => openBroadcast(entry)}
                      aria-label={`Message ${displayName}`}
                      className="ddr-action ddr-action--send"
                    >
                      <NotificationBroadcastIcon size="sm" />
                    </button>

                    {/* Call. Hidden entirely when there is no number, the same
                        absent-means-hidden rule as the crew directory — a dead
                        call button at a venue is worse than no button. */}
                    {entry.phoneNumber ? (
                      <a
                        href={`tel:${entry.phoneNumber}`}
                        aria-label={
                          entry.kind === 'team'
                            ? `Call the ${entry.teamName} captain`
                            : `Call ${entry.fullName}`
                        }
                        className="ddr-action"
                      >
                        <PhoneIcon size="sm" />
                      </a>
                    ) : null}
                  </div>

                  {isOpen ? (
                    <div id={`directory-panel-${key}`} className="ddr-panel">
                      {entry.collegeName ? (
                        <p className="ddr-panel__college">
                          <CollegeIcon size="sm" />
                          {entry.collegeName}
                        </p>
                      ) : null}

                      <ul className="ddr-members">
                        {rows.map((member) => (
                          <li key={member.userId} className="ddr-member">
                            <span className="ddr-member__initials" aria-hidden="true">
                              {initialsOf(member.fullName)}
                            </span>
                            <span className="ddr-member__name">
                              <span>{member.fullName}</span>
                              {member.isLeader ? (
                                <span className="ddr-member__badge">Captain</span>
                              ) : null}
                            </span>
                            {member.emailAddress ? (
                              <a
                                href={`mailto:${member.emailAddress}`}
                                aria-label={`Email ${member.fullName}`}
                                className="ddr-member__mail"
                              >
                                <MailIcon size="sm" />
                              </a>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export default DirectoryScreen;

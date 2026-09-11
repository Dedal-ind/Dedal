// CrewDirectoryScreen.jsx
// Route: /fests/:festSlug/crew-directory — who is running this fest, and how to
// reach them.
//
// DATA FLOW IS UNCHANGED. The fest slug resolves to festId via
// GET /public/fests/:festSlug, then GET /fests/:festId/staff-directory (grouped
// by event) and the public event tree load in parallel. The by-event groups are
// still flattened here into one entry per person with their event names
// collected.
//
// WHO IS RUNNING THE FEST IS OPEN; HOW TO REACH THEM IS TIERED. The endpoint no
// longer refuses a caller who has not registered — it returns the roster to any
// signed-in visitor and omits phoneNumber/emailAddress unless they are fest
// staff or a confirmed participant. Knowing who oversees an event is part of
// deciding whether to register for it, so the old "Register for an event under
// this fest to view its crew directory" was answering the wrong question.
//
// WHAT CHANGED IS THE PRESENTATION. This was the last Heritage Institutional
// frame on the participant surface — a Playfair 32px title, brand-navy on
// brand-beige cards, a search field filled with a green gradient whose
// placeholder was centred until focus, ALL-CAPS tracked stat labels, and four
// `material-symbols-outlined` ligatures (mail, call, close, search) which
// render as those literal words until the webfont arrives and permanently
// where it is blocked. It is now on the dedal tokens, with lucide icons.
//
// A TITLE IS PASSED TO ScreenHeader, which it previously was not. A title is
// what tells the layout to stand the global app header down; without one this
// screen stacked the participant app header, a bare floating back arrow and its
// own <h1> into three bands before any content.
//
// THE SEARCH FILTERS BY EVENT NAME, as before — "who is running Manthan" is the
// question this screen is opened with. The placeholder now says so.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Mail, Phone, Search, X } from 'lucide-react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import apiClient from '../../api-client/api-client.js';
import InlineError from '../../components/inline-error/InlineError.jsx';
import UserAvatar from '../../components/user-avatar/UserAvatar.jsx';
import { CREW_DIRECTORY_COPY } from '../../brand/brand-copy.js';
import './crew-directory.css';

const STAFF_ROLES = { COORDINATOR: 'coordinator', VOLUNTEER: 'volunteer' };

const COPY = {
  title: 'Crew & contacts',
  searchPlaceholder: 'Search by event',
  clear: 'Clear search',
  coordinators: 'Coordinators',
  volunteers: 'Volunteers',
  statCoordinators: 'coordinators',
  statVolunteers: 'volunteers',
  empty: 'No crew listed yet.',
  emptyAction: 'Back to the fest',
  noMatch: (query) => `No events match “${query}”.`,
};

/*
 * One person. The contact actions are the point of the screen — a name with no
 * way to reach it is a list of strangers — so they are 44px targets rather than
 * the 24px glyphs they were.
 *
 * Phone and email are HIDDEN when absent, not disabled. The service omits the
 * fields entirely for a visitor who is neither staff nor a confirmed
 * participant, and absent means "not yours to have" — a different statement
 * from a staff member with no number on file. A greyed-out call button
 * advertises a capability that does not exist here.
 */
function CrewCard({ person }) {
  const hasPhone = Boolean(person.phoneNumber);
  const hasEmail = Boolean(person.emailAddress);

  return (
    <div className="dcw-card">
      <UserAvatar user={person} size="directory" />

      <span className="dcw-card__body">
        <span className="dcw-card__name">{person.fullName ?? '—'}</span>
        {person.assignmentLine ? (
          <span className="dcw-card__events">{person.assignmentLine}</span>
        ) : null}
      </span>

      {hasEmail || hasPhone ? (
        <span className="dcw-card__actions">
          {hasEmail ? (
            <a
              className="dcw-action"
              href={`mailto:${person.emailAddress}`}
              aria-label={`Email ${person.fullName ?? 'this crew member'}`}
            >
              <Mail size={20} aria-hidden="true" />
            </a>
          ) : null}
          {hasPhone ? (
            <a
              className="dcw-action"
              href={`tel:${person.phoneNumber}`}
              aria-label={`Call ${person.fullName ?? 'this crew member'}`}
            >
              <Phone size={20} aria-hidden="true" />
            </a>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function RoleSection({ heading, people }) {
  if (people.length === 0) {
    return null;
  }
  return (
    <section className="dcw-section">
      <div className="dcw-section__head">
        <h2 className="dcw-section__title">{heading}</h2>
        <span className="dcw-section__count">{people.length}</span>
      </div>
      {people.map((person) => (
        <CrewCard key={person.key} person={person} />
      ))}
    </section>
  );
}

function CrewDirectoryScreen() {
  const { festSlug } = useParams();
  const navigate = useTransitionNavigate();

  const [fest, setFest] = useState(null);
  const [groups, setGroups] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [query, setQuery] = useState('');

  const loadDirectory = useCallback(async () => {
    setLoadState('loading');
    try {
      const festDetail = await apiClient.get(`/public/fests/${festSlug}`);
      setFest(festDetail);
      // The event tree fetch remains for parity with the directory payload's
      // event grouping; it fails silently — breadcrumbs are a nicety.
      const [directory] = await Promise.all([
        apiClient.get(`/fests/${festDetail.id}/staff-directory`),
        apiClient.get(`/public/fests/${festDetail.id}/events?includeChildren=true`).catch(() => []),
      ]);
      setGroups(Array.isArray(directory) ? directory : []);
      setLoadState('ready');
    } catch (loadException) {
      /*
       * The registration gate is gone, so a PERMISSION_DENIED is no longer the
       * expected answer for an ordinary visitor. The branch is kept because the
       * server may still refuse for another reason, and a refusal is not a
       * failure: offering Retry against a door that will never open invites
       * somebody to keep tapping it.
       */
      setLoadState(loadException?.code === 'PERMISSION_DENIED' ? 'notRegistered' : 'error');
    }
  }, [festSlug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDirectory();
  }, [loadDirectory]);

  const normalisedQuery = query.trim().toLowerCase();

  // Flatten the by-event groups into one entry per person, collecting the
  // event names they cover into the assignment line.
  const people = useMemo(() => {
    const byUser = new Map();
    groups.forEach((group) => {
      group.staff.forEach((staff) => {
        const key = staff.userId ?? staff.participantId ?? staff.fullName;
        if (!byUser.has(key)) {
          byUser.set(key, { ...staff, key, eventNames: [] });
        }
        if (group.eventName && !byUser.get(key).eventNames.includes(group.eventName)) {
          byUser.get(key).eventNames.push(group.eventName);
        }
      });
    });
    return [...byUser.values()].map((person) => ({
      ...person,
      assignmentLine: person.eventNames.join(' · '),
    }));
  }, [groups]);

  // Filter by EVENT NAME only — "who is running Manthan" is the question.
  const filteredPeople = useMemo(
    () =>
      normalisedQuery
        ? people.filter((person) =>
            person.eventNames.some((eventName) =>
              eventName.toLowerCase().includes(normalisedQuery),
            ),
          )
        : people,
    [people, normalisedQuery],
  );

  const coordinators = filteredPeople.filter((person) => person.role === STAFF_ROLES.COORDINATOR);
  const volunteers = filteredPeople.filter((person) => person.role === STAFF_ROLES.VOLUNTEER);
  const coordinatorCount = people.filter(
    (person) => person.role === STAFF_ROLES.COORDINATOR,
  ).length;
  const volunteerCount = people.filter((person) => person.role === STAFF_ROLES.VOLUNTEER).length;

  return (
    <div className="dcw-screen">
      <ScreenHeader title={COPY.title} />

      <div className="dcw-page">
        {loadState === 'loading' ? (
          <>
            <div className="dcw-stats">
              <div className="dcw-skel dcw-skel--stat" />
              <div className="dcw-skel dcw-skel--stat" />
            </div>
            <div className="dcw-section">
              <div className="dcw-skel dcw-skel--card" />
              <div className="dcw-skel dcw-skel--card" />
              <div className="dcw-skel dcw-skel--card" />
            </div>
          </>
        ) : loadState === 'notRegistered' ? (
          /* Deliberately says nothing about the fest — not even its name. The
             caller has no standing here, so the screen reveals nothing and just
             says what would grant it. */
          <p className="dcw-note">{CREW_DIRECTORY_COPY.notRegisteredMessage}</p>
        ) : loadState === 'error' ? (
          <InlineError message={CREW_DIRECTORY_COPY.errorMessage} onRetry={loadDirectory} />
        ) : people.length === 0 ? (
          /*
            Short, and with somewhere to go. It read "Crew assigned to this fest
            will show up here" — a sentence explaining the component to the
            reader instead of telling them what to do next, and it left them on
            a dead screen with only the back arrow. Nobody can conjure crew, so
            the action is the way out: back to the fest they came from.
          */
          <div className="dcw-empty">
            <p className="dcw-note">{COPY.empty}</p>
            <button
              type="button"
              className="dcw-empty__action"
              onClick={() => navigate(`/fests/${festSlug}`)}
            >
              {COPY.emptyAction}
            </button>
          </div>
        ) : (
          <div className="dcw-list">
            {fest ? <p className="dcw-fest">{fest.festName}</p> : null}

            <div className="dcw-search">
              <Search size={18} className="dcw-search__icon" aria-hidden="true" />
              <input
                className="dcw-search__input"
                value={query}
                onChange={(changeEvent) => setQuery(changeEvent.target.value)}
                placeholder={COPY.searchPlaceholder}
                autoComplete="off"
                spellCheck={false}
                aria-label={COPY.searchPlaceholder}
              />
              {query ? (
                <button
                  type="button"
                  className="dcw-search__clear"
                  onClick={() => setQuery('')}
                  aria-label={COPY.clear}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <div className="dcw-stats">
              <div className="dcw-stat">
                <span className="dcw-stat__value">{coordinatorCount}</span>
                <span className="dcw-stat__label">{COPY.statCoordinators}</span>
              </div>
              <div className="dcw-stat">
                <span className="dcw-stat__value">{volunteerCount}</span>
                <span className="dcw-stat__label">{COPY.statVolunteers}</span>
              </div>
            </div>

            {filteredPeople.length === 0 ? (
              <p className="dcw-note">{COPY.noMatch(query.trim())}</p>
            ) : (
              <>
                <RoleSection heading={COPY.coordinators} people={coordinators} />
                <RoleSection heading={COPY.volunteers} people={volunteers} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CrewDirectoryScreen;

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
// THE DIRECTORY IS FOR PEOPLE WHO ARE AT THE FEST. The endpoint refuses a
// caller who holds neither an active assignment nor a confirmed registration in
// the fest, so PERMISSION_DENIED is an expected answer here and gets its own
// state rather than the error retry — see staff-directory-service for why the
// rule is a gate and not a contact-details tier.
//
// GROUPED BY EVENT, NOT BY ROLE. The question this screen is opened with is
// "who is running Manthan", so the event is the heading and the people sit
// under it; role is a pill on the row. Grouping by role instead put a flat list
// of forty volunteers in front of someone looking for one event's crew, with
// the event names squeezed onto a secondary line.
//
// A PERSON APPEARS UNDER EVERY EVENT THEY COVER, deliberately. A coordinator on
// a parent vertical really is the coordinator of each of its sub-events, and
// collapsing them to a single row filed under the parent means a reader looking
// at the sub-event sees nobody.
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
// THE SEARCH MATCHES A PERSON'S NAME OR AN EVENT'S NAME. Both are things the
// reader arrives already knowing one of: they either want a named person or
// they want whoever is running a named event.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Mail, Phone, Search, X } from 'lucide-react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import apiClient from '../../api-client/api-client.js';
import InlineError from '../../components/inline-error/InlineError.jsx';
import { CREW_DIRECTORY_COPY } from '../../brand/brand-copy.js';
import './crew-directory.css';

const STAFF_ROLES = { COORDINATOR: 'coordinator', VOLUNTEER: 'volunteer' };

const COPY = {
  title: 'Crew & contacts',
  searchPlaceholder: 'Search a name or an event',
  clear: 'Clear search',
  coordinator: 'Coordinator',
  volunteer: 'Volunteer',
  statCoordinators: 'coordinators',
  statVolunteers: 'volunteers',
  empty: 'No crew assigned yet.',
  emptyAction: 'Back to the fest',
  notRegisteredAction: 'Browse events',
  noMatch: (query) => `Nothing matches “${query}”.`,
};

/*
 * One person. The contact actions are the point of the screen — a name with no
 * way to reach it is a list of strangers — so they are 44px targets rather than
 * the 24px glyphs they were.
 *
 * THE NUMBER AND THE ADDRESS ARE NEVER RENDERED AS TEXT, only as the icon that
 * opens them. A phone number on screen is a phone number that gets screenshotted
 * and forwarded; a `tel:` link does the one thing the reader actually wants and
 * leaves the value in the markup where it belongs. The volunteer gave us a
 * number so participants could reach them, not so it could be published.
 *
 * An action is HIDDEN when its field is null, not disabled. A greyed-out call
 * button advertises a capability that does not exist. With neither, the row is
 * just a name and a role — still worth showing, because knowing who is running
 * the event is useful even when you cannot ring them.
 */
function CrewRow({ person }) {
  const hasPhone = Boolean(person.phoneNumber);
  const hasEmail = Boolean(person.emailAddress);
  const roleLabel = person.role === STAFF_ROLES.COORDINATOR ? COPY.coordinator : COPY.volunteer;

  return (
    <div className="dcw-card">
      <span className="dcw-card__body">
        <span className="dcw-card__name">{person.fullName ?? '—'}</span>
        <span className="dcw-role">{roleLabel}</span>
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

function EventSection({ group }) {
  return (
    <section className="dcw-section">
      <div className="dcw-section__head">
        <h2 className="dcw-section__title">{group.eventName}</h2>
        <span className="dcw-section__count">{group.staff.length}</span>
      </div>
      {group.staff.map((person, index) => (
        /*
         * Keyed on the group's event id plus position. The payload carries no
         * per-person id by design (see staff-directory-service), and a name is
         * not unique enough to key on — two volunteers called Rahul in the same
         * event would collide and React would reuse the wrong row.
         */
        <CrewRow key={`${group.eventId}:${index}`} person={person} />
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
       * PERMISSION_DENIED is the expected answer for somebody with no seat in
       * this fest, and a refusal is not a failure: offering Retry against a
       * door that will never open invites somebody to keep tapping it. So it
       * gets its own state, which says what would grant access instead.
       */
      setLoadState(loadException?.code === 'PERMISSION_DENIED' ? 'notRegistered' : 'error');
    }
  }, [festSlug]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDirectory();
  }, [loadDirectory]);

  const normalisedQuery = query.trim().toLowerCase();

  /*
   * FILTERED WITHOUT FLATTENING. The payload arrives grouped by event and the
   * screen renders it grouped by event, so there is nothing to flatten — the
   * previous version collapsed it into one row per person only to print the
   * event names back onto a secondary line.
   *
   * A query matches a group if the EVENT name matches, in which case the whole
   * crew is kept; otherwise the group survives only with the people whose names
   * match. Searching "Manthan" should show everyone running Manthan, and
   * searching "Rahul" should show Rahul wherever he is — one filter, both
   * questions, no mode switch for the reader to get wrong.
   */
  const visibleGroups = useMemo(() => {
    if (!normalisedQuery) {
      return groups;
    }
    return groups
      .map((group) => {
        if (String(group.eventName ?? '').toLowerCase().includes(normalisedQuery)) {
          return group;
        }
        const staff = group.staff.filter((person) =>
          String(person.fullName ?? '').toLowerCase().includes(normalisedQuery),
        );
        return staff.length > 0 ? { ...group, staff } : null;
      })
      .filter(Boolean);
  }, [groups, normalisedQuery]);

  /*
   * Counted over DISTINCT PEOPLE, not over rows.
   *
   * A person appears under every event they cover, which is right for the list
   * and wrong for a total: a coordinator of a vertical with six sub-events
   * would have counted as seven coordinators. There is no per-person id in the
   * payload, so the name is the identity available here — two genuinely
   * different people sharing a name undercount by one, which is a far smaller
   * error than multiplying every vertical coordinator by its child count.
   */
  const countByRole = useMemo(() => {
    const seen = { [STAFF_ROLES.COORDINATOR]: new Set(), [STAFF_ROLES.VOLUNTEER]: new Set() };
    groups.forEach((group) => {
      group.staff.forEach((person) => {
        seen[person.role]?.add(person.fullName ?? '');
      });
    });
    return {
      coordinators: seen[STAFF_ROLES.COORDINATOR].size,
      volunteers: seen[STAFF_ROLES.VOLUNTEER].size,
    };
  }, [groups]);

  const hasAnyCrew = groups.length > 0;

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
          /*
            Deliberately says nothing about the fest — not even its name. The
            caller has no standing here, so the screen reveals nothing and just
            says what would grant it.

            It DOES carry an action, though. "Register for an event under this
            fest" with no way to reach the events is an instruction that leaves
            the reader to find the door themselves; the fest page is where the
            registering happens, so that is where the button goes.
          */
          <div className="dcw-empty">
            <p className="dcw-note">{CREW_DIRECTORY_COPY.notRegisteredMessage}</p>
            <button
              type="button"
              className="dcw-empty__action"
              onClick={() => navigate(`/fests/${festSlug}`)}
            >
              {COPY.notRegisteredAction}
            </button>
          </div>
        ) : loadState === 'error' ? (
          <InlineError message={CREW_DIRECTORY_COPY.errorMessage} onRetry={loadDirectory} />
        ) : !hasAnyCrew ? (
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
                <span className="dcw-stat__value">{countByRole.coordinators}</span>
                <span className="dcw-stat__label">{COPY.statCoordinators}</span>
              </div>
              <div className="dcw-stat">
                <span className="dcw-stat__value">{countByRole.volunteers}</span>
                <span className="dcw-stat__label">{COPY.statVolunteers}</span>
              </div>
            </div>

            {visibleGroups.length === 0 ? (
              <p className="dcw-note">{COPY.noMatch(query.trim())}</p>
            ) : (
              visibleGroups.map((group) => <EventSection key={group.eventId} group={group} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default CrewDirectoryScreen;

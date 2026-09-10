// CrewDirectoryScreen.jsx
// Route: /fests/:festSlug/crew-directory — the fest's crew contact directory,
// Heritage Institutional (the "Crew Directory" Stitch frame): Playfair page
// title, pill search, coordinator/volunteer stat cards, then the crew grouped
// by ROLE — Coordinators (Core Team) and Volunteers (On-Ground) — each person
// once, with the events they cover as their assignment line.
//
// Data flow is unchanged: the fest slug resolves to festId via
// GET /public/fests/:festSlug, then GET /fests/:festId/staff-directory (grouped
// by event; phone/email only for the staff tier) and the public event tree load
// in parallel. The by-event groups are flattened here into one entry per person
// with their event names collected. Tapping a card reveals the phone number for
// three seconds (REVEAL_MS) — a privacy measure, phones are never permanently
// displayed; participants' payloads simply have no phone and nothing is
// invented.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import apiClient from '../../api-client/api-client.js';
import InlineError from '../../components/inline-error/InlineError.jsx';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import SkeletonBlock from '../../components/skeleton-block/SkeletonBlock.jsx';
import UserAvatar from '../../components/user-avatar/UserAvatar.jsx';
import { CREW_DIRECTORY_COPY } from '../../brand/brand-copy.js';

const STAFF_ROLES = { COORDINATOR: 'coordinator', VOLUNTEER: 'volunteer' };

// One person's card. The whole card is the reveal target; the contact icons are
// separate stop-propagation links so a mail tap never triggers the reveal.
function CrewCard({ person, accentClassName }) {
  const hasPhone = Boolean(person.phoneNumber);
  const hasEmail = Boolean(person.emailAddress);

  return (
    <div
      className={[
        'rounded-xl border border-brand-brown/15 border-l-[3px] bg-brand-beige p-4',
        accentClassName,
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <UserAvatar user={person} size="directory" />
        <div className="min-w-0 flex-1">
          <span className="block truncate font-body text-[18px] font-semibold leading-6 text-brand-navy">
            {person.fullName ?? '—'}
          </span>
          {person.assignmentLine ? (
            <span className="block truncate font-body text-[13px] leading-[18px] text-brand-primary/60">
              {person.assignmentLine}
            </span>
          ) : null}
        </div>
        <span className="flex shrink-0 items-center gap-1">
          {hasEmail ? (
            <a
              href={`mailto:${person.emailAddress}`}
              aria-label={`${CREW_DIRECTORY_COPY.email} ${person.fullName ?? ''}`}
              className="flex h-11 w-11 items-center justify-center rounded-pill text-brand-primary transition-colors active:bg-brand-secondary/10"
            >
              <span className="material-symbols-outlined text-[24px]" aria-hidden="true">
                mail
              </span>
            </a>
          ) : null}
          {/*
            * Hidden, not disabled. The service omits phone and email entirely
            * for participants — absent means "you may not have this", which is
            * different from a staff member who simply has no number on file.
            * A greyed-out call icon advertised a capability participants do not
            * have and made the card look broken.
            */}
          {hasPhone ? (
            <a
              href={`tel:${person.phoneNumber}`}
              aria-label={`${CREW_DIRECTORY_COPY.call} ${person.fullName ?? ''}`}
              className="flex h-11 w-11 items-center justify-center rounded-pill text-brand-primary transition-colors active:bg-brand-secondary/10"
            >
              <span className="material-symbols-outlined text-[24px]" aria-hidden="true">
                call
              </span>
            </a>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function RoleSection({ heading, badge, people, accentClassName }) {
  if (people.length === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[24px] font-bold leading-8 text-brand-navy">{heading}</h2>
        <span className="rounded-pill bg-brand-secondary/20 px-3 py-1 font-body text-[12px] font-semibold leading-4 text-brand-primary">
          {badge}
        </span>
      </div>
      {people.map((person) => (
        <CrewCard key={person.key} person={person} accentClassName={accentClassName} />
      ))}
    </section>
  );
}

function CrewDirectoryScreen() {
  const { festSlug } = useParams();

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
       * A refusal is not a failure. The directory is gated on having a confirmed
       * registration in this fest, so a 403 means "not yours to see" — and
       * offering Retry there invites someone to keep tapping at a door that will
       * never open.
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

  // Filter by EVENT NAME only — show crew members whose assigned events
  // match the search query.
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
  const coordinatorCount = people.filter((person) => person.role === STAFF_ROLES.COORDINATOR).length;
  const volunteerCount = people.filter((person) => person.role === STAFF_ROLES.VOLUNTEER).length;

  return (
    <div className="min-h-screen bg-background pb-6">
      <ScreenHeader />

      <div className="flex flex-col gap-5 px-5 pb-6 pt-6">
        <h2 className="font-display text-[32px] font-bold leading-10 text-brand-navy">
          {CREW_DIRECTORY_COPY.pageTitle}
        </h2>

        {/* Search — exactly like home page, searches events only */}
        <div className="flex h-12 w-full items-center gap-3 rounded-[14px] bg-gradient-to-r from-brand-secondary/20 to-brand-primary/15 px-4">
          <input
            value={query}
            onChange={(changeEvent) => setQuery(changeEvent.target.value)}
            placeholder="Search events..."
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-grow bg-transparent font-body text-[14px] leading-[22px] text-brand-primary outline-none placeholder:text-brand-primary/60 placeholder:text-center focus:placeholder:text-left focus:outline-none focus:ring-0"
            data-search-input
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear"
              className="flex shrink-0 items-center justify-center active:scale-95"
            >
              <span className="material-symbols-outlined text-[20px] text-brand-primary/50" aria-hidden="true">
                close
              </span>
            </button>
          ) : null}
          {/* Search icon — RIGHT side. Tap to dismiss keyboard. */}
          <button
            type="button"
            onClick={() => document.activeElement?.blur()}
            className="flex shrink-0 items-center justify-center active:scale-95"
          >
            <span className="material-symbols-outlined text-[22px] text-brand-primary" aria-hidden="true">
              search
            </span>
          </button>
        </div>

        {loadState === 'loading' ? (
          <>
            <SkeletonBlock className="h-20 w-full" />
            <SkeletonBlock className="h-40 w-full" />
          </>
        ) : loadState === 'notRegistered' ? (
          /* Deliberately says nothing about the fest — not even its name. The
             caller has no standing here, so the screen reveals nothing and just
             says what would grant it. */
          <p className="px-6 py-16 text-center font-body text-[14px] leading-[22px] text-on-surface-variant">
            {CREW_DIRECTORY_COPY.notRegisteredMessage}
          </p>
        ) : loadState === 'error' ? (
          <InlineError message={CREW_DIRECTORY_COPY.errorMessage} onRetry={loadDirectory} />
        ) : (
          <>
            {/* Fest name — which directory this is */}
            {fest ? (
              <p className="-mt-2 font-body text-[12px] font-bold uppercase leading-4 tracking-label-caps text-brand-primary/60">
                {fest.festName}
              </p>
            ) : null}

            {people.length === 0 ? (
              <EmptyState line="Crew assigned to this fest will show up here." />
            ) : (
              <>
                {/* Stats */}
                <div className="flex gap-3">
                  <div className="flex-1 rounded-xl border border-brand-brown/15 bg-brand-beige p-4 text-center">
                    <p className="font-body text-[32px] font-bold leading-10 text-brand-navy">
                      {coordinatorCount}
                    </p>
                    <p className="font-body text-[11px] font-bold uppercase leading-4 tracking-label-caps text-brand-primary/60">
                      {CREW_DIRECTORY_COPY.statCoordinators}
                    </p>
                  </div>
                  <div className="flex-1 rounded-xl border border-brand-brown/15 bg-brand-beige p-4 text-center">
                    <p className="font-body text-[32px] font-bold leading-10 text-brand-navy">
                      {volunteerCount}
                    </p>
                    <p className="font-body text-[11px] font-bold uppercase leading-4 tracking-label-caps text-brand-primary/60">
                      {CREW_DIRECTORY_COPY.statVolunteers}
                    </p>
                  </div>
                </div>

                {filteredPeople.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="font-display text-[20px] font-bold leading-[28px] text-brand-navy">
                      No events match &ldquo;{query}&rdquo;
                    </p>
                  </div>
                ) : (
                  <>
                    <RoleSection
                      heading={CREW_DIRECTORY_COPY.sectionCoordinators}
                      badge={CREW_DIRECTORY_COPY.badgeCoordinators}
                      people={coordinators}
                      accentClassName="border-l-secondary-container"
                    />
                    <RoleSection
                      heading={CREW_DIRECTORY_COPY.sectionVolunteers}
                      badge={CREW_DIRECTORY_COPY.badgeVolunteers}
                      people={volunteers}
                      accentClassName="border-l-surface-container-high"
                    />
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default CrewDirectoryScreen;

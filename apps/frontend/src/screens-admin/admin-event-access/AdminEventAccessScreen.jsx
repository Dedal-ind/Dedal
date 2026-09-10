// AdminEventAccessScreen.jsx
// Route: /admin/events/access — the fest's events, and everything an organiser
// does to one after it is live.
//
// THERE IS NO PUBLISH BUTTON HERE, deliberately. Publishing is part of writing
// the event: the edit form's one commit is "Save changes & publish", so an edit
// is live the moment it is saved and there is no half-state where an admin has
// saved a correction that participants cannot see. A separate Publish step on
// this screen only ever produced that half-state.
//
// FOUR ACTIONS THAT SOUND ALIKE AND ARE NOT:
//   · CLOSE REGISTRATION — stop taking new sign-ups. Reversible, per event,
//     changes nothing for anyone already registered.
//   · CANCEL — the event is called off. Registrations end, refunds are marked,
//     staff released. Permanent.
//   · DELETE — the event should not be listed. It vanishes from the participant
//     app and takes no more sign-ups, but every existing registration, payment,
//     team and pass is left exactly as it was.
//   · NOTIFY — tell the people who signed up something.
// The menu shows only the ones that are legal for an event in its current state,
// so "cancelled" simply cannot be edited or reopened from here — the rule is
// enforced by what is offered, not by an error after the fact.
//
// Contract (verified against backend routes/services):
//   · GET    /fests/mine, /fests/:festId/events/all
//   · PATCH  /fests/:festId/events/:eventId        → edit (publishes on save)
//   · POST   /fests/:festId/events/:eventId/publish (only for a DRAFT event)
//   · POST   .../close-registration | .../reopen-registration
//   · POST   .../cancel
//   · DELETE .../soft                              → withdraw, registrations kept
//   · POST   /fests/:festId/close-registration | /reopen-registration (fest-wide)
//   · GET/POST .../notify-participants             → preview, then send

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, MapPin, Users } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminHierarchyFilter from '../../components-admin/admin-hierarchy-filter/AdminHierarchyFilter.jsx';
import { useAdminHierarchyScope } from '../../hooks/useAdminHierarchyScope.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveInput from '../../components-admin/admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveTextarea from '../../components-admin/admin-executive-textarea/AdminExecutiveTextarea.jsx';
import AdminExecutiveChip from '../../components-admin/admin-executive-chip/AdminExecutiveChip.jsx';
import AdminActionsMenu from '../../components-admin/admin-actions-menu/AdminActionsMenu.jsx';
import AdminModal from '../../components-admin/admin-modal/AdminModal.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import AdminContingentSection from '../../components-admin/admin-contingent-section/AdminContingentSection.jsx';
import { formatDateRange } from '../../helpers/admin-format.js';

const COPY = {
  pageTitle: 'Event access',
  intro:
    'Every event of this fest and what you can do to it. Closing registration is reversible; cancelling and deleting are not.',
  chooseFest: 'Choose a fest to manage its events.',
  noEvents: 'This fest has no events yet.',
  searchEventsPlaceholder: 'Search events…',
  noEventsMatchSearch: 'No events match your search.',
  loadFailed: 'The events could not be loaded.',

  // Badges
  badgeOpen: 'Registration open',
  badgeClosed: 'Registration closed',
  badgeCancelled: 'Cancelled',
  badgeDeleted: 'Deleted',
  badgeDraft: 'Draft',

  // Menu items
  editEvent: 'Edit event',
  closeRegistration: 'Close registration',
  reopenRegistration: 'Reopen registration',
  cancelEvent: 'Cancel event',
  deleteEvent: 'Delete event',
  notifyParticipants: 'Notify participants',

  // Fest-level
  festActions: 'Fest actions',
  closeAll: 'Close all registrations',
  reopenAll: 'Reopen all registrations',
  closeAllTitle: 'Close registration for every event?',
  closeAllBody: (festName) =>
    `Every event under ${festName} stops taking new sign-ups. Nobody already registered is affected, and you can reopen any event individually afterwards.`,
  reopenAllTitle: 'Reopen registration for every event?',
  reopenAllBody: (festName) =>
    `Every event under ${festName} starts taking sign-ups again. Cancelled and deleted events are skipped — those are final.`,
  festResult: (changed, skipped) =>
    `${changed} event${changed === 1 ? '' : 's'} updated${skipped > 0 ? `, ${skipped} skipped (cancelled or deleted)` : ''}.`,

  // Close / reopen one event
  closeTitle: (eventName) => `Close registration for ${eventName}?`,
  closeBody:
    'Participants will no longer be able to register. Everyone already registered keeps their place, their payment and their pass. You can reopen this at any time.',
  closeConfirm: 'Close registration',
  reopenTitle: (eventName) => `Reopen registration for ${eventName}?`,
  reopenBody: 'This event starts accepting new registrations again.',
  reopenConfirm: 'Reopen registration',

  // Cancel
  cancelTitle: (eventName) => `Cancel ${eventName}?`,
  cancelBody:
    'The event is called off. Everyone registered is notified, their registrations end, refunds are marked where money was taken, and assigned staff are released. This is permanent — a cancelled event cannot be reactivated from this screen.',
  cancelConfirm: 'Cancel event',

  // Delete
  deleteTitle: (eventName) => `Delete ${eventName}?`,
  deleteBody:
    'The event stops appearing in the participant app and takes no more registrations. Everyone already registered is notified by email and in their inbox — their registrations, payments, teams and passes are left untouched. If money is owed back, cancel the event instead.',
  deleteConfirm: 'Delete event',

  // Every confirmation's abort button. NOT "Cancel": on the cancel-event dialog
  // a button reading "Cancel" beside "Cancel event" is a coin toss.
  goBack: 'Go back',

  // Edit
  editTitle: (eventName) => `Edit ${eventName}`,
  editIntro:
    'Saving publishes immediately — participants see the change at once. Existing registrations, payments, teams and passes are not affected.',
  saveAndPublish: 'Save changes & publish',
  editSaved: 'Event updated. The changes are live.',
  fieldName: 'Event name',
  fieldDescription: 'Description',
  fieldRules: 'Rules',
  fieldVenue: 'Venue',
  fieldCapacity: 'Capacity',
  capacityHelp: 'Leave blank for unlimited.',
  fieldStartsAt: 'Starts at',
  fieldEndsAt: 'Ends at',
  fieldFee: 'Entry fee (₹)',
  feeHelp: 'Zero for a free event.',
  fieldRegistrationCloses: 'Registration deadline (shown to participants)',
  registrationClosesHelp:
    'Displayed as a deadline only. It does not close registration by itself — use Close registration for that.',

  // Notify
  notifyTitle: (eventName) => `Notify ${eventName}`,
  notifySubjectLabel: 'Subject',
  notifyMessageLabel: 'Message',
  notifyChannels: 'Send through',
  notifyEmail: 'Email',
  notifyInbox: 'In-app inbox',
  notifyRecipients: (count, eventName) =>
    `This goes to ${count} registered participant${count === 1 ? '' : 's'} of ${eventName}.`,
  notifyNoChannel: 'Choose at least one channel.',
  notifySend: 'Send notification',
  notifySent: (count) => `Notification sent to ${count} participant${count === 1 ? '' : 's'}.`,
  notifyBudget: (remaining) => `${remaining} bulk email${remaining === 1 ? '' : 's'} left today.`,

  actionFailed: 'That action could not be completed.',
};

/*
 * A parent event's eligible sub-events: published, solo, and directly under it.
 * Lifted straight from the screen this rebuilt so the two cannot disagree about
 * what makes a bundle possible.
 */
function countEligibleSubEvents(allEvents, parentEvent) {
  if (!parentEvent?.id) {
    return 0;
  }
  return allEvents.filter(
    (candidate) =>
      String(candidate.parentEventId) === String(parentEvent.id) &&
      candidate.status === 'published' &&
      candidate.eventType === 'solo',
  ).length;
}

function toDatetimeLocal(isoString) {
  if (!isoString) {
    return '';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  // Shifted into the admin's own timezone so the field shows the venue clock,
  // not UTC — a datetime-local input has no timezone of its own.
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/*
 * The two badges an event carries, as one row. They are separate facts and are
 * shown separately: an event can be published with registration closed, and
 * collapsing that into one pill loses the distinction the whole screen is about.
 */
function EventBadges({ event }) {
  if (event.status === 'deleted') {
    return <AdminExecutiveChip tone="neutral">{COPY.badgeDeleted}</AdminExecutiveChip>;
  }
  if (event.status === 'cancelled') {
    return <AdminExecutiveChip tone="error">{COPY.badgeCancelled}</AdminExecutiveChip>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {event.status === 'draft' ? (
        <AdminExecutiveChip tone="neutral">{COPY.badgeDraft}</AdminExecutiveChip>
      ) : null}
      <AdminExecutiveChip tone={event.registrationStatus === 'closed' ? 'warning' : 'success'}>
        {event.registrationStatus === 'closed' ? COPY.badgeClosed : COPY.badgeOpen}
      </AdminExecutiveChip>
    </span>
  );
}

function AdminEventAccessScreen() {
  const [searchParameters] = useSearchParams();
  const [fests, setFests] = useState([]);
  const { scope, handleScopeChange, setScope } = useAdminHierarchyScope(
    searchParameters.get('festId') ?? '',
  );
  const festId = scope.festId;

  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('idle');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  // { kind, event } for a confirmation; the edit and notify panels have their own.
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [reopenSchedule, setReopenSchedule] = useState({
    startsAt: '', endsAt: '', registrationOpensAt: '', registrationClosesAt: '',
  });
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [notifyTarget, setNotifyTarget] = useState(null);

  useEffect(() => {
    let isActive = true;
    apiClient
      .get('/fests/mine')
      .then((list) => {
        if (!isActive) {
          return;
        }
        const safe = Array.isArray(list) ? list : [];
        setFests(safe);
        setScope((previous) => ({
          ...previous,
          festId: previous.festId || (safe.length === 1 ? safe[0].id : ''),
        }));
      })
      .catch(() => isActive && setFests([]));
    return () => {
      isActive = false;
    };
  }, [setScope]);

  const loadEvents = useCallback(async () => {
    if (!festId) {
      setEvents([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    setLoadError('');
    try {
      const result = await apiClient.get(`/fests/${festId}/events/all`);
      setEvents(Array.isArray(result) ? result : (result?.events ?? []));
      setStatus('ready');
    } catch (error) {
      setLoadError(error?.message || COPY.loadFailed);
      setStatus('error');
    }
  }, [festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotice('');
    setActionError('');
    loadEvents();
  }, [loadEvents]);

  const selectedFest = fests.find((fest) => fest.id === festId) ?? null;

  /*
   * Deleted events are hidden rather than greyed out. The action list for a
   * deleted event is empty, so a visible row would be a permanent piece of
   * furniture nobody can act on — and the fest's event list is the wrong place
   * to keep a tombstone. The audit trail holds the record.
   */
  const visibleEvents = useMemo(
    () => events.filter((event) => event.status !== 'deleted'),
    [events],
  );

  const [eventSearch, setEventSearch] = useState('');

  /*
   * Case-insensitive, matched on eventName — the field the list actually renders.
   * Matching on anything else is how a search box ends up looking broken: the
   * admin types what they can see and gets nothing back.
   *
   * An empty box is not a filter, so it returns the full list rather than
   * matching the empty string against every row.
   */
  const searchedEvents = useMemo(() => {
    const query = eventSearch.trim().toLowerCase();
    if (query.length === 0) {
      return visibleEvents;
    }
    return visibleEvents.filter((event) =>
      String(event.eventName ?? '').toLowerCase().includes(query),
    );
  }, [visibleEvents, eventSearch]);

  /*
   * Which events can carry a contingent bundle: those with at least two
   * PUBLISHED SOLO sub-events. That is the pre-rebuild rule, restored verbatim —
   * a bundle is a discount across several of one event's solo sub-events, so one
   * sub-event is not a bundle and a team sub-event is not claimable individually.
   *
   * Cancelled and deleted parents are excluded: neither can take new claims, so
   * offering a bundle builder on them would only produce a dead bundle.
   */
  const parentEventsWithContingents = useMemo(
    () =>
      visibleEvents.filter(
        (event) =>
          event.status !== 'cancelled' && countEligibleSubEvents(events, event) >= 2,
      ),
    [visibleEvents, events],
  );

  async function runAction(request, successNotice) {
    setIsBusy(true);
    setActionError('');
    setNotice('');
    try {
      const result = await request();
      setNotice(typeof successNotice === 'function' ? successNotice(result) : successNotice);
      await loadEvents();
      return true;
    } catch (error) {
      setActionError(error?.message || COPY.actionFailed);
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmAction() {
    if (!confirmTarget) {
      return;
    }
    const { kind, event } = confirmTarget;
    const base = `/fests/${festId}/events/${event?.id}`;
    const ran = await runAction(
      () => {
        if (kind === 'close') return apiClient.post(`${base}/close-registration`);
        if (kind === 'reopen') return apiClient.post(`${base}/reopen-registration`);
        if (kind === 'cancel') return apiClient.post(`${base}/cancel`);
        if (kind === 'delete') return apiClient.delete(`${base}/soft`);
        if (kind === 'reopenCancelled') return apiClient.post(`${base}/reopen`, reopenSchedule);
        if (kind === 'closeAll') return apiClient.post(`/fests/${festId}/close-registration`);
        return apiClient.post(`/fests/${festId}/reopen-registration`);
      },
      (result) => {
        if (kind === 'closeAll' || kind === 'reopenAll') {
          return COPY.festResult(result?.eventsChanged ?? 0, result?.eventsSkippedFinal ?? 0);
        }
        return `${event.eventName} updated.`;
      },
    );
    if (ran) {
      setConfirmTarget(null);
      setReopenSchedule({ startsAt: '', endsAt: '', registrationOpensAt: '', registrationClosesAt: '' });
    }
  }

  function openEdit(event) {
    setEditTarget(event);
    setEditForm({
      eventName: event.eventName ?? '',
      description: event.description ?? '',
      rules: event.rules ?? '',
      venue: event.venue ?? '',
      capacity: event.capacity === null || event.capacity === undefined ? '' : String(event.capacity),
      startsAt: toDatetimeLocal(event.startsAt),
      endsAt: toDatetimeLocal(event.endsAt),
      registrationClosesAt: toDatetimeLocal(event.registrationClosesAt),
      feeRupees: String((event.feeAmountPaise ?? 0) / 100),
    });
  }

  /*
   * ONE commit: save and publish. A PATCH followed by a publish only when the
   * event is still a DRAFT — publishing an already-published event is refused by
   * the backend (assertEventPublishable), so calling it unconditionally would
   * turn every ordinary edit into an error after the save had already landed.
   */
  async function saveEdit() {
    if (!editTarget || !editForm) {
      return;
    }
    const payload = {
      eventName: editForm.eventName.trim(),
      description: editForm.description.trim() || null,
      rules: editForm.rules.trim() || null,
      venue: editForm.venue.trim(),
      capacity: editForm.capacity.trim() === '' ? null : Number(editForm.capacity),
      startsAt: editForm.startsAt ? new Date(editForm.startsAt).toISOString() : undefined,
      endsAt: editForm.endsAt ? new Date(editForm.endsAt).toISOString() : undefined,
      registrationClosesAt: editForm.registrationClosesAt
        ? new Date(editForm.registrationClosesAt).toISOString()
        : undefined,
      feeAmountPaise: Math.round(Number(editForm.feeRupees || 0) * 100),
    };
    const ran = await runAction(async () => {
      await apiClient.patch(`/fests/${festId}/events/${editTarget.id}`, payload);
      if (editTarget.status === 'draft') {
        await apiClient.post(`/fests/${festId}/events/${editTarget.id}/publish`);
      }
      return null;
    }, COPY.editSaved);
    if (ran) {
      setEditTarget(null);
      setEditForm(null);
    }
  }

  /*
   * What this event may legally have done to it. Built from status rather than
   * shown-and-disabled: a cancelled event offering a greyed-out "Reopen
   * registration" suggests a permission problem rather than a permanent state.
   */
  function buildMenuItems(event) {
    if (event.status === 'deleted') {
      return [];
    }
    if (event.status === 'cancelled') {
      return [
        {
          key: 'reopenCancelled',
          label: COPY.reopenEvent ?? 'Reopen Event',
          onSelect: () => setConfirmTarget({ kind: 'reopenCancelled', event }),
        },
        {
          key: 'notify',
          label: COPY.notifyParticipants,
          onSelect: () => setNotifyTarget(event),
        },
        {
          key: 'delete',
          label: COPY.deleteEvent,
          tone: 'danger',
          onSelect: () => setConfirmTarget({ kind: 'delete', event }),
        },
      ];
    }

    const items = [{ key: 'edit', label: COPY.editEvent, onSelect: () => openEdit(event) }];
    if (event.registrationStatus === 'closed') {
      items.push({
        key: 'reopen',
        label: COPY.reopenRegistration,
        onSelect: () => setConfirmTarget({ kind: 'reopen', event }),
      });
    } else {
      items.push({
        key: 'close',
        label: COPY.closeRegistration,
        onSelect: () => setConfirmTarget({ kind: 'close', event }),
      });
    }
    items.push(
      {
        key: 'notify',
        label: COPY.notifyParticipants,
        onSelect: () => setNotifyTarget(event),
      },
      {
        key: 'cancel',
        label: COPY.cancelEvent,
        tone: 'danger',
        onSelect: () => setConfirmTarget({ kind: 'cancel', event }),
      },
      {
        key: 'delete',
        label: COPY.deleteEvent,
        tone: 'danger',
        onSelect: () => setConfirmTarget({ kind: 'delete', event }),
      },
    );
    return items;
  }

  const confirmCopy = (() => {
    if (!confirmTarget) {
      return {};
    }
    if (confirmTarget.kind === 'reopenCancelled') {
      return {
        title: COPY.reopenEventModalTitle ?? 'Reopen this cancelled event?',
        body: typeof COPY.reopenEventModalBody === 'function'
          ? COPY.reopenEventModalBody(confirmTarget.event?.eventName ?? '')
          : 'This event comes back as a DRAFT on the new schedule, with registrations, staff and passes restored.',
        confirmLabel: COPY.reopenEvent ?? 'Reopen Event',
        tone: 'primary',
      };
    }
    const { kind, event } = confirmTarget;
    const festName = selectedFest?.festName ?? 'this fest';
    return {
      close: { title: COPY.closeTitle(event?.eventName), body: COPY.closeBody, confirm: COPY.closeConfirm, tone: 'primary' },
      reopen: { title: COPY.reopenTitle(event?.eventName), body: COPY.reopenBody, confirm: COPY.reopenConfirm, tone: 'primary' },
      cancel: { title: COPY.cancelTitle(event?.eventName), body: COPY.cancelBody, confirm: COPY.cancelConfirm, tone: 'danger' },
      delete: { title: COPY.deleteTitle(event?.eventName), body: COPY.deleteBody, confirm: COPY.deleteConfirm, tone: 'danger' },
      closeAll: { title: COPY.closeAllTitle, body: COPY.closeAllBody(festName), confirm: COPY.closeAll, tone: 'primary' },
      reopenAll: { title: COPY.reopenAllTitle, body: COPY.reopenAllBody(festName), confirm: COPY.reopenAll, tone: 'primary' },
    }[kind] ?? {};
  })();

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-6">
      <AdminErrorBanner message={loadError || actionError} />
      {notice ? (
        <div
          role="status"
          className="rounded-md border border-admin-status-success-green/30 bg-admin-status-success-green/5 px-4 py-3 font-admin-body text-[14px] leading-5 text-admin-status-success-green"
        >
          {notice}
        </div>
      ) : null}

      {/* Fest only: this screen acts on every event of one fest, so narrowing to
          a single event would hide the list it exists to show. */}
      <AdminHierarchyFilter
        fests={fests}
        selectedFestId={scope.festId}
        selectedEventId=""
        selectedSubEventId=""
        onChange={(next) => handleScopeChange({ festId: next.festId, eventId: '', subEventId: '' })}
      />

      {!festId ? (
        <AdminExecutiveCard>
          <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.chooseFest}</p>
        </AdminExecutiveCard>
      ) : status === 'loading' ? (
        <div className="flex h-[30vh] items-center justify-center">
          <span
            aria-label="Loading"
            className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
          />
        </div>
      ) : (
        <>
          {/* Fest-wide switches, beside the fest they act on. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-admin-slate-200 bg-admin-surface-white px-5 py-3">
            <span className="min-w-0">
              <span className="block truncate font-admin-body text-[15px] font-semibold text-admin-neutral-ink">
                {selectedFest?.festName ?? '—'}
              </span>
              <span className="block font-admin-mono text-[12px] text-admin-slate-600">
                {visibleEvents.length} event{visibleEvents.length === 1 ? '' : 's'}
              </span>
            </span>
            <AdminActionsMenu
              label={COPY.festActions}
              items={[
                {
                  key: 'closeAll',
                  label: COPY.closeAll,
                  onSelect: () => setConfirmTarget({ kind: 'closeAll' }),
                },
                {
                  key: 'reopenAll',
                  label: COPY.reopenAll,
                  onSelect: () => setConfirmTarget({ kind: 'reopenAll' }),
                },
              ]}
            />
          </div>

          {/* Filters the list below as the admin types; never refetches. */}
          {visibleEvents.length > 0 ? (
            <AdminExecutiveInput
              type="search"
              value={eventSearch}
              onChange={(changeEvent) => setEventSearch(changeEvent.target.value)}
              placeholder={COPY.searchEventsPlaceholder}
              aria-label={COPY.searchEventsPlaceholder}
            />
          ) : null}

          {visibleEvents.length === 0 ? (
            <AdminExecutiveCard>
              <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.noEvents}</p>
            </AdminExecutiveCard>
          ) : searchedEvents.length === 0 ? (
            /* Distinct from "no events": the fest has events, this search has no
               hits, and the admin needs to know which of the two they are in. */
            <AdminExecutiveCard>
              <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">
                {COPY.noEventsMatchSearch}
              </p>
            </AdminExecutiveCard>
          ) : (
            <ul className="flex flex-col gap-3">
              {searchedEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-admin-slate-200 bg-admin-surface-white px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-admin-body text-[15px] font-semibold text-admin-neutral-ink">
                        {event.eventName}
                      </span>
                      <EventBadges event={event} />
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-admin-mono text-[12px] text-admin-slate-600">
                      {event.startsAt ? (
                        <span className="flex items-center gap-1">
                          <CalendarClock size={12} />
                          {formatDateRange(event.startsAt, event.endsAt)}
                        </span>
                      ) : null}
                      {event.venue ? (
                        <span className="flex items-center gap-1">
                          <MapPin size={12} />
                          {event.venue}
                        </span>
                      ) : null}
                      <span className="flex items-center gap-1">
                        <Users size={12} />
                        {event.registeredCount ?? 0}
                        {event.capacity ? `/${event.capacity}` : ''} registered
                      </span>
                    </span>
                  </div>
                  <div className="shrink-0">
                    <AdminActionsMenu items={buildMenuItems(event)} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/*
            * CONTINGENTS — one card PER PARENT EVENT, never one for the fest.
            *
            * A contingent bundles an event's own sub-events, so the card is
            * inherently about one parent: the list it loads is filtered by
            * parentEventId, and "create bundle" navigates carrying that id. The
            * rebuild briefly rendered a single card with parentEvent={null},
            * which is what crashed this page — there is no fest-level contingent
            * for a null parent to stand for.
            *
            * Only events with at least two eligible sub-events are shown, which
            * is the same bar the card itself states ("needs two sub-events") and
            * the same one the pre-rebuild screen applied. Rendering a card for
            * every leaf event would bury the list under empty panels.
            */}
          {parentEventsWithContingents.map((parentEvent) => (
            <AdminContingentSection
              key={parentEvent.id}
              festId={festId}
              parentEvent={parentEvent}
              eligibleSubEventCount={countEligibleSubEvents(events, parentEvent)}
            />
          ))}
        </>
      )}

      {/* ------------------------------------------------------ confirmations */}
      <AdminModal
        isOpen={Boolean(confirmTarget)}
        title={confirmCopy.title}
        confirmLabel={confirmCopy.confirm}
        /* "Go back", never "Cancel": on the cancel-event dialog, an abort button
           reading "Cancel" beside a commit reading "Cancel event" is a coin toss
           with an irreversible action on one side of it. */
        cancelLabel={COPY.goBack}
        tone={confirmCopy.tone}
        isBusy={isBusy}
        onConfirm={confirmAction}
        onCancel={() => {
          if (!isBusy) {
            setConfirmTarget(null);
            setReopenSchedule({ startsAt: '', endsAt: '', registrationOpensAt: '', registrationClosesAt: '' });
          }
        }}
      >
        {confirmTarget?.kind === 'reopenCancelled' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-4">
            <AdminExecutiveInput
              label="New start"
              type="datetime-local"
              value={reopenSchedule.startsAt}
              onChange={(e) => setReopenSchedule((prev) => ({ ...prev, startsAt: e.target.value }))}
            />
            <AdminExecutiveInput
              label="New end"
              type="datetime-local"
              value={reopenSchedule.endsAt}
              onChange={(e) => setReopenSchedule((prev) => ({ ...prev, endsAt: e.target.value }))}
            />
            <AdminExecutiveInput
              label="Registration opens"
              type="datetime-local"
              value={reopenSchedule.registrationOpensAt}
              onChange={(e) => setReopenSchedule((prev) => ({ ...prev, registrationOpensAt: e.target.value }))}
            />
            <AdminExecutiveInput
              label="Registration closes"
              type="datetime-local"
              value={reopenSchedule.registrationClosesAt}
              onChange={(e) => setReopenSchedule((prev) => ({ ...prev, registrationClosesAt: e.target.value }))}
            />
          </div>
        ) : null}
        {confirmCopy.body}
      </AdminModal>

      {/* --------------------------------------------------------------- edit */}
      <AdminModal
        isOpen={Boolean(editTarget)}
        title={editTarget ? COPY.editTitle(editTarget.eventName) : ''}
        confirmLabel={COPY.saveAndPublish}
        cancelLabel={COPY.goBack}
        isBusy={isBusy}
        onConfirm={saveEdit}
        onCancel={() => {
          if (!isBusy) {
            setEditTarget(null);
            setEditForm(null);
          }
        }}
      >
        {editForm ? (
          <div className="flex flex-col gap-4">
            <p className="font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
              {COPY.editIntro}
            </p>
            <AdminExecutiveInput
              label={COPY.fieldName}
              required
              value={editForm.eventName}
              onChange={(changeEvent) =>
                setEditForm((previous) => ({ ...previous, eventName: changeEvent.target.value }))
              }
            />
            <AdminExecutiveTextarea
              label={COPY.fieldDescription}
              rows={3}
              value={editForm.description}
              onChange={(changeEvent) =>
                setEditForm((previous) => ({ ...previous, description: changeEvent.target.value }))
              }
            />
            <AdminExecutiveTextarea
              label={COPY.fieldRules}
              rows={3}
              value={editForm.rules}
              onChange={(changeEvent) =>
                setEditForm((previous) => ({ ...previous, rules: changeEvent.target.value }))
              }
            />
            <AdminExecutiveInput
              label={COPY.fieldVenue}
              required
              value={editForm.venue}
              onChange={(changeEvent) =>
                setEditForm((previous) => ({ ...previous, venue: changeEvent.target.value }))
              }
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AdminExecutiveInput
                label={COPY.fieldStartsAt}
                type="datetime-local"
                value={editForm.startsAt}
                onChange={(changeEvent) =>
                  setEditForm((previous) => ({ ...previous, startsAt: changeEvent.target.value }))
                }
              />
              <AdminExecutiveInput
                label={COPY.fieldEndsAt}
                type="datetime-local"
                value={editForm.endsAt}
                onChange={(changeEvent) =>
                  setEditForm((previous) => ({ ...previous, endsAt: changeEvent.target.value }))
                }
              />
            </div>
            <AdminExecutiveInput
              label={COPY.fieldRegistrationCloses}
              type="datetime-local"
              helperText={COPY.registrationClosesHelp}
              value={editForm.registrationClosesAt}
              onChange={(changeEvent) =>
                setEditForm((previous) => ({
                  ...previous,
                  registrationClosesAt: changeEvent.target.value,
                }))
              }
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AdminExecutiveInput
                label={COPY.fieldCapacity}
                type="number"
                min={1}
                helperText={COPY.capacityHelp}
                value={editForm.capacity}
                onChange={(changeEvent) =>
                  setEditForm((previous) => ({ ...previous, capacity: changeEvent.target.value }))
                }
              />
              <AdminExecutiveInput
                label={COPY.fieldFee}
                type="number"
                min={0}
                helperText={COPY.feeHelp}
                value={editForm.feeRupees}
                onChange={(changeEvent) =>
                  setEditForm((previous) => ({ ...previous, feeRupees: changeEvent.target.value }))
                }
              />
            </div>
          </div>
        ) : null}
      </AdminModal>

      {/* ------------------------------------------------------------- notify */}
      <NotifyPanel
        festId={festId}
        event={notifyTarget}
        onClose={() => setNotifyTarget(null)}
        onSent={(message) => {
          setNotifyTarget(null);
          setNotice(message);
        }}
      />
    </div>
  );
}

/*
 * The message composer. Its own component because it owns state nothing else on
 * the screen needs — a recipient preview fetched per event, a draft, and the
 * channel choice — and folding that into the screen would put four more pieces
 * of state on a component that is otherwise a list.
 */
function NotifyPanel({ festId, event, onClose, onSent }) {
  const [preview, setPreview] = useState(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [channels, setChannels] = useState({ email: true, inbox: true });
  const [isSending, setIsSending] = useState(false);
  const [formError, setFormError] = useState('');

  const eventId = event?.id ?? null;
  useEffect(() => {
    if (!festId || !eventId) {
      return undefined;
    }
    let isActive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSubject('');
    setMessage('');
    setChannels({ email: true, inbox: true });
    setFormError('');
    setPreview(null);
    apiClient
      .get(`/fests/${festId}/events/${eventId}/notify-participants`)
      .then((result) => isActive && setPreview(result))
      .catch(() => {});
    return () => {
      isActive = false;
    };
  }, [festId, eventId]);

  async function send() {
    const selected = Object.entries(channels)
      .filter(([, isOn]) => isOn)
      .map(([channel]) => channel);
    if (selected.length === 0) {
      setFormError(COPY.notifyNoChannel);
      return;
    }
    if (!subject.trim() || !message.trim()) {
      setFormError('Give the message a subject and a body.');
      return;
    }
    setIsSending(true);
    setFormError('');
    try {
      const result = await apiClient.post(
        `/fests/${festId}/events/${eventId}/notify-participants`,
        { subject: subject.trim(), message: message.trim(), channels: selected },
      );
      onSent(COPY.notifySent(result?.recipientCount ?? 0));
    } catch (error) {
      setFormError(error?.message || COPY.actionFailed);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <AdminModal
      isOpen={Boolean(event)}
      title={event ? COPY.notifyTitle(event.eventName) : ''}
      confirmLabel={COPY.notifySend}
      cancelLabel={COPY.goBack}
      isBusy={isSending}
      onConfirm={send}
      onCancel={() => (isSending ? null : onClose())}
    >
      <div className="flex flex-col gap-4">
        {preview ? (
          <p className="font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
            {COPY.notifyRecipients(preview.recipientCount ?? 0, event?.eventName ?? '')}{' '}
            {typeof preview.sendsRemainingToday === 'number'
              ? COPY.notifyBudget(preview.sendsRemainingToday)
              : ''}
          </p>
        ) : null}

        <AdminExecutiveInput
          label={COPY.notifySubjectLabel}
          required
          maxLength={120}
          value={subject}
          onChange={(changeEvent) => setSubject(changeEvent.target.value)}
        />
        <AdminExecutiveTextarea
          label={COPY.notifyMessageLabel}
          required
          rows={6}
          value={message}
          onChange={(changeEvent) => setMessage(changeEvent.target.value)}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="font-admin-body text-[13px] font-medium text-admin-neutral-ink">
            {COPY.notifyChannels}
          </legend>
          {/* Both on by default: the two channels cover different failure modes
              (a bounced mail versus an app nobody reopens), so the safe default
              is both rather than one. */}
          {[
            ['email', COPY.notifyEmail],
            ['inbox', COPY.notifyInbox],
          ].map(([channel, label]) => (
            <label key={channel} className="flex w-fit cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={channels[channel]}
                onChange={() =>
                  setChannels((previous) => ({ ...previous, [channel]: !previous[channel] }))
                }
                className="h-4 w-4 accent-admin-primary-blue"
              />
              <span className="font-admin-body text-[14px] text-admin-neutral-ink">{label}</span>
            </label>
          ))}
        </fieldset>

        {formError ? (
          <p className="font-admin-body text-[13px] text-admin-status-error-red">{formError}</p>
        ) : null}
      </div>
    </AdminModal>
  );
}

export default AdminEventAccessScreen;

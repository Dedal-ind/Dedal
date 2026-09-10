// AdminDashboardDrillDownScreen.jsx
// Route: /admin/dashboard/drill-down/:kind (kind = registrations|checkIns|checkOuts)
// The full-screen list behind a dashboard card's icon tap: search the fest's
// events, tap one for the participant list scoped to the card's meaning, and
// download the matching CSV. Read + export only — no per-participant actions.
//
// Data sources, deliberately nothing new:
//   · event counts     — the analytics summary (funnel.perEvent + scansPerEvent),
//     the same endpoint every other analytics surface reads
//   · registrations    — listEventParticipants via the coordinator/admin roster
//   · check-ins/outs   — GET /events/:eventId/scans?direction=IN|OUT
//   · CSV              — the streaming export endpoints

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Download, Search } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import { flattenEventParticipants } from '../../helpers/event-roster.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveInput from '../../components-admin/admin-executive-input/AdminExecutiveInput.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import { ADMIN_DRILL_DOWN_COPY as COPY } from '../../brand-admin/brand-copy.js';
import { formatShortDate } from '../../helpers/admin-format.js';
import { formatCategoryLabel } from '../../helpers/category-format.js';

const VALID_KINDS = ['registrations', 'checkIns', 'checkOuts'];

function csvPathFor(kind, festId, eventId) {
  if (kind === 'registrations') {
    return `/fests/${festId}/exports/registrations.csv?eventIds=${eventId}`;
  }
  const sheet = kind === 'checkIns' ? 'check-ins' : 'check-outs';
  return `/fests/${festId}/exports/events/${eventId}/${sheet}.csv`;
}

/* Blob download through the authenticated client, same shape as Data Controls. */
async function downloadCsv(path) {
  const response = await apiClient.get(path, { responseType: 'blob' });
  const blobUrl = URL.createObjectURL(response instanceof Blob ? response : new Blob([response]));
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = '';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

function AdminDashboardDrillDownScreen() {
  const navigate = useNavigate();
  const { kind } = useParams();
  const [searchParameters] = useSearchParams();

  const [festId, setFestId] = useState(searchParameters.get('festId') ?? '');
  /*
   * The shared cascade's scope arrives in the URL (?eventId=&subEventId=), so a
   * drill-down opened from a filtered dashboard starts already narrowed instead
   * of making the admin re-pick. Read once on mount — this screen has its own
   * event list below and does not mount the filter itself.
   */
  const scopedEventId = searchParameters.get('subEventId') || searchParameters.get('eventId') || '';
  const [events, setEvents] = useState([]);
  const [countsByEventId, setCountsByEventId] = useState(new Map());
  const [searchText, setSearchText] = useState('');
  // Segment state: null = the event list; an event object = its participant list.
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [status, setStatus] = useState('loading');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      // A deep link without ?festId= falls back to the admin's first fest.
      let resolvedFestId = festId;
      if (!resolvedFestId) {
        const fests = await apiClient.get('/fests/mine');
        resolvedFestId = Array.isArray(fests) && fests.length > 0 ? fests[0].id : '';
        setFestId(resolvedFestId);
      }
      if (!resolvedFestId) {
        setStatus('error');
        return;
      }
      const [eventList, summary] = await Promise.all([
        apiClient.get(`/fests/${resolvedFestId}/events/all`),
        apiClient.get(`/fests/${resolvedFestId}/analytics/summary`),
      ]);
      setEvents(Array.isArray(eventList) ? eventList : []);

      const counts = new Map();
      for (const row of summary?.funnel?.perEvent ?? []) {
        counts.set(row.eventId, { registrations: row.registrationsConfirmed });
      }
      for (const row of summary?.scansPerEvent ?? []) {
        counts.set(row.eventId, {
          ...(counts.get(row.eventId) ?? {}),
          checkIns: row.checkInsCount,
          checkOuts: row.checkOutsCount,
        });
      }
      setCountsByEventId(counts);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function openEvent(event) {
    setSelectedEvent(event);
    setParticipants([]);
    setActionError('');
    try {
      if (kind === 'registrations') {
        const roster = await apiClient.get(`/fests/${festId}/events/${event.id}/participants`);
        setParticipants(flattenEventParticipants(roster).participants);
      } else {
        const direction = kind === 'checkIns' ? 'IN' : 'OUT';
        const rows = await apiClient.get(
          `/fests/${festId}/events/${event.id}/scans?direction=${direction}`,
        );
        setParticipants(Array.isArray(rows) ? rows : []);
      }
    } catch {
      setActionError(COPY.loadFailed);
    }
  }

  async function handleDownload() {
    setActionError('');
    try {
      await downloadCsv(csvPathFor(kind, festId, selectedEvent.id));
    } catch {
      setActionError(COPY.loadFailed);
    }
  }

  const normalisedSearch = searchText.trim().toLowerCase();
  const filteredEvents = useMemo(() => {
    // A scoped arrival shows the chosen event and (when a parent was chosen)
    // its children — the same includeDescendants meaning the endpoints use.
    const scoped = scopedEventId
      ? events.filter(
          (event) => event.id === scopedEventId || event.parentEventId === scopedEventId,
        )
      : events;
    return scoped.filter(
      (event) => !normalisedSearch || event.eventName.toLowerCase().includes(normalisedSearch),
    );
  }, [events, normalisedSearch, scopedEventId]);

  if (!VALID_KINDS.includes(kind)) {
    return (
      <AdminExecutiveCard>
        <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.loadFailed}</p>
      </AdminExecutiveCard>
    );
  }

  const countKeyByKind = { registrations: 'registrations', checkIns: 'checkIns', checkOuts: 'checkOuts' };

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-4">
      {/* Sticky header: back, title for the kind, search. */}
      <div className="sticky top-0 z-10 flex flex-col gap-3 bg-admin-surface-off-white pb-2 pt-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => (selectedEvent ? setSelectedEvent(null) : navigate(-1))}
            aria-label={selectedEvent ? COPY.backToEvents : 'Go back'}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-admin-slate-200 bg-admin-surface-white text-admin-neutral-ink"
          >
            <ArrowLeft size={16} />
          </button>
          <h1 className="font-admin-display text-[22px] font-semibold leading-7 text-admin-neutral-ink">
            {COPY.titleByKind[kind]}
            {selectedEvent ? ` — ${selectedEvent.eventName}` : ''}
          </h1>
        </div>
        {!selectedEvent ? (
          <AdminExecutiveInput
            placeholder={COPY.searchPlaceholder}
            iconLeft={<Search size={15} />}
            value={searchText}
            onChange={(changeEvent) => setSearchText(changeEvent.target.value)}
          />
        ) : null}
      </div>

      <AdminErrorBanner message={actionError} />

      {status === 'loading' ? (
        <div className="flex h-[40vh] items-center justify-center">
          <span
            aria-label="Loading"
            className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
          />
        </div>
      ) : null}
      {status === 'error' ? (
        <AdminExecutiveCard>
          <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.loadFailed}</p>
        </AdminExecutiveCard>
      ) : null}

      {/* Segment 1: the searchable event list, each row a real button. */}
      {status === 'ready' && !selectedEvent ? (
        <AdminExecutiveCard>
          {filteredEvents.length === 0 ? (
            <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.emptyEvents}</p>
          ) : (
            <ul className="divide-y divide-admin-slate-200">
              {filteredEvents.map((event) => {
                const count = countsByEventId.get(event.id)?.[countKeyByKind[kind]] ?? 0;
                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => openEvent(event)}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 py-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-admin-body text-[14px] font-medium text-admin-neutral-ink">
                          {event.eventName}
                        </span>
                        <span className="block font-admin-mono text-[12px] text-admin-slate-600">
                          {[formatCategoryLabel(event.category), formatShortDate(event.startsAt)]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <span className="shrink-0 font-admin-mono text-[13px] font-semibold text-admin-neutral-ink">
                        {count} {COPY.eventCountSuffix[kind]}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </AdminExecutiveCard>
      ) : null}

      {/* Segment 2: the participant list for the tapped event + CSV download. */}
      {status === 'ready' && selectedEvent ? (
        <AdminExecutiveCard>
          <div className="mb-3 flex justify-end">
            <AdminExecutiveButton variant="secondary" iconLeft={<Download size={15} />} onClick={handleDownload}>
              {COPY.downloadCsv}
            </AdminExecutiveButton>
          </div>
          {participants.length === 0 ? (
            <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">
              {COPY.emptyParticipants}
            </p>
          ) : (
            <ul className="divide-y divide-admin-slate-200">
              {participants.map((row, index) => {
                // Registrations rows are populated registration docs; scan rows are flat.
                const person = row.userId && typeof row.userId === 'object' ? row.userId : row;
                return (
                  <li key={row.id ?? row.userId ?? index} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate font-admin-body text-[14px] text-admin-neutral-ink">
                        {person.fullName ?? '—'}
                      </span>
                      <span className="block truncate font-admin-mono text-[12px] text-admin-slate-600">
                        {[
                          person.emailAddress,
                          person.phoneNumber,
                          person.collegeId?.commonName ?? person.collegeName,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-admin-mono text-[12px] text-admin-slate-600">
                      {row.firstScannedAt ? (
                        `${COPY.firstScanColumn}: ${new Date(row.firstScannedAt).toLocaleTimeString('en-IN')}`
                      ) : (
                        <>
                          {row.status ? (
                            <span className="block uppercase text-admin-neutral-ink">{row.status}</span>
                          ) : null}
                          {row.registeredAt ? (
                            <span className="block">{formatShortDate(row.registeredAt)}</span>
                          ) : null}
                          {row.registrationType === 'contingent' ? (
                            <span className="block">CONTINGENT</span>
                          ) : null}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </AdminExecutiveCard>
      ) : null}
    </div>
  );
}

export default AdminDashboardDrillDownScreen;

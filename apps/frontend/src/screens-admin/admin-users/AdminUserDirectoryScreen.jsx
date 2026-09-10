// AdminUserDirectoryScreen.jsx
// Route: /admin/users — a VIEW-ONLY people directory for the administrator's
// fests, split into three sections: Coordinators, Volunteers (both from the
// fest staff-assignment roster), and Participants (from real registrations).
//
// Data sources, nothing fabricated:
//   · GET /fests/mine — the admin's fests, fanned across for both feeds below.
//   · GET /fests/:festId/staff-assignments — coordinators and volunteers. An
//     assignment whose eventIds is EMPTY is fest-wide and therefore matches any
//     event chosen in the cascade.
//   · GET /fests/:festId/participants — one aggregated row per registrant,
//     merged across fests; the hierarchy filter narrows it client-side by the
//     eventIds already present on each registration.
// This page deliberately has NO mutations: assigning/revoking staff lives on
// /admin/events/assignments, and there is no block/unblock feature here — the
// user model's isBlocked is still SHOWN (as a "disabled" chip) because it is
// real data, but nothing on this screen can change anybody.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserCog, HandHelping, Users, Search } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveInput from '../../components-admin/admin-executive-input/AdminExecutiveInput.jsx';
import AdminHierarchyFilter from '../../components-admin/admin-hierarchy-filter/AdminHierarchyFilter.jsx';
import { useAdminHierarchyScope } from '../../hooks/useAdminHierarchyScope.js';
import AdminExecutiveSelect from '../../components-admin/admin-executive-select/AdminExecutiveSelect.jsx';
import AdminExecutiveChip from '../../components-admin/admin-executive-chip/AdminExecutiveChip.jsx';
import AdminKpiCard from '../../components-admin/admin-kpi-card/AdminKpiCard.jsx';
import { ADMIN_USERS_COPY as COPY } from '../../brand-admin/brand-copy.js';
import { buildCsv, downloadCsv } from '../../helpers/admin-csv.js';
import { formatDepartmentLabel } from '../../helpers/department-format.js';

const PAGE_SIZE = 25;

/*
 * Strings new to the three-section layout. Local on purpose: the shared
 * brand-copy file must not be edited from this screen.
 */
const LOCAL_COPY = {
  coordinatorsHeading: 'Coordinators',
  volunteersHeading: 'Volunteers',
  participantsHeading: 'Participants',
  kpiCoordinators: 'Coordinators',
  kpiCoordinatorsSubtitle: 'Active coordinator assignments in scope',
  kpiVolunteers: 'Volunteers',
  kpiVolunteersSubtitle: 'Active volunteer assignments in scope',
  kpiParticipants: 'Participants',
  kpiParticipantsSubtitle: 'Unique registrants in scope',
  columnContact: 'Contact',
  columnRole: 'Role',
  roleCoordinator: 'coordinator',
  roleVolunteer: 'volunteer',
  roleParticipant: 'participant',
  disabledChip: 'disabled',
  staffEmpty: 'No one holds this role in the selected scope.',
  participantsEmpty: 'No registrations match the selected scope.',
};

// Registration status → chip tone. Reuses the shared chip rather than inventing a
// new pill for the directory's most-recent-status column.
const STATUS_TONE = {
  confirmed: 'success',
  attended: 'info',
  cancelled: 'error',
  waitlisted: 'warning',
  pendingPayment: 'warning',
  noShow: 'neutral',
  winner1st: 'success',
  winner2nd: 'success',
  winner3rd: 'success',
  eliminated: 'error',
  disqualified: 'error',
  paymentExpired: 'warning',
  eventCancelled: 'neutral',
  advancedToR2: 'info',
  advancedToR3: 'info',
  advancedToQuarterFinal: 'info',
  advancedToSemiFinal: 'info',
  advancedToFinal: 'info',
};

// Role badge tones — coordinator matches the staff screen's chip, participant
// gets its own quiet tone so the three sections read apart at a glance.
const ROLE_TONE = {
  coordinator: 'info',
  volunteer: 'neutral',
  participant: 'success',
};

function statusTone(status) {
  return STATUS_TONE[status] ?? 'neutral';
}

function initialsOf(fullName) {
  return (
    (fullName || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?'
  );
}

// Merge one user's rows that came from more than one fest into a single record.
function mergeParticipants(perFest) {
  const byUser = new Map();
  for (const { fest, participants } of perFest) {
    for (const participant of participants) {
      const existing = byUser.get(participant.userId);
      const taggedRegs = participant.registrations.map((registration) => ({
        ...registration,
        festName: fest.festName,
        festId: fest.id,
      }));
      if (existing) {
        existing.registrations.push(...taggedRegs);
      } else {
        byUser.set(participant.userId, { ...participant, registrations: [...taggedRegs] });
      }
    }
  }
  // Recompute derived fields over the merged registration set.
  return Array.from(byUser.values()).map((participant) => {
    const registrations = [...participant.registrations].sort(
      (a, b) => new Date(b.registeredAt) - new Date(a.registeredAt),
    );
    return {
      ...participant,
      registrations,
      registrationCount: registrations.length,
      mostRecentStatus: registrations[0]?.status ?? null,
    };
  });
}

// A staff assignment covers the chosen event when its eventIds names it — or
// when eventIds is EMPTY, the backend's meaning for a fest-wide assignment,
// which therefore covers every event in that fest.
function assignmentCoversEvent(assignment, eventId) {
  const coveredEventIds = (assignment.eventIds ?? []).map((entry) =>
    String(entry?.id ?? entry?._id ?? entry),
  );
  return coveredEventIds.length === 0 || coveredEventIds.includes(eventId);
}

function LoadingState() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <span
        aria-label="Loading"
        className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
      />
    </div>
  );
}

// Shared "name + email + avatar" cell used by all three sections.
function PersonCell({ fullName, emailAddress }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-admin-primary-blue/10 font-admin-body text-[12px] font-semibold text-admin-primary-blue">
        {initialsOf(fullName)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-admin-body text-[14px] font-medium text-admin-neutral-ink">
          {fullName ?? '—'}
        </span>
        <span className="block truncate font-admin-mono text-[13px] leading-[18px] text-admin-slate-600">
          {emailAddress ?? '—'}
        </span>
      </span>
    </div>
  );
}

function AdminUserDirectoryScreen() {
  // A ?event=<name> deep link (from Event Access → "View registrations")
  // pre-selects the event filter.
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('loading');
  const [participants, setParticipants] = useState([]);
  const [staffAssignments, setStaffAssignments] = useState([]);
  const [fests, setFests] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  /*
   * The shared cascade filters by event ID; the legacy ?event=<name> deep link
   * still works through eventNameFilter below, so old links do not break.
   */
  const { scope, handleScopeChange, activeEventId } = useAdminHierarchyScope();
  const [eventNameFilter] = useState(() => searchParams.get('event') ?? '');
  const [page, setPage] = useState(1);

  const loadDirectory = useCallback(async () => {
    setStatus('loading');
    try {
      const festList = await apiClient.get('/fests/mine');
      const safeFests = Array.isArray(festList) ? festList : [];
      const perFest = await Promise.all(
        safeFests.map(async (fest) => {
          const [festParticipants, festStaff] = await Promise.all([
            apiClient.get(`/fests/${fest.id}/participants`).catch(() => []),
            apiClient.get(`/fests/${fest.id}/staff-assignments`).catch(() => []),
          ]);
          return {
            fest,
            participants: Array.isArray(festParticipants) ? festParticipants : [],
            staff: (Array.isArray(festStaff) ? festStaff : []).map((assignment) => ({
              ...assignment,
              festId: fest.id,
              festName: fest.festName,
            })),
          };
        }),
      );
      setFests(safeFests);
      setParticipants(mergeParticipants(perFest));
      setStaffAssignments(perFest.flatMap((entry) => entry.staff));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDirectory();
  }, [loadDirectory]);

  const statusOptions = useMemo(() => {
    const set = new Set();
    participants.forEach((p) => p.mostRecentStatus && set.add(p.mostRecentStatus));
    return [...set].sort().map((s) => ({ value: s, label: s }));
  }, [participants]);

  const query = searchText.trim().toLowerCase();

  /*
   * Staff, narrowed by search + the cascade. Only ACTIVE assignments belong in
   * a people directory — revoked/expired rows are history and stay on the
   * assignments screen. Fest-wide assignments (empty eventIds) match any event.
   */
  const visibleStaff = useMemo(() => {
    return staffAssignments.filter((assignment) => {
      if (assignment.status !== 'active') {
        return false;
      }
      if (scope.festId && assignment.festId !== scope.festId) {
        return false;
      }
      if (activeEventId && !assignmentCoversEvent(assignment, activeEventId)) {
        return false;
      }
      if (query) {
        const haystack = `${assignment.userId?.fullName ?? ''} ${assignment.userId?.emailAddress ?? ''}`.toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [staffAssignments, scope.festId, activeEventId, query]);

  const coordinators = useMemo(
    () => visibleStaff.filter((assignment) => assignment.role === 'coordinator'),
    [visibleStaff],
  );
  const volunteers = useMemo(
    () => visibleStaff.filter((assignment) => assignment.role === 'volunteer'),
    [visibleStaff],
  );

  const filteredParticipants = useMemo(() => {
    return participants.filter((participant) => {
      if (query) {
        const haystack = `${participant.fullName ?? ''} ${participant.emailAddress ?? ''} ${participant.usn ?? ''}`.toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }
      // The cascade narrows by event id: a chosen sub-event matches only its
      // own registrants, a chosen event matches its own AND its sub-events'
      // (the includeDescendants meaning, applied to rows already loaded).
      if (
        activeEventId &&
        !participant.registrations.some(
          (registration) =>
            registration.eventId === activeEventId ||
            registration.parentEventId === activeEventId,
        )
      ) {
        return false;
      }
      if (
        eventNameFilter &&
        !participant.registrations.some((registration) => registration.eventName === eventNameFilter)
      ) {
        return false;
      }
      if (statusFilter && participant.mostRecentStatus !== statusFilter) {
        return false;
      }
      if (scope.festId && !participant.registrations.some((r) => r.festId === scope.festId)) {
        return false;
      }
      return true;
    });
  }, [participants, query, activeEventId, eventNameFilter, statusFilter, scope.festId]);

  function handleExport() {
    const headers = [
      'Full name',
      'Email',
      'USN',
      'College',
      'Department',
      'Phone',
      'Registered events',
      'Food orders',
      'Most recent status',
    ];
    const rows = filteredParticipants.map((p) => [
      p.fullName,
      p.emailAddress,
      p.usn,
      p.collegeName,
      formatDepartmentLabel(p.department),
      p.phoneNumber,
      p.registrations.map((r) => r.eventName).filter(Boolean).join('; '),
      // Total meals this person booked across their registrations.
      p.registrations.reduce((mealTotal, r) => mealTotal + (r.foodOrderCount ?? 0), 0),
      p.mostRecentStatus,
    ]);
    downloadCsv(COPY.csvFilename, buildCsv(headers, rows));
  }

  if (status === 'loading') {
    return <LoadingState />;
  }
  if (status === 'error') {
    return (
      <AdminExecutiveCard>
        <div className="flex flex-col items-start gap-3 py-6">
          <p className="font-admin-body text-[14px] text-admin-slate-600">{COPY.loadError}</p>
          <AdminExecutiveButton variant="secondary" onClick={loadDirectory}>
            Retry
          </AdminExecutiveButton>
        </div>
      </AdminExecutiveCard>
    );
  }

  const totalPages = Math.max(1, Math.ceil(filteredParticipants.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filteredParticipants.slice(pageStart, pageStart + PAGE_SIZE);

  // Coordinators and volunteers share one column set; the role chip on every
  // row is what states which section a printout or screenshot came from.
  const staffColumns = [
    {
      key: 'user',
      header: COPY.columnUser,
      render: (assignment) => (
        <PersonCell
          fullName={assignment.userId?.fullName}
          emailAddress={assignment.userId?.emailAddress}
        />
      ),
    },
    {
      key: 'contact',
      header: LOCAL_COPY.columnContact,
      render: (assignment) => {
        // Only what the payload carries: the per-assignment contact phone if the
        // admin recorded one, else the account's own number, else an em dash.
        const contactNumber =
          assignment.assignmentContactPhone || assignment.userId?.phoneNumber || null;
        return contactNumber ? (
          <span className="font-admin-mono text-[13px] text-admin-slate-600">{contactNumber}</span>
        ) : (
          <span className="text-admin-slate-600">—</span>
        );
      },
    },
    {
      key: 'role',
      header: LOCAL_COPY.columnRole,
      render: (assignment) => (
        <AdminExecutiveChip tone={ROLE_TONE[assignment.role] ?? 'neutral'}>
          {assignment.role}
        </AdminExecutiveChip>
      ),
    },
  ];

  const participantColumns = [
    {
      key: 'user',
      header: COPY.columnUser,
      render: (row) => <PersonCell fullName={row.fullName} emailAddress={row.emailAddress} />,
    },
    {
      key: 'contact',
      header: LOCAL_COPY.columnContact,
      render: (row) =>
        row.phoneNumber ? (
          <span className="font-admin-mono text-[13px] text-admin-slate-600">{row.phoneNumber}</span>
        ) : (
          <span className="text-admin-slate-600">—</span>
        ),
    },
    {
      key: 'usn',
      header: COPY.columnUsn,
      render: (row) => (
        <span className="font-admin-mono text-[13px] text-admin-slate-600">{row.usn ?? '—'}</span>
      ),
    },
    {
      key: 'events',
      header: COPY.columnEvents,
      align: 'right',
      render: (row) => (
        <span
          title={row.registrations.map((r) => r.eventName).filter(Boolean).join(', ')}
          className="font-admin-mono text-[13px] font-medium tabular-nums text-admin-neutral-ink"
        >
          {row.registrationCount}
        </span>
      ),
    },
    {
      key: 'status',
      header: COPY.columnStatus,
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {row.mostRecentStatus ? (
            <AdminExecutiveChip tone={statusTone(row.mostRecentStatus)}>
              {row.mostRecentStatus}
            </AdminExecutiveChip>
          ) : (
            <span className="text-admin-slate-600">—</span>
          )}
          {/* isBlocked is real user-model data; shown, never mutable here. */}
          {row.isBlocked ? (
            <AdminExecutiveChip tone="error">{LOCAL_COPY.disabledChip}</AdminExecutiveChip>
          ) : null}
        </span>
      ),
    },
    {
      key: 'role',
      header: LOCAL_COPY.columnRole,
      render: () => (
        <AdminExecutiveChip tone={ROLE_TONE.participant}>
          {LOCAL_COPY.roleParticipant}
        </AdminExecutiveChip>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">

      <AdminHierarchyFilter
        fests={fests}
        selectedFestId={scope.festId}
        selectedEventId={scope.eventId}
        selectedSubEventId={scope.subEventId}
        onChange={handleScopeChange}
        className="sticky top-0 z-10 bg-admin-surface-off-white py-2"
      />

      {/* KPI row — one live count per section, honest to the current scope. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <AdminKpiCard
          label={LOCAL_COPY.kpiCoordinators}
          value={coordinators.length.toLocaleString('en-IN')}
          subtitle={LOCAL_COPY.kpiCoordinatorsSubtitle}
          icon={<UserCog size={18} strokeWidth={1.75} />}
        />
        <AdminKpiCard
          label={LOCAL_COPY.kpiVolunteers}
          value={volunteers.length.toLocaleString('en-IN')}
          subtitle={LOCAL_COPY.kpiVolunteersSubtitle}
          icon={<HandHelping size={18} strokeWidth={1.75} />}
        />
        <AdminKpiCard
          label={LOCAL_COPY.kpiParticipants}
          value={filteredParticipants.length.toLocaleString('en-IN')}
          subtitle={LOCAL_COPY.kpiParticipantsSubtitle}
          icon={<Users size={18} strokeWidth={1.75} />}
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <AdminExecutiveInput
          className="lg:flex-1"
          placeholder={COPY.searchPlaceholder}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          iconLeft={<Search size={16} />}
        />
        <AdminExecutiveSelect
          className="lg:w-[180px]"
          placeholder={COPY.filterAllStatuses}
          options={[{ value: '', label: COPY.filterAllStatuses }, ...statusOptions]}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        />
        <AdminExecutiveButton
          variant="secondary"
          onClick={handleExport}
          disabled={filteredParticipants.length === 0}
        >
          {COPY.exportCsv}
        </AdminExecutiveButton>
      </div>

      {/* Section 1 — Coordinators */}
      <AdminExecutiveCard title={LOCAL_COPY.coordinatorsHeading} bodyClassName="p-0">
        <AdminExecutiveTable
          columns={staffColumns}
          rows={coordinators}
          rowKey={(assignment) => assignment.id}
          emptyMessage={LOCAL_COPY.staffEmpty}
        />
      </AdminExecutiveCard>

      {/* Section 2 — Volunteers */}
      <AdminExecutiveCard title={LOCAL_COPY.volunteersHeading} bodyClassName="p-0">
        <AdminExecutiveTable
          columns={staffColumns}
          rows={volunteers}
          rowKey={(assignment) => assignment.id}
          emptyMessage={LOCAL_COPY.staffEmpty}
        />
      </AdminExecutiveCard>

      {/* Section 3 — Participants (registration-backed, paginated) */}
      <AdminExecutiveCard title={LOCAL_COPY.participantsHeading} bodyClassName="p-0">
        {participants.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <p className="font-admin-display text-[20px] font-semibold text-admin-neutral-ink">
              {COPY.emptyTitle}
            </p>
            <p className="font-admin-body text-[14px] text-admin-slate-600">{COPY.emptyBody}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <AdminExecutiveTable
              columns={participantColumns}
              rows={pageRows}
              rowKey={(row) => row.userId}
              emptyMessage={LOCAL_COPY.participantsEmpty}
            />
            {filteredParticipants.length > PAGE_SIZE ? (
              <div className="flex items-center justify-between px-4 pb-4">
                <span className="font-admin-mono text-[13px] text-admin-slate-600">
                  {COPY.showingRange(
                    pageStart + 1,
                    Math.min(pageStart + PAGE_SIZE, filteredParticipants.length),
                    filteredParticipants.length,
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <AdminExecutiveButton
                    variant="secondary"
                    size="small"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                  >
                    {COPY.prev}
                  </AdminExecutiveButton>
                  <AdminExecutiveButton
                    variant="secondary"
                    size="small"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  >
                    {COPY.next}
                  </AdminExecutiveButton>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </AdminExecutiveCard>
    </div>
  );
}

export default AdminUserDirectoryScreen;

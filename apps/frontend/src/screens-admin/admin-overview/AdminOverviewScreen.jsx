// AdminOverviewScreen.jsx
// Route: /admin/overview — the administrator's landing page.
//
// Everything here is derived from endpoints that already exist; nothing is
// fabricated. The data comes from three real sources, fanned out per fest:
//   · GET /fests/mine                     → the administrator's fests (drafts too)
//   · GET /fests/:festId/dashboard        → per-fest registration totals + events
//   · GET /fests/:festId/events/all       → per-event capacity + counts
//   · GET /admin/audit-logs?festId=:id    → recent activity (real audit trail)
//
// Where the backend does not (yet) return a metric, the corresponding piece
// degrades honestly rather than inventing a number:
//   · Registration Trends: there is no per-day time-series endpoint, so the chart
//     shows a "coming soon" placeholder instead of drawn bars.
//   · Week-over-week deltas: no historical snapshot exists, so KPI cards show the
//     value alone with no "+12%" indicator.
//   · Recent Activity: hidden entirely if no audit entries are available.
//   · Revenue: no payment or revenue endpoint exists, so no revenue KPI is shown.
//     TODO: add revenue endpoint post-demo

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  BarChart3,
  LogIn,
  LogOut,
  UserMinus,
  DoorOpen,
  ScanLine,
} from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminHierarchyFilter from '../../components-admin/admin-hierarchy-filter/AdminHierarchyFilter.jsx';
import { useAdminHierarchyScope } from '../../hooks/useAdminHierarchyScope.js';
import { flattenEventParticipants } from '../../helpers/event-roster.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminKpiCard from '../../components-admin/admin-kpi-card/AdminKpiCard.jsx';
import AdminStatusPill from '../../components-admin/admin-status-pill/AdminStatusPill.jsx';
import AdminActionsMenu from '../../components-admin/admin-actions-menu/AdminActionsMenu.jsx';
import AdminActivityFeed from '../../components-admin/admin-activity-feed/AdminActivityFeed.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import {
  ADMIN_OVERVIEW_COPY,
  ADMIN_ACTIVITY_COPY,
  ADMIN_FEST_STRUCTURE_COPY,
} from '../../brand-admin/brand-copy.js';

const CREATE_FEST_ROUTE = '/admin/fests/create';
const editFestRoute = (festId) => `/admin/fests/${festId}/edit`;
const AUDIT_LOG_ROUTE = '/admin/system/data-controls';
const RECENT_ACTIVITY_LIMIT = 5;

// A leaf (registerable) event carries a capacity; container/vertical events do
// not. Fees, registrations and capacity totals are only meaningful for leaves.
function isLeafEvent(event) {
  return event && event.capacity !== null && event.capacity !== undefined;
}

// Fold one fest's raw payloads into the numbers the row and the KPIs read.
function summariseFest({ fest, dashboard, events }) {
  const leafEvents = Array.isArray(events) ? events.filter(isLeafEvent) : [];
  const capacityTotal = leafEvents.reduce((sum, event) => sum + (event.capacity || 0), 0);

  // Registrations: totalConfirmed, not totalRegistrations — the latter sums every
  // status group, cancellations included. Falls back to the sum of denormalised
  // confirmed counts if the dashboard call failed.
  const registrations =
    dashboard?.totals?.totalConfirmed ??
    leafEvents.reduce((sum, event) => sum + (event.registeredCount || 0), 0);

  return {
    id: fest.id,
    festName: fest.festName,
    status: fest.status,
    startsOn: fest.startsOn,
    endsOn: fest.endsOn,
    eventCount: leafEvents.length,
    registrations,
    capacityTotal,
    // Per-offer claimed-vs-booked (e.g. meals served against meals booked).
    offerClaims: Array.isArray(dashboard?.offerClaims) ? dashboard.offerClaims : [],
    hasDashboard: Boolean(dashboard),
  };
}

// Merge every fest's recent audit entries into one newest-first feed.
function mergeActivity(perFestResults) {
  const rows = [];
  for (const { activity } of perFestResults) {
    const logs = activity?.logs;
    if (!Array.isArray(logs)) {
      continue;
    }
    for (const log of logs) {
      rows.push({
        id: log.id ?? `${log.action}-${log.createdAt}-${log.actorUserId?.id ?? ''}`,
        action: log.action,
        actorName: log.actorUserId?.fullName ?? log.actorUserId?.emailAddress ?? null,
        createdAt: log.createdAt,
      });
    }
  }
  rows.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  return rows.slice(0, RECENT_ACTIVITY_LIMIT);
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

function AdminOverviewScreen() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [festSummaries, setFestSummaries] = useState([]);
  const [activityItems, setActivityItems] = useState([]);
  const [activityAvailable, setActivityAvailable] = useState(false);
  const [trendRange, setTrendRange] = useState('7D'); // 7D | 30D
  /*
   * The drill-down headline for the admin's first fest: total registrations /
   * check-ins / check-outs, from the analytics summary (one source of truth —
   * the same endpoint the Data Controls tab reads; nothing re-implemented).
   */
  const [drillDownSummary, setDrillDownSummary] = useState(null);
  // The headline KPI cards narrow with the shared cascade; the per-fest cards
  // below stay fest-level, which is what that section is for.
  const { scope, handleScopeChange, scopeQuery } = useAdminHierarchyScope();

  /*
   * CAMPUS ACCESS — today's gate figures for the selected fest.
   *
   * Its own request, and its own failure mode. The dashboard's main load is one
   * Promise.all over several endpoints; folding this into it would mean a
   * campus-access outage blanks the registration and check-in KPIs too, and
   * those are the numbers the screen exists for. A failure here just leaves the
   * card empty.
   *
   * Fest-scoped only: "who is on campus" has no meaning without a campus, so the
   * card does not render on the all-fests view.
   */
  const [gateStats, setGateStats] = useState(null);
  useEffect(() => {
    if (!scope.festId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGateStats(null);
      return undefined;
    }
    let isActive = true;
    apiClient
      .get(`/fests/${scope.festId}/gate-stats`)
      .then((stats) => isActive && setGateStats(stats))
      .catch(() => isActive && setGateStats(null));
    return () => {
      isActive = false;
    };
  }, [scope.festId]);
  const [availableFests, setAvailableFests] = useState([]);
  const [drillDownFestId, setDrillDownFestId] = useState(null);
  const [transitionError, setTransitionError] = useState('');
  const [activePopup, setActivePopup] = useState(null); // 'registrations' | 'checkIns' | 'checkOuts' | 'yetToCheckIn' | 'confirmedRegistrations'
  const [popupData, setPopupData] = useState([]);
  const [popupLoading, setPopupLoading] = useState(false);

  const loadDashboard = useCallback(async () => {
    /*
     * Only the FIRST load blanks the screen. Every later trigger (a filter
     * change, a background refetch) refreshes in place — flipping to the
     * full-screen spinner on each of those is exactly the "dashboard keeps
     * loading by itself" everyone was seeing: the content vanished and
     * reappeared on every scope change.
     */
    setStatus((previous) => (previous === 'ready' ? 'ready' : 'loading'));
    try {
      const fests = await apiClient.get('/fests/mine');
      const festList = Array.isArray(fests) ? fests : [];

      setAvailableFests(festList);
      /*
       * NOTHING IS SHOWN UNTIL A FEST IS CHOSEN.
       *
       * This used to fall back to festList[0] when the filter was empty, so an
       * admin landing on the dashboard read one arbitrary fest's numbers under
       * headings that named no fest at all. With several fests that is not a
       * harmless default — it is a figure attributed to the wrong event, and the
       * only clue is which fest happens to sort first.
       *
       * So an empty filter now means empty stats, and the cards say so.
       */
      if (scope.festId) {
        setDrillDownFestId(scope.festId);
        apiClient
          .get(`/fests/${scope.festId}/analytics/summary${scopeQuery}`)
          .then((summaryData) => setDrillDownSummary(summaryData?.headline ?? null))
          .catch(() => setDrillDownSummary(null));
      } else {
        setDrillDownFestId(null);
        setDrillDownSummary(null);
      }

      const perFestResults = await Promise.all(
        festList.map(async (fest) => {
          const [dashboard, events, activity] = await Promise.all([
            apiClient.get(`/fests/${fest.id}/dashboard`).catch(() => null),
            apiClient.get(`/fests/${fest.id}/events/all`).catch(() => []),
            apiClient.get(`/admin/audit-logs?festId=${fest.id}&limit=${RECENT_ACTIVITY_LIMIT}`).catch(() => null),
          ]);
          return { fest, dashboard, events, activity };
        }),
      );

      setFestSummaries(perFestResults.map(summariseFest));
      const anyActivityEndpointResponded = perFestResults.some((result) => result.activity !== null);
      setActivityAvailable(anyActivityEndpointResponded);
      setActivityItems(mergeActivity(perFestResults));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [scope.festId, scopeQuery]);

  useEffect(() => {
    // loadDashboard flips status to 'loading' synchronously on entry; that initial
    // setState is the intended kickoff, not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboard();
  }, [loadDashboard]);

  // Fest lifecycle transitions from the row menu, each backed by a real endpoint.
  const runFestTransition = useCallback(
    async (path) => {
      setTransitionError('');
      try {
        await apiClient.post(path);
        await loadDashboard();
      } catch (transitionException) {
        // The backend enforces the real guard; show which one rejected the
        // transition rather than leaving the table silently unchanged.
        setTransitionError(transitionException.message || ADMIN_OVERVIEW_COPY.transitionFailed);
      }
    },
    [loadDashboard],
  );

  /*
   * Open a popup and fetch the list behind the number.
   *
   * REWIRED: this originally called /analytics/drill-down/registrations|
   * checkIns|checkOuts — routes that have never existed. The .catch(() => null)
   * swallowed the 404, so every popup opened, spun, and reported "no data",
   * which read as an empty fest rather than a wiring fault. The sources below
   * are the same ones the full drill-down screen already uses:
   *
   *   registrations / yetToCheckIn -> the event roster or fest participants
   *   checkIns / checkOuts         -> the event scan log (direction IN/OUT)
   *
   * Scan lists are EVENT-scoped only (no fest-wide scan endpoint), so at fest
   * level those popups explain that instead of pretending an empty list.
   * "Yet to check in" is derived: the roster minus anyone with an IN scan —
   * the same subtraction the KPI card itself shows.
   */
  const popupEventId = scope.subEventId || scope.eventId || null;

  const openPopup = useCallback(async (kind) => {
    if (!drillDownFestId) return;
    setActivePopup(kind);
    setPopupLoading(true);
    setPopupData([]);
    try {
      if ((kind === 'checkIns' || kind === 'checkOuts') && !popupEventId) {
        /* No fest-wide scan list exists; the modal body explains. */
        setPopupData([]);
        return;
      }

      if (kind === 'checkIns' || kind === 'checkOuts') {
        const direction = kind === 'checkIns' ? 'IN' : 'OUT';
        const rows = await apiClient.get(
          `/fests/${drillDownFestId}/events/${popupEventId}/scans?direction=${direction}`,
        );
        setPopupData(Array.isArray(rows) ? rows : []);
        return;
      }

      /* registrations / yetToCheckIn */
      let people = [];
      if (popupEventId) {
        const roster = await apiClient.get(
          `/fests/${drillDownFestId}/events/${popupEventId}/participants`,
        );
        people = flattenEventParticipants(roster).participants;
      } else {
        const roster = await apiClient.get(`/fests/${drillDownFestId}/participants`);
        people = Array.isArray(roster?.participants)
          ? roster.participants
          : Array.isArray(roster)
            ? roster
            : [];
      }

      if (kind === 'yetToCheckIn' && popupEventId) {
        const inScans = await apiClient.get(
          `/fests/${drillDownFestId}/events/${popupEventId}/scans?direction=IN`,
        );
        const checkedIn = new Set(
          (Array.isArray(inScans) ? inScans : []).map((row) => String(row.userId)),
        );
        people = people.filter((person) => !checkedIn.has(String(person.userId)));
      }
      setPopupData(people);
    } catch {
      setPopupData([]);
    } finally {
      setPopupLoading(false);
    }
  }, [drillDownFestId, popupEventId]);

  if (status === 'loading') {
    return <LoadingState />;
  }

  if (status === 'error') {
    return (
      <AdminExecutiveCard>
        <div className="flex flex-col items-start gap-3 py-6">
          <p className="font-admin-body text-[14px] text-admin-slate-600">{ADMIN_OVERVIEW_COPY.loadError}</p>
          <AdminExecutiveButton variant="secondary" onClick={loadDashboard}>
            Retry
          </AdminExecutiveButton>
        </div>
      </AdminExecutiveCard>
    );
  }

  const showActivityCard = activityAvailable && activityItems.length > 0;

  const tableColumns = [
    {
      key: 'festName',
      header: 'Fest',
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="font-admin-body text-[14px] font-medium text-admin-neutral-ink">{row.festName}</span>
          <AdminStatusPill status={row.status} />
        </div>
      ),
    },
    {
      key: 'startsOn',
      header: 'Starting Date',
      render: (row) => (
        <span className="font-admin-mono text-[13px] leading-[18px] text-admin-slate-600">
          {row.startsOn ? new Date(row.startsOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
        </span>
      ),
    },
    {
      key: 'endsOn',
      header: 'Ending Date',
      render: (row) => (
        <span className="font-admin-mono text-[13px] leading-[18px] text-admin-slate-600">
          {row.endsOn ? new Date(row.endsOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
        </span>
      ),
    },
    {
      key: 'offerClaims',
      header: ADMIN_OVERVIEW_COPY.columnOfferClaims,
      render: (row) =>
        row.offerClaims.length === 0 ? (
          <span className="font-admin-body text-[13px] text-admin-slate-600">—</span>
        ) : (
          <span className="font-admin-mono text-[13px] leading-[18px] tabular-nums text-admin-slate-600">
            {row.offerClaims
              .map((claim) =>
                ADMIN_OVERVIEW_COPY.offerClaimSummary(claim.offerName, claim.claimedCount, claim.bookedCount),
              )
              .join(' · ')}
          </span>
        ),
    },
    {
      key: 'registrations',
      header: 'Registered / Capacity',
      align: 'right',
      render: (row) => (
        <span className="font-admin-mono text-[13px] font-medium leading-[18px] tabular-nums text-admin-neutral-ink">
          {ADMIN_OVERVIEW_COPY.registrationsOfCapacity(row.registrations, row.capacityTotal)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: ADMIN_OVERVIEW_COPY.columnActions,
      width: '56px',
      align: 'right',
      render: (row) => {
        const items = [
          { key: 'edit', label: ADMIN_OVERVIEW_COPY.actionEdit, onSelect: () => navigate(editFestRoute(row.id)) },
          {
            key: 'structure',
            label: ADMIN_FEST_STRUCTURE_COPY.viewStructure,
            onSelect: () => navigate(`/admin/fests/${row.id}/structure`),
          },
        ];
        if (row.status === 'draft') {
          items.push({
            key: 'publish',
            label: ADMIN_OVERVIEW_COPY.actionPublish,
            onSelect: () => runFestTransition(`/fests/${row.id}/publish`),
          });
        }
        if (row.status === 'archived') {
          items.push({
            key: 'unarchive',
            label: ADMIN_OVERVIEW_COPY.actionUnarchive,
            onSelect: () => runFestTransition(`/fests/${row.id}/unarchive`),
          });
        } else {
          items.push({
            key: 'archive',
            label: ADMIN_OVERVIEW_COPY.actionArchive,
            tone: 'danger',
            onSelect: () => {
              if (window.confirm(ADMIN_OVERVIEW_COPY.confirmArchive)) {
                runFestTransition(`/fests/${row.id}/archive`);
              }
            },
          });
        }
        /*
         * Hard delete lives last and reddest. The server refuses any fest with
         * registrations (409, "cancel or archive instead"), so this is only a
         * cleanup tool for test fests — the guard is server-side, the confirm
         * here is just a double-check.
         */
        items.push({
          key: 'delete',
          label: ADMIN_OVERVIEW_COPY.deleteFestAction ?? 'Delete fest',
          tone: 'danger',
          onSelect: async () => {
            if (!window.confirm(ADMIN_OVERVIEW_COPY.deleteFestConfirm ?? 'Delete this fest permanently?')) {
              return;
            }
            setTransitionError('');
            try {
              await apiClient.delete(`/fests/${row.id}`);
              await loadDashboard();
            } catch (deleteException) {
              setTransitionError(deleteException.message || ADMIN_OVERVIEW_COPY.transitionFailed);
            }
          },
        });
        return <AdminActionsMenu items={items} label={ADMIN_OVERVIEW_COPY.actionsLabel} />;
      },
    },
  ];

  /*
   * Registered minus actually-arrived. Both numbers come from the same scoped
   * summary call, so the subtraction is always self-consistent — it can never
   * mix a fest-wide registration count with an event-scoped check-in count.
   */
  // The cascade's event selection rides along, so the drill-down opens already
  // narrowed instead of making the admin re-pick.
  /*
   * An EXPLICIT choice in the filter, not "some fest id happens to be resolved".
   * Every stat on this screen keys off this so the four cards, their drill-down
   * popups and the helper line can never disagree about whether a fest is chosen.
   */
  const hasFestSelection = Boolean(scope.festId);

  const yetToCheckInValue =
    drillDownSummary && typeof drillDownSummary.totalRegistrationsCount === 'number'
      ? Math.max(
          0,
          drillDownSummary.totalRegistrationsCount - (drillDownSummary.totalCheckInsCount ?? 0),
        ).toLocaleString('en-IN')
      : undefined;

  return (
    <div className="flex flex-col gap-6">
      <AdminErrorBanner message={transitionError} />

      {/* The shared cascade. It scopes the headline KPI cards and their
          drill-downs; the per-fest cards further down stay fest-level. */}
      <AdminHierarchyFilter
        fests={availableFests}
        selectedFestId={scope.festId}
        selectedEventId={scope.eventId}
        selectedSubEventId={scope.subEventId}
        onChange={handleScopeChange}
        className="sticky top-0 z-10 bg-admin-surface-off-white py-2"
      />

      {/*
        THE SAME FOUR CARDS EITHER WAY — zeroed and inert until a fest is picked.
        Swapping in a different pair of cards for the unselected state (which is
        what this did before) makes the row look like it is reporting something
        when it is reporting nothing, and the numbers move when the admin picks a
        fest for reasons that have nothing to do with their choice.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminKpiCard
          label="Total Registration"
          value={hasFestSelection ? drillDownSummary?.totalRegistrationsCount?.toLocaleString('en-IN') : '0'}
          icon={<Users size={18} strokeWidth={1.75} />}
          onSelect={hasFestSelection ? () => openPopup('registrations') : undefined}
        />
        <AdminKpiCard
          label="Total Check-in"
          value={hasFestSelection ? drillDownSummary?.totalCheckInsCount?.toLocaleString('en-IN') : '0'}
          icon={<LogIn size={18} strokeWidth={1.75} />}
          onSelect={hasFestSelection ? () => openPopup('checkIns') : undefined}
        />
        <AdminKpiCard
          label="Total Check-out"
          value={hasFestSelection ? drillDownSummary?.totalCheckOutsCount?.toLocaleString('en-IN') : '0'}
          icon={<LogOut size={18} strokeWidth={1.75} />}
          onSelect={hasFestSelection ? () => openPopup('checkOuts') : undefined}
        />
        <AdminKpiCard
          label="Yet to Check-in"
          value={hasFestSelection ? yetToCheckInValue : '0'}
          icon={<UserMinus size={18} strokeWidth={1.75} />}
          onSelect={hasFestSelection ? () => openPopup('yetToCheckIn') : undefined}
        />
      </div>

      {/* Says why the row reads zero, so it is not mistaken for "no registrations". */}
      {!hasFestSelection ? (
        <p className="font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
          {ADMIN_OVERVIEW_COPY.selectFestForStats}
        </p>
      ) : null}

      {/* CAMPUS ACCESS. A separate row, below the registration/check-in KPIs,
          because it answers a different question: not "how many signed up" but
          "how many are physically here right now". Rendered only when a fest is
          selected and the figures actually loaded. */}
      {scope.festId && gateStats ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AdminKpiCard
            label={ADMIN_OVERVIEW_COPY.campusEntriesLabel}
            value={gateStats.uniqueEntrantCount.toLocaleString('en-IN')}
            subtitle={ADMIN_OVERVIEW_COPY.campusEntriesSubtitle}
            icon={<DoorOpen size={18} strokeWidth={1.75} />}
          />
          <AdminKpiCard
            label={ADMIN_OVERVIEW_COPY.onCampusLabel}
            value={gateStats.currentlyOnCampus.toLocaleString('en-IN')}
            subtitle={ADMIN_OVERVIEW_COPY.onCampusSubtitle}
            icon={<Users size={18} strokeWidth={1.75} />}
          />
          <AdminKpiCard
            label={ADMIN_OVERVIEW_COPY.gateScansLabel}
            value={gateStats.totalGateScans.toLocaleString('en-IN')}
            subtitle={ADMIN_OVERVIEW_COPY.gateScansSubtitle}
            icon={<ScanLine size={18} strokeWidth={1.75} />}
          />
        </div>
      ) : null}

      {/* Popup modal for KPI drill-down */}
      {activePopup ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setActivePopup(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-[720px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-admin-slate-200 px-6 py-4">
              <div>
                <h2 className="font-admin-display text-[18px] font-semibold text-admin-neutral-ink">
                  {activePopup === 'registrations' && 'Total Registrations'}
                  {activePopup === 'checkIns' && 'Total Check-ins'}
                  {activePopup === 'checkOuts' && 'Total Check-outs'}
                  {activePopup === 'yetToCheckIn' && 'Yet to Check-in'}
                  {activePopup === 'confirmedRegistrations' && 'Confirmed Registrations'}
                </h2>
                <p className="font-admin-body text-[12px] text-admin-slate-600">
                  {[
                    availableFests.find((f) => f.id === scope.festId)?.festName ?? (scope.festId ? 'Selected Fest' : 'All Fests'),
                    scope.eventId ? 'Selected Event' : null,
                    scope.subEventId ? 'Selected Sub-event' : null,
                  ].filter(Boolean).join(' → ')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActivePopup(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-admin-slate-200 text-admin-slate-600 hover:bg-admin-slate-50"
              >
                ✕
              </button>
            </div>

            {/* Modal body */}
            <div className="overflow-auto px-6 py-4">
              {popupLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue" />
                </div>
              ) : popupData.length === 0 ? (
                <p className="py-8 text-center font-admin-body text-[14px] text-admin-slate-600">
                  {(activePopup === 'checkIns' || activePopup === 'checkOuts') && !popupEventId
                    ? 'Scan lists are per event — pick an event in the selector above to see who checked in or out.'
                    : 'No data available for the selected scope.'}
                </p>
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-admin-slate-200">
                      <th className="pb-2 font-admin-body text-[11px] font-semibold uppercase tracking-wide text-admin-slate-600">Name</th>
                      <th className="pb-2 font-admin-body text-[11px] font-semibold uppercase tracking-wide text-admin-slate-600">College</th>
                      <th className="pb-2 font-admin-body text-[11px] font-semibold uppercase tracking-wide text-admin-slate-600">Contact</th>
                      <th className="pb-2 font-admin-body text-[11px] font-semibold uppercase tracking-wide text-admin-slate-600">Email</th>
                      {(activePopup === 'registrations' || activePopup === 'yetToCheckIn') && (
                        <th className="pb-2 font-admin-body text-[11px] font-semibold uppercase tracking-wide text-admin-slate-600">Place</th>
                      )}
                      {activePopup === 'checkIns' && (
                        <th className="pb-2 font-admin-body text-[11px] font-semibold uppercase tracking-wide text-admin-slate-600">Check-in Time</th>
                      )}
                      {activePopup === 'checkOuts' && (
                        <th className="pb-2 font-admin-body text-[11px] font-semibold uppercase tracking-wide text-admin-slate-600">Check-out Time</th>
                      )}
                      {activePopup === 'confirmedRegistrations' && (
                        <>
                          <th className="pb-2 font-admin-body text-[11px] font-semibold uppercase tracking-wide text-admin-slate-600">Payment Mode</th>
                          <th className="pb-2 font-admin-body text-[11px] font-semibold uppercase tracking-wide text-admin-slate-600">Payment Date</th>
                          <th className="pb-2 font-admin-body text-[11px] font-semibold uppercase tracking-wide text-admin-slate-600">Payment Status</th>
                          <th className="pb-2 font-admin-body text-[11px] font-semibold uppercase tracking-wide text-admin-slate-600">Booking Status</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {popupData.map((p, idx) => (
                      <tr key={p.userId ?? idx} className="border-b border-admin-slate-100 last:border-0">
                        <td className="py-2 font-admin-body text-[13px] text-admin-neutral-ink">{p.fullName ?? p.name ?? '—'}</td>
                        <td className="py-2 font-admin-body text-[13px] text-admin-slate-600">{p.collegeName ?? p.college ?? '—'}</td>
                        <td className="py-2 font-admin-body text-[13px] text-admin-slate-600">{p.phoneNumber ?? p.contact ?? '—'}</td>
                        <td className="py-2 font-admin-body text-[13px] text-admin-slate-600">{p.emailAddress ?? p.email ?? '—'}</td>
                        {(activePopup === 'registrations' || activePopup === 'yetToCheckIn') && (
                          <td className="py-2 font-admin-body text-[13px] text-admin-slate-600">{p.city ?? p.place ?? '—'}</td>
                        )}
                        {activePopup === 'checkIns' && (
                          <td className="py-2 font-admin-mono text-[13px] text-admin-slate-600">
                            {p.checkInTime ?? p.scannedAt ? new Date(p.checkInTime ?? p.scannedAt).toLocaleString('en-IN') : '—'}
                          </td>
                        )}
                        {activePopup === 'checkOuts' && (
                          <td className="py-2 font-admin-mono text-[13px] text-admin-slate-600">
                            {p.checkOutTime ?? p.scannedAt ? new Date(p.checkOutTime ?? p.scannedAt).toLocaleString('en-IN') : '—'}
                          </td>
                        )}
                        {activePopup === 'confirmedRegistrations' && (
                          <>
                            <td className="py-2 font-admin-body text-[13px] text-admin-slate-600">{p.paymentMode ?? '—'}</td>
                            <td className="py-2 font-admin-mono text-[13px] text-admin-slate-600">
                              {p.paymentDate ? new Date(p.paymentDate).toLocaleString('en-IN') : '—'}
                            </td>
                            <td className="py-2 font-admin-body text-[13px] text-admin-slate-600">{p.paymentStatus ?? '—'}</td>
                            <td className="py-2 font-admin-body text-[13px] text-admin-slate-600">{p.bookingStatus ?? '—'}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/*
        A SINGLE COLUMN, not a 60/40 split. Both of these are wide-form reads — a
        trend across days and a run of activity lines — and squeezing them into
        two columns on a console that is already desktop-only wastes the width on
        gutters while truncating the very thing each card is for.
      */}
      <div className="flex flex-col gap-6">
        <div>
          <AdminExecutiveCard
            title={ADMIN_OVERVIEW_COPY.trendsTitle}
            actions={
              <div className="flex items-center gap-1 rounded-md border border-admin-slate-200 p-0.5">
                {[ADMIN_OVERVIEW_COPY.trends7Day, ADMIN_OVERVIEW_COPY.trends30Day].map((rangeLabel) => (
                  <button
                    key={rangeLabel}
                    type="button"
                    onClick={() => setTrendRange(rangeLabel)}
                    className={[
                      'rounded px-2.5 py-1 font-admin-body text-[12px] font-semibold transition-colors',
                      trendRange === rangeLabel
                        ? 'bg-admin-primary-blue text-admin-surface-white'
                        : 'text-admin-slate-600 hover:text-admin-neutral-ink',
                    ].join(' ')}
                  >
                    {rangeLabel}
                  </button>
                ))}
              </div>
            }
          >
            {/* No per-day time-series endpoint exists yet — honest placeholder,
                never fabricated bars. */}
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-admin-primary-blue/10">
                <BarChart3 size={22} strokeWidth={1.75} className="text-admin-primary-blue" />
              </span>
              <div>
                <p className="font-admin-body text-[15px] font-medium text-admin-neutral-ink">
                  {ADMIN_OVERVIEW_COPY.trendsUnavailableTitle}
                </p>
                <p className="mt-1 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
                  {ADMIN_OVERVIEW_COPY.trendsUnavailableBody}
                </p>
              </div>
            </div>
          </AdminExecutiveCard>
        </div>

        {showActivityCard ? (
          <div>
            <AdminExecutiveCard
              title={ADMIN_ACTIVITY_COPY.title}
              actions={
                <button
                  type="button"
                  onClick={() => navigate(AUDIT_LOG_ROUTE)}
                  className="font-admin-body text-[13px] font-medium text-admin-primary-blue transition-colors hover:text-admin-primary-blue-dark"
                >
                  {ADMIN_ACTIVITY_COPY.viewAll}
                </button>
              }
            >
              <AdminActivityFeed items={activityItems} />
            </AdminExecutiveCard>
          </div>
        ) : null}
      </div>

      {/* Fests table, or a full-width empty state when there are none. */}
      {festSummaries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-admin-slate-200 bg-admin-surface-white px-6 py-16 text-center">
          <div>
            <p className="font-admin-display text-[20px] font-semibold text-admin-neutral-ink">
              {ADMIN_OVERVIEW_COPY.festsEmptyTitle}
            </p>
            <p className="mt-1 font-admin-body text-[14px] text-admin-slate-600">
              {ADMIN_OVERVIEW_COPY.festsEmptyBody}
            </p>
          </div>
          <AdminExecutiveButton variant="primary" size="large" onClick={() => navigate(CREATE_FEST_ROUTE)}>
            {ADMIN_OVERVIEW_COPY.createFestButton}
          </AdminExecutiveButton>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-admin-display text-[20px] font-semibold leading-7 text-admin-neutral-ink">
              {ADMIN_OVERVIEW_COPY.festsTitle}
            </h2>
          </div>
          {/* Scrolls inside the card once the list is long, instead of the
              last rows running past the bottom of the viewport. */}
          <AdminExecutiveTable
            columns={tableColumns}
            rows={festSummaries}
            rowKey={(row) => row.id}
            maxBodyHeight="60vh"
          />
        </div>
      )}
    </div>
  );
}

export default AdminOverviewScreen;

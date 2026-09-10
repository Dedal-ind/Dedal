// AdminCollegeApplicationsScreen.jsx
// Route: /admin/college-applications — the platform owner's queue of colleges
// applying to join. Superadmin-only at every layer: the sidebar item is flagged
// platformAdminOnly, the route sits inside PlatformAdminRoute in App.jsx, and
// the backend gates the endpoints behind the platform-admin check anyway.
//
// Backend contract:
//   · GET /admin/college-applications?status=pending|underReview|approved|rejected
//     (omit for all) → { applications } newest first.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminSegmentedToggle from '../../components-admin/admin-segmented-toggle/AdminSegmentedToggle.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import ApplicationStatusChip from './ApplicationStatusChip.jsx';
import { ADMIN_COLLEGE_APPLICATIONS_COPY as COPY } from '../../brand-admin/brand-copy.js';
import { formatRelativeTime, formatAbsoluteDateTime } from '../../helpers/admin-format.js';

const ALL = 'all';
const COPIED_RESET_MS = 1500;

function AdminCollegeApplicationsScreen() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('pending');
  // The result remembers which filter produced it, so "loading" is derived
  // (result stale vs the current filter) instead of set synchronously in the
  // effect — which the react-hooks lint rightly flags as a cascading render.
  const [result, setResult] = useState(null); // { filter, applications } | { filter, error: true }
  // Which row most recently had its email copied. Only one row can be in the
  // "Copied" state at a time, so a single id plus a single timer is enough.
  const [copiedApplicationId, setCopiedApplicationId] = useState(null);
  const copiedTimeoutRef = useRef(null);

  // The revert timer must not fire after the screen goes away.
  useEffect(
    () => () => {
      window.clearTimeout(copiedTimeoutRef.current);
    },
    [],
  );

  async function handleCopyEmail(row) {
    try {
      await navigator.clipboard.writeText(row.applicantEmail ?? '');
    } catch {
      // Clipboard access can be denied (insecure origin, permission). Nothing
      // useful to say inline — leave the button unchanged rather than lie.
      return;
    }
    window.clearTimeout(copiedTimeoutRef.current);
    setCopiedApplicationId(row.id);
    copiedTimeoutRef.current = window.setTimeout(() => setCopiedApplicationId(null), COPIED_RESET_MS);
  }

  useEffect(() => {
    let isActive = true;
    const query = filter === ALL ? '' : `?status=${filter}`;
    apiClient
      .get(`/admin/college-applications${query}`)
      .then((payload) => {
        if (!isActive) {
          return;
        }
        setResult({
          filter,
          applications: Array.isArray(payload?.applications) ? payload.applications : [],
        });
      })
      .catch(() => isActive && setResult({ filter, error: true }));
    return () => {
      isActive = false;
    };
  }, [filter]);

  const isLoading = result?.filter !== filter;
  const applications = result?.applications ?? [];

  const filterOptions = [
    { value: 'pending', label: COPY.filterPending },
    { value: 'underReview', label: COPY.filterUnderReview },
    { value: 'approved', label: COPY.filterApproved },
    { value: 'rejected', label: COPY.filterRejected },
    { value: ALL, label: COPY.filterAll },
  ];

  const columns = [
    {
      key: 'college',
      header: COPY.columnCollege,
      render: (row) => (
        <span className="flex min-w-0 max-w-[280px] items-center gap-2">
          <span className="min-w-0 truncate font-admin-body text-[14px] font-medium text-admin-neutral-ink">
            {row.collegeName}
          </span>
          {row.linkedCollegeId ? (
            <span className="shrink-0 rounded-full border border-admin-slate-200 bg-admin-surface-off-white px-2 py-0.5 font-admin-body text-[11px] font-medium leading-4 text-admin-slate-600">
              {COPY.directoryEntryTag}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'applicant',
      header: COPY.columnApplicant,
      render: (row) => (
        <span className="min-w-0">
          <span className="block truncate font-admin-body text-[14px] text-admin-neutral-ink">
            {row.applicantFullName}
          </span>
          {/* The email is the operator's actual working handle on an applicant —
              it stays whole (no truncate) and carries a title for long addresses. */}
          <span
            title={row.applicantEmail || undefined}
            className="block font-admin-mono text-[13px] leading-[18px] text-admin-neutral-ink"
          >
            {row.applicantEmail || COPY.notProvided}
          </span>
        </span>
      ),
    },
    {
      key: 'submitted',
      header: COPY.columnSubmitted,
      render: (row) => (
        <span
          title={formatAbsoluteDateTime(row.createdAt) ?? undefined}
          className="font-admin-mono text-[13px] text-admin-slate-600"
        >
          {formatRelativeTime(row.createdAt) ?? COPY.notProvided}
        </span>
      ),
    },
    {
      key: 'status',
      header: COPY.columnStatus,
      render: (row) => <ApplicationStatusChip status={row.status} />,
    },
    {
      key: 'actions',
      header: COPY.columnActions,
      align: 'right',
      width: '220px',
      render: (row) => (
        <span className="flex items-center justify-end gap-2">
          {/* stopPropagation: the whole row navigates on click, and copying an
              email must not also open the detail screen. */}
          <AdminExecutiveButton
            variant="secondary"
            size="small"
            disabled={!row.applicantEmail}
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              handleCopyEmail(row);
            }}
          >
            {copiedApplicationId === row.id ? COPY.copyEmailCopied : COPY.copyEmailAction}
          </AdminExecutiveButton>
          <AdminExecutiveButton
            variant="secondary"
            size="small"
            onClick={() => navigate(`/admin/college-applications/${row.id}`)}
          >
            {COPY.reviewAction}
          </AdminExecutiveButton>
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-6">
      <div>
        <p className="mt-1 font-admin-body text-[14px] leading-5 text-admin-slate-600">{COPY.intro}</p>
      </div>

      <AdminSegmentedToggle options={filterOptions} value={filter} onChange={setFilter} name="application-status" />

      {!isLoading && result?.error ? (
        <AdminErrorBanner message={COPY.loadFailed} />
      ) : isLoading ? (
        <div className="flex h-[40vh] items-center justify-center">
          <span
            aria-label="Loading"
            className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
          />
        </div>
      ) : (
        <AdminExecutiveTable
          columns={columns}
          rows={applications}
          emptyMessage={COPY.empty}
          onRowClick={(row) => navigate(`/admin/college-applications/${row.id}`)}
        />
      )}
    </div>
  );
}

export default AdminCollegeApplicationsScreen;

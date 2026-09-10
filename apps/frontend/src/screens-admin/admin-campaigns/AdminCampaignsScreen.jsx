// AdminCampaignsScreen.jsx
// Route: /admin/system/campaigns — the campaign list. Paginated, filterable by
// promoter, status, placement and flight state. Row actions are status-aware:
// only transitions valid for the current state are offered.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveSelect from '../../components-admin/admin-executive-select/AdminExecutiveSelect.jsx';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminExecutiveChip from '../../components-admin/admin-executive-chip/AdminExecutiveChip.jsx';
import AdminActionsMenu from '../../components-admin/admin-actions-menu/AdminActionsMenu.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import AdminModal from '../../components-admin/admin-modal/AdminModal.jsx';
import AdminPager from '../../components-admin/admin-pager/AdminPager.jsx';
import AdminScreenState from '../../components-admin/admin-screen-state/AdminScreenState.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { ADMIN_CAMPAIGNS_COPY as COPY } from '../../brand-admin/brand-copy.js';
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_FLIGHT_STATES,
  PLACEMENT_OPTIONS,
  isNetworkError,
  placementLabel,
  campaignsApi,
  promotersApi,
  campaignPath,
} from '../../helpers/admin-promotions-api.js';

const PAGE_SIZE = 20;

const STATUS_CHIP = {
  draft: { tone: 'neutral', label: COPY.flightState.upcoming ?? 'DRAFT' },
  published: { tone: 'success', label: 'PUBLISHED' },
  paused: { tone: 'warning', label: 'PAUSED' },
  archived: { tone: 'neutral', label: 'ARCHIVED' },
};

const FLIGHT_CHIP = {
  live: { tone: 'success', label: 'Live' },
  upcoming: { tone: 'info', label: 'Upcoming' },
  ended: { tone: 'neutral', label: 'Ended' },
};

export function CampaignStatusChip({ status, flightState }) {
  const s = STATUS_CHIP[status] ?? { tone: 'neutral', label: (status ?? '').toUpperCase() };
  const f = status === 'published' && flightState ? FLIGHT_CHIP[flightState] : null;
  return (
    <span className="flex items-center gap-1.5">
      <AdminExecutiveChip tone={s.tone}>{s.label}</AdminExecutiveChip>
      {f ? <AdminExecutiveChip tone={f.tone}>{f.label}</AdminExecutiveChip> : null}
    </span>
  );
}

function AdminCampaignsScreen() {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const [searchParameters, setSearchParameters] = useSearchParams();

  const promoterId = searchParameters.get('promoterId') ?? '';
  const statusFilter = searchParameters.get('status') ?? '';
  const placementKey = searchParameters.get('placementKey') ?? '';
  const flight = searchParameters.get('flight') ?? '';
  const page = Math.max(1, Number(searchParameters.get('page') ?? 1) || 1);

  const setFilter = (changes) => {
    const next = new URLSearchParams(searchParameters);
    for (const [key, value] of Object.entries(changes)) {
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
    }
    if (!('page' in changes)) {
      next.delete('page');
    }
    setSearchParameters(next);
  };

  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState({ campaigns: [], total: 0 });
  const [promoters, setPromoters] = useState([]);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError('');
    try {
      const [campaignResult, promoterResult] = await Promise.all([
        campaignsApi.list({ promoterId, status: statusFilter, placementKey, flight, page, limit: PAGE_SIZE }),
        promoters.length > 0 ? Promise.resolve(null) : promotersApi.list({ limit: 200 }),
      ]);
      const rows = campaignResult.data?.campaigns ?? campaignResult.campaigns ?? [];
      setResult({ campaigns: rows, total: campaignResult.data?.total ?? campaignResult.total ?? 0 });
      if (promoterResult) {
        setPromoters(promoterResult.promoters ?? []);
      }
      setStatus('ready');
    } catch (error) {
      setLoadError(isNetworkError(error) ? '' : error?.message || COPY.loadFailed);
      setStatus(isNetworkError(error) ? 'offline' : 'error');
    }
  }, [promoterId, statusFilter, placementKey, flight, page, promoters.length]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function runAction(action, successNotice) {
    setActionError('');
    setNotice('');
    try {
      await action();
      setNotice(successNotice);
      await load();
    } catch (error) {
      setActionError(error?.message || COPY.actionFailed);
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    setIsDeleting(true);
    await runAction(() => campaignsApi.remove(target.id), COPY.deletedNotice(target.name));
    setIsDeleting(false);
    setDeleteTarget(null);
  }

  function actionsForRow(row) {
    const items = [
      { key: 'open', label: COPY.openAction, onSelect: () => navigate(campaignPath(row.id)) },
      { key: 'report', label: 'View report', onSelect: () => navigate(`/admin/system/reporting/campaigns/${row.id}`) },
    ];
    if (row.status === 'draft') {
      items.push({ key: 'publish', label: COPY.publishAction, onSelect: () => runAction(() => campaignsApi.publish(row.id), COPY.publishedNotice(row.name)) });
      items.push({ key: 'delete', label: COPY.deleteAction, tone: 'danger', onSelect: () => setDeleteTarget(row) });
    }
    if (row.status === 'published') {
      items.push({ key: 'pause', label: COPY.pauseAction, onSelect: () => runAction(() => campaignsApi.pause(row.id), COPY.pausedNotice(row.name)) });
    }
    if (row.status === 'paused') {
      items.push({ key: 'resume', label: COPY.resumeAction, onSelect: () => runAction(() => campaignsApi.resume(row.id), COPY.resumedNotice(row.name)) });
    }
    if (row.status !== 'archived') {
      items.push({ key: 'archive', label: COPY.archiveAction, tone: 'danger', onSelect: () => runAction(() => campaignsApi.archive(row.id), COPY.archivedNotice(row.name)) });
    }
    return items;
  }

  function formatFlight(row) {
    if (!row.flightStartsAt) return '—';
    const start = new Date(row.flightStartsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const end = row.flightEndsAt ? new Date(row.flightEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '?';
    return `${start} – ${end}`;
  }

  const isFirstRun = status === 'ready' && result.total === 0 && !promoterId && !statusFilter && !placementKey && !flight;

  const columns = [
    {
      key: 'name',
      header: COPY.columnName,
      render: (row) => (
        <span className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">{row.name}</span>
      ),
    },
    {
      key: 'promoter',
      header: COPY.columnPromoter,
      render: (row) => row.promoter?.displayName ?? '—',
    },
    {
      key: 'status',
      header: COPY.columnStatus,
      render: (row) => <CampaignStatusChip status={row.status} flightState={row.flightState} />,
    },
    {
      key: 'flight',
      header: COPY.columnFlight,
      render: (row) => formatFlight(row),
    },
    {
      key: 'placements',
      header: COPY.columnPlacements,
      render: (row) => (row.placementKeys ?? []).map(placementLabel).join(', ') || '—',
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <AdminActionsMenu label={COPY.rowActionsLabel(row.name)} items={actionsForRow(row)} />
      ),
    },
  ];

  const promoterOptions = promoters.map((p) => ({ value: p.id, label: p.displayName }));

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="font-admin-body text-[14px] leading-5 text-admin-slate-600">{COPY.intro}</p>
        <AdminExecutiveButton variant="primary" iconLeft={<Megaphone size={15} />} onClick={() => navigate('/admin/system/campaigns/new')}>
          {COPY.createButton}
        </AdminExecutiveButton>
      </div>

      {isFirstRun ? null : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[200px]">
            <AdminExecutiveSelect
              label={COPY.promoterLabel}
              value={promoterId}
              onChange={(e) => setFilter({ promoterId: e.target.value })}
              placeholder={COPY.anyPromoter}
              options={promoterOptions}
            />
          </div>
          <div className="w-[160px]">
            <AdminExecutiveSelect
              label={COPY.statusLabel}
              value={statusFilter}
              onChange={(e) => setFilter({ status: e.target.value })}
              placeholder={COPY.anyStatus}
              options={CAMPAIGN_STATUSES}
            />
          </div>
          <div className="w-[180px]">
            <AdminExecutiveSelect
              label={COPY.placementLabel}
              value={placementKey}
              onChange={(e) => setFilter({ placementKey: e.target.value })}
              placeholder={COPY.anyPlacement}
              options={PLACEMENT_OPTIONS}
            />
          </div>
          <div className="w-[140px]">
            <AdminExecutiveSelect
              label={COPY.flightLabel}
              value={flight}
              onChange={(e) => setFilter({ flight: e.target.value })}
              placeholder={COPY.anyFlight}
              options={CAMPAIGN_FLIGHT_STATES}
            />
          </div>
        </div>
      )}

      <AdminErrorBanner message={actionError} />
      {notice ? (
        <div role="status" className="rounded-md border border-admin-status-success-green/30 bg-admin-status-success-green/5 px-4 py-3 font-admin-body text-[14px] leading-5 text-admin-status-success-green">
          {notice}
        </div>
      ) : null}

      {status === 'loading' ? <AdminScreenState tone="loading" message={COPY.loading} /> : null}
      {status === 'offline' || (status === 'error' && !isOnline) ? (
        <AdminScreenState tone="offline" message={COPY.offline} actionLabel={COPY.retry} onAction={load} />
      ) : null}
      {status === 'error' && isOnline ? (
        <AdminScreenState tone="error" message={loadError || COPY.loadFailed} actionLabel={COPY.retry} onAction={load} />
      ) : null}
      {isFirstRun ? (
        <AdminScreenState
          tone="empty"
          headline={COPY.emptyHeadline}
          message={COPY.emptyBody}
          actionLabel={COPY.createButton}
          icon={<Megaphone size={15} />}
          onAction={() => navigate('/admin/system/campaigns/new')}
        />
      ) : null}
      {status === 'ready' && !isFirstRun ? (
        <AdminExecutiveCard bodyClassName="p-0">
          <AdminExecutiveTable
            columns={columns}
            rows={result.campaigns}
            onRowClick={(row) => navigate(campaignPath(row.id))}
            emptyMessage={COPY.noMatches}
          />
          <AdminPager
            page={page}
            limit={PAGE_SIZE}
            total={result.total}
            onPageChange={(nextPage) => setFilter({ page: String(nextPage) })}
            labels={{ showingRange: COPY.showingRange, prev: COPY.prev, next: COPY.next }}
          />
        </AdminExecutiveCard>
      ) : null}

      <AdminModal
        isOpen={Boolean(deleteTarget)}
        title={COPY.deleteModalTitle}
        confirmLabel={COPY.deleteAction}
        cancelLabel={COPY.cancel}
        tone="danger"
        isBusy={isDeleting}
        onConfirm={confirmDelete}
        onCancel={() => (isDeleting ? null : setDeleteTarget(null))}
      >
        {deleteTarget ? COPY.deleteModalBody(deleteTarget.name) : ''}
      </AdminModal>
    </div>
  );
}

export default AdminCampaignsScreen;

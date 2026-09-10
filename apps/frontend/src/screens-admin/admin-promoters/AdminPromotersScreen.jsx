// AdminPromotersScreen.jsx
// Route: /admin/system/promoters — who is being promoted: colleges, fest
// organisers and sponsors. Platform-admin only, like promotions. A paginated
// table with search and filters, create and edit in a modal, archive and
// restore from the row menu.
//
// ARCHIVE IS GUARDED BY THE SERVER, and the refusal is specific: a promoter
// with published campaigns comes back with those campaigns named. This screen
// shows them by name so the admin knows exactly what to pause first, rather
// than a generic "could not archive".

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveInput from '../../components-admin/admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveSelect from '../../components-admin/admin-executive-select/AdminExecutiveSelect.jsx';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminExecutiveChip from '../../components-admin/admin-executive-chip/AdminExecutiveChip.jsx';
import AdminActionsMenu from '../../components-admin/admin-actions-menu/AdminActionsMenu.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import AdminModal from '../../components-admin/admin-modal/AdminModal.jsx';
import AdminPager from '../../components-admin/admin-pager/AdminPager.jsx';
import AdminScreenState from '../../components-admin/admin-screen-state/AdminScreenState.jsx';
import AdminPromoterFormModal from '../../components-admin/admin-promoter-form-modal/AdminPromoterFormModal.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { ADMIN_PROMOTERS_COPY as COPY } from '../../brand-admin/brand-copy.js';
import {
  PROMOTER_KINDS,
  PROMOTER_STATUSES,
  REFUSAL_CODES,
  isNetworkError,
  kindLabel,
  promotersApi,
  promoterPath,
} from '../../helpers/admin-promotions-api.js';

const PAGE_SIZE = 20;

export function PromoterStatusChip({ status }) {
  return status === 'inactive' ? (
    <AdminExecutiveChip tone="warning">{COPY.statusArchived}</AdminExecutiveChip>
  ) : (
    <AdminExecutiveChip tone="success">{COPY.statusActive}</AdminExecutiveChip>
  );
}

/*
 * The archive refusal, rendered as an alert that names and links every
 * published campaign the server reported. Shared with the detail screen.
 */
export function PublishedCampaignsRefusal({ campaigns, body }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-admin-status-error-red/30 bg-admin-status-error-red/5 px-4 py-3 font-admin-body text-[14px] leading-5 text-admin-neutral-ink"
    >
      <p>{body}</p>
      <ul className="mt-2 list-disc pl-5">
        {campaigns.map((campaign) => (
          <li key={campaign.id}>{campaign.name}</li>
        ))}
      </ul>
    </div>
  );
}

function AdminPromotersScreen() {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const [searchParameters, setSearchParameters] = useSearchParams();

  /* Filters live in the URL so a reload or a shared link lands on the same list. */
  const search = searchParameters.get('search') ?? '';
  const kind = searchParameters.get('kind') ?? '';
  const statusFilter = searchParameters.get('status') ?? '';
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
  const [result, setResult] = useState({ promoters: [], total: 0 });
  const [searchDraft, setSearchDraft] = useState(search);
  const [actionError, setActionError] = useState('');
  const [refusal, setRefusal] = useState(null);
  const [notice, setNotice] = useState('');
  const [formTarget, setFormTarget] = useState(undefined); // undefined closed, null create, object edit
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [isArchiving, setIsArchiving] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError('');
    try {
      const payload = await promotersApi.list({ search, kind, status: statusFilter, page, limit: PAGE_SIZE });
      const rows = payload.promoters ?? [];
      setResult({ promoters: rows, total: payload.total ?? 0 });
      setStatus('ready');
    } catch (error) {
      setLoadError(isNetworkError(error) ? '' : error?.message || COPY.loadFailed);
      setStatus(isNetworkError(error) ? 'offline' : 'error');
    }
  }, [search, kind, statusFilter, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function runAction(action, successNotice) {
    setActionError('');
    setRefusal(null);
    setNotice('');
    try {
      await action();
      setNotice(successNotice);
      await load();
    } catch (error) {
      if (error?.code === REFUSAL_CODES.PROMOTER_HAS_PUBLISHED) {
        setRefusal(error.details?.publishedCampaigns ?? []);
      } else {
        setActionError(error?.message || COPY.actionFailed);
      }
    }
  }

  async function confirmArchive() {
    const target = archiveTarget;
    setIsArchiving(true);
    await runAction(() => promotersApi.archive(target.id), COPY.archivedNotice(target.displayName));
    setIsArchiving(false);
    setArchiveTarget(null);
  }

  const isFirstRun = status === 'ready' && result.total === 0 && !search && !kind && !statusFilter;

  const columns = [
    {
      key: 'displayName',
      header: COPY.columnName,
      render: (row) => (
        <span className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">{row.displayName}</span>
      ),
    },
    { key: 'kind', header: COPY.columnKind, render: (row) => kindLabel(row.kind) },
    { key: 'status', header: COPY.columnStatus, render: (row) => <PromoterStatusChip status={row.status} /> },
    { key: 'creativeCount', header: COPY.columnCreatives, numeric: true, render: (row) => row.creativeCount ?? '—' },
    { key: 'campaignCount', header: COPY.columnCampaigns, numeric: true, render: (row) => row.campaignCount ?? '—' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <AdminActionsMenu
          label={COPY.rowActionsLabel(row.displayName)}
          items={[
            { key: 'open', label: COPY.openAction, onSelect: () => navigate(promoterPath(row.id)) },
            { key: 'edit', label: COPY.editAction, onSelect: () => setFormTarget(row) },
            row.status === 'inactive'
              ? { key: 'restore', label: COPY.restoreAction, onSelect: () => runAction(() => promotersApi.restore(row.id), COPY.restoredNotice(row.displayName)) }
              : { key: 'archive', label: COPY.archiveAction, tone: 'danger', onSelect: () => setArchiveTarget(row) },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="font-admin-body text-[14px] leading-5 text-admin-slate-600">{COPY.intro}</p>
        <AdminExecutiveButton variant="primary" iconLeft={<Building2 size={15} />} onClick={() => setFormTarget(null)}>
          {COPY.createButton}
        </AdminExecutiveButton>
      </div>

      {isFirstRun ? null : (
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="w-[280px]"
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault();
              setFilter({ search: searchDraft.trim() });
            }}
          >
            <AdminExecutiveInput
              label={COPY.searchLabel}
              placeholder={COPY.searchPlaceholder}
              value={searchDraft}
              onChange={(changeEvent) => setSearchDraft(changeEvent.target.value)}
            />
          </form>
          <div className="w-[180px]">
            <AdminExecutiveSelect
              label={COPY.kindLabel}
              value={kind}
              onChange={(changeEvent) => setFilter({ kind: changeEvent.target.value })}
              placeholder={COPY.anyKind}
              options={PROMOTER_KINDS}
            />
          </div>
          <div className="w-[160px]">
            <AdminExecutiveSelect
              label={COPY.statusLabel}
              value={statusFilter}
              onChange={(changeEvent) => setFilter({ status: changeEvent.target.value })}
              placeholder={COPY.anyStatus}
              options={PROMOTER_STATUSES}
            />
          </div>
        </div>
      )}

      <AdminErrorBanner message={actionError} />
      {refusal ? <PublishedCampaignsRefusal campaigns={refusal} body={COPY.archiveRefusedBody} /> : null}
      {notice ? (
        <div
          role="status"
          className="rounded-md border border-admin-status-success-green/30 bg-admin-status-success-green/5 px-4 py-3 font-admin-body text-[14px] leading-5 text-admin-status-success-green"
        >
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
          icon={<Building2 size={15} />}
          onAction={() => setFormTarget(null)}
        />
      ) : null}
      {status === 'ready' && !isFirstRun ? (
        <AdminExecutiveCard bodyClassName="p-0">
          <AdminExecutiveTable
            columns={columns}
            rows={result.promoters}
            onRowClick={(row) => navigate(promoterPath(row.id))}
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

      <AdminPromoterFormModal
        isOpen={formTarget !== undefined}
        promoter={formTarget ?? null}
        onClose={() => setFormTarget(undefined)}
        onSaved={(saved) => {
          setFormTarget(undefined);
          setNotice(COPY.savedNotice(saved.displayName));
          load();
        }}
      />

      <AdminModal
        isOpen={Boolean(archiveTarget)}
        title={COPY.archiveModalTitle}
        confirmLabel={COPY.archiveAction}
        cancelLabel={COPY.cancel}
        tone="danger"
        isBusy={isArchiving}
        onConfirm={confirmArchive}
        onCancel={() => (isArchiving ? null : setArchiveTarget(null))}
      >
        {archiveTarget ? COPY.archiveModalBody(archiveTarget.displayName) : ''}
      </AdminModal>
    </div>
  );
}

export default AdminPromotersScreen;

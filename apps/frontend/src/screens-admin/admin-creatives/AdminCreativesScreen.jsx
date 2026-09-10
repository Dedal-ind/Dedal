// AdminCreativesScreen.jsx
// Route: /admin/system/promoters/:promoterId/creatives — one promoter's
// creative library. A VISUAL library: every card shows the artwork, because an
// admin choosing what to run needs to see it, not read a filename. Paginated,
// with filters for media kind, status and whether the creative is in use.
//
// Attaching to a campaign is NOT done here; that belongs to the campaign
// console. This screen creates, edits, archives and restores artwork.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ImagePlus, Video } from 'lucide-react';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveSelect from '../../components-admin/admin-executive-select/AdminExecutiveSelect.jsx';
import AdminExecutiveChip from '../../components-admin/admin-executive-chip/AdminExecutiveChip.jsx';
import AdminActionsMenu from '../../components-admin/admin-actions-menu/AdminActionsMenu.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import AdminModal from '../../components-admin/admin-modal/AdminModal.jsx';
import AdminPager from '../../components-admin/admin-pager/AdminPager.jsx';
import AdminScreenState from '../../components-admin/admin-screen-state/AdminScreenState.jsx';
import AdminCreativeFormModal from '../../components-admin/admin-creative-form-modal/AdminCreativeFormModal.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { ADMIN_CREATIVES_COPY as COPY } from '../../brand-admin/brand-copy.js';
import {
  CREATIVE_MEDIA_TYPES,
  REFUSAL_CODES,
  isNetworkError,
  creativesApi,
  promotersApi,
  promoterPath,
} from '../../helpers/admin-promotions-api.js';
import { PublishedCampaignsRefusal } from '../admin-promoters/AdminPromotersScreen.jsx';

const PAGE_SIZE = 24;
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
];
const IN_USE_OPTIONS = [
  { value: 'true', label: 'In use' },
  { value: 'false', label: 'Not in use' },
];

function CreativeCard({ creative, onEdit, onArchive, onRestore }) {
  const isArchived = creative.status === 'archived';
  return (
    <li className={`overflow-hidden rounded-lg border border-admin-slate-200 bg-admin-surface-white ${isArchived ? 'opacity-70' : ''}`}>
      <div className="relative aspect-video w-full bg-admin-surface-off-white">
        {creative.imageUrl ? (
          <img src={creative.imageUrl} alt={creative.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-admin-body text-[12px] text-admin-slate-600">
            {COPY.noArtwork}
          </div>
        )}
        {creative.mediaType === 'video' ? (
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-admin-neutral-ink/80 px-2 py-0.5 font-admin-body text-[10px] font-semibold uppercase tracking-wide text-white">
            <Video size={10} aria-hidden="true" /> {COPY.videoBadge}
          </span>
        ) : null}
      </div>
      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate font-admin-body text-[14px] font-semibold text-admin-neutral-ink">{creative.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {isArchived ? <AdminExecutiveChip tone="warning">{COPY.statusArchived}</AdminExecutiveChip> : null}
            <AdminExecutiveChip tone={creative.campaignCount > 0 ? 'info' : 'neutral'}>
              {COPY.usedIn(creative.campaignCount ?? 0)}
            </AdminExecutiveChip>
          </div>
        </div>
        <AdminActionsMenu
          label={COPY.rowActionsLabel(creative.title)}
          items={[
            { key: 'edit', label: COPY.editAction, onSelect: onEdit, disabled: isArchived },
            isArchived
              ? { key: 'restore', label: COPY.restoreAction, onSelect: onRestore }
              : { key: 'archive', label: COPY.archiveAction, tone: 'danger', onSelect: onArchive },
          ]}
        />
      </div>
    </li>
  );
}

function AdminCreativesScreen() {
  const { promoterId } = useParams();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const mediaType = searchParameters.get('mediaType') ?? '';
  const statusFilter = searchParameters.get('status') ?? '';
  const inUse = searchParameters.get('inUse') ?? '';
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
  const [promoter, setPromoter] = useState(null);
  const [result, setResult] = useState({ creatives: [], total: 0 });
  const [actionError, setActionError] = useState('');
  const [refusal, setRefusal] = useState(null);
  const [notice, setNotice] = useState('');
  const [formTarget, setFormTarget] = useState(undefined); // undefined closed, null create, detail object edit
  const [archiveTarget, setArchiveTarget] = useState(null);
  const [isArchiving, setIsArchiving] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError('');
    try {
      const [detail, list] = await Promise.all([
        promotersApi.get(promoterId),
        creativesApi.list({ promoterId, mediaType, status: statusFilter, inUse, page, limit: PAGE_SIZE }),
      ]);
      setPromoter(detail);
      setResult({ creatives: list.creatives ?? [], total: list.total ?? 0 });
      setStatus('ready');
    } catch (error) {
      setLoadError(isNetworkError(error) ? '' : error?.message || COPY.loadFailed);
      setStatus(isNetworkError(error) ? 'offline' : 'error');
    }
  }, [promoterId, mediaType, statusFilter, inUse, page]);

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
      if (error?.code === REFUSAL_CODES.CREATIVE_IN_PUBLISHED) {
        setRefusal(error.details?.publishedCampaigns ?? []);
      } else {
        setActionError(error?.message || COPY.actionFailed);
      }
    }
  }

  /* Edit needs the detail read: it carries the campaigns the live-edit warning names. */
  async function openEdit(creative) {
    setActionError('');
    try {
      setFormTarget(await creativesApi.get(creative.id));
    } catch (error) {
      setActionError(error?.message || COPY.loadFailed);
    }
  }

  if (status === 'loading' && !promoter) {
    return <AdminScreenState tone="loading" message={COPY.loading} />;
  }
  if (status === 'offline' || (status === 'error' && !isOnline)) {
    return <AdminScreenState tone="offline" message={COPY.offline} actionLabel={COPY.retry} onAction={load} />;
  }
  if (status === 'error') {
    return <AdminScreenState tone="error" message={loadError || COPY.loadFailed} actionLabel={COPY.retry} onAction={load} />;
  }

  const hasFilters = Boolean(mediaType || statusFilter || inUse);
  const isFirstRun = status === 'ready' && result.total === 0 && !hasFilters;
  const canCreate = promoter?.status === 'active';

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AdminExecutiveButton variant="ghost" size="small" iconLeft={<ArrowLeft size={15} />} onClick={() => navigate(promoterPath(promoterId))}>
            {promoter?.displayName ?? COPY.backToPromoter}
          </AdminExecutiveButton>
          <h1 className="font-admin-display text-[22px] font-semibold text-admin-neutral-ink">{COPY.pageTitle}</h1>
        </div>
        <AdminExecutiveButton
          variant="primary"
          iconLeft={<ImagePlus size={15} />}
          disabled={!canCreate}
          title={canCreate ? undefined : COPY.promoterArchivedNote}
          onClick={() => setFormTarget(null)}
        >
          {COPY.createButton}
        </AdminExecutiveButton>
      </div>
      <p className="font-admin-body text-[14px] leading-5 text-admin-slate-600">{COPY.intro}</p>

      {isFirstRun ? null : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[160px]">
            <AdminExecutiveSelect label={COPY.mediaTypeLabel} value={mediaType} onChange={(changeEvent) => setFilter({ mediaType: changeEvent.target.value })} placeholder={COPY.anyMedia} options={CREATIVE_MEDIA_TYPES} />
          </div>
          <div className="w-[160px]">
            <AdminExecutiveSelect label={COPY.statusLabel} value={statusFilter} onChange={(changeEvent) => setFilter({ status: changeEvent.target.value })} placeholder={COPY.anyStatus} options={STATUS_OPTIONS} />
          </div>
          <div className="w-[160px]">
            <AdminExecutiveSelect label={COPY.inUseLabel} value={inUse} onChange={(changeEvent) => setFilter({ inUse: changeEvent.target.value })} placeholder={COPY.anyUse} options={IN_USE_OPTIONS} />
          </div>
        </div>
      )}

      <AdminErrorBanner message={actionError} />
      {refusal ? <PublishedCampaignsRefusal campaigns={refusal} body={COPY.archiveRefusedBody} /> : null}
      {notice ? (
        <div role="status" className="rounded-md border border-admin-status-success-green/30 bg-admin-status-success-green/5 px-4 py-3 font-admin-body text-[14px] leading-5 text-admin-status-success-green">
          {notice}
        </div>
      ) : null}

      {status === 'loading' ? <AdminScreenState tone="loading" message={COPY.loading} /> : null}
      {isFirstRun ? (
        <AdminScreenState
          tone="empty"
          headline={COPY.emptyHeadline}
          message={canCreate ? COPY.emptyBody : COPY.promoterArchivedNote}
          actionLabel={canCreate ? COPY.createButton : undefined}
          icon={<ImagePlus size={15} />}
          onAction={canCreate ? () => setFormTarget(null) : undefined}
        />
      ) : null}
      {status === 'ready' && !isFirstRun ? (
        <AdminExecutiveCard bodyClassName="p-0">
          {result.creatives.length === 0 ? (
            <p className="px-4 py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.noMatches}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {result.creatives.map((creative) => (
                <CreativeCard
                  key={creative.id}
                  creative={creative}
                  onEdit={() => openEdit(creative)}
                  onArchive={() => setArchiveTarget(creative)}
                  onRestore={() => runAction(() => creativesApi.restore(creative.id), COPY.restoredNotice(creative.title))}
                />
              ))}
            </ul>
          )}
          <AdminPager
            page={page}
            limit={PAGE_SIZE}
            total={result.total}
            onPageChange={(nextPage) => setFilter({ page: String(nextPage) })}
            labels={{ showingRange: COPY.showingRange, prev: COPY.prev, next: COPY.next }}
          />
        </AdminExecutiveCard>
      ) : null}

      <AdminCreativeFormModal
        isOpen={formTarget !== undefined}
        promoterId={promoterId}
        creative={formTarget ?? null}
        onClose={() => setFormTarget(undefined)}
        onSaved={(saved) => {
          setFormTarget(undefined);
          setNotice(COPY.savedNotice(saved.title));
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
        onConfirm={async () => {
          const target = archiveTarget;
          setIsArchiving(true);
          await runAction(() => creativesApi.archive(target.id), COPY.archivedNotice(target.title));
          setIsArchiving(false);
          setArchiveTarget(null);
        }}
        onCancel={() => (isArchiving ? null : setArchiveTarget(null))}
      >
        {archiveTarget ? COPY.archiveModalBody(archiveTarget.title) : ''}
      </AdminModal>
    </div>
  );
}

export default AdminCreativesScreen;

// AdminPromoterDetailScreen.jsx
// Route: /admin/system/promoters/:promoterId — one promoter: its fields, its
// creatives (linked to the library), and its campaigns. Edit through the same
// modal the list uses; archive and restore with the same guarded refusal.
//
// Campaign rows are listed by name and status but NOT linked: there is no
// campaign console screen yet (a later prompt). The link target is left as a
// TODO in the copy rather than pointing at a route that does not exist.

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Image as ImageIcon, Pencil } from 'lucide-react';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminStatusPill from '../../components-admin/admin-status-pill/AdminStatusPill.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import AdminModal from '../../components-admin/admin-modal/AdminModal.jsx';
import AdminScreenState from '../../components-admin/admin-screen-state/AdminScreenState.jsx';
import AdminPromoterFormModal from '../../components-admin/admin-promoter-form-modal/AdminPromoterFormModal.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { ADMIN_PROMOTERS_COPY as COPY } from '../../brand-admin/brand-copy.js';
import {
  REFUSAL_CODES,
  isNetworkError,
  kindLabel,
  promotersApi,
  creativesApi,
  campaignsApi,
  promoterCreativesPath,
  campaignPath,
} from '../../helpers/admin-promotions-api.js';
import { PromoterStatusChip, PublishedCampaignsRefusal } from '../admin-promoters/AdminPromotersScreen.jsx';

function DetailRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <span className="font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
        {label}
      </span>
      <span className="font-admin-body text-[14px] text-admin-neutral-ink">{value || '—'}</span>
    </div>
  );
}

function AdminPromoterDetailScreen() {
  const { promoterId } = useParams();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();

  const [status, setStatus] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [promoter, setPromoter] = useState(null);
  const [creatives, setCreatives] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [actionError, setActionError] = useState('');
  const [refusal, setRefusal] = useState(null);
  const [notice, setNotice] = useState('');
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setLoadError('');
    try {
      const [detail, creativeList, campaignList] = await Promise.all([
        promotersApi.get(promoterId),
        creativesApi.list({ promoterId, limit: 200 }),
        campaignsApi.listForPromoter(promoterId),
      ]);
      setPromoter(detail);
      setCreatives(creativeList.creatives ?? []);
      setCampaigns(campaignList.campaigns ?? []);
      setStatus('ready');
    } catch (error) {
      setLoadError(isNetworkError(error) ? '' : error?.message || COPY.loadFailed);
      setStatus(isNetworkError(error) ? 'offline' : 'error');
    }
  }, [promoterId]);

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

  if (status === 'loading') {
    return <AdminScreenState tone="loading" message={COPY.loading} />;
  }
  if (status === 'offline' || (status === 'error' && !isOnline)) {
    return <AdminScreenState tone="offline" message={COPY.offline} actionLabel={COPY.retry} onAction={load} />;
  }
  if (status === 'error') {
    return <AdminScreenState tone="error" message={loadError || COPY.loadFailed} actionLabel={COPY.retry} onAction={load} />;
  }

  const isArchived = promoter.status === 'inactive';

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AdminExecutiveButton variant="ghost" size="small" iconLeft={<ArrowLeft size={15} />} onClick={() => navigate('/admin/system/promoters')}>
            {COPY.backToList}
          </AdminExecutiveButton>
          <h1 className="font-admin-display text-[22px] font-semibold text-admin-neutral-ink">{promoter.displayName}</h1>
          <PromoterStatusChip status={promoter.status} />
        </div>
        <div className="flex items-center gap-2">
          <AdminExecutiveButton variant="secondary" iconLeft={<Pencil size={15} />} onClick={() => setIsEditOpen(true)}>
            {COPY.editAction}
          </AdminExecutiveButton>
          <AdminExecutiveButton variant="secondary" onClick={() => navigate(`/admin/system/reporting/promoters/${promoter.id}`)}>
            View report
          </AdminExecutiveButton>
          {isArchived ? (
            <AdminExecutiveButton variant="secondary" onClick={() => runAction(() => promotersApi.restore(promoter.id), COPY.restoredNotice(promoter.displayName))}>
              {COPY.restoreAction}
            </AdminExecutiveButton>
          ) : (
            <AdminExecutiveButton variant="danger" onClick={() => setIsArchiveOpen(true)}>
              {COPY.archiveAction}
            </AdminExecutiveButton>
          )}
        </div>
      </div>

      <AdminErrorBanner message={actionError} />
      {refusal ? <PublishedCampaignsRefusal campaigns={refusal} body={COPY.archiveRefusedBody} /> : null}
      {notice ? (
        <div role="status" className="rounded-md border border-admin-status-success-green/30 bg-admin-status-success-green/5 px-4 py-3 font-admin-body text-[14px] leading-5 text-admin-status-success-green">
          {notice}
        </div>
      ) : null}

      <AdminExecutiveCard title={COPY.detailsHeading}>
        <div className="grid grid-cols-1 divide-y divide-admin-slate-200 sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0">
          <DetailRow label={COPY.kindLabel} value={kindLabel(promoter.kind)} />
          <DetailRow label={COPY.contactNameLabel} value={promoter.contactName} />
          <DetailRow label={COPY.contactEmailLabel} value={promoter.contactEmail} />
          <DetailRow label={COPY.contactPhoneLabel} value={promoter.contactPhone} />
          <DetailRow label={COPY.columnCreatives} value={String(promoter.creativeCount ?? 0)} />
          <DetailRow label={COPY.columnCampaigns} value={`${promoter.campaignCount ?? 0} (${promoter.publishedCampaignCount ?? 0} ${COPY.publishedSuffix})`} />
        </div>
      </AdminExecutiveCard>

      <AdminExecutiveCard
        title={COPY.creativesHeading}
        actions={
          <Link to={promoterCreativesPath(promoter.id)}>
            <AdminExecutiveButton variant="secondary" size="small" iconLeft={<ImageIcon size={14} />}>
              {COPY.openLibrary}
            </AdminExecutiveButton>
          </Link>
        }
      >
        {creatives.length === 0 ? (
          <p className="py-2 font-admin-body text-[14px] text-admin-slate-600">{COPY.noCreativesYet}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {creatives.slice(0, 8).map((creative) => (
              <li key={creative.id}>
                <Link to={promoterCreativesPath(promoter.id)} className="block overflow-hidden rounded border border-admin-slate-200 hover:border-admin-primary-blue">
                  <div className="aspect-video w-full bg-admin-surface-off-white">
                    {creative.imageUrl ? <img src={creative.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
                  </div>
                  <p className="truncate px-2 py-1.5 font-admin-body text-[12px] text-admin-neutral-ink">{creative.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AdminExecutiveCard>

      <AdminExecutiveCard title={COPY.campaignsHeading}>
        <AdminExecutiveTable
          columns={[
            {
              key: 'name',
              header: COPY.columnName,
              render: (row) => (
                <Link to={campaignPath(row.id)} className="font-admin-body text-[14px] font-semibold text-admin-primary-blue hover:underline">
                  {row.name}
                </Link>
              ),
            },
            { key: 'status', header: COPY.columnStatus, render: (row) => <AdminStatusPill status={row.status} /> },
            { key: 'flightState', header: COPY.columnFlight, render: (row) => COPY.flightState[row.flightState] ?? row.flightState },
          ]}
          rows={campaigns}
          onRowClick={(row) => navigate(campaignPath(row.id))}
          emptyMessage={COPY.noCampaignsYet}
        />
      </AdminExecutiveCard>

      <AdminPromoterFormModal
        isOpen={isEditOpen}
        promoter={promoter}
        onClose={() => setIsEditOpen(false)}
        onSaved={(saved) => {
          setIsEditOpen(false);
          setNotice(COPY.savedNotice(saved.displayName));
          load();
        }}
      />

      <AdminModal
        isOpen={isArchiveOpen}
        title={COPY.archiveModalTitle}
        confirmLabel={COPY.archiveAction}
        cancelLabel={COPY.cancel}
        tone="danger"
        isBusy={isArchiving}
        onConfirm={async () => {
          setIsArchiving(true);
          await runAction(() => promotersApi.archive(promoter.id), COPY.archivedNotice(promoter.displayName));
          setIsArchiving(false);
          setIsArchiveOpen(false);
        }}
        onCancel={() => (isArchiving ? null : setIsArchiveOpen(false))}
      >
        {COPY.archiveModalBody(promoter.displayName)}
      </AdminModal>
    </div>
  );
}

export default AdminPromoterDetailScreen;

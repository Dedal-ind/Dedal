// Promoter summary — their campaigns with headline figures. The screen someone
// opens before a call with a sponsor.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Eye } from 'lucide-react';
import { deliveryApi } from '../../helpers/admin-promotions-api.js';
import {
  formatNumber, formatRate, daysAgoString, todayString, validateRange,
  pacingLabel, pacingTone, formatTimestamp, rateSubtitle,
} from '../../helpers/delivery-report-helpers.js';
import AdminKpiCard from '../../components-admin/admin-kpi-card/AdminKpiCard.jsx';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminDateRange from '../../components-admin/admin-date-range/AdminDateRange.jsx';
import AdminCoverageBanner from '../../components-admin/admin-coverage-banner/AdminCoverageBanner.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';

function AdminDeliveryPromoterScreen() {
  const { promoterId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [range, setRange] = useState({
    from: searchParams.get('from') || daysAgoString(29),
    to: searchParams.get('to') || todayString(),
  });
  const [status, setStatus] = useState('loading');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(() => {
    if (validateRange(range.from, range.to)) return;
    setStatus('loading');
    setError(null);
    deliveryApi.promoter(promoterId, { from: range.from, to: range.to })
      .then((result) => { if (mountedRef.current) { setData(result); setStatus('ready'); } })
      .catch((err) => { if (mountedRef.current) { setError(err?.message || 'Failed to load promoter report.'); setStatus('error'); } });
  }, [promoterId, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const rangeError = validateRange(range.from, range.to);

  if (status === 'loading' && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <span aria-label="Loading" className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue" />
      </div>
    );
  }

  if (status === 'error' && !data) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <AdminErrorBanner message={error} />
        <button type="button" onClick={load} className="mt-4 inline-flex items-center gap-2 rounded-md bg-admin-primary-blue px-4 py-2 font-admin-body text-[14px] font-medium text-white transition-colors hover:bg-admin-primary-blue-dark">
          <RefreshCw size={16} /> Retry
        </button>
      </div>
    );
  }

  const t = data?.totals ?? {};
  const r = data?.rates ?? {};
  const promoter = data?.promoter ?? {};

  const campaignColumns = [
    { key: 'name', header: 'Campaign', render: (row) => (
      <div>
        <p className="font-admin-body text-[14px] font-medium text-admin-neutral-ink">{row.name}</p>
        <p className="font-admin-body text-[12px] text-admin-slate-600">{row.status}</p>
      </div>
    )},
    { key: 'viewable', header: 'Viewables', numeric: true, render: (row) => formatNumber(row.viewable) },
    { key: 'viewableRate', header: 'Viewable rate', numeric: true, render: (row) => formatRate(row.rates?.viewableRate) },
    { key: 'click', header: 'Clicks', numeric: true, render: (row) => formatNumber(row.click) },
    { key: 'pacing', header: 'Pacing', render: (row) => {
      if (!row.pacing?.hasGoal) return <span className="text-admin-slate-600">No goal</span>;
      const diff = row.pacing.difference ?? 0;
      const sign = diff >= 0 ? '+' : '';
      return (
        <span className={`font-admin-mono text-[13px] font-medium ${pacingTone(row.pacing.status)}`}>
          {sign}{formatNumber(diff)} ({pacingLabel(row.pacing.status)})
        </span>
      );
    }},
    { key: 'measurable', header: 'Measurables', numeric: true, render: (row) => formatNumber(row.measurable) },
    { key: 'decision', header: 'Decisions', numeric: true, render: (row) => formatNumber(row.decision) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} className="flex h-8 w-8 items-center justify-center rounded-md text-admin-slate-600 transition-colors hover:bg-admin-slate-200">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-admin-display text-[28px] font-bold leading-9 text-admin-neutral-ink">{promoter.displayName || 'Promoter report'}</h1>
          <p className="font-admin-body text-[13px] text-admin-slate-600">{[promoter.kind, promoter.status].filter(Boolean).join(' · ')}</p>
        </div>
        <AdminDateRange from={range.from} to={range.to} onChange={setRange} />
      </div>

      {rangeError ? null : <AdminCoverageBanner coverage={data?.coverage} />}
      {status === 'error' ? <AdminErrorBanner message={error} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AdminKpiCard label="Viewables" value={formatNumber(t.viewable)} subtitle={`Viewable rate: ${formatRate(r.viewableRate)} (${rateSubtitle(r.viewableRate)})`} icon={<Eye size={20} />} />
        <AdminKpiCard label="Clicks" value={formatNumber(t.click)} subtitle={`Click rate: ${formatRate(r.clickRate)}`} />
        <AdminKpiCard label="Decisions" value={formatNumber(t.decision)} />
      </div>

      <AdminExecutiveCard
        title="Campaigns"
        description="Summary for a sponsor call — headline figures and pacing per campaign."
      >
        <AdminExecutiveTable
          columns={campaignColumns}
          rows={data?.campaigns ?? []}
          rowKey={(row) => row.campaignId}
          onRowClick={(row) => navigate(`/admin/system/reporting/campaigns/${row.campaignId}?from=${range.from}&to=${range.to}`)}
          emptyMessage="No campaigns for this promoter in this range."
        />
        <p className="mt-3 font-admin-body text-[12px] text-admin-slate-600">
          Pacing figures are computed from the last rollup ({formatTimestamp(data?.coverage?.lastRollupRunAt)}).
        </p>
      </AdminExecutiveCard>
    </div>
  );
}

export default AdminDeliveryPromoterScreen;

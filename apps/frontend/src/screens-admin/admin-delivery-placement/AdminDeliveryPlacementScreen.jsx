// Placement breakdown — figures per surface, per day, and per campaign.

import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Eye, Monitor, MousePointerClick, Server } from 'lucide-react';
import { deliveryApi } from '../../helpers/admin-promotions-api.js';
import {
  formatNumber, formatRate, rateSubtitle, daysAgoString, todayString, validateRange,
} from '../../helpers/delivery-report-helpers.js';
import AdminKpiCard from '../../components-admin/admin-kpi-card/AdminKpiCard.jsx';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminBarChart from '../../screens-admin/admin-data-controls/AdminBarChart.jsx';
import AdminDateRange from '../../components-admin/admin-date-range/AdminDateRange.jsx';
import AdminCoverageBanner from '../../components-admin/admin-coverage-banner/AdminCoverageBanner.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';

function AdminDeliveryPlacementScreen() {
  const { placementKey } = useParams();
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

  const [reloadToken, setReloadToken] = useState(0);

  /*
   * The fetch runs in the effect and touches state only from the promise
   * callbacks. The two resets that used to open `load` — status back to
   * loading, error cleared — now happen in the handlers that CAUSE a reload,
   * which is where a state update belongs; a setState reached synchronously
   * from an effect body is a cascading render (react-hooks/set-state-in-effect).
   * `active` replaces the identity-stable useCallback as the staleness guard:
   * a response that arrives after the range moved on is dropped.
   */
  useEffect(() => {
    if (validateRange(range.from, range.to)) return undefined;
    let active = true;
    deliveryApi.placement(placementKey, { from: range.from, to: range.to })
      .then((result) => { if (active && mountedRef.current) { setData(result); setError(null); setStatus('ready'); } })
      .catch((err) => { if (active && mountedRef.current) { setError(err?.message || 'Failed to load placement report.'); setStatus('error'); } });
    return () => { active = false; };
  }, [placementKey, range.from, range.to, reloadToken]);

  const reloadReport = () => {
    setStatus('loading');
    setError(null);
    setReloadToken((token) => token + 1);
  };

  const changeRange = (next) => {
    setStatus('loading');
    setError(null);
    setRange(next);
  };

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
        <button type="button" onClick={reloadReport} className="mt-4 inline-flex items-center gap-2 rounded-md bg-admin-primary-blue px-4 py-2 font-admin-body text-[14px] font-medium text-white transition-colors hover:bg-admin-primary-blue-dark">
          <RefreshCw size={16} /> Retry
        </button>
      </div>
    );
  }

  const t = data?.totals ?? {};
  const r = data?.rates ?? {};
  const placement = data?.placement ?? {};

  const campaignColumns = [
    { key: 'name', header: 'Campaign', render: (row) => (
      <div>
        <p className="font-admin-body text-[14px] font-medium text-admin-neutral-ink">{row.name}</p>
        <p className="font-admin-body text-[12px] text-admin-slate-600">{row.status}</p>
      </div>
    )},
    { key: 'viewable', header: 'Viewables', numeric: true, render: (row) => formatNumber(row.viewable) },
    { key: 'measurable', header: 'Measurables', numeric: true, render: (row) => formatNumber(row.measurable) },
    { key: 'click', header: 'Clicks', numeric: true, render: (row) => formatNumber(row.click) },
    { key: 'decision', header: 'Decisions', numeric: true, render: (row) => formatNumber(row.decision) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} className="flex h-8 w-8 items-center justify-center rounded-md text-admin-slate-600 transition-colors hover:bg-admin-slate-200">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-admin-display text-[28px] font-bold leading-9 text-admin-neutral-ink">{placement.label || placementKey}</h1>
          {placement.isActive !== undefined ? <p className="font-admin-body text-[13px] text-admin-slate-600">{placement.isActive ? 'Active' : 'Inactive'}</p> : null}
        </div>
        <AdminDateRange from={range.from} to={range.to} onChange={changeRange} />
      </div>

      {rangeError ? null : <AdminCoverageBanner coverage={data?.coverage} />}
      {status === 'error' ? <AdminErrorBanner message={error} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminKpiCard label="Viewables" value={formatNumber(t.viewable)} subtitle={`Viewable rate: ${formatRate(r.viewableRate)} (${rateSubtitle(r.viewableRate)})`} icon={<Eye size={20} />} />
        <AdminKpiCard label="Measurables" value={formatNumber(t.measurable)} subtitle={`Measurable rate: ${formatRate(r.measurableRate)} (${rateSubtitle(r.measurableRate)})`} icon={<Monitor size={20} />} />
        <AdminKpiCard label="Clicks" value={formatNumber(t.click)} subtitle={`Click rate: ${formatRate(r.clickRate)} (${rateSubtitle(r.clickRate)})`} icon={<MousePointerClick size={20} />} />
        <AdminKpiCard label="Decisions" value={formatNumber(t.decision)} icon={<Server size={20} />} />
      </div>

      <AdminExecutiveCard title="Viewables per day">
        <AdminBarChart
          series={(data?.perDay ?? []).map((d) => ({ day: d.day, value: d.viewable }))}
          formatValue={formatNumber}
          emptyLabel="No delivery data in this range."
        />
      </AdminExecutiveCard>

      <AdminExecutiveCard title="By campaign">
        <AdminExecutiveTable
          columns={campaignColumns}
          rows={data?.perCampaign ?? []}
          rowKey={(row) => row.campaignId}
          onRowClick={(row) => navigate(`/admin/system/reporting/campaigns/${row.campaignId}?from=${range.from}&to=${range.to}`)}
          emptyMessage="No campaign data for this placement in this range."
        />
      </AdminExecutiveCard>
    </div>
  );
}

export default AdminDeliveryPlacementScreen;

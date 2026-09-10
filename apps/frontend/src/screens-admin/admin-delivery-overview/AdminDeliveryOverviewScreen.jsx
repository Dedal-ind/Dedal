// Platform-wide delivery reporting overview.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Monitor, MousePointerClick, Server, RefreshCw } from 'lucide-react';
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

function AdminDeliveryOverviewScreen() {
  const navigate = useNavigate();
  const [range, setRange] = useState({ from: daysAgoString(29), to: todayString() });
  const [status, setStatus] = useState('loading');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(() => {
    if (validateRange(range.from, range.to)) return;
    setStatus('loading');
    setError(null);
    deliveryApi.platform({ from: range.from, to: range.to })
      .then((result) => { if (mountedRef.current) { setData(result); setStatus('ready'); } })
      .catch((err) => { if (mountedRef.current) { setError(err?.message || 'Failed to load delivery report.'); setStatus('error'); } });
  }, [range.from, range.to]);

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

  const rejectionColumns = [
    { key: 'reason', header: 'Reason' },
    { key: 'count', header: 'Count', numeric: true },
  ];

  const placementColumns = [
    { key: 'placementKey', header: 'Placement' },
    { key: 'viewable', header: 'Viewables', numeric: true, render: (row) => formatNumber(row.viewable) },
    { key: 'measurable', header: 'Measurables', numeric: true, render: (row) => formatNumber(row.measurable) },
    { key: 'decision', header: 'Decisions', numeric: true, render: (row) => formatNumber(row.decision) },
    { key: 'click', header: 'Clicks', numeric: true, render: (row) => formatNumber(row.click) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-admin-display text-[28px] font-bold leading-9 text-admin-neutral-ink">Delivery overview</h1>
        <AdminDateRange from={range.from} to={range.to} onChange={setRange} />
      </div>

      {rangeError ? null : <AdminCoverageBanner coverage={data?.coverage} />}

      {status === 'error' ? <AdminErrorBanner message={error} /> : null}

      {/* KPIs — viewables headline */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminKpiCard label="Viewables" value={formatNumber(t.viewable)} subtitle={`Viewable rate: ${formatRate(r.viewableRate)} (${rateSubtitle(r.viewableRate)})`} icon={<Eye size={20} />} />
        <AdminKpiCard label="Measurables" value={formatNumber(t.measurable)} subtitle={`Measurable rate: ${formatRate(r.measurableRate)} (${rateSubtitle(r.measurableRate)})`} icon={<Monitor size={20} />} />
        <AdminKpiCard label="Clicks" value={formatNumber(t.click)} subtitle={`Click rate: ${formatRate(r.clickRate)} (${rateSubtitle(r.clickRate)})`} icon={<MousePointerClick size={20} />} />
        <AdminKpiCard label="Decisions" value={formatNumber(t.decision)} subtitle="What the server chose to serve" icon={<Server size={20} />} />
      </div>

      <p className="font-admin-body text-[12px] leading-[16px] text-admin-slate-600">
        Viewables are what a sponsor is owed. The viewable rate divides measurables (what actually rendered), not decisions. Decisions, measurables, viewables and clicks are four separate metrics — they are not cumulative stages of the same number.
      </p>

      {/* Per-day chart — viewables */}
      <AdminExecutiveCard title="Viewables per day">
        <AdminBarChart
          series={(data?.perDay ?? []).map((d) => ({ day: d.day, value: d.viewable }))}
          formatValue={formatNumber}
          emptyLabel="No delivery data in this range."
        />
      </AdminExecutiveCard>

      {/* Placements */}
      <AdminExecutiveCard title="By placement">
        <AdminExecutiveTable
          columns={placementColumns}
          rows={data?.perPlacement ?? []}
          rowKey={(row) => row.placementKey}
          onRowClick={(row) => navigate(`/admin/system/reporting/placements/${row.placementKey}?from=${range.from}&to=${range.to}`)}
          emptyMessage="No placement data in this range."
        />
      </AdminExecutiveCard>

      {/* Rejections */}
      <AdminExecutiveCard
        title="Rejections"
        description={data?.rejections?.granularity}
      >
        <p className="mb-3 font-admin-mono text-[13px] text-admin-slate-600">
          Total: {formatNumber(data?.rejections?.total)}
        </p>
        <AdminExecutiveTable
          columns={rejectionColumns}
          rows={data?.rejections?.byReason ?? []}
          rowKey={(row) => row.reason}
          emptyMessage="No rejections in this range."
        />
      </AdminExecutiveCard>
    </div>
  );
}

export default AdminDeliveryOverviewScreen;

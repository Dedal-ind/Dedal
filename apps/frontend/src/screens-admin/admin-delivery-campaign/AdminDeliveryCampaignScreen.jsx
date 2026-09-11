// Campaign delivery report — figures + pacing.

import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, Monitor, MousePointerClick, Server, RefreshCw, ArrowLeft } from 'lucide-react';
import { deliveryApi } from '../../helpers/admin-promotions-api.js';
import {
  formatNumber, formatRate, rateSubtitle, daysAgoString, todayString, validateRange,
  pacingLabel, pacingTone, formatTimestamp,
} from '../../helpers/delivery-report-helpers.js';
import AdminKpiCard from '../../components-admin/admin-kpi-card/AdminKpiCard.jsx';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminBarChart from '../../screens-admin/admin-data-controls/AdminBarChart.jsx';
import AdminDateRange from '../../components-admin/admin-date-range/AdminDateRange.jsx';
import AdminCoverageBanner from '../../components-admin/admin-coverage-banner/AdminCoverageBanner.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';

function PacingCard({ pacing, coverage }) {
  if (!pacing || !pacing.hasGoal) {
    return (
      <AdminExecutiveCard title="Pacing">
        <p className="font-admin-body text-[14px] text-admin-slate-600">No delivery goal is set for this campaign.</p>
      </AdminExecutiveCard>
    );
  }

  const diff = pacing.difference ?? 0;
  const sign = diff >= 0 ? '+' : '';

  return (
    <AdminExecutiveCard title="Pacing">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <p className="font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">Ahead / behind</p>
          <p className={`mt-1 font-admin-display text-[24px] font-bold ${pacingTone(pacing.status)}`}>
            {sign}{formatNumber(diff)}
          </p>
          <p className="mt-0.5 font-admin-body text-[12px] text-admin-slate-600">{pacingLabel(pacing.status)}</p>
        </div>
        <div>
          <p className="font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">Goal</p>
          <p className="mt-1 font-admin-mono text-[20px] font-medium text-admin-neutral-ink">{formatNumber(pacing.target)}</p>
        </div>
        <div>
          <p className="font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">Delivered</p>
          <p className="mt-1 font-admin-mono text-[20px] font-medium text-admin-neutral-ink">{formatNumber(pacing.delivered)}</p>
        </div>
        <div>
          <p className="font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">Expected by now</p>
          <p className="mt-1 font-admin-mono text-[20px] font-medium text-admin-neutral-ink">{formatNumber(pacing.expectedDelivered)}</p>
        </div>
        <div>
          <p className="font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">Flight elapsed</p>
          <p className="mt-1 font-admin-mono text-[20px] font-medium text-admin-neutral-ink">{pacing.elapsedShare !== null ? `${(pacing.elapsedShare * 100).toFixed(0)}%` : '—'}</p>
        </div>
      </div>
      {pacing.note ? <p className="mt-3 font-admin-body text-[13px] text-admin-slate-600">{pacing.note}</p> : null}
      <p className="mt-2 font-admin-body text-[12px] text-admin-slate-600">
        Pacing is computed from the last completed rollup ({formatTimestamp(coverage?.lastRollupRunAt)}).
      </p>
    </AdminExecutiveCard>
  );
}

function AdminDeliveryCampaignScreen() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [range, setRange] = useState({
    from: searchParams.get('from') || daysAgoString(29),
    to: searchParams.get('to') || todayString(),
  });
  const [status, setStatus] = useState('loading');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  /*
   * A `mountedRef` stood here, and it was why every screen in this section sat
   * on its spinner forever in development. It was declared true, set to false
   * by an unmount cleanup, and never set back to true by anything.
   *
   * A ref survives a remount of the same component instance, and StrictMode
   * deliberately mounts, unmounts and remounts every component in development.
   * So by the time the real mount ran, the flag was already false. Every
   * response then failed the `active && mountedRef.current` guard and was
   * discarded: the request returned 200, the data arrived, and status stayed
   * 'loading'. Verified in the browser - two 200s on the platform report with
   * the spinner still up and nothing in the console.
   *
   * Deleted rather than repaired, because the `active` flag inside each
   * fetching effect already does this job and does it correctly: it is created
   * per effect run, so it cannot leak state across runs the way a ref does, and
   * it guards the thing actually worth guarding - a stale response landing
   * after its inputs have changed. Setting state on an unmounted component is
   * not an error in React 18; the warning that made refs like this look
   * necessary was removed precisely because it caused this bug more often than
   * it prevented a leak.
   */

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
    deliveryApi.campaign(campaignId, { from: range.from, to: range.to })
      .then((result) => { if (active) { setData(result); setError(null); setStatus('ready'); } })
      .catch((err) => { if (active) { setError(err?.message || 'Failed to load campaign report.'); setStatus('error'); } });
    return () => { active = false; };
  }, [campaignId, range.from, range.to, reloadToken]);

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
  const campaign = data?.campaign ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} className="flex h-8 w-8 items-center justify-center rounded-md text-admin-slate-600 transition-colors hover:bg-admin-slate-200">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-admin-display text-[28px] font-bold leading-9 text-admin-neutral-ink">{campaign.name || 'Campaign report'}</h1>
          {campaign.status ? <p className="font-admin-body text-[13px] text-admin-slate-600">Status: {campaign.status}</p> : null}
        </div>
        <AdminDateRange from={range.from} to={range.to} onChange={changeRange} />
      </div>

      {rangeError ? null : <AdminCoverageBanner coverage={data?.coverage} />}
      {status === 'error' ? <AdminErrorBanner message={error} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminKpiCard label="Viewables" value={formatNumber(t.viewable)} subtitle={`Viewable rate: ${formatRate(r.viewableRate)} (${rateSubtitle(r.viewableRate)})`} icon={<Eye size={20} />} />
        <AdminKpiCard label="Measurables" value={formatNumber(t.measurable)} subtitle={`Measurable rate: ${formatRate(r.measurableRate)} (${rateSubtitle(r.measurableRate)})`} icon={<Monitor size={20} />} />
        <AdminKpiCard label="Clicks" value={formatNumber(t.click)} subtitle={`Click rate: ${formatRate(r.clickRate)} (${rateSubtitle(r.clickRate)})`} icon={<MousePointerClick size={20} />} />
        <AdminKpiCard label="Decisions" value={formatNumber(t.decision)} subtitle="What the server chose to serve" icon={<Server size={20} />} />
      </div>

      <PacingCard pacing={data?.pacing} coverage={data?.coverage} />

      <AdminExecutiveCard title="Viewables per day">
        <AdminBarChart
          series={(data?.perDay ?? []).map((d) => ({ day: d.day, value: d.viewable }))}
          formatValue={formatNumber}
          emptyLabel="No delivery data in this range."
        />
      </AdminExecutiveCard>

      <div className="flex gap-3">
        <button type="button" onClick={() => navigate(`/admin/system/reporting/campaigns/${campaignId}/creatives?from=${range.from}&to=${range.to}`)} className="rounded-md bg-admin-primary-blue px-4 py-2 font-admin-body text-[14px] font-medium text-white transition-colors hover:bg-admin-primary-blue-dark">
          Creative breakdown
        </button>
      </div>
    </div>
  );
}

export default AdminDeliveryCampaignScreen;

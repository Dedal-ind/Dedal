// Creative breakdown within a campaign — figures per creative with rotation weight.

import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { deliveryApi, campaignsApi } from '../../helpers/admin-promotions-api.js';
import { formatNumber, formatRate, daysAgoString, todayString, validateRange } from '../../helpers/delivery-report-helpers.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveTable from '../../components-admin/admin-executive-table/AdminExecutiveTable.jsx';
import AdminDateRange from '../../components-admin/admin-date-range/AdminDateRange.jsx';
import AdminCoverageBanner from '../../components-admin/admin-coverage-banner/AdminCoverageBanner.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';

function AdminDeliveryCreativesScreen() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [range, setRange] = useState({
    from: searchParams.get('from') || daysAgoString(29),
    to: searchParams.get('to') || todayString(),
  });
  const [status, setStatus] = useState('loading');
  const [data, setData] = useState(null);
  const [weights, setWeights] = useState({});
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
    Promise.all([
      deliveryApi.creatives(campaignId, { from: range.from, to: range.to }),
      campaignsApi.get(campaignId),
    ])
      .then(([report, campaign]) => {
        if (!active) return;
        const w = {};
        (campaign?.creatives ?? []).forEach((c) => { w[c.creativeId] = c.rotationWeight ?? 1; });
        setWeights(w);
        setData(report);
        setError(null);
        setStatus('ready');
      })
      .catch((err) => { if (active) { setError(err?.message || 'Failed to load creative report.'); setStatus('error'); } });
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

  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0) || 1;

  const columns = [
    { key: 'title', header: 'Creative', render: (row) => (
      <div>
        <p className="font-admin-body text-[14px] font-medium text-admin-neutral-ink">{row.title}</p>
        <p className="font-admin-body text-[12px] text-admin-slate-600">{row.mediaType} · {row.status}</p>
      </div>
    )},
    { key: 'weight', header: 'Weight', numeric: true, render: (row) => {
      const w = weights[row.creativeId] ?? 1;
      return `${w} (${((w / totalWeight) * 100).toFixed(0)}%)`;
    }},
    { key: 'viewable', header: 'Viewables', numeric: true, render: (row) => formatNumber(row.viewable) },
    { key: 'viewableRate', header: 'Viewable rate', numeric: true, render: (row) => formatRate(row.rates?.viewableRate) },
    { key: 'measurable', header: 'Measurables', numeric: true, render: (row) => formatNumber(row.measurable) },
    { key: 'click', header: 'Clicks', numeric: true, render: (row) => formatNumber(row.click) },
    { key: 'clickRate', header: 'Click rate', numeric: true, render: (row) => formatRate(row.rates?.clickRate) },
    { key: 'decision', header: 'Decisions', numeric: true, render: (row) => formatNumber(row.decision) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate(-1)} className="flex h-8 w-8 items-center justify-center rounded-md text-admin-slate-600 transition-colors hover:bg-admin-slate-200">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-admin-display text-[28px] font-bold leading-9 text-admin-neutral-ink">Creative breakdown</h1>
          {data?.campaign?.name ? <p className="font-admin-body text-[13px] text-admin-slate-600">{data.campaign.name}</p> : null}
        </div>
        <AdminDateRange from={range.from} to={range.to} onChange={changeRange} />
      </div>

      {rangeError ? null : <AdminCoverageBanner coverage={data?.coverage} />}
      {status === 'error' ? <AdminErrorBanner message={error} /> : null}

      <AdminExecutiveCard
        title="Performance by creative"
        description="Compare viewable performance against rotation weight to decide which artwork earns its share."
      >
        <AdminExecutiveTable
          columns={columns}
          rows={data?.perCreative ?? []}
          rowKey={(row) => row.creativeId}
          emptyMessage="No creative delivery data in this range."
        />
      </AdminExecutiveCard>
    </div>
  );
}

export default AdminDeliveryCreativesScreen;

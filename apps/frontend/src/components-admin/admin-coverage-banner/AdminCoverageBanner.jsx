// Surfaces the coverage block from delivery report responses.

import { Info } from 'lucide-react';
import { formatTimestamp } from '../../helpers/delivery-report-helpers.js';

function AdminCoverageBanner({ coverage }) {
  if (!coverage) return null;

  const isIncomplete = !coverage.isComplete;
  const tone = isIncomplete
    ? 'border-admin-status-warning-amber/30 bg-admin-status-warning-amber/5'
    : 'border-admin-slate-200 bg-admin-surface-off-white';

  return (
    <div className={`flex items-start gap-2 rounded-md border px-4 py-3 ${tone}`}>
      <Info size={16} className={`mt-0.5 shrink-0 ${isIncomplete ? 'text-admin-status-warning-amber' : 'text-admin-slate-600'}`} />
      <div className="min-w-0 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
        {coverage.note ? <p>{coverage.note}</p> : null}
        <p className="mt-1">
          Range: {coverage.from} to {coverage.to} ({coverage.days} day{coverage.days !== 1 ? 's' : ''}).
          {' '}Last rollup: {formatTimestamp(coverage.lastRollupRunAt)}.
        </p>
      </div>
    </div>
  );
}

export default AdminCoverageBanner;

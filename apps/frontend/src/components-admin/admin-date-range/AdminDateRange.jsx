// A from/to date-range control that prevents inverted ranges and ranges over 92 days.

import { validateRange } from '../../helpers/delivery-report-helpers.js';

function AdminDateRange({ from, to, onChange }) {
  const error = validateRange(from, to);

  function handleFrom(e) {
    onChange({ from: e.target.value, to });
  }

  function handleTo(e) {
    onChange({ from, to: e.target.value });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">From</span>
        <input type="date" value={from} onChange={handleFrom} className="h-9 rounded-md border border-admin-slate-200 bg-admin-surface-white px-3 font-admin-mono text-[13px] text-admin-neutral-ink focus:border-admin-primary-blue focus:outline-none" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">To</span>
        <input type="date" value={to} onChange={handleTo} className="h-9 rounded-md border border-admin-slate-200 bg-admin-surface-white px-3 font-admin-mono text-[13px] text-admin-neutral-ink focus:border-admin-primary-blue focus:outline-none" />
      </label>
      {error ? (
        <p className="font-admin-body text-[13px] text-admin-status-error-red">{error}</p>
      ) : null}
    </div>
  );
}

export default AdminDateRange;

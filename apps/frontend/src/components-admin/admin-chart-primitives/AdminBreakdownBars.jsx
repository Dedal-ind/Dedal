// AdminBreakdownBars.jsx
// A horizontal bar list: a label, a proportional bar, a value. One component
// answering "which of these is biggest", which is the shape of six different
// questions on the overview — top events, revenue by event, add-on sales per
// offer, check-in rate per event, certificates by type, revenue by purpose.
//
// WHY THIS RATHER THAN A DONUT. A ring encodes value as arc length, which the
// eye compares badly: two adjacent slices of 18% and 22% are indistinguishable,
// and the labels have to sit outside the shape with leader lines or in a legend
// the reader then has to cross-reference. Bars from a common left edge are
// directly comparable, carry their own label, and read the same at four rows as
// at twelve. The brief allows exactly this substitution.
//
// NO CHART LIBRARY, for the reason AdminBarChart already documents: this is a
// fest console, and recharts is ~100KB gzipped on an admin bundle.
//
// ADMIN TOKENS, NOT PARTICIPANT ONES. The console has its own palette — see
// brand-admin/brand-colors.js, which opens by saying it is deliberately not the
// participant system. --primary there is #ff3b30, the participant signature
// red; using it here would import that identity into a surface built to be
// quiet.
//
// rows: Array<{ key, label, value, secondaryLabel? }>

const MAX_ROWS_DEFAULT = 5;

function AdminBreakdownBars({
  rows,
  formatValue = (value) => String(value),
  emptyLabel = 'No data yet',
  maxRows = MAX_ROWS_DEFAULT,
  variant = 'primary',
}) {
  const visible = [...rows]
    .sort((first, second) => second.value - first.value)
    .slice(0, maxRows);
  const largest = Math.max(0, ...visible.map((row) => row.value));

  /*
   * An all-zero set is EMPTY, not a row of hairlines. "Five events, all on
   * zero" is a sentence; five bars of width zero is a chart that looks broken.
   */
  if (visible.length === 0 || largest === 0) {
    return (
      <p className="py-6 text-center font-admin-body text-[13px] text-admin-slate-600">
        {emptyLabel}
      </p>
    );
  }

  const barClass =
    variant === 'secondary' ? 'bg-admin-primary-blue/40' : 'bg-admin-primary-blue';

  return (
    <ul className="flex flex-col gap-2" role="list">
      {visible.map((row) => (
        <li key={row.key} className="flex items-center gap-3">
          <span
            className="w-[120px] shrink-0 truncate font-admin-body text-[13px] text-admin-neutral-ink"
            title={row.label}
          >
            {row.label}
          </span>

          <span className="relative h-[14px] min-w-0 flex-1 overflow-hidden rounded-sm bg-admin-slate-200/60">
            <span
              className={`absolute inset-y-0 left-0 block rounded-sm ${barClass}`}
              /* Width is the value and nothing else — no minimum stub, because a
                 visible bar for a zero is a lie the reader cannot detect. */
              style={{ width: `${(row.value / largest) * 100}%` }}
            />
          </span>

          <span className="shrink-0 text-right font-admin-mono text-[12px] text-admin-neutral-ink">
            {formatValue(row.value)}
            {row.secondaryLabel ? (
              <span className="ml-2 text-admin-slate-600">{row.secondaryLabel}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default AdminBreakdownBars;

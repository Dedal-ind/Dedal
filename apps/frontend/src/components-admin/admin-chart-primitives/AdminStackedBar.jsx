// AdminStackedBar.jsx
// One bar divided into its parts, with a legend under it. Used for the
// registration funnel.
//
// A STACK IS ONLY HONEST IF THE PARTS ARE DISJOINT AND SUM TO THE WHOLE, and
// here they are — which is worth stating because it is not obvious from the
// field names. analytics-service builds `registrationsInitiated` by
// incrementing it for EVERY registration regardless of status, then sorts each
// one into exactly one of pendingPayment / cancelled / paymentExpired /
// confirmed. So `initiated` is the TOTAL, the four others partition it, and
// stacking them fills the bar exactly once.
//
// Stacking a funnel whose stages NEST — where "confirmed" is a subset of
// "initiated" rather than a sibling of it — would double-count, and that is the
// usual reason a stacked funnel is wrong. It is not the case here.
//
// PAYMENT-EXPIRED IS INCLUDED even though it is easy to forget: leaving it out
// makes the segments sum to less than the total and the bar renders with a gap
// the reader reads as a rendering fault.
//
// segments: Array<{ key, label, value, className }>

function AdminStackedBar({ segments, total, formatValue = (value) => String(value), emptyLabel }) {
  const sum = segments.reduce((running, segment) => running + segment.value, 0);
  const denominator = total ?? sum;

  if (denominator === 0) {
    return (
      <p className="py-6 text-center font-admin-body text-[13px] text-admin-slate-600">
        {emptyLabel}
      </p>
    );
  }

  const present = segments.filter((segment) => segment.value > 0);

  return (
    <div className="flex flex-col gap-3">
      <span className="flex h-5 w-full overflow-hidden rounded-sm bg-admin-slate-200/60">
        {present.map((segment) => (
          <span
            key={segment.key}
            className={`block h-full ${segment.className}`}
            style={{ width: `${(segment.value / denominator) * 100}%` }}
            title={`${segment.label}: ${formatValue(segment.value)}`}
          />
        ))}
      </span>

      {/*
        A legend, because a stacked bar cannot label its own segments — a 4%
        sliver has no room for a word inside it. Every segment appears here
        including the zeroes, so the list does not reshuffle between refreshes.
      */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1" role="list">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${segment.className}`} />
            <span className="font-admin-body text-[12px] text-admin-slate-600">
              {segment.label}
            </span>
            <span className="font-admin-mono text-[12px] text-admin-neutral-ink">
              {formatValue(segment.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default AdminStackedBar;

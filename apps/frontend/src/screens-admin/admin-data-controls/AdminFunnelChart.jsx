// AdminFunnelChart.jsx
// The registration funnel: initiated → pending payment → confirmed, and the
// drop between each pair.
//
// HORIZONTAL BARS, NOT A TAPERING TRAPEZOID. A classic funnel encodes its
// values as the WIDTH of a shape whose sides also slope, so the eye reads area
// and the area is not the number — a stage at 50% looks like far less than
// half. Bars from a common left edge are directly comparable, and the width is
// the value with nothing added to it.
//
// Every stage is drawn relative to the FIRST stage, not to the one above it, so
// the bars compare against a single denominator. A bar drawn relative to its
// predecessor makes every stage look equally healthy: three stages each keeping
// 50% would all render full width.
//
// stages: Array<{ label: string, value: number }> in funnel order.

const ROW_HEIGHT = 34;
const BAR_HEIGHT = 18;
const LABEL_WIDTH = 132;

function formatPercent(value, total) {
  if (!total) {
    return "0%";
  }
  return `${Math.round((value / total) * 100)}%`;
}

function AdminFunnelChart({ stages, formatValue = (value) => String(value), emptyLabel }) {
  const head = stages[0]?.value ?? 0;

  if (stages.length === 0 || head === 0) {
    return (
      <p className="py-6 text-center font-admin-body text-[13px] text-admin-slate-600">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {stages.map((stage, index) => {
        const share = Math.max(0, Math.min(1, stage.value / head));
        /*
         * The drop is measured against the PREVIOUS stage, because that is the
         * question it answers: how many did we lose at this step. The bar
         * length and the drop label therefore use different denominators on
         * purpose — one compares to the top, the other to the step before.
         */
        const previous = index > 0 ? stages[index - 1].value : null;
        const dropped = previous === null ? null : previous - stage.value;

        return (
          <div key={stage.label} className="flex items-center gap-3" style={{ height: ROW_HEIGHT }}>
            <span
              className="shrink-0 truncate font-admin-body text-[13px] text-admin-neutral-ink"
              style={{ width: LABEL_WIDTH }}
              title={stage.label}
            >
              {stage.label}
            </span>

            <span className="relative min-w-0 flex-1">
              <span
                className="block rounded-sm bg-admin-slate-200/60"
                style={{ height: BAR_HEIGHT }}
              />
              <span
                className="absolute left-0 top-0 block rounded-sm bg-admin-primary-blue"
                style={{ height: BAR_HEIGHT, width: `${share * 100}%` }}
              />
            </span>

            <span className="shrink-0 text-right font-admin-mono text-[12px] text-admin-neutral-ink">
              {formatValue(stage.value)}
              <span className="ml-2 text-admin-slate-600">{formatPercent(stage.value, head)}</span>
            </span>

            {/* Only rendered where there IS a previous stage to have dropped
                from — a "−0" on the first row is noise. */}
            {dropped !== null && dropped > 0 ? (
              <span className="shrink-0 font-admin-mono text-[11px] text-admin-status-error-red">
                −{formatValue(dropped)}
              </span>
            ) : (
              <span className="shrink-0" style={{ width: 0 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default AdminFunnelChart;

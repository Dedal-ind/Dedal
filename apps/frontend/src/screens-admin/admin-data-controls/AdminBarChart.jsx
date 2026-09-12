// AdminBarChart.jsx
// A hand-rolled SVG bar chart for the analytics tabs — deliberately no chart
// library (fest console, not Tableau). Fixed-width 8px bars, native <title>
// tooltips carrying the exact value, a baseline, and min/max axis hints.
//
// series: Array<{ day: string, value: number }>  — `day` is the x label and the
// React key, so it is any unique string, not necessarily a date. The arrival
// pattern passes hours through it.
//
// highlightKey names ONE bar to draw at full strength while the rest recede.
// Used by the arrival-pattern chart for the peak hour: a chart where every bar
// is the accent colour has no accent, and the peak is the one thing that chart
// exists to point at. Omitted, every bar is drawn the same as before.

const BAR_WIDTH = 6;
const BAR_GAP = 2;
const CHART_HEIGHT = 120;
const AXIS_HEIGHT = 18;

function AdminBarChart({
  series,
  formatValue = (value) => String(value),
  emptyLabel,
  highlightKey = null,
}) {
  const maxValue = Math.max(0, ...series.map((point) => point.value));
  const chartWidth = series.length * (BAR_WIDTH + BAR_GAP);

  if (series.length === 0 || maxValue === 0) {
    return (
      <p className="py-6 text-center font-admin-body text-[13px] text-admin-slate-600">{emptyLabel}</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <svg
        width={chartWidth}
        height={CHART_HEIGHT + AXIS_HEIGHT}
        role="img"
        className="block"
      >
        {series.map((point, index) => {
          const barHeight = maxValue > 0 ? Math.round((point.value / maxValue) * (CHART_HEIGHT - 4)) : 0;
          return (
            <rect
              key={point.day}
              x={index * (BAR_WIDTH + BAR_GAP)}
              y={CHART_HEIGHT - barHeight}
              width={BAR_WIDTH}
              height={Math.max(barHeight, point.value > 0 ? 2 : 0)}
              className={
                highlightKey === null || point.day === highlightKey
                  ? 'fill-admin-primary-blue'
                  : 'fill-admin-primary-blue/30'
              }
            >
              <title>{`${point.day}: ${formatValue(point.value)}`}</title>
            </rect>
          );
        })}
        {/* Baseline */}
        <line x1={0} y1={CHART_HEIGHT} x2={chartWidth} y2={CHART_HEIGHT} className="stroke-admin-slate-200" strokeWidth={1} />
        {/* First/last day labels */}
        <text x={0} y={CHART_HEIGHT + 13} className="fill-admin-slate-600" fontSize={10} fontFamily="monospace">
          {series[0].day}
        </text>
        <text
          x={chartWidth}
          y={CHART_HEIGHT + 13}
          textAnchor="end"
          className="fill-admin-slate-600"
          fontSize={10}
          fontFamily="monospace"
        >
          {series[series.length - 1].day}
        </text>
      </svg>
      <p className="mt-1 font-admin-mono text-[11px] text-admin-slate-600">
        max {formatValue(maxValue)}
      </p>
    </div>
  );
}

export default AdminBarChart;

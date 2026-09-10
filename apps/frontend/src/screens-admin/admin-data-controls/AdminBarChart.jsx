// AdminBarChart.jsx
// A hand-rolled SVG bar chart for the analytics tabs — deliberately no chart
// library (fest console, not Tableau). Fixed-width 8px bars, native <title>
// tooltips carrying the exact value, a baseline, and min/max axis hints.
//
// series: Array<{ day: 'yyyy-mm-dd', value: number }>

const BAR_WIDTH = 6;
const BAR_GAP = 2;
const CHART_HEIGHT = 120;
const AXIS_HEIGHT = 18;

function AdminBarChart({ series, formatValue = (value) => String(value), emptyLabel }) {
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
              className="fill-admin-primary-blue"
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

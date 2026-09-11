// AdminLineChart.jsx
// A hand-rolled SVG line chart for a daily series, and a companion to
// AdminBarChart rather than a replacement for it.
//
// NO CHART LIBRARY, for the reason AdminBarChart already states: this is a fest
// console, not Tableau. recharts is ~100KB gzipped on an admin bundle and would
// put a second charting system beside the one the five delivery screens already
// use, so two components would then disagree about what a chart looks like.
//
// WHEN TO USE WHICH. A bar reads as a COUNT PER DAY — forty discrete bars you
// compare against each other. A line reads as a TREND — the shape matters more
// than any one point, which is what a revenue or velocity series is for. The
// existing bar chart stays exactly as it is; this is the other question.
//
// series: Array<{ day: 'yyyy-mm-dd', value: number }>

const CHART_HEIGHT = 120;
const AXIS_HEIGHT = 18;
const POINT_GAP = 8;
const TOP_PADDING = 4;

function AdminLineChart({ series, formatValue = (value) => String(value), emptyLabel }) {
  const maxValue = Math.max(0, ...series.map((point) => point.value));
  const chartWidth = Math.max(1, (series.length - 1) * POINT_GAP);

  /*
   * An all-zero series is EMPTY, not a flat line along the baseline. A line
   * pinned to the axis reads as data, and "we took ₹0 every day for six weeks"
   * is a sentence, not a chart.
   */
  if (series.length === 0 || maxValue === 0) {
    return (
      <p className="py-6 text-center font-admin-body text-[13px] text-admin-slate-600">
        {emptyLabel}
      </p>
    );
  }

  const yFor = (value) =>
    CHART_HEIGHT - Math.round((value / maxValue) * (CHART_HEIGHT - TOP_PADDING));
  const points = series.map((point, index) => `${index * POINT_GAP},${yFor(point.value)}`);

  return (
    <div className="overflow-x-auto">
      <svg width={chartWidth} height={CHART_HEIGHT + AXIS_HEIGHT} role="img" className="block">
        {/*
          The fill under the line, drawn first so the stroke sits on top of it.
          It closes down to the baseline at both ends, which is what makes the
          area read as "under the curve" rather than as a second shape.
        */}
        <polygon
          points={`0,${CHART_HEIGHT} ${points.join(" ")} ${chartWidth},${CHART_HEIGHT}`}
          className="fill-admin-primary-blue/10"
        />
        <polyline
          points={points.join(" ")}
          fill="none"
          className="stroke-admin-primary-blue"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/*
          One invisible hit target per point carrying a native <title>, exactly
          the tooltip mechanism AdminBarChart uses. A visible dot per day would
          be forty dots on a six-week series; the value still has to be
          readable, so the target is there and the dot is not.
        */}
        {series.map((point, index) => (
          <circle
            key={point.day}
            cx={index * POINT_GAP}
            cy={yFor(point.value)}
            r={Math.max(3, POINT_GAP / 2)}
            fill="transparent"
          >
            <title>{`${point.day}: ${formatValue(point.value)}`}</title>
          </circle>
        ))}

        <line
          x1={0}
          y1={CHART_HEIGHT}
          x2={chartWidth}
          y2={CHART_HEIGHT}
          className="stroke-admin-slate-200"
          strokeWidth={1}
        />
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

export default AdminLineChart;

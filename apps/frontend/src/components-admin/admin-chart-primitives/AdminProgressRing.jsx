// AdminProgressRing.jsx
// One rate, drawn as a ring with the percentage in the middle.
//
// A RING IS A BAD WAY TO COMPARE AND A GOOD WAY TO SHOW ONE NUMBER. Arc length
// is exactly what the eye reads badly, which is why AdminBreakdownBars exists
// and why the per-offer and per-college lists are bars. But a single rate
// against a fixed whole has nothing to compare it to — the comparison is
// against 100%, and a closed circle is that whole, visible without a label.
//
// So this is used once per card, for the headline rate, and never for a set.
//
// STROKE, NOT FILL, and the track is always drawn. A ring with no track is a
// floating arc with no denominator: 40% and 90% both read as "some blue", and
// the gap that makes the rate legible is the part that is missing.

const SIZE = 112;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function AdminProgressRing({ rate, label, caption = null }) {
  /* Clamped, because a rate above 1 is possible in real data — more distinct
     scans than confirmed seats happens when a walk-in is scanned against a
     borrowed pass — and an arc longer than its own circumference renders as a
     ring that has wrapped over itself. */
  const safeRate = Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) : 0;
  const dash = CIRCUMFERENCE * safeRate;

  return (
    <div className="flex items-center gap-4">
      <svg width={SIZE} height={SIZE} role="img" aria-label={`${label}: ${Math.round(safeRate * 100)}%`}>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className="stroke-admin-slate-200"
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
          /* Rotated so the arc starts at twelve o'clock rather than three —
             a progress ring that starts on the right reads as a pie slice. */
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          className="stroke-admin-primary-blue"
        />
        <text
          x={SIZE / 2}
          y={SIZE / 2 + 6}
          textAnchor="middle"
          className="fill-admin-neutral-ink font-admin-display"
          fontSize={22}
          fontWeight={600}
        >
          {Math.round(safeRate * 100)}%
        </text>
      </svg>

      <div className="min-w-0">
        <p className="font-admin-body text-[14px] font-medium text-admin-neutral-ink">{label}</p>
        {caption ? (
          <p className="mt-0.5 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
            {caption}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default AdminProgressRing;

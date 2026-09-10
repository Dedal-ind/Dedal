// AdminExecutiveChip.jsx
// A status pill: low-saturation background, high-saturation text. The pairing is
// what keeps a table of forty rows readable — a fully saturated fill on every
// row would fight the data for attention, and colour alone would fail anyone who
// cannot distinguish it, which is why the chip always carries a word too.

const TONE_CLASSES = {
  success: 'bg-admin-status-success-green/10 text-admin-status-success-green',
  warning: 'bg-admin-status-warning-amber/10 text-admin-status-warning-amber',
  error: 'bg-admin-status-error-red/10 text-admin-status-error-red',
  info: 'bg-admin-primary-blue/10 text-admin-primary-blue',
  neutral: 'bg-admin-slate-200/60 text-admin-slate-600',
};

function AdminExecutiveChip({ tone = 'neutral', icon, children, className = '' }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5',
        'font-admin-body text-[12px] font-semibold leading-4',
        TONE_CLASSES[tone] ?? TONE_CLASSES.neutral,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon}
      {children}
    </span>
  );
}

export default AdminExecutiveChip;

// AdminSegmentedToggle.jsx
// A two-or-more-way segmented control for the mutually-exclusive choices on the
// event form — solo/team, physical/virtual, free/paid, per-team/per-person. The
// selected segment fills primary blue; the rest stay quiet on the off-white
// track. It is a labelled radio group under the hood, so arrow keys move the
// selection and a screen reader announces it.
//
// options: Array<{ value, label }>

function AdminSegmentedToggle({ label, options = [], value, onChange, name, className = '' }) {
  return (
    <div className={['flex flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      {label ? (
        <span className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink">
          {label}
        </span>
      ) : null}
      <div
        role="radiogroup"
        aria-label={label || name}
        className="inline-flex w-full rounded-md border border-admin-slate-200 bg-admin-surface-off-white p-0.5 sm:w-auto"
      >
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange?.(option.value)}
              className={[
                'flex-1 rounded px-4 py-1.5 font-admin-body text-[14px] font-medium transition-colors sm:flex-none',
                isSelected
                  ? 'bg-admin-primary-blue text-admin-surface-white'
                  : 'text-admin-slate-600 hover:text-admin-neutral-ink',
              ].join(' ')}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default AdminSegmentedToggle;

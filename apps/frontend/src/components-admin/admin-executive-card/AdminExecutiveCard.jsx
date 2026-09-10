// AdminExecutiveCard.jsx
// The console's default container: a white plane on the off-white page, marked
// off by a 1px slate hairline and nothing else. No drop shadow — separation here
// is tonal, and a shadow on every card is the single change that would make this
// system read as a generic dashboard template.

function AdminExecutiveCard({ title, description, actions, children, className = '', bodyClassName = '' }) {
  const hasHeader = Boolean(title || actions);

  return (
    <section
      className={['rounded-lg border border-admin-slate-200 bg-admin-surface-white', className]
        .filter(Boolean)
        .join(' ')}
    >
      {hasHeader ? (
        <header className="flex items-start justify-between gap-4 border-b border-admin-slate-200 px-6 py-4">
          <div className="min-w-0">
            {title ? (
              <h2 className="font-admin-display text-[20px] font-semibold leading-7 text-admin-neutral-ink">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-1 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={['p-6', bodyClassName].filter(Boolean).join(' ')}>{children}</div>
    </section>
  );
}

export default AdminExecutiveCard;

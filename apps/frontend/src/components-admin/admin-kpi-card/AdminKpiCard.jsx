// AdminKpiCard.jsx
// A single headline metric: a caps label, a big value, a quiet subtitle, and an
// icon boxed top-right. It is not a parallel card — it composes the shared
// AdminExecutiveCard for its plane and hairline, then lays the metric out inside.
//
// `value` is pre-formatted by the caller (the card never formats money or counts
// itself). A null/undefined value renders the em dash the caller passes as
// `emptyValue`, so an unavailable metric shows "—" rather than "0" or "NaN".

/*
 * `onIconTap` turns the icon into a real tap target — a <button type="button">
 * with an aria-label, never a div with a handler (the prompt-24 iOS lesson).
 * Without it the icon stays decorative, exactly as before.
 */
/*
 * `onSelect` makes the WHOLE card a filter toggle (the user directory's KPI
 * cards). It renders a real <button> rather than a clickable <section>, so it
 * is reachable by keyboard and announced as pressable; `isSelected` drives
 * aria-pressed and the accent ring. Cards without it stay inert <section>s.
 */
function AdminKpiCard({
  label,
  value,
  emptyValue = '—',
  subtitle,
  icon,
  onIconTap,
  iconTapLabel,
  onSelect,
  isSelected = false,
}) {
  const displayValue = value === null || value === undefined || value === '' ? emptyValue : value;

  const ContainerElement = onSelect ? 'button' : 'section';
  const containerProps = onSelect
    ? { type: 'button', onClick: onSelect, 'aria-pressed': isSelected }
    : {};

  return (
    <ContainerElement
      {...containerProps}
      className={[
        'rounded-lg border bg-admin-surface-white p-6 text-left',
        onSelect ? 'w-full cursor-pointer transition-colors hover:border-admin-primary-blue/40' : '',
        isSelected
          ? 'border-admin-primary-blue ring-2 ring-admin-primary-blue/30'
          : 'border-admin-slate-200',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-start justify-between gap-4">
        <p className="font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
          {label}
        </p>
        {icon && onIconTap ? (
          <button
            type="button"
            onClick={onIconTap}
            aria-label={iconTapLabel}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md bg-admin-primary-blue/10 text-admin-primary-blue transition-colors hover:bg-admin-primary-blue/20"
          >
            {icon}
          </button>
        ) : icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-admin-primary-blue/10 text-admin-primary-blue">
            {icon}
          </span>
        ) : null}
      </div>

      <p className="mt-4 font-admin-display text-[32px] font-bold leading-9 tracking-[-0.01em] text-admin-neutral-ink">
        {displayValue}
      </p>

      {subtitle ? (
        <p className="mt-1 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">{subtitle}</p>
      ) : null}
    </ContainerElement>
  );
}

export default AdminKpiCard;

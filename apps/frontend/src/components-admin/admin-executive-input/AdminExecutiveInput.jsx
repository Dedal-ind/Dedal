// AdminExecutiveInput.jsx
// A hairline field that answers focus with the primary blue and a soft outer
// glow — the ring is the whole focus affordance in this system, so it is a real
// box-shadow rather than an outline the browser might drop.
//
// The label is bound with htmlFor/id: an admin console is filled in by keyboard
// and screen reader as often as by mouse, and an unlabelled field is unusable.

import { useId } from 'react';

function AdminExecutiveInput({
  label,
  required = false,
  helperText,
  errorMessage,
  iconLeft,
  iconRight,
  className = '',
  id,
  ...inputProps
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedById = helperText || errorMessage ? `${inputId}-description` : undefined;
  const hasError = Boolean(errorMessage);

  return (
    <div className={['flex flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      {label ? (
        <label
          htmlFor={inputId}
          className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink"
        >
          {label}
          {required ? <span className="ml-0.5 text-admin-status-error-red">*</span> : null}
        </label>
      ) : null}

      <div className="relative">
        {iconLeft ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-admin-slate-600">
            {iconLeft}
          </span>
        ) : null}
        <input
          id={inputId}
          aria-invalid={hasError || undefined}
          aria-describedby={describedById}
          className={[
            'h-10 w-full rounded-md border bg-admin-surface-white font-admin-body text-[14px] text-admin-neutral-ink',
            'placeholder:text-admin-slate-600/70 transition-shadow transition-colors',
            'focus:outline-none focus:ring-4',
            hasError
              ? 'border-admin-status-error-red focus:border-admin-status-error-red focus:ring-admin-status-error-red/15'
              : 'border-admin-slate-200 focus:border-admin-primary-blue focus:ring-admin-primary-blue/15',
            iconLeft ? 'pl-9' : 'pl-3',
            iconRight ? 'pr-9' : 'pr-3',
          ].join(' ')}
          {...inputProps}
        />
        {iconRight ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-admin-slate-600">{iconRight}</span>
        ) : null}
      </div>

      {helperText || errorMessage ? (
        <p
          id={describedById}
          className={[
            'font-admin-body text-[13px] leading-[18px]',
            hasError ? 'text-admin-status-error-red' : 'text-admin-slate-600',
          ].join(' ')}
        >
          {errorMessage || helperText}
        </p>
      ) : null}
    </div>
  );
}

export default AdminExecutiveInput;

// AdminExecutiveTextarea.jsx
// The multi-line sibling of AdminExecutiveInput: same hairline field, same
// focus ring, same label/error contract — only taller and with an optional
// character counter for the length-capped fields (description, rules).
//
// maxLength is a soft cap enforced by the control itself; the counter turns
// amber as it approaches the limit so an organiser sees the ceiling before they
// hit it.

import { useId } from 'react';

function AdminExecutiveTextarea({
  label,
  required = false,
  helperText,
  errorMessage,
  maxLength,
  rows = 4,
  value = '',
  className = '',
  id,
  ...textareaProps
}) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;
  const describedById = helperText || errorMessage ? `${textareaId}-description` : undefined;
  const hasError = Boolean(errorMessage);
  const remaining = typeof maxLength === 'number' ? maxLength - value.length : null;
  const isNearLimit = remaining !== null && remaining <= Math.max(20, maxLength * 0.1);

  return (
    <div className={['flex flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      {label ? (
        <label
          htmlFor={textareaId}
          className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink"
        >
          {label}
          {required ? <span className="ml-0.5 text-admin-status-error-red">*</span> : null}
        </label>
      ) : null}

      <textarea
        id={textareaId}
        rows={rows}
        value={value}
        maxLength={maxLength}
        aria-invalid={hasError || undefined}
        aria-describedby={describedById}
        className={[
          'w-full rounded-md border bg-admin-surface-white px-3 py-2.5 font-admin-body text-[14px] text-admin-neutral-ink',
          'placeholder:text-admin-slate-600/70 transition-shadow transition-colors',
          'focus:outline-none focus:ring-4 resize-y',
          hasError
            ? 'border-admin-status-error-red focus:border-admin-status-error-red focus:ring-admin-status-error-red/15'
            : 'border-admin-slate-200 focus:border-admin-primary-blue focus:ring-admin-primary-blue/15',
        ].join(' ')}
        {...textareaProps}
      />

      <div className="flex items-start justify-between gap-2">
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
        ) : (
          <span />
        )}
        {remaining !== null ? (
          <span
            className={[
              'shrink-0 font-admin-mono text-[12px] leading-[18px]',
              isNearLimit ? 'text-admin-status-warning-amber' : 'text-admin-slate-600',
            ].join(' ')}
          >
            {value.length}/{maxLength}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default AdminExecutiveTextarea;

// AdminExecutiveSelect.jsx
// A native <select> dressed to match the executive input: hairline field, blue
// focus ring, a chevron affordance drawn in. Native on purpose — a keyboard- and
// screen-reader-driven console is better served by the platform control than by a
// bespoke listbox, and the field values (category, scoring format) are short.
//
// options: Array<{ value, label }>. `placeholder` renders a disabled first row so
// an unselected field reads as "Choose…" rather than silently defaulting.

import { useId } from 'react';
import { ChevronDown } from 'lucide-react';

function AdminExecutiveSelect({
  label,
  required = false,
  helperText,
  errorMessage,
  options = [],
  placeholder,
  value = '',
  className = '',
  id,
  ...selectProps
}) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const describedById = helperText || errorMessage ? `${selectId}-description` : undefined;
  const hasError = Boolean(errorMessage);

  return (
    <div className={['flex flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      {label ? (
        <label
          htmlFor={selectId}
          className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink"
        >
          {label}
          {required ? <span className="ml-0.5 text-admin-status-error-red">*</span> : null}
        </label>
      ) : null}

      <div className="relative">
        <select
          id={selectId}
          value={value}
          aria-invalid={hasError || undefined}
          aria-describedby={describedById}
          className={[
            'h-10 w-full appearance-none rounded-md border bg-admin-surface-white pl-3 pr-9 font-admin-body text-[14px]',
            'transition-shadow transition-colors focus:outline-none focus:ring-4',
            value === '' ? 'text-admin-slate-600/70' : 'text-admin-neutral-ink',
            hasError
              ? 'border-admin-status-error-red focus:border-admin-status-error-red focus:ring-admin-status-error-red/15'
              : 'border-admin-slate-200 focus:border-admin-primary-blue focus:ring-admin-primary-blue/15',
          ].join(' ')}
          {...selectProps}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-admin-slate-600"
        />
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

export default AdminExecutiveSelect;

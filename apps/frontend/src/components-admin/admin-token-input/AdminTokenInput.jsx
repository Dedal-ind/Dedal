// AdminTokenInput.jsx
// A multi-select token input for the targeting editor. Selected values render as
// removable chips. A dropdown offers suggestions filtered by the typed query.
// Open dimensions accept any typed value on Enter; closed dimensions restrict to
// the suggestion list.
//
// options: Array<{ value: string, label: string }>
// value: string[] — selected values
// onChange: (string[]) => void
// allowFreeText: boolean — open dimensions accept arbitrary input

import { useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

function AdminTokenInput({
  label,
  options = [],
  value = [],
  onChange,
  allowFreeText = false,
  placeholder = 'Type to search…',
  helperText,
  errorMessage,
  warningMessage,
  disabled = false,
  className = '',
}) {
  const generatedId = useId();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const hasError = Boolean(errorMessage);
  const hasWarning = Boolean(warningMessage);

  const selectedSet = new Set(value);
  const filtered = options.filter(
    (option) => !selectedSet.has(option.value) && option.label.toLowerCase().includes(query.toLowerCase()),
  );

  function addValue(newValue) {
    if (!selectedSet.has(newValue)) {
      onChange([...value, newValue]);
    }
    setQuery('');
  }

  function removeValue(removeTarget) {
    onChange(value.filter((v) => v !== removeTarget));
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) return;
      if (filtered.length > 0) {
        addValue(filtered[0].value);
      } else if (allowFreeText && trimmed) {
        addValue(trimmed);
      }
    }
    if (event.key === 'Backspace' && !query && value.length > 0) {
      removeValue(value[value.length - 1]);
    }
    if (event.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  }

  function labelForValue(v) {
    return options.find((o) => o.value === v)?.label ?? v;
  }

  return (
    <div className={['flex flex-col gap-1.5', className].filter(Boolean).join(' ')}>
      {label ? (
        <span className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink">
          {label}
        </span>
      ) : null}

      <div
        className={[
          'flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5 transition-shadow focus-within:ring-4',
          disabled ? 'bg-admin-surface-off-white opacity-60' : 'bg-admin-surface-white',
          hasError
            ? 'border-admin-status-error-red focus-within:border-admin-status-error-red focus-within:ring-admin-status-error-red/15'
            : hasWarning
              ? 'border-admin-status-warning-amber focus-within:border-admin-status-warning-amber focus-within:ring-admin-status-warning-amber/15'
              : 'border-admin-slate-200 focus-within:border-admin-primary-blue focus-within:ring-admin-primary-blue/15',
        ].join(' ')}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full bg-admin-primary-blue/10 px-2.5 py-0.5 font-admin-body text-[12px] font-medium text-admin-primary-blue"
          >
            {labelForValue(v)}
            {!disabled ? (
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); removeValue(v); }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-admin-primary-blue/20"
                aria-label={`Remove ${labelForValue(v)}`}
              >
                <X size={11} />
              </button>
            ) : null}
          </span>
        ))}
        <div className="relative min-w-[80px] flex-1">
          <input
            ref={inputRef}
            id={generatedId}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIsOpen(true); }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => setTimeout(() => setIsOpen(false), 150)}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? placeholder : ''}
            disabled={disabled}
            autoComplete="off"
            className="w-full bg-transparent py-0.5 font-admin-body text-[14px] text-admin-neutral-ink placeholder:text-admin-slate-600/50 focus:outline-none"
          />
          {isOpen && (filtered.length > 0 || (allowFreeText && query.trim())) ? (
            <ul className="absolute left-0 top-full z-10 mt-1 max-h-[200px] w-[280px] overflow-y-auto rounded-md border border-admin-slate-200 bg-admin-surface-white shadow-admin-modal">
              {filtered.slice(0, 50).map((option) => (
                <li key={option.value}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addValue(option.value)}
                    className="w-full px-3 py-2 text-left font-admin-body text-[14px] text-admin-neutral-ink hover:bg-admin-surface-off-white"
                  >
                    {option.label}
                  </button>
                </li>
              ))}
              {allowFreeText && query.trim() && !filtered.some((o) => o.label.toLowerCase() === query.trim().toLowerCase()) ? (
                <li>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addValue(query.trim())}
                    className="w-full px-3 py-2 text-left font-admin-body text-[14px] text-admin-primary-blue hover:bg-admin-surface-off-white"
                  >
                    Add "{query.trim()}"
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
      </div>

      {errorMessage ? (
        <p className="font-admin-body text-[13px] leading-[18px] text-admin-status-error-red">{errorMessage}</p>
      ) : null}
      {warningMessage && !errorMessage ? (
        <p className="font-admin-body text-[13px] leading-[18px] text-admin-status-warning-amber">{warningMessage}</p>
      ) : null}
      {helperText && !errorMessage && !warningMessage ? (
        <p className="font-admin-body text-[13px] leading-[18px] text-admin-slate-600">{helperText}</p>
      ) : null}
    </div>
  );
}

export default AdminTokenInput;

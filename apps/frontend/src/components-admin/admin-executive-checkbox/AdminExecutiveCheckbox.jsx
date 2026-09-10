// AdminExecutiveCheckbox.jsx
// A labelled checkbox in the console's palette. The native input drives state and
// keyboard behaviour; `accent-color` tints the box the primary blue without a
// bespoke SVG. An optional description sits under the label for the checkboxes
// that gate something consequential (a medical declaration, nesting).

import { useId } from 'react';

function AdminExecutiveCheckbox({ label, description, checked = false, onChange, id, className = '' }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={['flex items-start gap-2.5', className].filter(Boolean).join(' ')}>
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={(changeEvent) => onChange?.(changeEvent.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-admin-slate-200 accent-admin-primary-blue focus:outline-none focus:ring-2 focus:ring-admin-primary-blue/30"
      />
      <label htmlFor={inputId} className="cursor-pointer select-none">
        <span className="block font-admin-body text-[14px] leading-5 text-admin-neutral-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
            {description}
          </span>
        ) : null}
      </label>
    </div>
  );
}

export default AdminExecutiveCheckbox;

// AdminCollapsibleSection.jsx
// A disclosure block for the optional parts of a long form (additional details,
// parent event, custom questions). Closed by default so the form reads short, it
// opens to reveal its children. The header is a real button with aria-expanded, so
// the section is operable by keyboard and announced correctly.

import { ChevronDown } from 'lucide-react';

function AdminCollapsibleSection({ title, description, isOpen, onToggle, badge, children }) {
  return (
    <div className="rounded-md border border-admin-slate-200">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-admin-surface-off-white"
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">{title}</span>
            {badge ? (
              <span className="rounded-full bg-admin-primary-blue/10 px-2 py-0.5 font-admin-mono text-[12px] font-semibold text-admin-primary-blue">
                {badge}
              </span>
            ) : null}
          </span>
          {description ? (
            <span className="mt-0.5 block font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
              {description}
            </span>
          ) : null}
        </span>
        <ChevronDown
          size={18}
          aria-hidden="true"
          className={['shrink-0 text-admin-slate-600 transition-transform', isOpen ? 'rotate-180' : ''].join(' ')}
        />
      </button>
      {isOpen ? <div className="border-t border-admin-slate-200 px-4 py-4">{children}</div> : null}
    </div>
  );
}

export default AdminCollapsibleSection;

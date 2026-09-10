// AdminStepIndicator.jsx
// The wizard's progress header: 01 Event Setup · 02 Assignments · 03 Review. The
// current step reads in primary blue with a filled index chip; completed steps
// keep a solid chip in neutral ink; steps ahead sit quiet in slate. A completed
// step is clickable so an admin can jump back to edit; steps ahead are not, so
// the wizard's forward gate is never bypassed by the header.
//
// steps: Array<{ id, label }>. currentIndex is zero-based.

import { Check } from 'lucide-react';

function AdminStepIndicator({ steps = [], currentIndex = 0, onStepSelect }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
      {steps.map((step, index) => {
        const isCurrent = index === currentIndex;
        const isComplete = index < currentIndex;
        const isClickable = isComplete && typeof onStepSelect === 'function';

        return (
          <li key={step.id} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!isClickable}
              aria-current={isCurrent ? 'step' : undefined}
              onClick={isClickable ? () => onStepSelect(index) : undefined}
              className={[
                'flex items-center gap-2 rounded-md px-2 py-1 transition-colors',
                isClickable ? 'cursor-pointer hover:bg-admin-surface-off-white' : 'cursor-default',
              ].join(' ')}
            >
              <span
                className={[
                  'flex h-7 w-7 items-center justify-center rounded-md font-admin-mono text-[13px] font-semibold',
                  isCurrent
                    ? 'bg-admin-primary-blue text-admin-surface-white'
                    : isComplete
                      ? 'bg-admin-neutral-ink text-admin-surface-white'
                      : 'bg-admin-surface-off-white text-admin-slate-600',
                ].join(' ')}
              >
                {isComplete ? <Check size={15} strokeWidth={2.5} /> : String(index + 1).padStart(2, '0')}
              </span>
              <span
                className={[
                  'font-admin-body text-[14px] font-medium',
                  isCurrent ? 'text-admin-neutral-ink' : 'text-admin-slate-600',
                ].join(' ')}
              >
                {step.label}
              </span>
            </button>
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className="h-px w-6 bg-admin-slate-200 sm:w-10" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default AdminStepIndicator;

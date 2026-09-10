// AdminActionsMenu.jsx
// The row-level "⋮" overflow menu. Data-driven: it takes a list of actions and
// renders each as a menu item, with the same click-away layer and shadow-modal
// panel the topbar account menu uses — one dropdown treatment across the console.
//
// Near the bottom of the viewport (the last table row) the panel FLIPS to open
// upward instead of clipping below the screen edge; the direction is measured
// from the trigger's rect at the moment it opens. A max-height + scroll is the
// safety net for very long action lists.
//
// items: Array<{ key, label, onSelect, tone?: 'default' | 'danger', disabled? }>

import { useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

// If the trigger sits in the bottom band of the viewport, open upward.
const FLIP_THRESHOLD_PX = 200;

function AdminActionsMenu({ items = [], label = 'Actions' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [opensUpward, setOpensUpward] = useState(false);
  const triggerRef = useRef(null);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="relative flex justify-end">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={(clickEvent) => {
          clickEvent.stopPropagation();
          const rect = triggerRef.current?.getBoundingClientRect();
          setOpensUpward(Boolean(rect && window.innerHeight - rect.bottom < FLIP_THRESHOLD_PX));
          setIsOpen((previous) => !previous);
        }}
        className="flex h-8 w-8 items-center justify-center rounded-md text-admin-slate-600 transition-colors hover:bg-admin-surface-off-white hover:text-admin-neutral-ink"
      >
        <MoreVertical size={18} strokeWidth={1.75} />
      </button>

      {isOpen ? (
        <>
          {/* Click-away layer */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              setIsOpen(false);
            }}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div
            role="menu"
            className={[
              'absolute right-0 z-40 w-[190px] max-h-[280px] overflow-y-auto rounded-lg border border-admin-slate-200 bg-admin-surface-white py-1 shadow-admin-modal',
              opensUpward ? 'bottom-9' : 'top-9',
            ].join(' ')}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={(clickEvent) => {
                  clickEvent.stopPropagation();
                  setIsOpen(false);
                  item.onSelect?.();
                }}
                className={[
                  'flex w-full items-center gap-2 px-4 py-2.5 text-left font-admin-body text-[14px] transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  item.tone === 'danger'
                    ? 'text-admin-status-error-red hover:bg-admin-status-error-red/10'
                    : 'text-admin-neutral-ink hover:bg-admin-surface-off-white',
                ].join(' ')}
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export default AdminActionsMenu;

// AdminCategorySelect.jsx
// The event category field: free text with suggestions, the admin-side twin of
// the participant DepartmentSelect and built on the same rule — whatever is
// TYPED is already a valid value.
//
// It replaces a native <select> bound to a closed enum, which meant a college
// running "Robotics" or "Culinary Arts" could not create the event at all. So,
// exactly as in DepartmentSelect: `value` is the plain category string, typing
// propagates immediately through onChange (no extra tap needed to keep a
// category that is not on the list), and tapping a suggestion writes that
// suggestion's label. The list can never say "no results", because a query
// matching nothing still describes a category the organiser may save.
//
// Styling is AdminExecutiveInput's — same behaviour as the participant-side
// select, admin design tokens. (It was once contrasted here with a
// `BrutalistInput`; that component and its design system no longer exist.)

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

import { EVENT_CATEGORIES } from '../../brand/brand-copy.js';
import { ADMIN_CREATE_EVENT_COPY } from '../../brand-admin/brand-copy.js';

// Suggestions are offered by LABEL: tapping "Social Impact" should store
// "Social Impact", not the legacy slug "socialImpact".
const CATEGORY_LABELS = EVENT_CATEGORIES.map((category) => category.label);

function AdminCategorySelect({
  value,
  onChange,
  placeholder,
  maxLength = 50,
  hasError = false,
  inputId,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerReference = useRef(null);

  const filteredCategories = useMemo(() => {
    const normalisedQuery = (value ?? '').trim().toLowerCase();
    if (!normalisedQuery) {
      return CATEGORY_LABELS;
    }
    return CATEGORY_LABELS.filter((category) =>
      category.toLowerCase().includes(normalisedQuery),
    );
  }, [value]);

  useEffect(() => {
    function handleDocumentClick(clickEvent) {
      if (containerReference.current && !containerReference.current.contains(clickEvent.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  return (
    <div className="relative" ref={containerReference}>
      <div
        className={[
          'flex h-10 w-full items-center gap-2 rounded-md border bg-admin-surface-white px-3',
          'transition-shadow transition-colors focus-within:ring-4',
          hasError
            ? 'border-admin-status-error-red focus-within:border-admin-status-error-red focus-within:ring-admin-status-error-red/15'
            : 'border-admin-slate-200 focus-within:border-admin-primary-blue focus-within:ring-admin-primary-blue/15',
        ].join(' ')}
      >
        <Search size={16} className="shrink-0 text-admin-slate-600/70" />
        <input
          id={inputId}
          type="text"
          value={value ?? ''}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          aria-invalid={hasError || undefined}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === 'Escape') {
              setIsOpen(false);
            }
          }}
          onChange={(changeEvent) => {
            onChange(changeEvent.target.value);
            setIsOpen(true);
          }}
          className="w-full bg-transparent font-admin-body text-[14px] text-admin-neutral-ink outline-none placeholder:text-admin-slate-600/70 focus:outline-none focus:ring-0"
          data-search-input
        />
        <ChevronDown size={16} className="shrink-0 text-admin-slate-600" />
      </div>

      {isOpen ? (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-admin-slate-200 bg-admin-surface-white shadow-lg">
          {filteredCategories.length === 0 ? (
            /* Never "No results" — whatever was typed IS the accepted value. */
            <li className="px-3 py-2.5 font-admin-body text-[12px] uppercase tracking-wide text-admin-slate-600">
              {ADMIN_CREATE_EVENT_COPY.categoryUsingTyped}
            </li>
          ) : (
            filteredCategories.map((category) => (
              <li key={category}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(category);
                    setIsOpen(false);
                  }}
                  className="w-full border-b border-admin-slate-200 px-3 py-2.5 text-left font-admin-body text-[14px] text-admin-neutral-ink last:border-b-0 hover:bg-admin-surface-off-white"
                >
                  {category}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export default AdminCategorySelect;

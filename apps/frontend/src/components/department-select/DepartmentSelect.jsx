// DepartmentSelect.jsx
// A searchable department field shared by profile completion and edit profile,
// styled to match CollegeSelect directly above it. Unlike CollegeSelect it
// holds no id: `value` is the plain department string, and typing propagates
// immediately through onChange — so a department not on the suggestion list is
// kept exactly as typed, no extra tap needed. Tapping a suggestion writes that
// exact label to the same field.

import { useEffect, useMemo, useRef, useState } from 'react';

import { DEPARTMENT_OPTIONS } from '../../brand/brand-copy.js';
import { useExitTransition } from '../../hooks/use-exit-transition/use-exit-transition.js';
import '../../design/layer-motion.css';

function DepartmentSelect({ value, onChange, placeholder, maxLength = 100 }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerReference = useRef(null);

  const filteredDepartments = useMemo(() => {
    const normalisedQuery = (value ?? '').trim().toLowerCase();
    if (!normalisedQuery) {
      return DEPARTMENT_OPTIONS;
    }
    return DEPARTMENT_OPTIONS.filter((department) =>
      department.toLowerCase().includes(normalisedQuery)
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

  /*
   * The listbox was conditionally rendered with no transition, so it appeared
   * and vanished instantly under a field people are actively typing in. It now
   * drops out of the input and retracts back into it. See
   * use-exit-transition.js for why `isOpen` alone cannot drive the mount.
   */
  const {
    isMounted: isListMounted,
    isVisible: isListVisible,
    ref: listRef,
  } = useExitTransition(isOpen);

  return (
    <div className="relative" ref={containerReference}>
      <div className="flex items-center gap-2 rounded-large border border-outline-variant bg-surface-container-lowest px-4 py-3 transition-colors focus-within:border-olive-accent">
        <span className="material-symbols-outlined text-[18px] text-on-surface-variant" aria-hidden="true">
          search
        </span>
        <input
          type="text"
          value={value ?? ''}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
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
          className="w-full bg-transparent font-body text-base text-on-surface outline-none placeholder:text-on-surface-variant focus:outline-none focus:ring-0"
          data-search-input
        />
        <span className="material-symbols-outlined text-[18px] text-on-surface-variant" aria-hidden="true">
          expand_more
        </span>
      </div>

      {isListMounted ? (
        <ul
          ref={listRef}
          className={`absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-large border border-outline-variant bg-surface-container-lowest shadow-subtle dlm-drop${
            isListVisible ? ' dlm-drop--in' : ''
          }`}
          /* Held in the tree for the 180ms exit, but not a list a keyboard can
             still walk into while it is retracting. */
          inert={isOpen ? undefined : true}
        >
          {filteredDepartments.length === 0 ? (
            /* Never "No results" — whatever was typed IS the accepted value. */
            <li className="px-4 py-3 font-body text-[12px] font-bold uppercase tracking-label-caps text-on-surface-variant">
              USING WHAT YOU TYPED
            </li>
          ) : (
            filteredDepartments.map((department) => (
              <li key={department}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(department);
                    setIsOpen(false);
                  }}
                  className="w-full border-b border-outline-variant px-4 py-3 text-left font-body text-base text-on-surface last:border-b-0 hover:bg-surface-container"
                >
                  {department}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export default DepartmentSelect;

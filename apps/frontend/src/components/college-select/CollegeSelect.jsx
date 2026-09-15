// CollegeSelect.jsx
// A searchable college picker shared by profile completion and edit profile.
// Colleges arrive as { id, collegeName, commonName, city }. If no `colleges`
// prop is passed, the component fetches GET /colleges itself on mount, scoped
// by the `city` prop (Bangalore by default for the Alliance ONE context).
// Typing filters against BOTH the full collegeName and the short commonName,
// and results render as "R.V. College of Engineering [RVCE]" with the short
// name highlighted. Selecting sets the collegeId via onSelect.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

import apiClient from '../../api-client/api-client.js';
import { OTHER_COLLEGE_LABEL, OTHER_COLLEGE_OPTION } from '../../helpers/college-options.js';
import { useExitTransition } from '../../hooks/use-exit-transition/use-exit-transition.js';
import '../../design/layer-motion.css';

function readCollegeLabel(college) {
  return college.commonName ?? college.collegeName ?? '';
}

function collegeMatchesQuery(college, normalisedQuery) {
  const collegeName = (college.collegeName ?? '').toLowerCase();
  const commonName = (college.commonName ?? '').toLowerCase();
  return collegeName.includes(normalisedQuery) || commonName.includes(normalisedQuery);
}

function CollegeSelect({ colleges, selectedCollegeId, onSelect, placeholder, city = 'Bangalore' }) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [fetchedColleges, setFetchedColleges] = useState([]);
  const containerReference = useRef(null);

  const shouldSelfFetch = colleges === undefined;
  const collegeOptions = shouldSelfFetch ? fetchedColleges : colleges;

  // Self-fetch mode: load the verified colleges for the given city once.
  useEffect(() => {
    if (!shouldSelfFetch) {
      return undefined;
    }
    let isActive = true;
    async function loadColleges() {
      try {
        const path = city ? `/colleges?city=${encodeURIComponent(city)}` : '/colleges';
        const payload = await apiClient.get(path);
        const collegeList = payload?.colleges ?? payload ?? [];
        if (isActive) {
          setFetchedColleges(collegeList.filter((college) => college.isVerified !== false));
        }
      } catch {
        if (isActive) {
          setFetchedColleges([]);
        }
      }
    }
    loadColleges();
    return () => {
      isActive = false;
    };
  }, [shouldSelfFetch, city]);

  const selectedCollege = collegeOptions.find((college) => college.id === selectedCollegeId);

  const filteredColleges = useMemo(() => {
    const normalisedQuery = query.trim().toLowerCase();
    if (!normalisedQuery) {
      return collegeOptions;
    }
    return collegeOptions.filter((college) => collegeMatchesQuery(college, normalisedQuery));
  }, [collegeOptions, query]);

  useEffect(() => {
    function handleDocumentClick(clickEvent) {
      if (containerReference.current && !containerReference.current.contains(clickEvent.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, []);

  const isOtherSelected = selectedCollegeId === OTHER_COLLEGE_OPTION;
  const displayValue = isOpen
    ? query
    : isOtherSelected
      ? OTHER_COLLEGE_LABEL
      : selectedCollege
        ? readCollegeLabel(selectedCollege)
        : '';

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
      <div className="flex items-center gap-2 rounded-[var(--r-card)] border border-[var(--divider)] bg-[var(--surface-card)] px-4 py-3 transition-colors focus-within:border-[var(--ink)]">
        <Search size={18} className="shrink-0 text-[var(--muted)]" aria-hidden="true" />
        <input
          type="text"
          value={displayValue}
          placeholder={placeholder}
          onFocus={() => setIsOpen(true)}
          onChange={(changeEvent) => {
            setQuery(changeEvent.target.value);
            setIsOpen(true);
          }}
          className="w-full bg-transparent font-[family-name:var(--font)] text-base text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus:outline-none focus:ring-0"
          data-search-input
        />
        <ChevronDown size={18} className="shrink-0 text-[var(--muted)]" aria-hidden="true" />
      </div>

      {isListMounted ? (
        <ul
          ref={listRef}
          className={`absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-[var(--r-card)] border border-[var(--divider)] bg-[var(--surface-card)] shadow-[var(--e1)] dlm-drop${
            isListVisible ? ' dlm-drop--in' : ''
          }`}
          /* Held in the tree for the 180ms exit, but not a list a keyboard can
             still walk into while it is retracting. */
          inert={isOpen ? undefined : true}
        >
          {filteredColleges.length === 0 ? (
            <li className="border-b border-[var(--divider)] px-4 py-3 font-[family-name:var(--font)] text-[12px] font-bold text-[var(--muted)]">
              No colleges found
            </li>
          ) : (
            filteredColleges.map((college) => {
              const hasDistinctShortName =
                college.commonName &&
                college.collegeName &&
                college.commonName !== college.collegeName;
              return (
                <li key={college.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(college.id);
                      setQuery('');
                      setIsOpen(false);
                    }}
                    className="w-full border-b border-[var(--divider)] px-4 py-3 text-left font-[family-name:var(--font)] text-base text-[var(--ink)] last:border-b-0 hover:bg-[var(--ink-dim-4)]"
                  >
                    {hasDistinctShortName ? (
                      <>
                        {college.collegeName}{' '}
                        <span className="font-[family-name:var(--font)] text-[12px] font-semibold text-[var(--muted)]">
                          [{college.commonName}]
                        </span>
                      </>
                    ) : (
                      readCollegeLabel(college)
                    )}
                  </button>
                </li>
              );
            })
          )}
          {/* Always last, whatever the search: a college that is not on the
              platform yet must never lock a student out of signing up. */}
          <li>
            <button
              type="button"
              onClick={() => {
                onSelect(OTHER_COLLEGE_OPTION);
                setQuery('');
                setIsOpen(false);
              }}
              className="w-full px-4 py-3 text-left font-[family-name:var(--font)] text-base font-semibold text-[var(--ink)] hover:bg-[var(--ink-dim-4)]"
            >
              {OTHER_COLLEGE_LABEL}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

export default CollegeSelect;

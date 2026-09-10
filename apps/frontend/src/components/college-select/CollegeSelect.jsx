// CollegeSelect.jsx
// A searchable college picker shared by profile completion and edit profile.
// Colleges arrive as { id, collegeName, commonName, city }. If no `colleges`
// prop is passed, the component fetches GET /colleges itself on mount, scoped
// by the `city` prop (Bangalore by default for the Alliance ONE context).
// Typing filters against BOTH the full collegeName and the short commonName,
// and results render as "R.V. College of Engineering [RVCE]" with the short
// name highlighted. Selecting sets the collegeId via onSelect.

import { useEffect, useMemo, useRef, useState } from 'react';

import apiClient from '../../api-client/api-client.js';
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

  const displayValue = isOpen ? query : selectedCollege ? readCollegeLabel(selectedCollege) : '';

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
          value={displayValue}
          placeholder={placeholder}
          onFocus={() => setIsOpen(true)}
          onChange={(changeEvent) => {
            setQuery(changeEvent.target.value);
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
          {filteredColleges.length === 0 ? (
            <li className="px-4 py-3 font-body text-[12px] font-bold uppercase tracking-label-caps text-on-surface-variant">
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
                    className="w-full border-b border-outline-variant px-4 py-3 text-left font-body text-base text-on-surface last:border-b-0 hover:bg-surface-container"
                  >
                    {hasDistinctShortName ? (
                      <>
                        {college.collegeName}{' '}
                        <span className="font-body text-[12px] font-semibold uppercase tracking-label-caps text-on-surface-variant">
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
        </ul>
      ) : null}
    </div>
  );
}

export default CollegeSelect;

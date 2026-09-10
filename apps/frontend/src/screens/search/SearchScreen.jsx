// SearchScreen.jsx
// Route: /search — the mobile full-page search takeover. It is the second of
// the two containers around SearchPanel: the desktop modal arrives over the
// feed behind a scrim, this one replaces the page and opens the keyboard. The
// behaviour — field, debounce, chips, trending, results — lives entirely in
// SearchPanel, so this file is chrome and data: a back arrow, the city, and the
// promotions to interleave.
//
// Both fetches fail SILENTLY. A missing city degrades the panel's heading from
// "Trending in Bangalore" to "Trending", and missing promotions simply mean
// nothing is injected. Neither is worth an error state on a screen whose whole
// job is to get out of the way of the keyboard.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import SearchPanel from '../../components/search/SearchPanel.jsx';
import { useRotatingPlaceholder } from '../../hooks/use-rotating-placeholder/use-rotating-placeholder.js';
import './search-screen.css';

const BACK_LABEL = 'Back';

function BackGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <path
        d="M15 5 8 12l7 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuthentication();
  const { prefix, term, full } = useRotatingPlaceholder();

  const [query, setQuery] = useState('');
  const [collegeCity, setCollegeCity] = useState(null);
  const [promotions, setPromotions] = useState([]);

  /*
   * The city. The auth user only carries collegeId, and there is no public
   * college-by-id route — the same GET /colleges list Profile reads is the
   * source, matched on id. `city` is in that endpoint's projection.
   *
   * Held under collegeId rather than cleared in the effect: signing out drops
   * the id, and a city read from the previous account must not outlive it.
   */
  const collegeId = currentUser?.collegeId ?? null;
  useEffect(() => {
    if (!collegeId) return undefined;
    const controller = new AbortController();
    apiClient
      .get('/colleges', { signal: controller.signal })
      .then((payload) => {
        const colleges = payload?.colleges ?? payload ?? [];
        const college = Array.isArray(colleges)
          ? colleges.find((candidate) => candidate.id === collegeId)
          : null;
        setCollegeCity(college?.city ?? null);
      })
      .catch(() => setCollegeCity(null));
    return () => controller.abort();
  }, [collegeId]);

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .get('/public/promotions', { signal: controller.signal })
      .then((payload) => {
        const commercial = Array.isArray(payload?.commercial) ? payload.commercial : [];
        const collegeEvent = Array.isArray(payload?.collegeEvent) ? payload.collegeEvent : [];
        setPromotions([...commercial, ...collegeEvent]);
      })
      .catch(() => setPromotions([]));
    return () => controller.abort();
  }, []);

  return (
    <div className="dss-screen">
      <SearchPanel
        query={query}
        onQueryChange={setQuery}
        placeholder={full}
        placeholderPrefix={prefix}
        placeholderTerm={term}
        autoFocus
        city={collegeId ? collegeCity : null}
        promotions={promotions}
        /* The back arrow sits INSIDE the field, where the magnifier was. It was
           on a row of its own above; that row cost 44px of vertical space at the
           very top of a screen whose entire job is to get results under the
           keyboard, to hold one control that is now somewhere easier to reach
           with a thumb. */
        leading={
          <button
            type="button"
            className="dss-back"
            onClick={() => navigate(-1)}
            aria-label={BACK_LABEL}
          >
            <BackGlyph />
          </button>
        }
      />
    </div>
  );
}

export default SearchScreen;

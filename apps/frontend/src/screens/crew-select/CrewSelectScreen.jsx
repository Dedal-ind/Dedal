// CrewSelectScreen.jsx
// Route: /crew-select — pick a fest, open its crew directory.
//
// UNCHANGED: GET /public/fests, then the two best-effort follow-ups — GET
// /staff-assignments/mine and GET /passes/mine/all — each swallowing its own
// failure into an empty Set so a directory list still renders. The same
// end-date filter, the same "fests I staff first, then the rest" split, the
// same client-side name filter, and the same destination
// (/fests/:festSlug/crew-directory).
//
// THE SEARCH FIELD was a gradient-filled pill with the magnifier on the RIGHT,
// a placeholder that centred itself until focus, and a button whose only job was
// to blur the input. The gradient and the two brand tints are gone with the
// Heritage palette; the magnifier is back on the left, where every search field
// in this app and every other one puts it; the placeholder does not move; and
// the blur button is gone, because a control that undoes focus is not a control
// anybody asked for.
//
// NO TITLE PASSED TO ScreenHeader, on purpose. /crew-select is a nav ROOT — a
// title would stand the global app header down and leave the screen with no way
// out but the browser's own Back.

import { useCallback, useEffect, useMemo, useState } from 'react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import apiClient from '../../api-client/api-client.js';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import {
  ChevronIcon,
  CloseIcon,
  SearchIcon,
  TeamIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { CREW_SELECT_COPY } from '../../brand/brand-copy.js';
import '../../design/backstage.css';

/*
 * CREW_SELECT_COPY is consumed by this screen and nothing else (checked across
 * src/), so it was fixed AT SOURCE in brand/brand-copy.js: sentence case, no
 * stamped uppercase, and "My fests" for the ones the signed-in user staffs.
 */

function FestRow({ fest, onOpen }) {
  const [hasImageFailed, setHasImageFailed] = useState(false);
  const showImage = fest.bannerImageUrl && !hasImageFailed;

  return (
    <button type="button" className="dbk-row" onClick={onOpen}>
      {showImage ? (
        <img
          src={fest.bannerImageUrl}
          alt=""
          onError={() => setHasImageFailed(true)}
          className="dbk-row__mark"
        />
      ) : (
        <span className="dbk-row__mark" aria-hidden="true">
          <TeamIcon />
        </span>
      )}
      <span className="dbk-row__name">{fest.festName}</span>
      <span className="dbk-row__chevron" aria-hidden="true">
        <ChevronIcon />
      </span>
    </button>
  );
}

function CrewSelectScreen() {
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();
  const [fests, setFests] = useState([]);
  const [staffFestIds, setStaffFestIds] = useState(() => new Set());
  const [registeredFestIds, setRegisteredFestIds] = useState(() => new Set());
  const [loadState, setLoadState] = useState('loading');
  const [searchText, setSearchText] = useState('');

  const loadFests = useCallback(async () => {
    setLoadState('loading');
    try {
      const payload = await apiClient.get('/public/fests');
      const allFests = Array.isArray(payload) ? payload : [];
      const now = Date.now();
      const activeFests = allFests.filter((fest) => {
        if (!fest.endsOn) return true;
        return new Date(fest.endsOn).getTime() >= now;
      });
      setFests(activeFests);
      try {
        const assignmentResponse = await apiClient.get('/staff-assignments/mine');
        const assignments = Array.isArray(assignmentResponse?.data)
          ? assignmentResponse.data
          : Array.isArray(assignmentResponse)
            ? assignmentResponse
            : [];
        setStaffFestIds(
          new Set(
            assignments.map(
              (assignment) => assignment.festId?.id ?? assignment.festId?._id ?? assignment.festId,
            ),
          ),
        );
      } catch {
        setStaffFestIds(new Set());
      }
      // Fetch passes to know which fests the user is registered for.
      try {
        const passResponse = await apiClient.get('/passes/mine/all');
        const passes = Array.isArray(passResponse?.data)
          ? passResponse.data
          : Array.isArray(passResponse)
            ? passResponse
            : [];
        setRegisteredFestIds(
          new Set(passes.map((pass) => pass.festId?.id ?? pass.festId?._id ?? pass.festId)),
        );
      } catch {
        setRegisteredFestIds(new Set());
      }
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFests();
  }, [loadFests]);

  const { yourFests, otherFests } = useMemo(() => {
    const normalisedQuery = searchText.trim().toLowerCase();
    const relevantFests = fests.filter(
      (fest) => registeredFestIds.has(fest.id) || staffFestIds.has(fest.id),
    );
    const filtered = normalisedQuery
      ? relevantFests.filter((fest) =>
          (fest.festName ?? '').toLowerCase().includes(normalisedQuery),
        )
      : relevantFests;
    const yours = filtered.filter((fest) => staffFestIds.has(fest.id));
    const others = filtered.filter((fest) => !staffFestIds.has(fest.id));
    return { yourFests: yours, otherFests: others };
  }, [fests, staffFestIds, registeredFestIds, searchText]);

  function openDirectory(fest) {
    navigate(`/fests/${fest.festSlug}/crew-directory`);
  }

  return (
    <div className="dbk-screen">
      <ScreenHeader showBack={false} />

      <div className="dbk-col">
        <h1 className="dbk-h1">{CREW_SELECT_COPY.title}</h1>

        {!isOnline ? <p className="dbk-offline">{CREW_SELECT_COPY.offline}</p> : null}

        <div className="dbk-search">
          <SearchIcon />
          <input
            type="text"
            value={searchText}
            onChange={(changeEvent) => setSearchText(changeEvent.target.value)}
            placeholder={CREW_SELECT_COPY.searchPlaceholder}
            aria-label={CREW_SELECT_COPY.searchPlaceholder}
            maxLength={50}
            autoComplete="off"
            spellCheck={false}
            className="dbk-search__input"
            data-search-input
          />
          {searchText ? (
            <button
              type="button"
              className="dbk-search__clear"
              onClick={() => setSearchText('')}
              aria-label={CREW_SELECT_COPY.clearSearch}
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>

        {loadState === 'loading' ? (
          <div className="dbk-section">
            <div className="dbk-skel dbk-skel--row" />
            <div className="dbk-skel dbk-skel--row" />
            <div className="dbk-skel dbk-skel--row" />
          </div>
        ) : loadState === 'error' ? (
          <div className="dbk-error">
            <p className="dbk-error__message">{CREW_SELECT_COPY.errorMessage}</p>
            <button type="button" className="dbk-error__retry" onClick={loadFests}>
              {CREW_SELECT_COPY.retry}
            </button>
          </div>
        ) : fests.length === 0 ? (
          <EmptyState line={CREW_SELECT_COPY.emptyLine} />
        ) : yourFests.length === 0 && otherFests.length === 0 ? (
          <EmptyState line={CREW_SELECT_COPY.noMatches(searchText)} />
        ) : (
          <>
            {yourFests.length > 0 ? (
              <section className="dbk-section">
                <h2 className="dbk-section__title">{CREW_SELECT_COPY.yourFests}</h2>
                <div className="dbk-grid">
                  {yourFests.map((fest) => (
                    <FestRow key={fest.id} fest={fest} onOpen={() => openDirectory(fest)} />
                  ))}
                </div>
              </section>
            ) : null}
            {otherFests.length > 0 ? (
              <section className="dbk-section">
                <h2 className="dbk-section__title">{CREW_SELECT_COPY.allFests}</h2>
                <div className="dbk-grid">
                  {otherFests.map((fest) => (
                    <FestRow key={fest.id} fest={fest} onOpen={() => openDirectory(fest)} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export default CrewSelectScreen;

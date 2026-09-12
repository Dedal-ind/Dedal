// CrewFestPickerScreen.jsx
// Route: /crew-directory — which fest's crew, when the participant has seats in
// more than one.
//
// WHY A PICKER AND NOT A SECOND DIRECTORY. The crew list already exists at
// /fests/:festSlug/crew-directory and is reached from inside a fest. Arriving
// from the account menu, the participant has not named a fest yet, so the only
// thing missing was the step that names one. This screen is that step and
// nothing else — it hands off to the existing screen rather than fetching and
// rendering a second copy of the same list.
//
// ONE FEST SKIPS THE STEP ENTIRELY, with `replace: true`. A menu of one is not
// a choice, it is a tap that asks the reader to confirm something they never
// had an alternative to. Replacing rather than pushing also means Back from the
// crew list returns to the account menu they came from, instead of landing on a
// picker that would immediately bounce them forward again.
//
// THE DATA IS /registrations/mine, NOT a new endpoint. That response already
// populates the fest with its name, slug, dates, banner and host college — it
// is what the participant hub groups by — so the cards need nothing added to
// the backend.

import { useCallback, useEffect, useMemo, useState } from 'react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import apiClient from '../../api-client/api-client.js';
import InlineError from '../../components/inline-error/InlineError.jsx';
import './crew-directory.css';

const COPY = {
  title: 'Crew & contacts',
  lead: 'Pick a fest to see who is running it.',
  noFests: 'Register for an event to see the crew directory.',
  noFestsAction: 'Browse fests',
  error: 'The crew directory could not be loaded.',
};

/*
 * CONFIRMED ONLY, matching the endpoint.
 *
 * The directory refuses anyone without a confirmed registration in the fest, so
 * listing a fest here on the strength of a paused checkout would offer a card
 * that opens onto a 403. The shared live-status set is deliberately NOT used:
 * it is the right answer to "do I hold a seat here" and the wrong one to "will
 * the crew endpoint let me in".
 */
function isConfirmed(registration) {
  return registration?.status === 'confirmed';
}

function formatDateRange(startsOn, endsOn) {
  if (!startsOn) {
    return null;
  }
  const options = { day: 'numeric', month: 'short' };
  const start = new Date(startsOn).toLocaleDateString('en-IN', options);
  if (!endsOn) {
    return start;
  }
  const end = new Date(endsOn).toLocaleDateString('en-IN', options);
  return start === end ? start : `${start} – ${end}`;
}

function FestCard({ fest, onOpen }) {
  const collegeName = fest.hostCollegeId?.commonName ?? fest.hostCollegeId?.collegeName ?? null;
  const dateRange = formatDateRange(fest.startsOn, fest.endsOn);
  /* College and dates share a line: two secondary lines under a name turns a
     48px row into a 72px one for information nobody came here to read. */
  const meta = [collegeName, dateRange].filter(Boolean).join(' · ');

  return (
    <button type="button" className="dcw-festcard" onClick={onOpen}>
      {fest.bannerImageUrl ? (
        <img className="dcw-festcard__poster" src={fest.bannerImageUrl} alt="" />
      ) : (
        /* A coloured block, not a broken image and not a letter monogram: the
           fest's name is already on the row beside it. */
        <span className="dcw-festcard__poster" aria-hidden="true" />
      )}
      <span className="dcw-festcard__body">
        <span className="dcw-festcard__name">{fest.festName}</span>
        {meta ? <span className="dcw-festcard__meta">{meta}</span> : null}
      </span>
    </button>
  );
}

function CrewFestPickerScreen() {
  const navigate = useTransitionNavigate();
  /*
   * The sole-fest redirect is NOT animated, and that needs its own hook.
   *
   * It is a continuation of the tap that opened this screen, not a second
   * navigation the reader made — animating it plays two forward slides back to
   * back for one intent, which reads as the app overshooting and correcting.
   * `replace: true` alone does not skip the animation; resolveNavigation treats
   * REPLACE like any other path navigation.
   */
  const redirectWithoutAnimating = useTransitionNavigate({ skipTransition: true });
  const [fests, setFests] = useState([]);
  const [loadState, setLoadState] = useState('loading');

  const loadFests = useCallback(async () => {
    setLoadState('loading');
    try {
      const payload = await apiClient.get('/registrations/mine');
      const rows = Array.isArray(payload) ? payload : (payload?.registrations ?? []);

      /*
       * One card per FEST, not per registration. A participant with four
       * registrations at one fest wants one row, and the four are the reason
       * this cannot just be the registration list.
       */
      const byFestId = new Map();
      rows.filter(isConfirmed).forEach((registration) => {
        const fest = registration?.eventId?.festId;
        if (!fest?.id || byFestId.has(fest.id)) {
          return;
        }
        byFestId.set(fest.id, fest);
      });
      setFests([...byFestId.values()]);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFests();
  }, [loadFests]);

  const soleFestSlug = useMemo(
    () => (fests.length === 1 ? (fests[0].festSlug ?? null) : null),
    [fests],
  );

  useEffect(() => {
    if (loadState === 'ready' && soleFestSlug) {
      redirectWithoutAnimating(`/fests/${soleFestSlug}/crew-directory`, { replace: true });
    }
  }, [loadState, soleFestSlug, redirectWithoutAnimating]);

  return (
    <div className="dcw-screen">
      <ScreenHeader title={COPY.title} />

      <div className="dcw-page">
        {loadState === 'loading' || soleFestSlug ? (
          /* The sole-fest case keeps the skeleton rather than flashing a
             one-row picker for the frame before the redirect lands. */
          <div className="dcw-picker">
            <div className="dcw-skel dcw-skel--card" />
            <div className="dcw-skel dcw-skel--card" />
          </div>
        ) : loadState === 'error' ? (
          <InlineError message={COPY.error} onRetry={loadFests} />
        ) : fests.length === 0 ? (
          <div className="dcw-empty">
            <p className="dcw-note">{COPY.noFests}</p>
            <button type="button" className="dcw-empty__action" onClick={() => navigate('/')}>
              {COPY.noFestsAction}
            </button>
          </div>
        ) : (
          <div className="dcw-picker">
            <p className="dcw-note">{COPY.lead}</p>
            {fests.map((fest) => (
              <FestCard
                key={fest.id}
                fest={fest}
                onOpen={() => navigate(`/fests/${fest.festSlug}/crew-directory`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CrewFestPickerScreen;

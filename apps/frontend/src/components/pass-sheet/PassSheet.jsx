// PassSheet.jsx
// The pass, one tap from anywhere, over whatever you were looking at.
//
// THIS IS A SHORTCUT, NOT A NAVIGATION. It does not push a route, so nothing
// is added to history and dismissing it puts you back exactly where you were —
// mid-scroll, mid-form, mid-anything. The full pass screen still exists at
// /my-passes/:festId for deep links, sharing and the case where someone wants
// the whole thing; this is the version for standing at a gate with a queue
// behind you.
//
// WHICH PASS. The active one: a pass whose fest is running now, or if none is,
// the one starting soonest. Passes for fests that have already finished are
// not offered — a QR nobody will scan is worse than an empty state, because it
// looks like it should work.
//
// The QR itself is the same QRCodeSVG at the same error-correction level as the
// pass screen, rendered from the same qrToken. There is no second encoding of
// a credential anywhere in this app.

import { useEffect, useState } from 'react';
import { useTransitionNavigate } from '../route-transition/use-transition-navigate.js';
import apiClient from '../../api-client/api-client.js';
import BottomSheet from '../bottom-sheet/BottomSheet.jsx';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import PassCard from '../../screens/qr-pass/PassCard.jsx';
import { selectActivePass } from './select-active-pass.js';

const COPY = {
  title: 'My pass',
  empty: 'You do not have a pass yet. Register for a fest and it appears here.',
  emptyAction: 'Find a fest',
  loading: 'Loading your pass',
  viewFull: 'Open full pass',
};

function PassSheet({ isOpen, onClose }) {
  // A bottom sheet that navigates on dismiss does NOT get a page transition.
  // The sheet's own slide-down IS the transition; running a 200ms page slide
  // underneath it animates the same moment twice, and the two curves do not
  // agree. skipTransition makes every navigate() in this component plain.
  const navigate = useTransitionNavigate({ skipTransition: true });
  /* The card names its holder, and this is the only place the sheet can get
     that from: /passes/mine/all returns the pass and the fest, not the user. */
  const { currentUser } = useAuthentication();
  const [entries, setEntries] = useState([]);
  const [loadState, setLoadState] = useState('idle'); // idle | loading | ready
  /* Stamped when the passes land, never read during render: Date.now() in a
     render body makes "which pass is active" answer differently on two renders
     of identical data. */
  const [nowTs, setNowTs] = useState(() => Date.now());

  /*
   * Fetched when the sheet opens, not on mount. This component is rendered on
   * every participant screen; requesting a list of passes on every navigation
   * would be a request nobody asked for on screens where the sheet is never
   * opened.
   */
  useEffect(() => {
    if (!isOpen) return undefined;
    const controller = new AbortController();
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       This effect IS the external system: it starts a network request and
       reports its lifecycle. Marking the request in flight is the first half
       of that, and there is nothing to derive it from. */
    setLoadState('loading');
    apiClient
      .get('/passes/mine/all', { signal: controller.signal })
      .then((list) => {
        setEntries(Array.isArray(list) ? list : []);
        setNowTs(Date.now());
        setLoadState('ready');
      })
      .catch((error) => {
        if (error?.name === 'CanceledError' || error?.name === 'AbortError') return;
        /* A failure and an empty list land on the same screen deliberately.
           "Could not load your pass" with a retry button is not a thing to read
           at a gate; "you do not have a pass" with a way to get one is. */
        setEntries([]);
        setLoadState('ready');
      });
    return () => controller.abort();
  }, [isOpen]);

  const active = loadState === 'ready' ? selectActivePass(entries, nowTs) : null;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={COPY.title}>
      {loadState === 'loading' ? (
        <div className="dsh-empty">
          <p className="dsh-empty__text">{COPY.loading}</p>
        </div>
      ) : null}

      {loadState === 'ready' && !active ? (
        <div className="dsh-empty">
          <p className="dsh-empty__text">{COPY.empty}</p>
          <button
            type="button"
            className="dsh-button"
            onClick={() => {
              onClose();
              navigate('/');
            }}
          >
            {COPY.emptyAction}
          </button>
        </div>
      ) : null}

      {active ? (
        <div className="dps">
          {/*
            THE SAME CARD THE PASS SCREEN DRAWS, not a second rendering of the
            credential. This used to be a hand-rolled QR plus a fest name and a
            host line, which meant two places drew the one thing a volunteer
            scans — and the two had already drifted: the screen showed the
            backup code and the holder, the sheet showed neither, so a camera
            failure at the gate was recoverable on one surface and a dead end on
            the other. PassCard is imported from the pass screen so there is
            exactly one answer to "what does a pass look like".

            `compact` trims the QR to 208px and drops the date line and email;
            it never restyles, so the credential itself is identical in both
            homes. No entitlements are passed because /passes/mine/all does not
            return them, and the section is absent rather than empty.
          */}
          <PassCard
            pass={active.pass}
            fest={active.fest}
            user={currentUser}
            compact
            nowMs={nowTs}
          />
          <button
            type="button"
            className="dsh-button dsh-button--quiet"
            onClick={() => {
              onClose();
              navigate(`/my-passes/${active.fest.id}`);
            }}
          >
            {COPY.viewFull}
          </button>
        </div>
      ) : null}
    </BottomSheet>
  );
}

export default PassSheet;

// SignOutScreen.jsx
// Route: /sign-out — the URL you can always type. It signs out on mount, says so,
// and returns to the sign-in screen a moment later.
//
// It is registered OUTSIDE PublicOnlyRoute on purpose: a public-only wrapper would
// bounce an authenticated visitor away, and an authenticated visitor is the only
// person this route is for.
//
// It draws from auth-sign-in.css rather than a stylesheet of its own. This is the
// last frame of the authentication flow — the next thing on screen is /auth/email
// — so a second stylesheet here would be a second visual system for two seconds
// of one journey.

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { IDENTITY_MENU_COPY } from '../../brand/brand-copy.js';
import { SignOutIcon } from '../../components/detail-icons/DetailIcons.jsx';
import '../auth-sign-in/auth-sign-in.css';

const REDIRECT_DELAY_MS = 2000;

function SignOutScreen() {
  const navigate = useNavigate();
  const { signOut } = useAuthentication();

  useEffect(() => {
    signOut();
    const redirectTimer = window.setTimeout(() => {
      navigate('/auth/email', { replace: true });
    }, REDIRECT_DELAY_MS);
    return () => window.clearTimeout(redirectTimer);
    // signOut is re-created every render, so depending on it would re-run this
    // effect (and restart the timer) forever. The mount-once contract is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dsi-signout">
      <span className="dsi-signout__mark" aria-hidden="true">
        <SignOutIcon size="lg" />
      </span>
      {/*
        A plain <h1>. No role="status" and no live region: the headline is present
        at first paint rather than arriving later, so there is nothing for a live
        region to announce — and role="status" would have overridden the heading
        role, costing the page its only landmark heading to gain nothing.
      */}
      <h1 className="dsi-signout__title">{IDENTITY_MENU_COPY.signedOutHeadline}</h1>
      <p className="dsi-signout__body">{IDENTITY_MENU_COPY.signedOutBody}</p>
      {/*
        The two-second wait, drawn as the bar that is actually draining rather
        than as three pulsing dots that imply an indefinite one. aria-hidden
        because the copy above already says what is happening, and under reduced
        motion the bar simply sits full — nothing is lost.
      */}
      <span className="dsi-signout__track" aria-hidden="true" />
    </div>
  );
}

export default SignOutScreen;

// AppHeader.jsx
// The participant navigation. Replaces the bottom tab bar.
//
// Three controls on the right, in the order a thumb reaches them and in the
// order they are needed:
//
//   SEARCH  DESKTOP ONLY, and hidden below 1024px by search.css. It opens the
//           search modal over whatever you were looking at. On a phone the job
//           is done by the visible bar on Discover, which goes to /search — a
//           real page with a real keyboard, because a modal on a phone is a
//           full-screen page wearing a scrim whose back button dismisses the
//           whole app. The two are mutually exclusive by media query, so at any
//           width there is exactly one way into search.
//
//   PASS    opens the pass as a sheet over the current screen. Not a route:
//           dismissing it returns you to exactly where you were. This is the
//           replacement for the Pass tab, and it is better than the tab was,
//           because it does not cost you your place.
//
//   AVATAR  goes to /account — Profile, My Fests, Certificates, Notifications,
//           Settings, Sign out. A page, not a sheet: on a laptop it is a
//           two-pane view with a menu that stays, and on a phone it is a panel
//           that slides in from the left. Unlike the pass, this one IS worth a
//           route — every row in it was a place already.
//
// The header does not hide on scroll and has no blur and no shadow, only a 1px
// border. See app-header.css for why the no-hiding part is not a style choice.

import { useState } from 'react';
import { useTransitionNavigate } from '../route-transition/use-transition-navigate.js';
import DedalWordmark from '../dedal-wordmark/DedalWordmark.jsx';
import SearchModal from '../search/SearchModal.jsx';
import NotificationsPanel from '../notifications-panel/NotificationsPanel.jsx';
import AccountDrawer from '../account-drawer/AccountDrawer.jsx';
import { useIsDesktopLayout } from '../../screens/account/use-desktop-layout.js';
import PassSheet from '../pass-sheet/PassSheet.jsx';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { normalizeGooglePhotoUrl } from '../../helpers/google-photo-url.js';
import './app-header.css';

const COPY = {
  home: 'Go to Discover',
  openSearch: 'Search',
  openNotifications: 'Notifications',
  openPass: 'My pass',
  openAccount: 'Account and settings',
};

/* Drawn here rather than imported, matching SearchIcon and PassIcon beside it:
   the header's marks are hand-drawn at this weight so they sit together. */
function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13.73 21a2 2 0 0 1-3.46 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* A QR mark, not a ticket: the thing this opens is a code someone scans. */
function PassIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M14 14h3v3h-3zM19 14h2M14 19h3m2 0h2m-2-2v.01"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Avatar({ user }) {
  /* A Google photo URL that 404s is common — the account had a photo, the
     photo was removed, the URL stayed. Without this the header renders the
     browser's broken-image glyph on every screen. */
  const [hasPhotoFailed, setHasPhotoFailed] = useState(false);
  const photoUrl =
    user?.profilePictureUrl && !hasPhotoFailed
      ? normalizeGooglePhotoUrl(user.profilePictureUrl, 64)
      : null;
  const initial = (user?.fullName || user?.email || '?').trim().charAt(0).toUpperCase();

  if (photoUrl) {
    return (
      <img
        className="dhd-avatar"
        src={photoUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setHasPhotoFailed(true)}
      />
    );
  }
  return <span className="dhd-avatar dhd-avatar--initial">{initial}</span>;
}

function AppHeader() {
  const navigate = useTransitionNavigate();
  const { currentUser } = useAuthentication();

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const isDesktop = useIsDesktopLayout();
  const [isPassOpen, setIsPassOpen] = useState(false);
  /* The avatar goes to a PAGE now, /account, not a sheet — and it goes there
     without a view transition, because that page animates its own panel in
     from the left on mobile and the two would be the same 240ms twice. */
  const navigateToAccount = useTransitionNavigate({ skipTransition: true });

  return (
    <>
      <header className="dhd-header">
        <div className="dhd-row">
          <button
            type="button"
            className="dhd-brand"
            onClick={() => navigate('/')}
            aria-label={COPY.home}
          >
            <DedalWordmark size={26} />
          </button>

          <div className="dhd-actions">
            <button
              type="button"
              className="dhd-iconbutton dhd-iconbutton--search"
              onClick={() => setIsSearchOpen(true)}
              aria-label={COPY.openSearch}
              aria-haspopup="dialog"
            >
              <SearchIcon />
            </button>

            {/* DESKTOP ONLY, hidden below 1024px by the same rule that hides
                search. On a phone notifications are a page, reached from the
                account menu: a panel would cover the screen it is anchored to,
                which is just the page with extra steps. */}
            <button
              type="button"
              className="dhd-iconbutton dhd-iconbutton--search"
              onClick={() => setIsNotificationsOpen(true)}
              aria-label={COPY.openNotifications}
              aria-haspopup="dialog"
              aria-expanded={isNotificationsOpen}
            >
              <BellIcon />
            </button>

            <button
              type="button"
              className="dhd-iconbutton"
              onClick={() => setIsPassOpen(true)}
              aria-label={COPY.openPass}
              aria-haspopup="dialog"
            >
              <PassIcon />
            </button>

            <button
              type="button"
              className="dhd-iconbutton"
              /*
               * TWO SHAPES, ONE CONTROL. A laptop goes to /account, where the
               * menu and the section sit side by side. A phone opens the
               * drawer over the page it is already on — the feed stays behind
               * it, dimmed, which is the whole point of a drawer and is
               * something a route change cannot do, because it unmounts the
               * page you would be sliding over.
               */
              onClick={() =>
                isDesktop ? navigateToAccount('/account') : setIsAccountOpen(true)
              }
              aria-label={COPY.openAccount}
            >
              <Avatar user={currentUser} />
            </button>
          </div>
        </div>
      </header>

      <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      <NotificationsPanel
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
      />
      <AccountDrawer isOpen={isAccountOpen} onClose={() => setIsAccountOpen(false)} />
      <PassSheet isOpen={isPassOpen} onClose={() => setIsPassOpen(false)} />
    </>
  );
}

export default AppHeader;

// AccountDrawer.jsx
// The account menu on a PHONE: a FULL-SCREEN panel that slides in from the
// right over whatever you were looking at, the way Zomato District and most
// consumer apps present a profile drawer.
//
// It is full-bleed rather than the 400px column it started as. A drawer that
// leaves a strip of the page showing beside it reads as a peek, and the profile
// is not a peek — it is a place you went. See account-drawer.css for what that
// does to the scrim, which is now only visible while the panel is travelling.
//
// WHY A DRAWER AND NOT THE /account PAGE.
//
// /account is a route, and a route change unmounts the screen you were on. So a
// "slide in from the right" on a route can only ever slide over a blank page —
// there is nothing behind it, which is precisely what a drawer is for. The
// point of the gesture is that you have not left: the feed is still mounted
// behind, one tap away, and it is still there — unscrolled, unrefetched — when
// you close. A drawer keeps that; a route cannot. Going full-bleed does not
// change it: the page behind is covered, not unmounted.
//
// So the two shapes are genuinely different components rather than one
// component with a breakpoint. Desktop keeps the /account page with its
// persistent left pane, because a laptop has room to show the menu and the
// section at once and a drawer there would cover a screen that did not need
// covering.
//
// The menu itself is NOT duplicated: SECTIONS is imported from AccountScreen,
// so the drawer and the page can never list different destinations.

import { useEffect, useRef } from 'react';
import { useTransitionNavigate } from '../route-transition/use-transition-navigate.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { SECTIONS } from '../../screens/account/AccountScreen.jsx';
import { BackIcon, ChevronIcon, SignOutIcon } from '../detail-icons/DetailIcons.jsx';
import './account-drawer.css';

const COPY = {
  title: 'Profile',
  back: 'Close',
  menuLabel: 'Account sections',
  signOut: 'Sign out',
};

function AccountDrawer({ isOpen, onClose }) {
  /*
   * THE DESTINATION ANIMATES. This used to pass skipTransition, on the theory
   * that the drawer's own close was the transition and a page transition over
   * the same moment would animate twice. In use that was wrong: the drawer
   * closes over the OLD page and the new page then appears with no motion at
   * all, so every destination arrived as an instant hard cut. The two
   * animations are sequential, not simultaneous — close, then navigate — so
   * they do not fight, and the slide is what tells you the app moved.
   */
  const navigate = useTransitionNavigate();
  const { signOut, hasStaffAssignment } = useAuthentication();
  const panelRef = useRef(null);

  /* Escape closes, like every other dismissible layer in the app. */
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  /*
   * The page behind must not scroll while the drawer is over it. Without this
   * a flick on the drawer's own list, once it reaches its end, scrolls the feed
   * underneath — which looks like the drawer moving and is the single most
   * common way a panel like this feels broken.
   */
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      panelRef.current?.focus();
    }
  }, [isOpen]);

  function go(path) {
    onClose();
    /*
     * A frame after the close, not in the same one. startViewTransition
     * snapshots the page the moment it is called, and calling it while the
     * drawer is still on screen bakes the drawer into the outgoing snapshot —
     * so it appears to slide away twice, once for real and once as a picture.
     * One frame is enough for the close to have been committed.
     */
    window.requestAnimationFrame(() => navigate(path));
  }

  return (
    /*
     * Kept MOUNTED and toggled by a class, not conditionally rendered. A panel
     * that is removed from the DOM on close cannot animate out — it simply
     * vanishes — and the exit is half of what makes a drawer feel like a
     * drawer. `inert` and `visibility` take it out of the tab order and off the
     * screen when shut, so a mounted-but-closed drawer is not a set of links a
     * keyboard can still reach.
     */
    <div
      className={`dad-root${isOpen ? ' dad-root--open' : ''}`}
      /* React 19 wants a real boolean here; an empty string is read as false,
         which is the opposite of what a closed drawer needs. */
      inert={isOpen ? undefined : true}
      aria-hidden={isOpen ? undefined : 'true'}
    >
      <button
        type="button"
        className="dad-scrim"
        onClick={onClose}
        aria-label={COPY.back}
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        className="dad-panel"
        role="dialog"
        aria-modal="true"
        aria-label={COPY.title}
        tabIndex={-1}
      >
        {/* The nav bar the brief asks for, and only what it asks for: a back
            control and the word Profile. No avatar, no actions, no subtitle. */}
        <div className="dad-bar">
          <button type="button" className="dad-back" onClick={onClose} aria-label={COPY.back}>
            <BackIcon />
          </button>
          <h2 className="dad-title">{COPY.title}</h2>
        </div>

        <nav className="dad-menu" aria-label={COPY.menuLabel}>
          <ul className="dad-list">
            {SECTIONS.filter((entry) => !entry.staffOnly || hasStaffAssignment).map((entry) => (
              <li key={entry.key}>
                <button type="button" className="dad-row" onClick={() => go(entry.path)}>
                  <span className="dad-row__icon">
                    <entry.Icon />
                  </span>
                  <span className="dad-row__label">{entry.label}</span>
                  <span className="dad-row__chevron">
                    <ChevronIcon />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Last, under a rule, in --primary: it is the one row here that ends a
            session rather than opening something. */}
        <button
          type="button"
          className="dad-signout"
          onClick={() => {
            onClose();
            signOut();
            navigate('/');
          }}
        >
          <SignOutIcon />
          {COPY.signOut}
        </button>
      </div>
    </div>
  );
}

export default AccountDrawer;

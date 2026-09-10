// AccountScreen.jsx
// Routes: /account and /account/:section — the account experience that used to
// be AccountSheet, promoted from a half-sheet to a real place.
//
// WHY IT STOPPED BEING A SHEET. The sheet was a list of five links that covered
// the screen, could not be linked to, could not be bookmarked, and — on a
// 1600px laptop — drew a 480px column of five rows in the middle of an empty
// window. A menu that is only ever a door does not need to be modal.
//
// TWO SHAPES, ONE DESTINATION.
//
//   DESKTOP (>= 1024px) is two panes. The left pane is the menu and it never
//   leaves; the right pane is the selected section, rendered by the screen that
//   already owns it. Choosing a section changes the URL and the right pane and
//   nothing else, which is the whole reason this is a page: on a wide window
//   the menu costs nothing to keep on screen, so keeping it is free navigation.
//
//   MOBILE (< 1024px) is the menu alone, sliding in from the left behind a nav
//   bar that holds a back button and the word "Profile" — that bar carries
//   nothing else on purpose. Tapping a row goes to the section's OWN route
//   (/settings, /notifications, …) rather than to /account/settings, because
//   those screens are already the mobile design for that content; nesting them
//   inside this panel would stack their header under ours for no gain.
//   A deep link straight to /account/:section still renders the section here,
//   so the URL is never a dead end.
//
// THE MENU IS AccountSheet'S LIST, UNCHANGED — My Fests, Certificates,
// Notifications, Settings, Sign out — with Profile added at the top. Profile is
// not an invention: /profile is the identity screen this page is named after in
// the user's own words, and it is the only entry that makes a sensible default
// for the desktop right pane when no section has been chosen yet.
//
// The two counts are AccountSheet's, kept for the same reason it fetched them:
// "do I have anything on?" is the question this menu is opened to answer. They
// still fail silently — a badge that did not load must never stop its row from
// being tapped.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ScreenTitleProvider } from '../../components/screen-header/screen-title-context.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import apiClient from '../../api-client/api-client.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import {
  BackIcon,
  ChevronIcon,
  SignOutIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { SECTIONS } from './account-sections.js';
import { useIsDesktopLayout } from './use-desktop-layout.js';
/* account.css is loaded from main.jsx alongside the other design-system
   sheets, not imported here — see the note there. */

const COPY = {
  title: 'Profile',
  back: 'Go back',
  menuLabel: 'Account sections',
  signOut: 'Sign out',
};

function AccountScreen() {
  /*
   * skipTransition, and it matters here more than it did in the sheet this
   * replaces. The mobile panel animates itself in with a transform (see
   * account.css); a view transition over the same moment is a second animation
   * of the same pixels on a different curve. On desktop the left pane is
   * persistent, so a full-page slide would animate the menu against itself.
   * Neither shape wants the page transition, so no navigation from this screen
   * gets one.
   */
  const navigate = useTransitionNavigate({ skipTransition: true });
  const { section } = useParams();
  const isDesktop = useIsDesktopLayout();
  const { signOut, hasStaffAssignment } = useAuthentication();

  const [counts, setCounts] = useState({ registrations: 0, unread: 0 });

  /*
   * NO SLIDE HERE ANY MORE. AccountDrawer owns the sliding presentation on a
   * phone; this route is just a page. The transform this used to run got stuck
   * part-way often enough to be the normal case — the screen sat at
   * translateX(-100%), which put every pixel of it off the left edge and read
   * as the whole layout being shoved to one side.
   */
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiClient.get('/registrations/mine', { signal: controller.signal }).catch(() => []),
      apiClient.get('/notifications/mine?limit=1', { signal: controller.signal }).catch(() => null),
    ]).then(([registrations, notifications]) => {
      setCounts({
        registrations: Array.isArray(registrations) ? registrations.length : 0,
        unread: notifications?.unreadCount ?? 0,
      });
    });
    return () => controller.abort();
  }, []);

  /* On a laptop an empty /account is not an empty screen — it opens on the
     first section, which is the identity. On a phone nothing is selected: the
     menu IS the screen. */
  const activeKey = section ?? (isDesktop ? SECTIONS[0].key : null);

  /*
   * A PHONE HAS NO PANE, SO /account/:section IS NOT A PLACE.
   *
   * The menu rows already navigate to the section's own route on mobile; this
   * catches the other ways in — a deep link, a shared URL, a Back into a
   * desktop history entry on a phone. Rendering the section inside this screen
   * instead gave the page two back buttons, its own and the section's, one
   * above the other.
   */
  useEffect(() => {
    if (isDesktop || !section) {
      return;
    }
    const target = SECTIONS.find((candidate) => candidate.key === section);
    navigate(target ? target.path : '/account', { replace: true });
  }, [isDesktop, section, navigate]);
  /*
   * ONE VISIBLE SET, USED FOR BOTH THE MENU AND THE PANE.
   *
   * The drawer filtered staff-only entries and this screen did not, so Backstage
   * was absent on a phone and present on a laptop for the same signed-out-of-
   * staff person — and because its Screen was null the pane rendered nothing,
   * leaving the empty page showing through underneath.
   *
   * Resolving `activeSection` from the FILTERED list matters as much as the
   * menu does: without it, typing /account/backstage would render the staff
   * screen to somebody with no assignment.
   */
  const visibleSections = SECTIONS.filter(
    (candidate) => !candidate.staffOnly || hasStaffAssignment,
  );

  const resolvedSection =
    visibleSections.find((candidate) => candidate.key === activeKey) ?? null;

  /*
   * A section that cannot be resolved — a typo in the URL, or one filtered out
   * because this person is not staff — falls back to the first entry on a
   * laptop rather than leaving the pane blank. An empty right-hand column next
   * to a populated menu reads as a screen that failed to load, which is exactly
   * what /account/backstage looked like before the filter was applied here.
   * On a phone there is no pane to fill, so null is correct there.
   */
  const activeSection = resolvedSection ?? (isDesktop ? (visibleSections[0] ?? null) : null);

  function handleRowClick(entry) {
    if (isDesktop) {
      /* replace while already inside a section, so a back press leaves the
         account page rather than walking back through every pane you looked
         at. The panes are a view, not a journey. */
      navigate(`/account/${entry.key}`, { replace: Boolean(section) });
      return;
    }
    navigate(entry.path);
  }

  function handleBack() {
    /* Inside a section on a phone, back means "up to the menu" — the panel is
       still where you are. Everywhere else it is ordinary history. */
    if (section && !isDesktop) {
      navigate('/account', { replace: true });
      return;
    }
    navigate(-1);
  }

  const ActiveScreen = activeSection?.Screen ?? null;

  return (
    <div className="dac-screen">
      {/* The nav bar the user asked for, verbatim: a back button and the word
          Profile. Hidden at desktop widths, where the app header and the
          persistent left pane already say both of those things. */}
      <div className="dac-topbar">
        <button type="button" className="dac-back" onClick={handleBack} aria-label={COPY.back}>
          <BackIcon size="lg" />
        </button>
        <h1 className="dac-topbar__title">{COPY.title}</h1>
      </div>

      <div className="dac-body">
        <nav className="dac-menu" aria-label={COPY.menuLabel}>
          <ul className="dac-menu__list">
            {visibleSections.map((entry) => {
              const count = entry.countKey ? counts[entry.countKey] : 0;
              const isCurrent = entry.key === activeKey;
              return (
                <li key={entry.key}>
                  <button
                    type="button"
                    className={`dac-item${isCurrent ? ' dac-item--current' : ''}`}
                    onClick={() => handleRowClick(entry)}
                    aria-current={isCurrent ? 'page' : undefined}
                  >
                    <entry.Icon />
                    <span className="dac-item__label">{entry.label}</span>
                    {count > 0 ? <span className="dac-item__count">{count}</span> : null}
                    <span className="dac-item__chevron" aria-hidden="true">
                      <ChevronIcon size="sm" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Last, below a rule, tinted --primary: the one row here the back
              button cannot undo. The same placement it had in the sheet. */}
          <button
            type="button"
            className="dac-item dac-item--danger"
            onClick={() => {
              signOut();
              navigate('/', { replace: true });
            }}
          >
            <SignOutIcon />
            <span className="dac-item__label">{COPY.signOut}</span>
          </button>
        </nav>

        {ActiveScreen ? (
          /* Keyed on the section so switching panes remounts rather than
             re-renders: these screens fetch on mount, and a pane that kept the
             previous section's state would show stale content under a new
             heading for as long as the request took. */
          <div className="dac-pane" key={activeSection.key}>
            {/*
              A provider of its own, so the section's ScreenHeader registers its
              title HERE and not with the page. Without it the nested header
              switches off the app header for all of /account, taking search,
              notifications and the avatar with it.
            */}
            <ScreenTitleProvider>
              <ActiveScreen />
            </ScreenTitleProvider>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default AccountScreen;

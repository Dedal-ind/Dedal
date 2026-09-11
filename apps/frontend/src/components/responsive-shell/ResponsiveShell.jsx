// ResponsiveShell.jsx
// The single top-level layout wrapper. It sorts every route into ONE of three
// surfaces and applies that surface's form-factor rule — this is the one place
// form-factor is decided, so the overlay logic can never drift route to route.
//
//   · utility     — the shared entry/utility screens (sign-in, OTP, profile
//                   completion, not-authorized, the public college onboarding
//                   flow, dev tools) plus the /backstage staff working screens
//                   (except the phone-only scanner). They belong to neither
//                   audience, so they NEVER show an overlay: a centered mobile
//                   column on desktop, full-width on mobile. This is what keeps
//                   the sign-in from stretching edge-to-edge on a desktop.
//   · admin       — the /admin/* console. DESKTOP-first: the app renders at ≥768px
//                   and AdminMobileComingSoonOverlay takes over below it.
//   · participant — everything else. MOBILE-first: the app renders below 768px and
//                   DesktopComingSoonOverlay takes over at ≥768px.
//
// The lone exception inside `participant` is "/", which both routes by role AND
// renders the participant home (RootRoute): its role redirects must run on every
// viewport, so it renders children instead of being pre-empted by the desktop
// overlay — and the home feed it falls through to is desktop-ready anyway.
//
// A debounced resize listener flips between states so a browser resize switches
// immediately.

import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import DesktopComingSoonOverlay from '../desktop-coming-soon/DesktopComingSoonOverlay.jsx';
import AdminMobileComingSoonOverlay from '../../components-admin/admin-mobile-coming-soon/AdminMobileComingSoonOverlay.jsx';

const DESKTOP_MIN_WIDTH = 768;
const UTILITY_COLUMN_MAX_WIDTH = 480;
/*
 * Profile completion is the one utility screen that is a LONG FORM rather than a
 * single action, so it gets a wider column on desktop. At 480px its field pairs
 * (city/PIN, state/country) wrap onto separate lines and the form runs to a
 * scroll nobody reads; 600px lets them sit side by side without becoming the
 * full-width sprawl the utility column exists to prevent.
 */
const FORM_COLUMN_MAX_WIDTH = 600;
/*
 * OPERATOR SCREENS ARE NOT UTILITY SCREENS.
 *
 * The utility column exists to stop a single-action page sprawling across a
 * desktop, and 480px is right for that. It is wrong for the coordinator and
 * backstage tools, which are rosters, score tables and bracket timelines — the
 * densest surfaces in the product, run on a laptop at a control desk. Capped at
 * 480 they were a ribbon in a 1920px window with about 350px left for a table
 * after the gutters, which is the opposite of what an operator needs.
 *
 * 1440 rather than unbounded, for the same reason the detail pages cap there:
 * past it a table stops looking generous and starts looking stretched.
 */
const OPERATOR_COLUMN_MAX_WIDTH = 1440;

/* /backstage/scanner is deliberately absent: it is a full-bleed camera view and
   owns its own layout entirely. */
function readUtilityColumnWidth(pathname) {
  if (pathname === '/profile-completion') {
    return FORM_COLUMN_MAX_WIDTH;
  }
  if (pathname.startsWith('/backstage') && pathname !== '/backstage/scanner') {
    return OPERATOR_COLUMN_MAX_WIDTH;
  }
  return UTILITY_COLUMN_MAX_WIDTH;
}
const RESIZE_DEBOUNCE_MILLISECONDS = 120;

// Shared utility screens: always a centered mobile column on desktop, never an
// overlay. `/admin/not-authorized` is deliberately here rather than under `admin`
// — a participant bounced to it on a phone must read the message, not the
// "admin works best on desktop" overlay. Checked before the /admin prefix.
function isUtilityRoute(pathname) {
  return (
    pathname === '/profile-completion' ||
    pathname === '/admin/not-authorized' ||
    pathname === '/sign-out' ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/verify-certificate/') ||
    // Public college onboarding — landing, application form, success, status.
    pathname === '/for-colleges' ||
    pathname === '/register-college' ||
    pathname.startsWith('/register-college/') ||
    /*
     * Staff working screens: a coordinator generating and releasing certificates
     * (or editing event details) is at a desk, and these screens must function
     * on whatever device the person has — a narrow roster beats a wall telling
     * them to find their phone. The QR scanner is the one exception: it is
     * phone-only by design (camera in hand at a gate) and stays participant.
     */
    (pathname.startsWith('/backstage') && pathname !== '/backstage/scanner') ||
    pathname.startsWith('/dev/')
  );
}

function isAdminRoute(pathname) {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/*
 * Participant routes that are DESKTOP-READY and therefore never see the
 * coming-soon overlay. A route earns its place here by laying itself out for a
 * wide viewport on its own — not by merely surviving one.
 *
 * "/" (the participant home feed, formerly /discover) was the first, in the
 * redesign: its grid decides its own column
 * count from the width available, and its header runs edge to edge. Showing a
 * person a wall that says "come back on your phone" in front of a screen that
 * is already built for the machine they are sitting at is the overlay doing
 * harm.
 *
 * /search followed. On a wide viewport search normally opens as a modal from
 * the header and this route is never reached — but it IS reachable, by a
 * bookmark, a shared link, or a browser back button after searching on a phone
 * and resizing. The page itself lays out perfectly well wide, so the overlay
 * would be blocking a working screen for no reason.
 *
 * Fest detail and event detail joined next, with the detail-page redesign.
 * Both lay themselves out for a wide viewport through the container queries in
 * design/detail-page.css — the fest page becomes a two-column split with a
 * sticky sidebar past 1024px, and the event page a centred 720px column with
 * the register bar released from the bottom edge. Neither merely survives a
 * wide window; each was measured at one.
 *
 * These two are the first entries that are not literal paths, because neither
 * route IS one: they are /fests/:festSlug and /events/:eventSlug. An exact
 * match would have sent every real fest URL to the overlay while the redesign
 * sat behind it unreachable, which is exactly what happened before this list
 * learned about prefixes.
 *
 * The rest of the participant app is still mobile-only and still gets the
 * overlay; each screen joins this list as it is redesigned.
 */
const DESKTOP_READY_PARTICIPANT_ROUTES = [
  '/',
  '/search',
  '/my-passes',
  '/my-registrations',
  '/settings',
  '/profile',
  '/profile/edit',
  '/my-certificates',
  '/notifications',
  /* Staff-facing but routed outside /backstage, so it does not inherit that
     prefix's exemption. It is migrated and responsive now, and a volunteer
     picking a crew on a laptop was being shown a "coming soon to desktop"
     page instead of the screen. */
  '/crew-select',
  '/account',
  '/terms-of-service',
  '/privacy-policy',
];

/*
 * Prefixes rather than paths. The trailing slash is part of the prefix on
 * purpose: '/fests/' matches '/fests/alliance-one-2026' but not a future
 * '/fests-archive', which a bare '/fests' would have swallowed.
 */
const DESKTOP_READY_PARTICIPANT_PREFIXES = ['/fests/', '/events/'];

/*
 * THE REGISTRATION FLOW, which is desktop-ready as a whole rather than screen by
 * screen — and has to be, because it is one journey. Letting a student start a
 * registration on a laptop and then hit a "come back on your phone" wall at the
 * payment step would be worse than never letting them start.
 *
 * These are patterns rather than prefixes because two of them are not one
 * segment deep: a contingent purchase is /contingents/:id/purchase, and matching
 * it with a bare prefix would also have matched every other future sub-page of a
 * contingent. Each pattern is anchored and names its own shape.
 */
const DESKTOP_READY_PARTICIPANT_PATTERNS = [
  /^\/register\/[^/]+$/,
  /^\/checkout\/[^/]+$/,
  /^\/registration-success\/[^/]+$/,
  /^\/payment-processing\/[^/]+$/,
  /^\/payment-failed\/[^/]+$/,
  /^\/contingents\/[^/]+\/purchase$/,
  /*
   * The pass. It earns desktop for a different reason from every other route
   * here: nobody scans a laptop at a gate, so the wide layout is not the phone
   * layout stretched — it is the details-and-sharing view, with an "open on
   * phone" QR that hands the credential back to the device that will actually
   * be scanned.
   */
  /^\/my-passes\/[^/]+$/,
  /^\/my-certificates\/[^/]+$/,
  /* The public verify page, with or without a code in the path. A recruiter
     opening a shared link on a laptop is the MAIN way this screen is reached,
     so a mobile-only overlay here would break the one flow it exists for. */
  /^\/verify-certificate(\/[^/]+)?$/,
  /* A past policy version is legal text — the same document the /terms-of-service
     route serves, at an older version. It reads on a laptop like any other. */
  /^\/policies\/versions\/[^/]+$/,
  /^\/account\/[^/]+$/,
  /*
   * The fest crew directory. It was deliberately EXCLUDED — see the note in
   * isDesktopReadyParticipantRoute about a fest sub-page not inheriting its
   * parent's prefix — because it was a mobile-only Heritage frame that ran the
   * full width of a laptop.
   *
   * It is a 720px centred column now, so the reason no longer holds. It also
   * has to render here: the link to it sits in the fest's core info block, and
   * a link that walls you on the device you are already reading the fest on is
   * worse than no link.
   */
  /^\/fests\/[^/]+\/crew-directory$/,
  /*
   * A registration's own URL. The hub shows the same detail in a right-hand
   * panel at desktop widths, so this route is only reached by a deep link or a
   * share — but it has to render rather than wall, because the link a student
   * sends a teammate should open where they click it.
   */
  /^\/my-registrations\/[^/]+$/,
];

function isDesktopReadyParticipantRoute(pathname) {
  if (DESKTOP_READY_PARTICIPANT_ROUTES.includes(pathname)) {
    return true;
  }
  if (DESKTOP_READY_PARTICIPANT_PATTERNS.some((pattern) => pattern.test(pathname))) {
    return true;
  }
  /*
   * A sub-page of a fest is NOT the fest page, so the prefix has to match the
   * whole remaining segment rather than just its start — a future
   * /fests/:slug/something must opt in deliberately rather than inherit.
   * (/fests/:slug/crew-directory is now such an opt-in; it has its own pattern
   * above.)
   */
  return DESKTOP_READY_PARTICIPANT_PREFIXES.some((prefix) => {
    if (!pathname.startsWith(prefix)) {
      return false;
    }
    const remainder = pathname.slice(prefix.length);
    return remainder.length > 0 && !remainder.includes('/');
  });
}

function useIsDesktopViewport() {
  const [isDesktopViewport, setIsDesktopViewport] = useState(
    () => window.innerWidth >= DESKTOP_MIN_WIDTH,
  );

  useEffect(() => {
    let debounceTimeoutId;
    function handleResize() {
      window.clearTimeout(debounceTimeoutId);
      debounceTimeoutId = window.setTimeout(() => {
        setIsDesktopViewport(window.innerWidth >= DESKTOP_MIN_WIDTH);
      }, RESIZE_DEBOUNCE_MILLISECONDS);
    }
    window.addEventListener('resize', handleResize);
    return () => {
      window.clearTimeout(debounceTimeoutId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return isDesktopViewport;
}

function ResponsiveShell({ children }) {
  const isDesktopViewport = useIsDesktopViewport();
  const { isAuthenticated } = useAuthentication();
  const location = useLocation();
  const { pathname } = location;

  // 0) Auth screens — desktop-adapted: they carry their own md: two-column
  // layout (hero left, form right), so they render full-width on every
  // viewport instead of the centered utility column or any overlay.
  if (pathname.startsWith('/auth/')) {
    return <div className="min-h-screen w-full bg-background">{children}</div>;
  }

  // 1) Shared utility screens — centered column on desktop, full-width on mobile.
  if (isUtilityRoute(pathname)) {
    if (isDesktopViewport) {
      return (
        <div className="flex min-h-screen w-full justify-center bg-background">
          <div
            className="w-full"
            style={{
              maxWidth: `${readUtilityColumnWidth(pathname)}px`,
            }}
          >
            {children}
          </div>
        </div>
      );
    }
    return <div className="min-h-screen w-full bg-background">{children}</div>;
  }

  // 2) Admin console — desktop-first.
  if (isAdminRoute(pathname)) {
    if (!isDesktopViewport) {
      return <AdminMobileComingSoonOverlay />;
    }
    return children;
  }

  // 3) Participant — mobile-first. "/" both routes by role and renders the home
  // feed: let its role redirects run on every viewport for signed-in users, and
  // the feed itself is desktop-ready (it is also listed in
  // DESKTOP_READY_PARTICIPANT_ROUTES), so it never wants the overlay either.
  // /discover rides along for the same reason: it is now nothing but a redirect
  // to "/", and an overlay would swallow the route before the redirect ran.
  if ((pathname === '/' || pathname === '/discover') && isAuthenticated) {
    return <div className="min-h-screen w-full">{children}</div>;
  }
  // Desktop: unauthenticated users see the login page (handled by /auth/ above).
  // Authenticated non-admin users see the "Coming Soon" overlay with a back
  // arrow to sign out and return to login.
  if (isDesktopViewport && isAuthenticated) {
    if (isDesktopReadyParticipantRoute(pathname)) {
      return <div className="min-h-screen w-full">{children}</div>;
    }
    return <DesktopComingSoonOverlay />;
  }
  // Desktop: unauthenticated users who somehow land on a participant route
  // (e.g. "/") — let the route render so it can redirect to /auth/sign-in.
  if (isDesktopViewport && !isAuthenticated) {
    return children;
  }
  return <div className="min-h-screen w-full bg-background">{children}</div>;
}

export default ResponsiveShell;

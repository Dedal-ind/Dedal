// App.jsx
// The root component. Everything renders inside ResponsiveShell, which handles
// the mobile column on wide screens and the desktop coming-soon overlay for
// phone-only pages. Routing covers the full participant + staff surface.
//
// Public routes: the root "/" sign-in screen, OTP verification, and public
// certificate verification. Everything else is gated by AuthenticatedRoute, which
// bounces unauthenticated visitors to "/".

import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import ResponsiveShell from './components/responsive-shell/ResponsiveShell.jsx';
import RouteTransition from './components/route-transition/RouteTransition.jsx';
import PublicOnlyRoute from './components/public-only-route/PublicOnlyRoute.jsx';
import AppHeader from './components/app-header/AppHeader.jsx';
import ScrollToTop from './components/route-transition/ScrollToTop.jsx';
import { ScreenTitleProvider } from './components/screen-header/screen-title-context.jsx';
import { useHasScreenTitle } from './components/screen-header/screen-title-hooks.js';
import { HeaderSearchProvider } from './contexts/header-search-context/HeaderSearchProvider.jsx';
import {
  AuthenticationProvider,
  useAuthentication,
} from './contexts/authentication-context/AuthenticationContext.jsx';
import { saveIntendedRoute } from './helpers/post-sign-in-redirect.js';
import { fetchDeploymentEnvironment } from './helpers/deployment-environment.js';
import AuthSignInScreen from './screens/auth-sign-in/AuthSignInScreen.jsx';
import AuthVerifyOtpScreen from './screens/auth-verify-otp/AuthVerifyOtpScreen.jsx';
import ProfileCompletionScreen from './screens/profile-completion/ProfileCompletionScreen.jsx';
import DiscoverScreen from './screens/discover/DiscoverScreen.jsx';
import SearchScreen from './screens/search/SearchScreen.jsx';
import CategoryEventsScreen from './screens/category-events/CategoryEventsScreen.jsx';
import FestDetailScreen from './screens/fest-detail/FestDetailScreen.jsx';
import EventDetailScreen from './screens/event-detail/EventDetailScreen.jsx';
import RegistrationFormScreen from './screens/registration-form/RegistrationFormScreen.jsx';
import CheckoutScreen from './screens/checkout/CheckoutScreen.jsx';
import PostJoinAddonsScreen from './screens/post-join-addons/PostJoinAddonsScreen.jsx';
import AdminContingentEditScreen from './screens-admin/admin-contingent-edit/AdminContingentEditScreen.jsx';
import AdminDashboardDrillDownScreen from './screens-admin/admin-dashboard-drill-down/AdminDashboardDrillDownScreen.jsx';
import ContingentPurchaseScreen from './screens/contingent-purchase/ContingentPurchaseScreen.jsx';
import RegistrationSuccessScreen from './screens/registration-success/RegistrationSuccessScreen.jsx';
import PaymentProcessingScreen from './screens/payment-processing/PaymentProcessingScreen.jsx';
import PaymentFailedScreen from './screens/payment-failed/PaymentFailedScreen.jsx';
import MyRegistrationsScreen from './screens/my-registrations/MyRegistrationsScreen.jsx';
import RegistrationDetailScreen from './screens/registration-detail/RegistrationDetailScreen.jsx';
import MyPassesScreen from './screens/my-passes/MyPassesScreen.jsx';
import QrPassScreen from './screens/qr-pass/QrPassScreen.jsx';
import SavedEventsScreen from './screens/saved-events/SavedEventsScreen.jsx';
import MyCertificatesScreen from './screens/my-certificates/MyCertificatesScreen.jsx';
import CertificateDetailScreen from './screens/certificate-detail/CertificateDetailScreen.jsx';
import VerifyCertificateScreen from './screens/verify-certificate/VerifyCertificateScreen.jsx';
import ForCollegesScreen from './screens/for-colleges/ForCollegesScreen.jsx';
import RegisterCollegeScreen from './screens/register-college/RegisterCollegeScreen.jsx';
import RegisterCollegeSuccessScreen from './screens/register-college-success/RegisterCollegeSuccessScreen.jsx';
import CollegeApplicationStatusScreen from './screens/college-application-status/CollegeApplicationStatusScreen.jsx';
import TeamManagementScreen from './screens/team-management/TeamManagementScreen.jsx';
import EditProfileScreen from './screens/edit-profile/EditProfileScreen.jsx';
import ProfileScreen from './screens/profile/ProfileScreen.jsx';
import AccountScreen from './screens/account/AccountScreen.jsx';
import SettingsScreen from './screens/settings/SettingsScreen.jsx';
import NotificationsScreen from './screens/notifications/NotificationsScreen.jsx';
import BackstageScreen from './screens/backstage/BackstageScreen.jsx';
import CoordinatorHubScreen from './screens/backstage/CoordinatorHubScreen.jsx';
import VolunteerHubScreen from './screens/backstage/VolunteerHubScreen.jsx';
import NoCrewAccessScreen from './screens/backstage/NoCrewAccessScreen.jsx';
import CreateRoundsScreen from './screens/backstage/CreateRoundsScreen.jsx';
import BroadcastScreen from './screens/broadcast/BroadcastScreen.jsx';
import DirectoryScreen from './screens/directory/DirectoryScreen.jsx';
import PushCertificateScreen from './screens/push-certificate/PushCertificateScreen.jsx';
import ScoreboardScreen from './screens/backstage/ScoreboardScreen.jsx';
import VolunteerScannerScreen from './screens/volunteer-scanner/VolunteerScannerScreen.jsx';
import VolunteerDashboardScreen from './screens/volunteer-dashboard/VolunteerDashboardScreen.jsx';
import VolunteerEventScreen from './screens/volunteer-event/VolunteerEventScreen.jsx';
import CoordinatorPanelScreen from './screens/coordinator-panel/CoordinatorPanelScreen.jsx';
import CoordinatorEventScreen from './screens/coordinator-event/CoordinatorEventScreen.jsx';
import CrewDirectoryScreen from './screens/crew-directory/CrewDirectoryScreen.jsx';
import CrewFestPickerScreen from './screens/crew-directory/CrewFestPickerScreen.jsx';
import CrewSelectScreen from './screens/crew-select/CrewSelectScreen.jsx';
import DevSwitchUserScreen from './screens/dev-switch-user/DevSwitchUserScreen.jsx';
import SignOutScreen from './screens/sign-out/SignOutScreen.jsx';

// Admin console — a desktop-first surface of the SAME app, under /admin/*.
import AdminLayout from './components-admin/admin-layout/AdminLayout.jsx';
import AdminPlaceholderScreen from './screens-admin/admin-placeholder/AdminPlaceholderScreen.jsx';
import AdminNotAuthorizedScreen from './screens-admin/admin-not-authorized/AdminNotAuthorizedScreen.jsx';
import AdminOverviewScreen from './screens-admin/admin-overview/AdminOverviewScreen.jsx';
import AdminBroadcastScreen from './screens-admin/admin-broadcast/AdminBroadcastScreen.jsx';
import AdminCreateEventScreen from './screens-admin/admin-create-event/AdminCreateEventScreen.jsx';
import AdminCreateFestScreen from './screens-admin/admin-create-fest/AdminCreateFestScreen.jsx';
import AdminUserDirectoryScreen from './screens-admin/admin-users/AdminUserDirectoryScreen.jsx';
import AdminProfileScreen from './screens-admin/admin-profile/AdminProfileScreen.jsx';
import AdminFestStructureScreen from './screens-admin/admin-fest-structure/AdminFestStructureScreen.jsx';
import AdminSettingsScreen from './screens-admin/admin-settings/AdminSettingsScreen.jsx';
import AdminEventAccessScreen from './screens-admin/admin-event-access/AdminEventAccessScreen.jsx';
import AdminStaffAssignmentsScreen from './screens-admin/admin-staff-assignments/AdminStaffAssignmentsScreen.jsx';
import AdminShiftsScreen from './screens-admin/admin-shifts/AdminShiftsScreen.jsx';
import AdminEditFestScreen from './screens-admin/admin-edit-fest/AdminEditFestScreen.jsx';
import AdminCollegeVerificationScreen from './screens-admin/admin-college-verification/AdminCollegeVerificationScreen.jsx';
import AdminCollegeApplicationsScreen from './screens-admin/admin-college-applications/AdminCollegeApplicationsScreen.jsx';
import AdminCollegeApplicationDetailScreen from './screens-admin/admin-college-applications/AdminCollegeApplicationDetailScreen.jsx';
import AdminScoringScreen from './screens-admin/admin-scoring/AdminScoringScreen.jsx';
import AdminResultsBoardScreen from './screens-admin/admin-results-board/AdminResultsBoardScreen.jsx';
import EventScheduleScreen from './screens/event-schedule/EventScheduleScreen.jsx';
import AppErrorBoundary from './components/app-error-boundary/AppErrorBoundary.jsx';
import AdminEventTimelineScreen from './screens-admin/admin-event-timeline/AdminEventTimelineScreen.jsx';
import AdminPromotionsScreen from './screens-admin/admin-promotions/AdminPromotionsScreen.jsx';
import AdminPromotersScreen from './screens-admin/admin-promoters/AdminPromotersScreen.jsx';
import AdminPromoterDetailScreen from './screens-admin/admin-promoter-detail/AdminPromoterDetailScreen.jsx';
import AdminCreativesScreen from './screens-admin/admin-creatives/AdminCreativesScreen.jsx';
import AdminCampaignsScreen from './screens-admin/admin-campaigns/AdminCampaignsScreen.jsx';
import AdminCampaignDetailScreen from './screens-admin/admin-campaign-detail/AdminCampaignDetailScreen.jsx';
import AdminOffersDashboardScreen from './screens-admin/admin-offers-dashboard/AdminOffersDashboardScreen.jsx';
import AdminDataControlsScreen from './screens-admin/admin-data-controls/AdminDataControlsScreen.jsx';
import AdminDeliveryOverviewScreen from './screens-admin/admin-delivery-overview/AdminDeliveryOverviewScreen.jsx';
import AdminDeliveryCampaignScreen from './screens-admin/admin-delivery-campaign/AdminDeliveryCampaignScreen.jsx';
import AdminDeliveryCreativesScreen from './screens-admin/admin-delivery-creatives/AdminDeliveryCreativesScreen.jsx';
import AdminDeliveryPlacementScreen from './screens-admin/admin-delivery-placement/AdminDeliveryPlacementScreen.jsx';
import AdminDeliveryPromoterScreen from './screens-admin/admin-delivery-promoter/AdminDeliveryPromoterScreen.jsx';
import TermsOfServiceScreen from './screens/terms-of-service/TermsOfServiceScreen.jsx';
import PrivacyPolicyScreen from './screens/privacy-policy/PrivacyPolicyScreen.jsx';
import PolicyVersionScreen from './screens/policy-version/PolicyVersionScreen.jsx';

// Gate: render the protected tree only when authenticated, else redirect to the
// root sign-in screen.
function AuthenticatedRoute() {
  const { isAuthenticated } = useAuthentication();
  if (!isAuthenticated) {
    return <Navigate to="/auth/email" replace />;
  }
  return <Outlet />;
}

/*
 * The admin gate. Three-state authority, and the third state is why this is not a
 * boolean: while /staff-assignments/mine is in flight the authorization is
 * 'unknown', and rendering the not-authorized screen then would flash it at every
 * administrator on every cold load — so 'unknown' holds on a spinner instead.
 *
 *   · not signed in  → save the intended /admin path and send to the shared
 *     sign-in ("/"); after auth the sign-in flow returns the user here.
 *   · authority unknown  → hold on a spinner.
 *   · not an administrator → the not-authorized screen.
 *   · administrator  → render the console.
 *
 * Presentation only — every admin endpoint enforces authority server-side.
 */
function AdminAuthorizedRoute() {
  const { isAuthenticated, authorizationState } = useAuthentication();
  const location = useLocation();

  if (!isAuthenticated) {
    saveIntendedRoute(`${location.pathname}${location.search}`);
    return <Navigate to="/auth/email" replace />;
  }
  if (authorizationState === 'unknown') {
    return (
      <div className="flex h-screen items-center justify-center bg-admin-surface-off-white">
        <span
          aria-label="Loading"
          className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
        />
      </div>
    );
  }
  if (authorizationState !== 'authorized') {
    return <Navigate to="/admin/not-authorized" replace />;
  }
  return <Outlet />;
}

/*
 * Superadmin gate for platform-admin-only screens INSIDE the console. It nests
 * under AdminAuthorizedRoute, so authentication and admin authority are already
 * settled — the only question left is whether this admin holds a platformAdmin
 * assignment. A regular admin who types the URL is bounced to the existing
 * not-authorized screen. Presentation only: the backend gates these endpoints
 * behind requirePlatformAdminMiddleware regardless.
 */
function PlatformAdminRoute() {
  const { isPlatformAdmin } = useAuthentication();
  if (!isPlatformAdmin) {
    return <Navigate to="/admin/not-authorized" replace />;
  }
  return <Outlet />;
}

// "/" is the participant home AND the role router. The canonical sign-in lives at
// /auth/email (a shared utility route that stays reachable and centered on every
// viewport), so a signed-out visitor is sent there. A signed-in visitor is routed
// by role: an administrator to the console, and everyone else — including
// coordinators and volunteers — falls through to the feed, which is RENDERED
// here rather than redirected to — the participant home lives at "/" (it used
// to live at "/discover", which is now a redirect back to "/").
// Authority resolves asynchronously, so while it is still 'unknown' this holds on
// a spinner rather than flashing an admin to the feed and leaving them there.
//
// The profile-completion branch lives HERE rather than in the sign-in flow because
// this is the only place that has waited for authority. An administrator has no
// USN, college or department and never needs them, so their profile is legitimately
// incomplete — gating on that flag before authority is known is what sent every
// admin into the participant form.
//
// Staff are NOT redirected to /backstage: the home page is the home page for
// everyone, and backstage stays reachable from the navigation at its own route.
//
// Order is load-bearing: admin, then profile, then participant.
function RootRoute() {
  const { isAuthenticated, authorizationState, currentUser } =
    useAuthentication();
  if (!isAuthenticated) {
    return <Navigate to="/auth/email" replace />;
  }
  if (authorizationState === 'unknown') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <span
          aria-label="Loading"
          className="h-6 w-6 animate-spin rounded-full border-2 border-ink-gray-200 border-t-ink-black"
        />
      </div>
    );
  }
  // Administrators first, and deliberately AHEAD of the profile check: the profile
  // form's own validator requires collegeId and usn (user-validator.js), which an
  // admin has no answer for, so gating them on it is a dead end rather than a step.
  if (authorizationState === 'authorized') {
    return <Navigate to="/admin/overview" replace />;
  }
  // Coordinators and volunteers ARE participants underneath, so they finish the
  // profile like anyone else before reaching the home page.
  if (currentUser?.isProfileComplete !== true) {
    return <Navigate to="/profile-completion" replace />;
  }
  /*
   * The participant home. Rendered, not redirected — and wrapped in
   * ParticipantLayout by hand so it gets the same sticky AppHeader as every
   * other participant screen. "/" cannot simply be moved inside the
   * <Route element={<ParticipantLayout />}> block, because the branches above
   * must be able to redirect an admin (or a signed-out visitor) WITHOUT first
   * mounting the participant header and its pass fetch.
   */
  return (
    <ParticipantLayout>
      <DiscoverScreen />
    </ParticipantLayout>
  );
}

/*
 * ParticipantLayout — the shell every participant screen renders inside.
 *
 * REPLACES TabbedLayout, which wrapped the same routes in a `pb-16` div and
 * rendered a fixed bottom capsule beneath them. Navigation moved to a sticky
 * top header (AppHeader), so:
 *
 *   · There is no bottom chrome, and therefore no bottom padding. Content runs
 *     to the true bottom of the viewport. Screens that kept a `pb-28` to clear
 *     the old capsule have had it reduced; screens with a fixed footer of their
 *     own (checkout, registration, contingent purchase, edit profile) keep
 *     theirs, because that footer is still there.
 *
 *   · TAB_BAR_HIDDEN_PREFIXES is gone with the bar it hid. It existed because
 *     a coordinator deep in a task page saw five unlit tabs offering five ways
 *     out of a flow that should be finished. A header with a wordmark, a pass
 *     and an account menu is not five exits, so there is nothing to suppress.
 *
 * The header is OUTSIDE the Outlet and inside the search provider, so one
 * header instance survives every route change — the pass sheet does not
 * remount, and its fetch is not repeated, when you move between screens.
 *
 * It is usable two ways: as a route element (children omitted → <Outlet />),
 * and directly with children, which is how RootRoute puts the "/" home screen
 * under the same header without making "/" a child route.
 */
/*
 * Split out so it can read the context its own parent provides — a component
 * cannot consume a provider it renders itself.
 */
function ParticipantChrome({ children }) {
  /* A screen with its own back-and-title bar replaces the app header rather
     than stacking under it. See screen-title-context.jsx. */
  const hasScreenTitle = useHasScreenTitle();
  return (
    <div className="min-h-screen">
      {hasScreenTitle ? null : <AppHeader />}
      {children ?? <Outlet />}
    </div>
  );
}

function ParticipantLayout({ children }) {
  return (
    <HeaderSearchProvider>
      <ScreenTitleProvider>
        <ParticipantChrome>{children}</ParticipantChrome>
      </ScreenTitleProvider>
    </HeaderSearchProvider>
  );
}

/*
 * EMPTY, DELIBERATELY — the banner no longer labels any environment.
 *
 * It existed to stop somebody mistaking a deployed non-production environment
 * for the real one. That risk is answered by the URL: staging is reached at
 * testing.dedal.in and nowhere else, so anybody looking at it has already typed
 * or bookmarked the thing the strip was there to tell them.
 *
 * What it cost was not free. A sticky 27px band at z-index 9999 sat above the
 * app header on every screen of the environment the UI is actually reviewed in,
 * which is the one place a reviewer needs the layout to match production.
 *
 * The component is kept rather than deleted: the labels are the whole of its
 * behaviour, so restoring the banner for a future environment is one line here
 * and nothing else.
 */
const ENVIRONMENT_BANNER_LABELS = {};

/*
 * Development deliberately has NO label, so the banner renders nothing on a
 * local machine.
 *
 * The banner exists to stop someone mistaking a deployed non-production
 * environment for the real one — a real risk on staging, which looks exactly
 * like production and is one URL away from it. Localhost is not that risk:
 * nobody has ever confused the machine they are running the dev server on for
 * production, and in exchange the strip took 27px off the top of every screen
 * and sat above the sticky header while the UI was being reviewed.
 *
 * Staging and test keep theirs, unchanged.
 */

function EnvironmentBanner() {
  const [environment, setEnvironment] = useState(
    import.meta.env.VITE_APP_ENVIRONMENT || null
  );

  useEffect(() => {
    fetchDeploymentEnvironment().then((serverEnvironment) => {
      setEnvironment(serverEnvironment);
    });
  }, []);

  if (environment === 'production') {
    return null;
  }

  const label = ENVIRONMENT_BANNER_LABELS[environment];
  /* No label for this environment (development, or an environment that has not
     been given one) means no banner at all. */
  if (!label) {
    return null;
  }

  return (
    <div style={{
      background: '#f59e0b',
      color: '#000',
      textAlign: 'center',
      padding: '4px 0',
      fontSize: '13px',
      fontWeight: 600,
      position: 'sticky',
      top: 0,
      zIndex: 9999,
    }}>
      {label}
    </div>
  );
}

function App() {
  return (
    /*
     * Outermost, above the router and the auth provider: a crash inside either
     * of those is exactly the crash that produces a white screen, and a
     * boundary nested inside them could not catch it.
     */
    <AppErrorBoundary>
    <AuthenticationProvider>
      <BrowserRouter>
        {/* Inside the router so it can read the location, above the routes so
            it runs for every screen rather than each one remembering. */}
        <ScrollToTop />
        <ResponsiveShell>
        <EnvironmentBanner />
        <RouteTransition>
        <Routes>
          {/* Public */}
          <Route path="/" element={<RootRoute />} />
          {/* The participant home moved from /discover to "/". Redirected rather
              than deleted so bookmarks, shared links and browser history from
              before the move still land on the feed. */}
          <Route path="/discover" element={<Navigate to="/" replace />} />
          {/* Bare and coded forms of the same public screen. Without the bare
              route the search field was unreachable — a visitor with a code in
              their hand and no link had nowhere to type it. */}
          <Route path="/verify-certificate" element={<VerifyCertificateScreen />} />
          <Route path="/verify-certificate/:verificationCode" element={<VerifyCertificateScreen />} />
          {/* Deliberately OUTSIDE PublicOnlyRoute: it must stay reachable while
              signed in, which is the only state it is useful in. */}
          <Route path="/sign-out" element={<SignOutScreen />} />
          {/* Public-ONLY: signed-in visitors are bounced to "/" (RootRoute), which
              routes them by role — a signed-in admin typing /auth/email must not
              land on a dead-end sign-in form. */}
          <Route element={<PublicOnlyRoute />}>
            {/* The canonical universal sign-in — shared by participants and admins. */}
            <Route path="/auth/email" element={<AuthSignInScreen />} />
            <Route path="/auth/verify-otp" element={<AuthVerifyOtpScreen />} />
            {/* College onboarding — marketing landing, application form, success
                page, and application-status lookup. */}
            <Route path="/for-colleges" element={<ForCollegesScreen />} />
            <Route path="/register-college" element={<RegisterCollegeScreen />} />
            <Route path="/register-college/success" element={<RegisterCollegeSuccessScreen />} />
            <Route
              path="/register-college/status/:applicationId"
              element={<CollegeApplicationStatusScreen />}
            />
          </Route>
          {/* Development-only identity switcher — not registered in production
              builds, so it is unreachable there (and its backend routes 404). */}
          {import.meta.env.DEV ? (
            <Route path="/dev/switch-user" element={<DevSwitchUserScreen />} />
          ) : null}

          {/* Authenticated */}
          <Route element={<AuthenticatedRoute />}>
            <Route path="/profile-completion" element={<ProfileCompletionScreen />} />

            {/* Every participant screen renders under the sticky top header. */}
            <Route element={<ParticipantLayout />}>
              {/* My Fests — the consolidated participant hub. The screens it
                  links to are unchanged; only the door into them moved. */}
              {/* /my-fests was a menu of destinations and is gone; /account is
                  that menu now. Redirected rather than deleted outright so an
                  old bookmark or a link in an already-sent email still lands
                  somewhere true instead of on a 404. */}
              <Route path="/my-fests" element={<Navigate to="/account" replace />} />
              {/*
                The category browse screen that used to live at /search moved
                here, unchanged. It was never a search screen; it was a category
                grid with a search box bolted on, and the two were competing for
                one route.
              */}
              <Route path="/explore" element={<CategoryEventsScreen />} />
              <Route path="/my-passes" element={<MyPassesScreen />} />
              <Route path="/backstage" element={<BackstageScreen />} />
              <Route path="/crew-select" element={<CrewSelectScreen />} />
              <Route path="/my-registrations" element={<MyRegistrationsScreen />} />
              <Route path="/profile" element={<ProfileScreen />} />
              {/* The account page. Two routes for one screen: /account is the
                  menu (and, on desktop, the menu with its first section open),
                  /account/:section names the pane on the right so it can be
                  linked to and reloaded. */}
              <Route path="/account" element={<AccountScreen />} />
              <Route path="/account/:section" element={<AccountScreen />} />
              {/* Fest detail renders under the header; it also carries its own
                  sticky register bar on the bottom edge. */}
              <Route path="/fests/:festSlug" element={<FestDetailScreen />} />
              {/* Volunteer dashboard and coordinator panel. */}
              <Route path="/backstage/volunteer-dashboard" element={<VolunteerDashboardScreen />} />
              <Route path="/backstage/coordinator/:eventId" element={<CoordinatorPanelScreen />} />
              {/* Crew Access hubs the backstage screen routes into. */}
              <Route path="/backstage/coordinator-hub" element={<CoordinatorHubScreen />} />
              <Route path="/backstage/volunteer-hub" element={<VolunteerHubScreen />} />
              <Route path="/backstage/no-access" element={<NoCrewAccessScreen />} />

              {/* Targets the coordinator event page already links to. */}
              <Route
                path="/backstage/coordinator/events/:eventId/create-round"
                element={<CreateRoundsScreen />}
              />
              <Route
                path="/backstage/coordinator/events/:eventId/scorecard"
                element={<ScoreboardScreen />}
              />
              <Route
                path="/backstage/coordinator/events/:eventId/broadcast"
                element={<BroadcastScreen />}
              />
              <Route
                path="/backstage/coordinator/events/:eventId/directory"
                element={<DirectoryScreen />}
              />
              <Route
                path="/backstage/coordinator/events/:eventId/push-certificate"
                element={<PushCertificateScreen />}
              />
              {/* The fest-scoped crew list, reached from inside a fest. */}
              <Route path="/fests/:festSlug/crew-directory" element={<CrewDirectoryScreen />} />
              {/* The same list reached from the account menu, where no fest has
                  been named yet — the picker redirects into the route above. */}
              <Route path="/crew-directory" element={<CrewFestPickerScreen />} />
              <Route path="/my-registrations/:registrationId" element={<RegistrationDetailScreen />} />
              <Route path="/saved" element={<SavedEventsScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
              <Route path="/notifications" element={<NotificationsScreen />} />
              <Route path="/my-certificates/:certificateId" element={<CertificateDetailScreen />} />
              {/* The fest running order. Keyed by festId, not slug: it is
                  reached from the fest page, which already holds the id. */}
              <Route path="/schedule/:festId" element={<EventScheduleScreen />} />
            </Route>

            {/*
              /search is a TAKEOVER, so it sits outside ParticipantLayout and
              renders with no app header at all. The field is then the first
              thing on the screen instead of the second, and the page does not
              offer three ways to leave it (search, pass, account) to somebody
              who opened it to do one thing. Its own back arrow, inside the
              field, is the way out.
            */}
            <Route path="/search" element={<SearchScreen />} />

            {/* Interior pages — no participant header */}
            {/* Superseded by /search. Redirected rather than deleted so any
                bookmark or in-app link still lands somewhere that searches. */}
            <Route path="/search-live" element={<Navigate to="/search" replace />} />
            <Route path="/events/:eventSlug" element={<EventDetailScreen />} />

            {/* Registration and checkout */}
            <Route path="/register/:eventId" element={<RegistrationFormScreen />} />
            <Route
              path="/contingents/:contingentId/purchase"
              element={<ContingentPurchaseScreen />}
            />
            <Route path="/checkout/:paymentGroupId" element={<CheckoutScreen />} />
            <Route
              path="/registrations/:registrationId/add-ons"
              element={<PostJoinAddonsScreen />}
            />
            <Route path="/registration-success/:registrationId" element={<RegistrationSuccessScreen />} />
            <Route path="/payment-processing/:paymentGroupId" element={<PaymentProcessingScreen />} />
            <Route path="/payment-failed/:paymentGroupId" element={<PaymentFailedScreen />} />

            {/* Passes */}
            <Route path="/my-passes/:festId" element={<QrPassScreen />} />

            {/* Certificates */}
            <Route path="/my-certificates" element={<MyCertificatesScreen />} />

            {/* Teams */}
            <Route path="/my-teams" element={<TeamManagementScreen />} />

            {/* Profile */}
            <Route path="/profile/edit" element={<EditProfileScreen />} />

            {/* Backstage sub-pages — phone-only (ResponsiveShell shows coming-soon on desktop) */}
            <Route path="/backstage/scanner" element={<VolunteerScannerScreen />} />
            <Route path="/backstage/volunteer-event" element={<VolunteerEventScreen />} />
            <Route path="/backstage/coordinator-event" element={<CoordinatorEventScreen />} />
          </Route>

          {/*
            Admin console — a desktop-first surface under /admin/*. ResponsiveShell
            inverts the form-factor rule for these paths (phone → coming-soon).
            The not-authorized screen sits OUTSIDE the admin gate (an authenticated
            non-admin must be able to see it) but still requires authentication.
          */}
          <Route element={<AuthenticatedRoute />}>
            <Route path="/admin/not-authorized" element={<AdminNotAuthorizedScreen />} />
          </Route>

          <Route element={<AdminAuthorizedRoute />}>
            {/* /admin → the dashboard once authorized. */}
            <Route path="/admin" element={<Navigate to="/admin/overview" replace />} />

            <Route element={<AdminLayout />}>
              <Route path="/admin/overview" element={<AdminOverviewScreen />} />
              {/* The sidebar has always linked here; the route was never
                  registered, so the /admin catch-all bounced every click to
                  the overview — which read as "broadcast opens the dashboard". */}
              <Route path="/admin/broadcast" element={<AdminBroadcastScreen />} />
              <Route
                path="/admin/dashboard/drill-down/:kind"
                element={<AdminDashboardDrillDownScreen />}
              />

              {/* Fests */}
              <Route path="/admin/fests/create" element={<AdminCreateFestScreen />} />
              <Route path="/admin/fests/:festId/edit" element={<AdminEditFestScreen />} />
              <Route path="/admin/fests/:festId/structure" element={<AdminFestStructureScreen />} />
              <Route
                path="/admin/fests/:festId/contingents/create"
                element={<AdminContingentEditScreen />}
              />
              <Route
                path="/admin/fests/:festId/contingents/:contingentId/edit"
                element={<AdminContingentEditScreen />}
              />

              {/* Events */}
              <Route
                path="/admin/events/structure"
                element={
                  <AdminFestStructureScreen />
                }
              />
              <Route path="/admin/events/create" element={<AdminCreateEventScreen />} />
              <Route
                path="/admin/events/create/sub-event"
                element={<AdminPlaceholderScreen title="Add sub-event" stitchScreen="create_sub_event" />}
              />
              <Route path="/admin/events/assignments" element={<AdminStaffAssignmentsScreen />} />
              <Route path="/admin/events/shifts" element={<AdminShiftsScreen />} />
              <Route path="/admin/events/access" element={<AdminEventAccessScreen />} />
              {/* Offer utilisation — fest-level, so it sits beside the event
                  screens rather than under one of them. */}
              <Route path="/admin/offers-dashboard" element={<AdminOffersDashboardScreen />} />
              <Route path="/admin/events/timeline" element={<AdminEventTimelineScreen />} />
              <Route path="/admin/events/scoring" element={<AdminScoringScreen />} />
              <Route path="/admin/events/results-board" element={<AdminResultsBoardScreen />} />

              {/* People */}
              <Route path="/admin/users" element={<AdminUserDirectoryScreen />} />

              {/* Account — the console-side profile/settings the topbar menu opens.
                  The participant /profile and /settings are mobile surfaces; these
                  keep the admin inside the shell. */}
              <Route path="/admin/profile" element={<AdminProfileScreen />} />
              <Route path="/admin/settings" element={<AdminSettingsScreen />} />

              {/* Certificates live inside Scoring & results (/admin/events/scoring). */}

              {/* System — the college queue is superadmin-only. */}
              <Route element={<PlatformAdminRoute />}>
                <Route path="/admin/system/colleges" element={<AdminCollegeVerificationScreen />} />
                <Route path="/admin/system/promotions" element={<AdminPromotionsScreen />} />
                <Route path="/admin/system/promoters" element={<AdminPromotersScreen />} />
                <Route path="/admin/system/promoters/:promoterId" element={<AdminPromoterDetailScreen />} />
                <Route path="/admin/system/promoters/:promoterId/creatives" element={<AdminCreativesScreen />} />
                <Route path="/admin/system/campaigns" element={<AdminCampaignsScreen />} />
                <Route path="/admin/system/campaigns/new" element={<AdminCampaignDetailScreen />} />
                <Route path="/admin/system/campaigns/:campaignId" element={<AdminCampaignDetailScreen />} />
                <Route path="/admin/system/reporting" element={<AdminDeliveryOverviewScreen />} />
                <Route path="/admin/system/reporting/campaigns/:campaignId" element={<AdminDeliveryCampaignScreen />} />
                <Route path="/admin/system/reporting/campaigns/:campaignId/creatives" element={<AdminDeliveryCreativesScreen />} />
                <Route path="/admin/system/reporting/placements/:placementKey" element={<AdminDeliveryPlacementScreen />} />
                <Route path="/admin/system/reporting/promoters/:promoterId" element={<AdminDeliveryPromoterScreen />} />
                <Route path="/admin/college-applications" element={<AdminCollegeApplicationsScreen />} />
                <Route
                  path="/admin/college-applications/:applicationId"
                  element={<AdminCollegeApplicationDetailScreen />}
                />
              </Route>
              <Route path="/admin/system/data-controls" element={<AdminDataControlsScreen />} />
              <Route
                path="/admin/system/configuration"
                element={
                  <AdminPlaceholderScreen title="Configuration" stitchScreen="system_configuration" />
                }
              />
            </Route>
          </Route>

          {/* Unknown paths → root, which itself routes by auth state. */}
          <Route path="*" element={<Navigate to="/" replace />} />
          <Route path="/terms-of-service" element={<TermsOfServiceScreen />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyScreen />} />
          {/* A specific past version, for showing an acceptance back verbatim. */}
          <Route path="/policies/versions/:versionId" element={<PolicyVersionScreen />} />
        </Routes>
        </RouteTransition>
        </ResponsiveShell>
      </BrowserRouter>
    </AuthenticationProvider>
    </AppErrorBoundary>
  );
}

export default App;

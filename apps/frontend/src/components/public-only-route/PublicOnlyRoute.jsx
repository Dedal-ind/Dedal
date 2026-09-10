// PublicOnlyRoute.jsx
// Gate for pages that only make sense signed OUT: the sign-in pair and the
// college onboarding flow. A signed-in visitor typing these URLs used to land on
// a dead-end sign-in form with no way back to their surface.
//
// Deliberately does NOT recompute role routing. "/" (RootRoute) already owns the
// whole decision — hold for authority, admin → console, incomplete participant →
// profile completion, staff → backstage, else discover — so an authenticated
// visitor is simply sent there. Duplicating those branches here is how the two
// would drift apart.
//
// While authority is 'unknown' the redirect target is not knowable, so this
// holds on the same spinner RootRoute uses rather than flashing the public page
// at a signed-in admin.

import { Navigate, Outlet } from 'react-router-dom';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';

function PublicOnlyRoute() {
  const { isAuthenticated, authorizationState } = useAuthentication();

  if (!isAuthenticated) {
    return <Outlet />;
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
  return <Navigate to="/" replace />;
}

export default PublicOnlyRoute;

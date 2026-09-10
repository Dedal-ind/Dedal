// AdminNotAuthorizedScreen.jsx
// Route: /admin/not-authorized — where a signed-in user with no administrator
// assignment lands. It says plainly that this is the admin panel and they lack
// access, and points back to the participant surface ("/") rather than
// looping them through a sign-in they have already completed.
//
// It names no college and lists no roles: what a person is NOT authorised for is
// still information about how the organisation is structured.

import { useNavigate } from 'react-router-dom';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import { ADMIN_BRAND_IDENTITY } from '../../brand-admin/brand-identity.js';
import { ADMIN_AUTHORIZATION_COPY } from '../../brand-admin/brand-copy.js';

function AdminNotAuthorizedScreen() {
  const navigate = useNavigate();
  const { currentUser, signOut } = useAuthentication();

  return (
    <div className="flex min-h-screen items-center justify-center bg-admin-surface-off-white px-4 py-12">
      <div className="w-full max-w-[480px] rounded-lg border border-admin-slate-200 bg-admin-surface-white p-8">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-admin-status-warning-amber/10">
          <ShieldAlert size={22} className="text-admin-status-warning-amber" strokeWidth={1.75} />
        </span>

        <h1 className="mt-5 font-admin-display text-[24px] font-semibold leading-8 text-admin-neutral-ink">
          {ADMIN_AUTHORIZATION_COPY.deniedTitle}
        </h1>
        <p className="mt-2 font-admin-body text-[14px] leading-5 text-admin-slate-600">
          {ADMIN_AUTHORIZATION_COPY.deniedBody}
        </p>
        <p className="mt-3 font-admin-body text-[14px] leading-5 text-admin-slate-600">
          {ADMIN_AUTHORIZATION_COPY.deniedHint}
        </p>

        {currentUser?.emailAddress ? (
          <p className="mt-5 rounded-md border border-admin-slate-200 bg-admin-surface-off-white px-3 py-2 font-admin-mono text-[13px] leading-[18px] text-admin-slate-600">
            {currentUser.emailAddress}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <AdminExecutiveButton
            variant="primary"
            size="large"
            onClick={() => navigate(ADMIN_BRAND_IDENTITY.participantHomeRoute)}
            iconRight={<ArrowRight size={16} />}
          >
            {ADMIN_AUTHORIZATION_COPY.goToParticipantApp}
          </AdminExecutiveButton>
          {/* signOut alone only clears state — without the redirect this screen
              stays mounted, showing a denial to nobody. */}
          <AdminExecutiveButton
            variant="secondary"
            size="large"
            onClick={() => {
              signOut();
              navigate('/auth/email', { replace: true });
            }}
          >
            {ADMIN_AUTHORIZATION_COPY.signOutAndSwitch}
          </AdminExecutiveButton>
        </div>
      </div>
    </div>
  );
}

export default AdminNotAuthorizedScreen;

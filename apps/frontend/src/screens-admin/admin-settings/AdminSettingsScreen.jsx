// AdminSettingsScreen.jsx
// Route: /admin/settings — the console-side settings surface (the participant
// /settings screen is a mobile-first surface and never belongs in a desktop
// column). Deliberately limited to what exists today: account info, the legal
// document rows, and sign out.

import { useNavigate } from 'react-router-dom';
import { FileText, LogOut } from 'lucide-react';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import RoleBadge from '../../components/role-badge/RoleBadge.jsx';
import { ADMIN_SETTINGS_COPY as COPY } from '../../brand-admin/brand-copy.js';

function SettingsRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="font-admin-body text-[14px] text-admin-slate-600">{label}</span>
      <span className="min-w-0 truncate text-right font-admin-body text-[14px] text-admin-neutral-ink">
        {value}
      </span>
    </div>
  );
}

function AdminSettingsScreen() {
  const navigate = useNavigate();
  const { currentUser, roleIdentity, signOut } = useAuthentication();

  function handleSignOut() {
    signOut();
    navigate('/auth/email', { replace: true });
  }

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6">

      <AdminExecutiveCard title={COPY.accountHeading}>
        <div className="divide-y divide-admin-slate-200">
          <SettingsRow label={COPY.emailLabel} value={currentUser?.emailAddress ?? '—'} />
          <div className="flex items-center justify-between gap-4 py-3">
            <span className="font-admin-body text-[14px] text-admin-slate-600">{COPY.roleLabel}</span>
            <RoleBadge roleIdentity={roleIdentity} variant="admin" />
          </div>
        </div>
      </AdminExecutiveCard>

      {/* Legal rows are deliberately inert: the in-app legal documents are being
          wired by the legal-documents work. Do not fabricate document text here —
          these rows gain their open action when that lands. */}
      <AdminExecutiveCard title={COPY.legalHeading}>
        <div className="divide-y divide-admin-slate-200">
          {[COPY.termsOfService, COPY.privacyPolicy].map((documentName) => (
            <div key={documentName} className="flex items-center gap-3 py-3">
              <FileText size={16} className="shrink-0 text-admin-slate-600" />
              <span className="font-admin-body text-[14px] text-admin-neutral-ink">{documentName}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
          {COPY.legalComingSoon}
        </p>
      </AdminExecutiveCard>

      <AdminExecutiveCard title={COPY.sessionHeading}>
        <AdminExecutiveButton variant="danger" iconLeft={<LogOut size={15} />} onClick={handleSignOut}>
          {COPY.signOut}
        </AdminExecutiveButton>
      </AdminExecutiveCard>
    </div>
  );
}

export default AdminSettingsScreen;

// AdminProfileScreen.jsx
// Route: /admin/profile — the signed-in administrator's own record, rendered
// inside the console shell (the participant /profile screen is a mobile-first
// surface and never belongs in a desktop column). Read-only by design:
// there is no admin profile-edit requirement. Identity comes from the auth
// context; role and scope from roleIdentity and the admin assignment rows; the
// consent record from GET /users/me/consents — the append-only consent records
// per document, never the deprecated timestamps on the user.

import { useState } from 'react';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import RoleBadge from '../../components/role-badge/RoleBadge.jsx';
import { ADMIN_PROFILE_COPY as COPY } from '../../brand-admin/brand-copy.js';
import { formatShortDate } from '../../helpers/admin-format.js';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import { useConsentStanding } from '../../hooks/use-consent-standing/use-consent-standing.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { POLICY_KINDS, policyVersionPath } from '../../helpers/policy-documents.js';

function initialsOf(fullName) {
  return (
    (fullName || '?')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?'
  );
}

function ProfileAvatar({ user }) {
  const [hasImageFailed, setHasImageFailed] = useState(false);
  if (user?.profilePictureUrl && !hasImageFailed) {
    return (
      <img
        src={user.profilePictureUrl}
        alt=""
        width={56}
        height={56}
        onError={() => setHasImageFailed(true)}
        className="h-14 w-14 shrink-0 rounded-full border border-admin-slate-200 object-cover"
      />
    );
  }
  return (
    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-admin-primary-blue/10 font-admin-display text-[18px] font-semibold text-admin-primary-blue">
      {initialsOf(user?.fullName)}
    </span>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <span className="font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
        {label}
      </span>
      <span className="font-admin-body text-[14px] text-admin-neutral-ink">{value}</span>
    </div>
  );
}

function AdminProfileScreen() {
  const { currentUser, roleIdentity, adminAssignments } = useAuthentication();

  // The scope actually granted: unique colleges and fests off the admin rows.
  const collegeNames = [
    ...new Set(
      adminAssignments
        .map((assignment) => assignment.collegeId?.commonName ?? assignment.collegeId?.collegeName)
        .filter(Boolean),
    ),
  ];
  const festNames = [
    ...new Set(adminAssignments.map((assignment) => assignment.festId?.festName).filter(Boolean)),
  ];

  const consent = useConsentStanding();
  const isOnline = useOnlineStatus();

  function describeStanding(entry) {
    if (entry?.status === 'accepted') {
      return COPY.consentAcceptedOn(entry.versionLabel ?? '—', formatShortDate(entry.consentedAt));
    }
    if (entry?.status === 'withdrawn') {
      return COPY.consentWithdrawnOn(formatShortDate(entry.consentedAt));
    }
    return COPY.notRecorded;
  }

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6">
      <h1 className="font-admin-display text-[24px] font-semibold leading-8 text-admin-neutral-ink">
        {COPY.pageTitle}
      </h1>

      <AdminExecutiveCard title={COPY.identityHeading}>
        <div className="flex items-center gap-4">
          <ProfileAvatar user={currentUser} />
          <div className="min-w-0">
            <p className="truncate font-admin-display text-[18px] font-semibold text-admin-neutral-ink">
              {currentUser?.fullName ?? COPY.noName}
            </p>
            <p className="truncate font-admin-mono text-[13px] leading-[18px] text-admin-slate-600">
              {currentUser?.emailAddress ?? ''}
            </p>
          </div>
        </div>
        <p className="mt-4 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
          {COPY.readOnlyNote}
        </p>
      </AdminExecutiveCard>

      <AdminExecutiveCard title={COPY.roleHeading}>
        <RoleBadge roleIdentity={roleIdentity} variant="admin" />
      </AdminExecutiveCard>

      <AdminExecutiveCard title={COPY.scopeHeading}>
        {collegeNames.length === 0 && festNames.length === 0 ? (
          <p className="font-admin-body text-[14px] text-admin-slate-600">{COPY.noScope}</p>
        ) : (
          <div className="divide-y divide-admin-slate-200">
            {collegeNames.length > 0 ? (
              <DetailRow label={COPY.collegesLabel} value={collegeNames.join(', ')} />
            ) : null}
            {festNames.length > 0 ? (
              <DetailRow label={COPY.festsLabel} value={festNames.join(', ')} />
            ) : null}
          </div>
        )}
      </AdminExecutiveCard>

      <AdminExecutiveCard title={COPY.consentHeading}>
        {consent.status === 'loading' ? (
          <div className="flex flex-col gap-2" role="status" aria-label={COPY.consentHeading}>
            <div className="h-4 w-2/3 animate-pulse rounded bg-admin-slate-200/70" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-admin-slate-200/70" />
          </div>
        ) : null}
        {consent.status === 'error' ? (
          <div className="flex flex-col gap-2">
            <AdminErrorBanner
              message={!isOnline || consent.errorIsNetwork ? COPY.consentOffline : COPY.consentLoadFailed}
            />
            <button
              type="button"
              onClick={consent.reload}
              className="self-start rounded-md border border-admin-slate-200 px-3 py-1.5 font-admin-body text-[13px] font-semibold text-admin-neutral-ink hover:bg-admin-surface-off-white"
            >
              {COPY.consentRetry}
            </button>
          </div>
        ) : null}
        {consent.status === 'ready' ? (
          <div className="divide-y divide-admin-slate-200">
            {[
              [POLICY_KINDS.TERMS_OF_SERVICE, COPY.termsAcceptedLabel],
              [POLICY_KINDS.PRIVACY_POLICY, COPY.privacyAcceptedLabel],
            ].map(([kind, label]) => {
              const entry = consent.standing?.[kind];
              const isAccepted = entry?.status === 'accepted';
              return (
                <DetailRow
                  key={kind}
                  label={label}
                  value={
                    <span className="flex flex-col gap-0.5">
                      <span>{describeStanding(entry)}</span>
                      {isAccepted ? (
                        <span className="text-[12px] text-admin-slate-600">
                          {entry.isCurrentVersion ? COPY.consentCurrent : COPY.consentSuperseded}
                        </span>
                      ) : null}
                      {isAccepted && entry.policyVersionId ? (
                        <a
                          href={policyVersionPath(entry.policyVersionId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[12px] font-semibold text-admin-primary-blue underline underline-offset-2"
                        >
                          {COPY.consentViewVersion}
                        </a>
                      ) : null}
                    </span>
                  }
                />
              );
            })}
          </div>
        ) : null}
      </AdminExecutiveCard>
    </div>
  );
}

export default AdminProfileScreen;

// AdminMobileComingSoonOverlay.jsx
// The full-screen overlay shown on viewports NARROWER than 768px for any /admin
// route. The console is desktop-first — the exact inverse of the participant app,
// which shows a coming-soon overlay on wide screens instead. Built entirely from
// Executive Precision (admin) tokens so the two systems never bleed into each
// other.

import { Monitor } from 'lucide-react';
import { ADMIN_BRAND_IDENTITY } from '../../brand-admin/brand-identity.js';
import { ADMIN_GLOBAL_COPY } from '../../brand-admin/brand-copy.js';

function AdminMobileComingSoonOverlay() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-admin-surface-off-white px-6">
      <span className="mb-6 flex h-14 w-14 items-center justify-center rounded-lg bg-admin-primary-blue/10">
        <Monitor size={26} strokeWidth={1.75} className="text-admin-primary-blue" />
      </span>

      {/* Wordmark */}
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-admin-primary-blue font-admin-display text-[13px] font-bold text-admin-surface-white">
          D
        </span>
        <span className="font-admin-display text-[15px] font-semibold text-admin-neutral-ink">
          {ADMIN_BRAND_IDENTITY.appName}
        </span>
      </div>

      <h1 className="max-w-[420px] text-center font-admin-display text-[24px] font-semibold leading-8 text-admin-neutral-ink">
        {ADMIN_GLOBAL_COPY.mobileComingSoonHeadline}
      </h1>

      <p className="mt-3 max-w-[420px] text-center font-admin-body text-[14px] leading-5 text-admin-slate-600">
        {ADMIN_GLOBAL_COPY.mobileComingSoonBody}
      </p>
    </div>
  );
}

export default AdminMobileComingSoonOverlay;

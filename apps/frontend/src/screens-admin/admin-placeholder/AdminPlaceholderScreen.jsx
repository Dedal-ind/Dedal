// AdminPlaceholderScreen.jsx
// The stand-in for every admin screen not yet built. It renders inside the real
// AdminLayout, so the sidebar, topbar, and card system are exercised from the
// first run — and each placeholder names the Stitch design it will be built
// from, so the scaffold doubles as the build checklist.

import { Construction } from 'lucide-react';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import { ADMIN_GLOBAL_COPY } from '../../brand-admin/brand-copy.js';

function AdminPlaceholderScreen({ title, stitchScreen }) {
  return (
    <AdminExecutiveCard>
      <div className="flex flex-col items-start gap-3 py-8">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-admin-primary-blue/10">
          <Construction size={20} className="text-admin-primary-blue" strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="font-admin-display text-[20px] font-semibold leading-7 text-admin-neutral-ink">
            {title} — {ADMIN_GLOBAL_COPY.comingSoon}
          </h2>
          <p className="mt-1 font-admin-body text-[14px] leading-5 text-admin-slate-600">
            {ADMIN_GLOBAL_COPY.comingSoonBody}
          </p>
        </div>
        {stitchScreen ? (
          <p className="rounded-md border border-admin-slate-200 bg-admin-surface-off-white px-3 py-1.5 font-admin-mono text-[13px] leading-[18px] text-admin-slate-600">
            {stitchScreen}
          </p>
        ) : null}
      </div>
    </AdminExecutiveCard>
  );
}

export default AdminPlaceholderScreen;

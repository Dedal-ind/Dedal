// AdminNotificationPanel.jsx
// The popover under the topbar bell. It renders REAL recent activity from the
// append-only audit log (GET /admin/audit-logs, fest-scoped) via the existing
// AdminActivityFeed — not fabricated notifications. Participant-facing
// notifications (registration confirmed, certificate released) need a real
// notifications model and are a separate feature; until then this is the honest
// content for the bell.
//
// A popover, not a modal: no focus trap. The trigger (in AdminTopbar) carries
// aria-haspopup/aria-expanded; this panel is the dialog. Escape and outside
// mousedown both close it via onClose — the caller returns focus to the bell.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellOff } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminActivityFeed from '../admin-activity-feed/AdminActivityFeed.jsx';
import AdminExecutiveButton from '../admin-executive-button/AdminExecutiveButton.jsx';
import { ADMIN_NOTIFICATIONS_COPY as COPY } from '../../brand-admin/brand-copy.js';

const ACTIVITY_LIMIT = 8;
const OVERVIEW_ROUTE = '/admin/overview';

function AdminNotificationPanel({ festId, onClose }) {
  const navigate = useNavigate();
  // 'noFest' | 'loading' | 'ready' | 'empty' | 'error'
  const [loadState, setLoadState] = useState(festId ? 'loading' : 'noFest');
  const [items, setItems] = useState([]);

  const loadActivity = useCallback(async () => {
    /*
     * Two explicit no-fest cases end here rather than in a failed request: an
     * administrator with no fest yet, and a platform admin whose assignment
     * carries no fest at all. Both get a clear empty state, never a dead spinner.
     */
    if (!festId) {
      setLoadState('noFest');
      return;
    }
    setLoadState('loading');
    try {
      const payload = await apiClient.get(`/admin/audit-logs?festId=${festId}&limit=${ACTIVITY_LIMIT}`);
      const logs = Array.isArray(payload?.logs) ? payload.logs : [];
      setItems(
        logs.map((log) => ({
          id: log.id,
          action: log.action,
          actorName: log.actorUserId?.fullName ?? log.actorUserId?.emailAddress ?? null,
          createdAt: log.createdAt,
        })),
      );
      setLoadState(logs.length === 0 ? 'empty' : 'ready');
    } catch {
      setLoadState('error');
    }
  }, [festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadActivity();
  }, [loadActivity]);

  // Escape closes the panel; the caller's onClose returns focus to the bell.
  useEffect(() => {
    function handleKeyDown(keyboardEvent) {
      if (keyboardEvent.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function handleViewAll() {
    onClose();
    navigate(OVERVIEW_ROUTE);
  }

  return (
    <div
      role="dialog"
      aria-label={COPY.panelAriaLabel}
      className="absolute right-0 z-40 mt-2 w-[360px] rounded-lg border border-admin-slate-200 bg-admin-surface-white shadow-admin-modal"
    >
      <header className="flex items-center justify-between border-b border-admin-slate-200 px-4 py-3">
        <h2 className="font-admin-display text-[16px] font-semibold text-admin-neutral-ink">
          {COPY.panelTitle}
        </h2>
      </header>

      <div className="max-h-[380px] overflow-y-auto px-4 py-3">
        {loadState === 'loading' ? (
          <div className="flex flex-col gap-3 py-2" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-10 animate-pulse rounded-md bg-admin-surface-off-white" />
            ))}
          </div>
        ) : null}

        {loadState === 'noFest' ? (
          <EmptyBlock title={COPY.noFestTitle} body={COPY.noFestBody} />
        ) : null}
        {loadState === 'empty' ? <EmptyBlock title={COPY.emptyTitle} body={COPY.emptyBody} /> : null}

        {loadState === 'error' ? (
          <div className="flex flex-col items-start gap-2 py-3">
            <p className="font-admin-body text-[14px] text-admin-slate-600">{COPY.loadError}</p>
            <AdminExecutiveButton variant="secondary" size="small" onClick={loadActivity}>
              {COPY.retry}
            </AdminExecutiveButton>
          </div>
        ) : null}

        {loadState === 'ready' ? <AdminActivityFeed items={items} /> : null}
      </div>

      {loadState === 'ready' || loadState === 'empty' ? (
        <footer className="border-t border-admin-slate-200 px-4 py-2.5">
          <button
            type="button"
            onClick={handleViewAll}
            className="font-admin-body text-[13px] font-medium text-admin-primary-blue transition-colors hover:text-admin-neutral-ink"
          >
            {COPY.viewAll}
          </button>
        </footer>
      ) : null}
    </div>
  );
}

function EmptyBlock({ title, body }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <BellOff size={20} className="text-admin-slate-600" />
      <p className="font-admin-body text-[14px] font-medium text-admin-neutral-ink">{title}</p>
      <p className="font-admin-body text-[13px] leading-[18px] text-admin-slate-600">{body}</p>
    </div>
  );
}

export default AdminNotificationPanel;

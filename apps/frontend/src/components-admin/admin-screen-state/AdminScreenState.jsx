// AdminScreenState.jsx
// The console's full-panel "there is nothing to show you" states, in one
// place: loading, error, offline, and first-run empty.
//
// Lifted from the promotions screen, which carried the loading spinner and the
// error card inline — the same markup was about to be copied into a third
// screen, which is the moment it becomes a component. The treatments are the
// promotions screen's own, unchanged; the offline tone is the error card with
// the connection named as the cause, and the empty tone is a card that says
// what the thing is and offers to make one, because a first-run list is not
// an error.

import { AlertTriangle, RotateCw, WifiOff } from 'lucide-react';
import AdminExecutiveCard from '../admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../admin-executive-button/AdminExecutiveButton.jsx';

function AdminScreenState({ tone, message, headline, actionLabel, onAction, icon }) {
  if (tone === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-[50vh] flex-col items-center justify-center gap-3"
      >
        <span
          aria-hidden="true"
          className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
        />
        <span className="font-admin-body text-[14px] text-admin-slate-600">{message}</span>
      </div>
    );
  }

  if (tone === 'error' || tone === 'offline') {
    const Icon = tone === 'offline' ? WifiOff : AlertTriangle;
    return (
      <AdminExecutiveCard>
        <div className="flex flex-col items-start gap-3 py-6">
          <p className="flex items-start gap-2 font-admin-body text-[14px] text-admin-neutral-ink">
            <Icon size={16} className="mt-0.5 shrink-0 text-admin-status-error-red" />
            {message}
          </p>
          {onAction ? (
            <AdminExecutiveButton variant="secondary" iconLeft={<RotateCw size={15} />} onClick={onAction}>
              {actionLabel}
            </AdminExecutiveButton>
          ) : null}
        </div>
      </AdminExecutiveCard>
    );
  }

  // empty
  return (
    <AdminExecutiveCard>
      <div className="flex flex-col items-start gap-3 py-8">
        {headline ? (
          <p className="font-admin-display text-[18px] font-semibold text-admin-neutral-ink">{headline}</p>
        ) : null}
        <p className="max-w-[560px] font-admin-body text-[14px] leading-5 text-admin-slate-600">{message}</p>
        {onAction ? (
          <AdminExecutiveButton variant="primary" iconLeft={icon} onClick={onAction}>
            {actionLabel}
          </AdminExecutiveButton>
        ) : null}
      </div>
    </AdminExecutiveCard>
  );
}

export default AdminScreenState;

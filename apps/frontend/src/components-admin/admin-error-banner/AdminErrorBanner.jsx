// AdminErrorBanner.jsx
// The one error surface every admin screen uses to report a failed mutation.
// It renders the message the backend actually sent ({ error: { message } },
// surfaced by the api-client as error.message) rather than a generic apology,
// because the admin's next action depends on which guard rejected them.

import { AlertTriangle } from 'lucide-react';

function AdminErrorBanner({ message, className = '' }) {
  if (!message) {
    return null;
  }

  return (
    <div
      role="alert"
      className={[
        'flex items-start gap-2 rounded-md border border-admin-status-error-red/30 bg-admin-status-error-red/5 px-4 py-3',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-admin-status-error-red" />
      <p className="font-admin-body text-[14px] leading-5 text-admin-status-error-red">{message}</p>
    </div>
  );
}

export default AdminErrorBanner;

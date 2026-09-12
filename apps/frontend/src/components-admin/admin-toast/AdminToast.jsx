// AdminToast.jsx
// A short confirmation that something happened, bottom-centre, self-dismissing.
//
// WHY THIS EXISTS AT ALL. The admin console had no toast — every confirmation
// was either a banner that displaced the layout or nothing. A rearrange needs
// the third thing: the move already happened and the table already shows it, so
// a banner would be shouting about something the reader can see, and silence
// would leave them unsure whether the drop was saved or merely animated.
//
// IT IS NOT AN ERROR CHANNEL. Failures still go to AdminErrorBanner, which
// stays on screen until it is dealt with. A toast that carries errors is a
// toast that hides them after four seconds.
//
// aria-live="polite", not "assertive": the table's own live region already
// announces the move for screen-reader users at the moment it commits, so an
// assertive toast would interrupt to say the same thing twice.

import { useEffect } from 'react';
import { Check } from 'lucide-react';

const DISMISS_AFTER_MS = 4000;

function AdminToast({ message, onDismiss }) {
  useEffect(() => {
    if (!message) {
      return undefined;
    }
    /* Keyed on the message, so a second move while the first toast is up
       restarts the clock instead of inheriting the remainder of it. */
    const timer = window.setTimeout(onDismiss, DISMISS_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-lg bg-admin-neutral-ink px-4 py-2.5 shadow-lg">
        <Check size={15} strokeWidth={2.5} className="shrink-0 text-admin-surface-white" />
        <span className="font-admin-body text-[13px] text-admin-surface-white">{message}</span>
      </div>
    </div>
  );
}

export default AdminToast;

// AdminActivityFeed.jsx
// The vertical list inside the Recent Activity card. Each row is one audit-log
// entry: a small tone-coloured icon, what happened, and who + when. Tone is
// derived from the action string so the feed colours itself without the backend
// sending a tone — publishes/awards read green, archives/cancellations amber,
// everything else the neutral blue of an ordinary action.
//
// items: Array<{ id, action, actorName, createdAt }>

import { Activity, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ADMIN_ACTIVITY_COPY } from '../../brand-admin/brand-copy.js';
import { formatRelativeTime } from '../../helpers/admin-format.js';

// Green for a positive terminal action, amber for a removal/cancellation, blue
// otherwise. Matched on substrings so the whole 'achievement.*' family, etc.,
// resolves without enumerating every action.
function toneForAction(action) {
  const value = typeof action === 'string' ? action : '';
  if (/(published|finalized|released|awarded)/.test(value)) {
    return 'success';
  }
  if (/(archived|cancelled|revoked)/.test(value)) {
    return 'warning';
  }
  return 'info';
}

const TONE_STYLES = {
  success: { icon: CheckCircle2, className: 'bg-admin-status-success-green/10 text-admin-status-success-green' },
  warning: { icon: AlertTriangle, className: 'bg-admin-status-warning-amber/10 text-admin-status-warning-amber' },
  info: { icon: Activity, className: 'bg-admin-primary-blue/10 text-admin-primary-blue' },
};

// Humanise an action the label map does not cover: 'thing.someAction' → 'Thing
// someAction'. Keeps an unmapped action readable instead of showing a raw slug.
function humaniseAction(action) {
  if (typeof action !== 'string' || !action) {
    return 'Activity';
  }
  const readable = action.replace(/\./g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

function ActivityRow({ item }) {
  const tone = toneForAction(item.action);
  const { icon: IconComponent, className } = TONE_STYLES[tone];
  const primaryText = ADMIN_ACTIVITY_COPY.actionLabels[item.action] ?? humaniseAction(item.action);
  const actorName = item.actorName || ADMIN_ACTIVITY_COPY.unknownActor;
  const relativeTime = formatRelativeTime(item.createdAt);

  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className={['mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', className].join(' ')}>
        <IconComponent size={15} strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="font-admin-body text-[14px] leading-5 text-admin-neutral-ink">{primaryText}</p>
        <p className="mt-0.5 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
          {actorName}
          {relativeTime ? <span className="font-admin-mono"> · {relativeTime}</span> : null}
        </p>
      </div>
    </li>
  );
}

function AdminActivityFeed({ items }) {
  return (
    <ul className="divide-y divide-admin-slate-200">
      {items.map((item) => (
        <ActivityRow key={item.id} item={item} />
      ))}
    </ul>
  );
}

export default AdminActivityFeed;

// AdminStatusPill.jsx
// A lifecycle status as a pill. It does not invent a new visual — it maps a fest
// OR event status onto the shared AdminExecutiveChip tones, so a PUBLISHED thing
// reads with the same green as any other success chip in the console. An unknown
// status falls back to the neutral tone rather than rendering nothing.

import AdminExecutiveChip from '../admin-executive-chip/AdminExecutiveChip.jsx';
import { ADMIN_OVERVIEW_COPY } from '../../brand-admin/brand-copy.js';

// Fest statuses: 'draft' | 'published' | 'archived'.
// Event statuses add: 'ongoing' | 'completed' | 'cancelled'.
const STATUS_TO_CHIP = {
  published: { tone: 'success', label: ADMIN_OVERVIEW_COPY.statusPublished },
  draft: { tone: 'neutral', label: ADMIN_OVERVIEW_COPY.statusDraft },
  archived: { tone: 'warning', label: ADMIN_OVERVIEW_COPY.statusArchived },
  ongoing: { tone: 'info', label: 'ONGOING' },
  completed: { tone: 'neutral', label: 'COMPLETED' },
  cancelled: { tone: 'error', label: 'CANCELLED' },
};

function AdminStatusPill({ status, className = '' }) {
  const mapped = STATUS_TO_CHIP[status] ?? {
    tone: 'neutral',
    label: typeof status === 'string' ? status.toUpperCase() : '—',
  };

  return (
    <AdminExecutiveChip tone={mapped.tone} className={className}>
      {mapped.label}
    </AdminExecutiveChip>
  );
}

export default AdminStatusPill;

// ApplicationStatusChip.jsx
// One place maps a college-application status to a chip tone + label, so the
// queue and the detail screen cannot drift apart.

import AdminExecutiveChip from '../../components-admin/admin-executive-chip/AdminExecutiveChip.jsx';
import { ADMIN_COLLEGE_APPLICATIONS_COPY as COPY } from '../../brand-admin/brand-copy.js';

const TONES = {
  pending: 'warning',
  underReview: 'info',
  approved: 'success',
  rejected: 'error',
};

function ApplicationStatusChip({ status }) {
  return (
    <AdminExecutiveChip tone={TONES[status] ?? 'neutral'}>
      {COPY.statusLabels[status] ?? String(status ?? '').toUpperCase()}
    </AdminExecutiveChip>
  );
}

export default ApplicationStatusChip;

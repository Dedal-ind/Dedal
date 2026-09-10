// Shared formatting and date-range logic for all delivery reporting screens.

export function formatNumber(n) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString();
}

export function formatRate(rateObj) {
  if (!rateObj || rateObj.rate === null || rateObj.rate === undefined) return '—';
  return `${(rateObj.rate * 100).toFixed(1)}%`;
}

export function rateSubtitle(rateObj) {
  if (!rateObj?.of) return '';
  return rateObj.of;
}

export function formatDay(dayString) {
  if (!dayString) return '';
  const d = new Date(dayString + 'T00:00:00Z');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function formatTimestamp(isoString) {
  if (!isoString) return '—';
  return new Date(isoString).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgoString(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const MAX_RANGE_DAYS = 92;

export function validateRange(from, to) {
  if (!from || !to) return null;
  if (from > to) return 'Start date must be before end date.';
  const diffMs = new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z');
  const diffDays = Math.round(diffMs / 86400000) + 1;
  if (diffDays > MAX_RANGE_DAYS) return `Range cannot exceed ${MAX_RANGE_DAYS} days.`;
  return null;
}

export function pacingLabel(status) {
  const map = { ahead: 'Ahead', behind: 'Behind', onPace: 'On pace', noGoal: 'No goal' };
  return map[status] || status;
}

export function pacingTone(status) {
  if (status === 'ahead') return 'text-admin-status-success-green';
  if (status === 'behind') return 'text-admin-status-error-red';
  return 'text-admin-slate-600';
}

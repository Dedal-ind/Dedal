// admin-format.js
// Pure formatting helpers shared by admin screens. No design tokens, no copy —
// just deterministic string formatting for money, dates, and relative times, so
// every admin surface presents the same values the same way.

// Indian-grouped rupees from a paise integer: 12450000 → "₹1,24,500". Rounded to
// whole rupees — the console never shows paise. A non-finite input becomes null so
// callers can fall back to an em dash rather than render "₹NaN".
export function formatInrFromPaise(amountPaise) {
  if (typeof amountPaise !== 'number' || !Number.isFinite(amountPaise)) {
    return null;
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Math.round(amountPaise) / 100);
}

// "21 Jul 2026". Returns null for anything that is not a real date, so a missing
// field never renders "Invalid Date".
export function formatShortDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  // Pinned to IST — Dedal dates are Indian, and a UTC-midnight startsOn must
  // not slip a day on a non-IST machine.
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

// "21 Jul – 28 Jul 2026" style range for the fests table, collapsing to a single
// date when both endpoints fall on the same IST day. The en dash and the mono
// face are applied by the caller; this only produces the endpoints.
export function formatDateRange(startValue, endValue) {
  const start = formatShortDate(startValue);
  const end = formatShortDate(endValue);
  if (start && end) {
    return start === end ? start : `${start} – ${end}`;
  }
  return start || end || '—';
}

// "21 Jul 2026, 14:32 IST" — the full, unambiguous stamp behind a relative time.
// Used for title/tooltip text where "3h ago" alone is not precise enough.
export function formatAbsoluteDateTime(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${formatted} IST`;
}

// "just now" / "5m ago" / "3h ago" / "2d ago", falling back to a short date past a
// week. Used by the recent-activity feed.
export function formatRelativeTime(value, nowValue = Date.now()) {
  if (!value) {
    return null;
  }
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) {
    return null;
  }
  const secondsAgo = Math.max(0, Math.round((nowValue - then) / 1000));
  if (secondsAgo < 60) {
    return 'just now';
  }
  const minutesAgo = Math.round(secondsAgo / 60);
  if (minutesAgo < 60) {
    return `${minutesAgo}m ago`;
  }
  const hoursAgo = Math.round(minutesAgo / 60);
  if (hoursAgo < 24) {
    return `${hoursAgo}h ago`;
  }
  const daysAgo = Math.round(hoursAgo / 24);
  if (daysAgo <= 7) {
    return `${daysAgo}d ago`;
  }
  return formatShortDate(value);
}

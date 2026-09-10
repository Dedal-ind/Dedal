// feed-format.js
// Date and deadline strings for the Discover feed.
//
// Separate from event-format.js on purpose: that module renders "SEP 9 – SEP
// 12, 2026" for the older screens, and the redesign is sentence case
// everywhere, never all-caps. Both are correct for their own surface, so the
// old one is left alone rather than changed underneath forty screens.
//
// The shapes, in the order they are tried:
//   same day          9 Sep
//   same month        9–12 Sep
//   same year         28 Sep – 3 Oct
//   crosses a year    28 Dec 2026 – 3 Jan 2027
// The year is added to every shape when the range does not fall in the current
// one, because "9–12 Sep" for something eighteen months away is a trap.

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/* An en dash, unspaced between bare numbers and spaced between full dates —
   the ordinary typographic convention, and the reason "9–12 Sep" reads as one
   span while "28 Sep – 3 Oct" reads as two dates. */
const TIGHT_DASH = '–';
const SPACED_DASH = ' – ';

function toDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatFeedDateRange(startsOn, endsOn, nowTs = Date.now()) {
  const start = toDate(startsOn);
  if (!start) {
    return '';
  }
  const end = toDate(endsOn) ?? start;
  const currentYear = new Date(nowTs).getFullYear();
  const spansYears = start.getFullYear() !== end.getFullYear();
  const isCurrentYear = !spansYears && start.getFullYear() === currentYear;

  const startDay = start.getDate();
  const endDay = end.getDate();
  const startMonth = MONTHS[start.getMonth()];
  const endMonth = MONTHS[end.getMonth()];
  const yearSuffix = isCurrentYear ? '' : ` ${end.getFullYear()}`;

  if (spansYears) {
    return `${startDay} ${startMonth} ${start.getFullYear()}${SPACED_DASH}${endDay} ${endMonth} ${end.getFullYear()}`;
  }
  if (start.getMonth() === end.getMonth() && startDay === endDay) {
    return `${startDay} ${startMonth}${yearSuffix}`;
  }
  if (start.getMonth() === end.getMonth()) {
    return `${startDay}${TIGHT_DASH}${endDay} ${startMonth}${yearSuffix}`;
  }
  return `${startDay} ${startMonth}${SPACED_DASH}${endDay} ${endMonth}${yearSuffix}`;
}

export function isFestLive(startsOn, endsOn, nowTs) {
  const start = toDate(startsOn);
  if (!start) {
    return false;
  }
  const end = toDate(endsOn) ?? start;
  return start.getTime() <= nowTs && end.getTime() >= nowTs;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/* Beyond a week away, a deadline is not news and the line is noise. */
const DEADLINE_HORIZON_DAYS = 7;

/*
 * "Closes today" / "Closes tomorrow" / "Closes in 4 days", or null when the
 * deadline is absent, already past, or further out than the horizon. Null is
 * the common case and means the card renders no deadline line at all rather
 * than an empty one.
 */
export function formatRegistrationDeadline(closesAt, nowTs) {
  const closes = toDate(closesAt);
  if (!closes) {
    return null;
  }
  const remaining = closes.getTime() - nowTs;
  if (remaining <= 0) {
    return null;
  }
  const days = Math.ceil(remaining / DAY_MS);
  if (days > DEADLINE_HORIZON_DAYS) {
    return null;
  }
  if (days <= 1) {
    return remaining <= DAY_MS / 2 ? 'Closes today' : 'Closes tomorrow';
  }
  return `Closes in ${days} days`;
}

/*
 * "Alliance University, Bengaluru". A comma rather than a middle dot: this is
 * a place, and a place is written the way an address is written.
 */
export function formatHostLine(collegeName, city) {
  return [collegeName, city].filter(Boolean).join(', ');
}

/* The populated host college arrives as { commonName, city, id } from
   /public/fests, and as a flat name on some older payload shapes. */
export function readHostCollege(fest) {
  const host = fest?.hostCollegeId;
  if (host && typeof host === 'object') {
    return {
      name: host.commonName ?? host.collegeName ?? '',
      city: host.city ?? '',
    };
  }
  return { name: fest?.hostCollegeName ?? '', city: fest?.hostCollegeCity ?? '' };
}

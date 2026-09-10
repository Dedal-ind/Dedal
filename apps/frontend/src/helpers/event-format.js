// event-format.js
// Pure display formatters shared by the browse and event screens. These turn raw
// backend event fields (paise, ISO dates, enum values) into the stamped, mostly
// uppercase strings the Neo-Zine screens show. No React, no tokens — just strings.

import { SCORING_FORMAT_LABELS } from '../brand/brand-copy.js';

// Backend enum values (from event-constants.js) — the contract, not display copy.
const EVENT_TYPES = { SOLO: 'solo', TEAM: 'team' };
const FEE_TYPES = { FREE: 'free', PER_PERSON: 'perPerson', PER_TEAM: 'perTeam' };

const MONTH_ABBREVIATIONS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

// Dedal serves Indian college fests, so every date/time is shown in IST
// regardless of the viewer's machine clock. These formatters read the calendar
// parts IN Asia/Kolkata rather than via local Date getters, so a judge on a
// non-IST laptop still sees the correct fest day (a UTC-midnight startsOn would
// otherwise slip back a day).
const IST_TIME_ZONE = 'Asia/Kolkata';
const IST_PART_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: IST_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hour12: false,
});

function toDate(isoString) {
  if (!isoString) {
    return null;
  }
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? null : date;
}

// The calendar/clock parts of a date as they read in IST.
function istParts(date) {
  const parts = {};
  for (const part of IST_PART_FORMATTER.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month) - 1,
    day: Number(parts.day),
    // hour12:false can yield "24" at midnight in some engines — normalise.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

// True when both instants fall on the same IST calendar day.
function isSameIstDay(a, b) {
  const first = istParts(a);
  const second = istParts(b);
  return first.year === second.year && first.month === second.month && first.day === second.day;
}

// "AUG 22" (IST)
export function formatShortDate(isoString) {
  const date = toDate(isoString);
  if (!date) {
    return '';
  }
  const { month, day } = istParts(date);
  return `${MONTH_ABBREVIATIONS[month]} ${day}`;
}

// "09:00 AM" (IST)
export function formatClockTime(isoString) {
  const date = toDate(isoString);
  if (!date) {
    return '';
  }
  const { hour, minute } = istParts(date);
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${String(hour12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${meridiem}`;
}

// "OCT 25, 2026 · 09:00 AM – 10:00 PM" (IST)
/*
 * SENTENCE CASE, A COMMA, AND THE WORD "to".
 *
 * This returned "JUL 31, 2026 · 03:30 PM – 10:30 PM", which carries three
 * things the rest of the app has moved away from: the stamped uppercase month
 * (the retired voice), the middle dot as a joiner (the meta-string tic that
 * makes every line look like every other line), and an en dash between the
 * times. A dash renders as a hyphen at 13px and reads as part of the number.
 *
 * Its only consumer is the event detail page, so it is fixed here at source
 * rather than overridden locally. IST is unchanged.
 */
export function formatScheduleRange(startsAt, endsAt) {
  const start = toDate(startsAt);
  if (!start) {
    return '';
  }
  const { month, day, year } = istParts(start);
  const monthName = MONTH_ABBREVIATIONS[month];
  const datePart = `${day} ${monthName.charAt(0)}${monthName.slice(1).toLowerCase()} ${year}`;
  const end = toDate(endsAt);
  if (!end) {
    return `${datePart}, ${formatClockTime(startsAt)}`;
  }
  return `${datePart}, ${formatClockTime(startsAt)} to ${formatClockTime(endsAt)}`;
}

// "JUL 17 – JUL 20", collapsing to a single "JUL 17" when both fall on the same
// IST day.
export function formatRegistrationWindow(opensAt, closesAt) {
  const opens = toDate(opensAt);
  const closes = toDate(closesAt);
  if (!opens && !closes) {
    return '';
  }
  if (opens && closes && isSameIstDay(opens, closes)) {
    return formatShortDate(opensAt);
  }
  const opensLabel = formatShortDate(opensAt);
  const closesLabel = formatShortDate(closesAt);
  if (!opensLabel || !closesLabel) {
    return opensLabel || closesLabel;
  }
  return `${opensLabel} – ${closesLabel}`;
}

// "AUG 22 – AUG 25, 2026" for a fest window, collapsing to "AUG 22, 2026" when
// the fest runs a single IST day. Shared by Discover, fest detail and category
// screens so the fest date range reads identically everywhere.
export function formatFestDateRange(startsOn, endsOn) {
  const start = toDate(startsOn);
  const end = toDate(endsOn);
  if (!start && !end) {
    return '';
  }
  if (start && end) {
    const s = istParts(start);
    const e = istParts(end);
    if (s.year === e.year && s.month === e.month && s.day === e.day) {
      return `${MONTH_ABBREVIATIONS[s.month]} ${s.day}, ${s.year}`;
    }
    return `${MONTH_ABBREVIATIONS[s.month]} ${s.day} – ${MONTH_ABBREVIATIONS[e.month]} ${e.day}, ${e.year}`;
  }
  const only = istParts(start || end);
  return `${MONTH_ABBREVIATIONS[only.month]} ${only.day}, ${only.year}`;
}

// "AUG 22 · MAIN AUDITORIUM"
export function formatDateVenue(event) {
  const parts = [formatShortDate(event.startsAt), event.venue].filter(Boolean);
  return parts.join(' · ').toUpperCase();
}

// Rupees from paise, Indian-grouped with the ₹ symbol: 12450000 → "₹1,24,500";
// 21180 → "₹211.80". Whole rupees drop the decimals; fractional rupees keep two.
export function formatRupees(paise) {
  const rupees = (paise ?? 0) / 100;
  const fractionDigits = Number.isInteger(rupees) ? 0 : 2;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(rupees);
}

// "FREE" or "₹1,24,500"
export function formatFeeLabel(event) {
  if (event.feeType === FEE_TYPES.FREE || !event.feeAmountPaise) {
    return 'Free';
  }
  return formatRupees(event.feeAmountPaise);
}

// A precise money amount from paise, Indian-grouped: "₹1,24,500" / "₹211.80".
export function formatPaiseAmount(paise) {
  return formatRupees(paise);
}

// Whether an event charges a fee at all.
export function isPaidEvent(event) {
  return event.feeType !== FEE_TYPES.FREE && Boolean(event.feeAmountPaise);
}

// Short chip: "Team" / "Solo"
export function formatEventTypeShort(event) {
  return event.eventType === EVENT_TYPES.TEAM ? 'Team' : 'Solo';
}

// Full chip: "Solo" / "Team of 4" / "Team of 3–6"
export function formatEventTypeFull(event) {
  if (event.eventType !== EVENT_TYPES.TEAM) {
    return 'Solo';
  }
  const { minimumTeamSize, maximumTeamSize } = event;
  if (minimumTeamSize && maximumTeamSize && minimumTeamSize !== maximumTeamSize) {
    return `Team of ${minimumTeamSize}–${maximumTeamSize}`;
  }
  return `Team of ${maximumTeamSize ?? minimumTeamSize ?? ''}`.trim();
}

// scoringFormat enum -> human label ("BRACKET", "SCORED", "JUDGED"…)
export function formatScoringFormat(event) {
  return SCORING_FORMAT_LABELS[event.scoringFormat] ?? SCORING_FORMAT_LABELS.none;
}

// Capacity read-out for the browse chips and the detail progress bar.
export function computeCapacityState(event) {
  if (event.capacity === null || event.capacity === undefined) {
    return { isUnlimited: true, isFull: false, isFillingFast: false, percent: 0 };
  }
  const registered = event.registeredCount ?? 0;
  const percent = event.capacity > 0 ? Math.min(100, Math.round((registered / event.capacity) * 100)) : 0;
  const isFull = registered >= event.capacity;
  const isFillingFast = !isFull && registered >= event.capacity * 0.8;
  return { isUnlimited: false, isFull, isFillingFast, percent };
}

/*
 * Whether this event is taking registrations, read from the SERVER'S OWN answer.
 *
 * This used to compare endsAt against the wall clock, mirroring a rule the
 * backend applied too. Both are gone. No date on an event reliably means "stop
 * taking people": walk-ups register at the venue after the start time, an
 * organiser running long still wants the desk open, and a placeholder end time
 * would silently shut a door nobody chose to shut. Registration now closes only
 * when an administrator closes it, and `registrationStatus` is that decision.
 *
 * Deriving it here from a timestamp was also the specific way this screen could
 * disagree with the API: the button said closed, the endpoint accepted the
 * registration, and neither was wrong on its own terms. One authority removes
 * that entirely — the server computes registrationStatus, this reads it.
 *
 * Cancelled and deleted events resolve to closed server-side, so they need no
 * special case here.
 */
export function isRegistrationClosed(event) {
  return event?.registrationStatus === 'closed';
}

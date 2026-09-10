// backstage-time.js
// The date and time voice for the backstage hubs, in one place so the
// coordinator hub and the volunteer hub cannot drift into two of them.
//
// WHY RELATIVE DAYS. A coordinator opening this list on the morning of a fest
// is asking "what is on now, and what is next" — not "what is the date". An
// absolute date makes them do the arithmetic; "Today" and "Tomorrow" do not.
// Past the end of the week the relative form stops helping ("in 23 days" is
// not a thing anyone can picture), so it falls back to the day chip alone,
// which is already carrying the date.
//
// Everything is IST, because a fest happens in one place and the person
// reading this is standing in it.

const IST = 'Asia/Kolkata';

const DAY_NUMBER = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric' });
const MONTH_SHORT = new Intl.DateTimeFormat('en-IN', { timeZone: IST, month: 'short' });
const WEEKDAY = new Intl.DateTimeFormat('en-IN', { timeZone: IST, weekday: 'long' });
const DAY_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/*
 * Whole-day distance, counted in IST calendar days rather than in elapsed
 * hours. 11pm to 1am is one day apart even though it is two hours, and that is
 * what "Tomorrow" has to mean.
 */
function istDayOffset(date, nowMs) {
  const a = DAY_KEY.format(date);
  const b = DAY_KEY.format(new Date(nowMs));
  const parse = (key) => {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(a) - parse(b)) / 86400000);
}

/** True when `value` falls on today's IST date. */
export function isToday(value, nowMs) {
  const date = toDate(value);
  return date ? istDayOffset(date, nowMs) === 0 : false;
}

/**
 * The leading chip: a day number and a short month, plus whether it is today
 * so the chip can carry the one bit of colour on the row.
 */
export function dayChip(value, nowMs) {
  const date = toDate(value);
  if (!date) {
    return { day: '—', month: '', isToday: false };
  }
  return {
    day: DAY_NUMBER.format(date),
    month: MONTH_SHORT.format(date),
    isToday: istDayOffset(date, nowMs) === 0,
  };
}

/** "10:00 am" — lowercased, because the row is a sentence and not a stamp. */
export function clockTime(value) {
  const date = toDate(value);
  return date ? TIME.format(date).toLowerCase() : '';
}

/**
 * The time line. The relative day is prefixed only while it still means
 * something; beyond a week the chip beside it is already the answer.
 *
 *   today        → "Today, 10:00 am – 5:00 pm"
 *   tomorrow     → "Tomorrow, 10:00 am – 5:00 pm"
 *   this week    → "Friday, 10:00 am – 5:00 pm"
 *   further out  → "10:00 am – 5:00 pm"
 *   no end time  → "Today, from 10:00 am"
 */
export function whenLabel(startsAt, endsAt, nowMs) {
  const start = toDate(startsAt);
  if (!start) return '';

  const offset = istDayOffset(start, nowMs);
  let dayWord = '';
  if (offset === 0) dayWord = 'Today';
  else if (offset === 1) dayWord = 'Tomorrow';
  else if (offset === -1) dayWord = 'Yesterday';
  else if (offset > 1 && offset <= 6) dayWord = WEEKDAY.format(start);

  const end = toDate(endsAt);
  /* An en dash, not a hyphen: this is a range, and the hyphen is for
     compound words. */
  const range = end ? clockTime(start) + ' – ' + clockTime(end) : 'from ' + clockTime(start);

  return dayWord ? dayWord + ', ' + range : range;
}

// pass-format.js
// The two pure things the pass card needs to say and the passes list needs to
// agree with: how a fest's dates read, and whether a fest is happening now.
//
// Split out of PassCard.jsx rather than exported alongside it, for the same
// reason select-active-pass.js is split out of PassSheet.jsx: React Fast
// Refresh gives up on a module that exports both a component and something
// else, and the list screen imports these without wanting the card. They are
// also the pieces worth testing on their own — pure, total, and the whole of
// the judgement about what "live" means.

/*
 * Sentence case, in IST, deliberately not formatFestDateRange().
 *
 * The shared helper returns "JUL 25 – AUG 1, 2026" — the month in caps, which
 * is the retired stamped-uppercase voice. This surface is sentence case
 * throughout, and a single shouting fragment in the middle of the card is more
 * conspicuous than it sounds. Same timezone rule as the helper: Asia/Kolkata,
 * always, because a fest day must not slip on a laptop set to UTC.
 */
const IST_DAY = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
});
const IST_DAY_YEAR = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function formatPassDateRange(startsOn, endsOn) {
  const start = startsOn ? new Date(startsOn) : null;
  const end = endsOn ? new Date(endsOn) : null;
  const valid = (date) => date && !Number.isNaN(date.getTime());
  if (!valid(start) && !valid(end)) {
    return '';
  }
  if (!valid(start)) {
    return IST_DAY_YEAR.format(end);
  }
  if (!valid(end)) {
    return IST_DAY_YEAR.format(start);
  }
  if (IST_DAY_YEAR.format(start) === IST_DAY_YEAR.format(end)) {
    return IST_DAY_YEAR.format(start);
  }
  return `${IST_DAY.format(start)} – ${IST_DAY_YEAR.format(end)}`;
}

export function isFestLive(fest, nowMs) {
  const start = fest?.startsOn ? new Date(fest.startsOn).getTime() : null;
  const end = fest?.endsOn ? new Date(fest.endsOn).getTime() : null;
  if (start === null) {
    return false;
  }
  return start <= nowMs && (end === null || end >= nowMs);
}

/* ─────────────────────────────────────────────────────────────────────────
   "Your events" — turning two responses into one list.

   The events on the pass ARE the `eventEntry` entitlements: each one carries a
   populated `referenceId` with the event's name, venue, start and end. Nothing
   else has to be fetched for the list itself.
   ───────────────────────────────────────────────────────────────────────── */

const IST_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const IST_DAY_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
// 'en-CA' is the shortest route to a sortable, comparable 'YYYY-MM-DD' for a
// named timezone; it is used only to answer "is this the same IST day", never
// shown to anyone.
const IST_DAY_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Under this, the start time is drawn in the accent instead of the usual muted
// grey. Thirty minutes is roughly "stop reading your pass and start walking" at
// a campus fest; it is the whole of the urgency treatment — no banner, no
// alarm, no icon, because a red box on the screen holding your entry QR reads
// as "something is wrong with the pass".
const URGENT_WINDOW_MS = 30 * 60 * 1000;

function timeOf(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
}

/*
 * ATTENDED vs MISSED IS AN INFERENCE, and it is the only one on this screen.
 *
 * Nothing in the pass payload records attendance directly. The closest signal
 * is the entitlement's `usedCount`: it is incremented when a volunteer scans
 * this pass at that event's door. So `usedCount > 0` after the event has ended
 * is read as "you went", and `usedCount === 0` as "you missed it".
 *
 * That is a statement about SCANS, not about truth. A student who walked in
 * behind a friend, or whose scan failed and was waved through, shows as missed.
 * The UI therefore states the inference quietly — a tick or a cross in muted
 * grey, never a red "you missed this" — because the pass is not the register
 * and must not be argued with as though it were.
 */
export function deriveEventStatus(row, nowMs) {
  const start = timeOf(row?.startsAt);
  const end = timeOf(row?.endsAt);
  if (start !== null && start <= nowMs && (end === null || end >= nowMs)) {
    return 'live';
  }
  if (end !== null && end < nowMs) {
    return (row?.usedCount ?? 0) > 0 ? 'completed' : 'missed';
  }
  // No end and already started, or simply not begun: it is still ahead of you.
  return 'upcoming';
}

/*
 * The clock, with the day only when the day is not today. A multi-day fest puts
 * "10:00" against three different events on three different days, and at a gate
 * that is worse than no time at all; a same-day event does not need the date
 * repeated on every row.
 */
export function formatEventTime(startsAt, nowMs) {
  const start = timeOf(startsAt);
  if (start === null) {
    return '';
  }
  const sameDay = IST_DAY_KEY.format(new Date(start)) === IST_DAY_KEY.format(new Date(nowMs));
  return sameDay ? IST_TIME.format(start) : IST_DAY_TIME.format(start);
}

/*
 * The join. Events come from the entitlements; the TEAM NAME cannot — the
 * entitlement's populated event has no team on it — so it comes from
 * /registrations/mine, matched on `registration.eventId.id ===
 * entitlement.referenceId.id`. That request is already made by the pass screen
 * for its desktop panel and is reused rather than repeated.
 *
 * THE ROUND IS DELIBERATELY ABSENT. Rounds are modelled (Round.participantIds
 * exists) but every rounds route is behind `coordinatorOrAdmin`, so a student
 * asking which round they are in gets a 403. A participant-facing rounds
 * endpoint has to exist before this list can carry a round line; a placeholder
 * here would be a guess printed next to a real credential.
 */
export function buildPassEventRows(entitlements, registrations, nowMs) {
  const byEventId = new Map();
  (Array.isArray(registrations) ? registrations : []).forEach((registration) => {
    const eventId = registration?.eventId?.id;
    if (eventId) {
      byEventId.set(eventId, registration);
    }
  });

  return (Array.isArray(entitlements) ? entitlements : [])
    .filter(
      (entitlement) =>
        entitlement?.entitlementType === 'eventEntry' &&
        entitlement.referenceId &&
        typeof entitlement.referenceId === 'object',
    )
    .map((entitlement) => {
      const event = entitlement.referenceId;
      const registration = byEventId.get(event.id) ?? null;
      const status = deriveEventStatus(
        { startsAt: event.startsAt, endsAt: event.endsAt, usedCount: entitlement.usedCount },
        nowMs,
      );
      const start = timeOf(event.startsAt);
      return {
        id: entitlement.id ?? event.id,
        eventId: event.id,
        eventName: event.eventName ?? 'Event',
        venue: typeof event.venue === 'string' ? event.venue : '',
        startsAt: event.startsAt ?? null,
        startMs: start,
        status,
        // Only ever set on something that has not started; a live row already
        // says "Now" and a finished one has nothing left to be urgent about.
        isStartingSoon:
          status === 'upcoming' && start !== null && start - nowMs >= 0 && start - nowMs < URGENT_WINDOW_MS,
        timeLabel: status === 'live' ? 'Now' : formatEventTime(event.startsAt, nowMs),
        // A team event is one the student actually joined as a team. There is
        // no reliable team flag on the populated event, and the registration's
        // teamId is the fact that matters anyway: it is null for solo entries.
        teamName: registration?.teamId?.teamName ?? '',
        /*
         * The round the student should be heading to, resolved SERVER-SIDE and
         * handed over on the entitlement as `activeRound`.
         *
         * It is not derived here, and it could not be: rounds are child events,
         * and every rounds route is coordinator-or-admin, so a participant
         * cannot read them. The pass service now batches one lookup across all
         * event entitlements and picks by relevance — live now, else the next
         * upcoming, else the last completed — so this row only has to render
         * what it is given.
         */
        activeRound: entitlement.activeRound ?? null,
      };
    })
    .sort((a, b) => {
      // Chronological, next first. An event with no start time cannot be placed
      // in the sequence, so it goes last rather than pretending to be at epoch.
      if (a.startMs === null) return b.startMs === null ? 0 : 1;
      if (b.startMs === null) return -1;
      return a.startMs - b.startMs;
    });
}

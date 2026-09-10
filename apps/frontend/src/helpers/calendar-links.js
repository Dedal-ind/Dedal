// calendar-links.js
// The two "add to calendar" destinations for an event.
//
// Both are plain URLs — no Google Calendar API, no key, no quota. The Google
// link is the documented TEMPLATE deep link; the .ics comes from our own public
// endpoint, which builds the RFC 5545 file server-side.

const GOOGLE_CALENDAR_TEMPLATE_URL = 'https://calendar.google.com/calendar/event';

/*
 * Google's `dates` parameter wants the compact UTC form (20270301T100000Z),
 * which is the ISO string with the separators and milliseconds removed.
 */
function formatCalendarTimestamp(dateValue) {
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function buildDetails(event) {
  const parts = [];
  if (event.festId?.festName) {
    parts.push(`Part of ${event.festId.festName}.`);
  }
  parts.push('Your pass and registration details are in the Dedal app.');
  return parts.join(' ');
}

export function buildGoogleCalendarUrl(event) {
  if (!event?.startsAt || !event?.endsAt) {
    return null;
  }
  const startStamp = formatCalendarTimestamp(event.startsAt);
  const endStamp = formatCalendarTimestamp(event.endsAt);
  if (!startStamp || !endStamp) {
    return null;
  }
  const parameters = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.eventName ?? 'Event',
    dates: `${startStamp}/${endStamp}`,
    details: buildDetails(event),
  });
  if (event.venue) {
    parameters.set('location', event.venue);
  }
  return `${GOOGLE_CALENDAR_TEMPLATE_URL}?${parameters.toString()}`;
}

/*
 * The public .ics endpoint. Built from the API base URL rather than routed
 * through apiClient because this has to be an href the browser navigates to —
 * an XHR would hand us a string we would then have to turn back into a download.
 */
export function buildIcsUrl(eventId) {
  if (!eventId) {
    return null;
  }
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '';
  return `${apiBaseUrl.replace(/\/$/, '')}/events/${eventId}/calendar.ics`;
}

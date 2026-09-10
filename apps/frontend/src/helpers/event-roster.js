// event-roster.js
// Normaliser for GET /fests/:festId/events/:eventId/participants, which returns
// { individual, contingent, pendingInvites } (two ordered slices plus paid
// not-yet-accepted contingent invites). Screens that only need one flat list —
// scoring, brackets — flatten here in ONE place, each row keeping the
// registrationType the backend stamped on it.

export function flattenEventParticipants(rosterResponse) {
  if (Array.isArray(rosterResponse)) {
    // Legacy array shape (pre-contingent backend) — treat every row as individual.
    return { participants: rosterResponse, pendingInvites: [] };
  }
  return {
    participants: [
      ...(rosterResponse?.individual ?? []),
      ...(rosterResponse?.contingent ?? []),
    ],
    pendingInvites: rosterResponse?.pendingInvites ?? [],
  };
}

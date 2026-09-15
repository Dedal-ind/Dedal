// EventCrewContacts.jsx
// "Event contacts": the coordinators and volunteers covering ONE event, shown
// inline on the registration form, below the questions and above the button.
//
// TWO SOURCES, best first:
//   GET /fests/:festId/staff-directory?eventId=…  phone AND email, but only for
//       somebody who already holds a seat in the fest (403 otherwise).
//   GET /public/events/:eventId/staff-contacts    phone only, open to anyone —
//       the fallback for a first-time registrant.
// Neither failing may cost somebody the register button, so any error simply
// renders nothing. No crew → no section: no heading, no empty message.

import { useEffect, useState } from 'react';
import apiClient from '../../api-client/api-client.js';
import CrewRow from '../crew-row/CrewRow.jsx';
import { STAFF_ROLES } from '../crew-row/staff-roles.js';
import './event-crew-contacts.css';

async function loadCrew(festId, eventId) {
  if (festId) {
    try {
      const groups = await apiClient.get(
        `/fests/${festId}/staff-directory?eventId=${encodeURIComponent(eventId)}`,
      );
      if (Array.isArray(groups)) {
        // Hierarchy-aware on the server: a parent's crew can arrive under the
        // event's own group, so flatten and drop repeats.
        const seen = new Set();
        return groups
          .flatMap((group) => group.staff ?? [])
          .filter((person) => {
            const key = `${person.role}:${person.fullName}:${person.phoneNumber}:${person.emailAddress}`;
            if (seen.has(key)) {
              return false;
            }
            seen.add(key);
            return true;
          });
      }
    } catch {
      // No seat in the fest yet — fall through to the public list.
    }
  }
  const payload = await apiClient.get(`/public/events/${eventId}/staff-contacts`);
  return (Array.isArray(payload?.contacts) ? payload.contacts : []).map((contact) => ({
    fullName: contact.fullName,
    role: contact.role,
    phoneNumber: contact.contactPhone,
    emailAddress: null,
  }));
}

/* Coordinators first — they are the escalation point — then volunteers; each
   group alphabetical by name. */
function orderCrew(people) {
  const rank = (person) => (person.role === STAFF_ROLES.COORDINATOR ? 0 : 1);
  return [...people].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      String(left.fullName ?? '').localeCompare(String(right.fullName ?? ''), undefined, {
        sensitivity: 'base',
      }),
  );
}

function EventCrewContacts({ eventId, festId }) {
  const [crew, setCrew] = useState([]);

  useEffect(() => {
    if (!eventId) {
      return undefined;
    }
    let cancelled = false;
    loadCrew(festId, eventId)
      .then((people) => {
        if (!cancelled) {
          setCrew(orderCrew(people));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCrew([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, festId]);

  if (crew.length === 0) {
    return null;
  }

  return (
    <section className="drg-section dec-contacts" aria-labelledby="event-contacts-title">
      <h2 className="dec-contacts__title" id="event-contacts-title">
        Event contacts
      </h2>
      <div className="dec-contacts__list">
        {crew.map((person, index) => (
          // No per-person id in either payload; position within this list is stable.
          <CrewRow key={`${eventId}:${index}`} person={person} compact />
        ))}
      </div>
    </section>
  );
}

export default EventCrewContacts;

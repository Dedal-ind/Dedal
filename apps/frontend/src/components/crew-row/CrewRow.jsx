// CrewRow.jsx
// One coordinator or volunteer: name, role badge, and the icons that reach them.
// Shared by the crew directory and the registration form's event contacts.
//
// THE NUMBER AND THE ADDRESS ARE NEVER RENDERED AS TEXT, only as the icon that
// opens them. A phone number on screen is a phone number that gets screenshotted
// and forwarded; a `tel:` link does the one thing the reader actually wants.
//
// An action is HIDDEN when its field is null, not disabled. A greyed-out call
// button advertises a capability that does not exist.
//
// `compact`: the tighter row used inside a form (body 14 name, micro pill,
// 18px icons, still 44px touch targets) so a list of contacts does not push the
// form's action off screen.

import { Mail, Phone } from 'lucide-react';
import { STAFF_ROLES } from './staff-roles.js';
import '../../screens/crew-directory/crew-directory.css';
import './crew-row.css';

function CrewRow({ person, compact = false }) {
  const hasPhone = Boolean(person.phoneNumber);
  const hasEmail = Boolean(person.emailAddress);
  const roleLabel = person.role === STAFF_ROLES.COORDINATOR ? 'Coordinator' : 'Volunteer';
  const iconSize = compact ? 18 : 20;
  const name = person.fullName ?? 'this crew member';

  return (
    <div className={compact ? 'dcw-card dcw-card--compact' : 'dcw-card'}>
      <span className="dcw-card__body">
        <span className="dcw-card__name">{person.fullName ?? '—'}</span>
        <span className="dcw-role">{roleLabel}</span>
      </span>

      {hasEmail || hasPhone ? (
        <span className="dcw-card__actions">
          {hasPhone ? (
            <a className="dcw-action" href={`tel:${person.phoneNumber}`} aria-label={`Call ${name}`}>
              <Phone size={iconSize} aria-hidden="true" />
            </a>
          ) : null}
          {hasEmail ? (
            <a className="dcw-action" href={`mailto:${person.emailAddress}`} aria-label={`Email ${name}`}>
              <Mail size={iconSize} aria-hidden="true" />
            </a>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export default CrewRow;

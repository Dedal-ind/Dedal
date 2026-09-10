// PassCard.jsx
// THE credential. One component, two homes.
//
// It is extracted from QrPassScreen so the header's PassSheet can render the
// same object rather than a second, thinner interpretation of it. Before this,
// the sheet showed a QR, a fest name and a link — which is a *reference to* a
// pass, not a pass. Two renderings of the same credential is how a volunteer
// ends up saying "that's not what mine looks like" at a gate, and how a change
// to the card gets made in one place and missed in the other.
//
// PassSheet should import this and drop its own QR block; the sheet passes no
// `entitlements` (its /passes/mine/all response has none) and sets `compact`.
//
// It carries its own stylesheet import, so a caller gets the styles by
// importing the component — there is no second thing to remember.
//
// The palette is dark and hardcoded even on a light surface. qr-pass.css says
// why at length; the short version is that a QR plate which inherits a
// surface token becomes navy inside a dark subtree and stops being scannable.

import { useId, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  CheckCircleIcon,
  DismissIcon,
  EntitlementFallbackIcon,
  ExpandIcon,
  GateIcon,
  MealIcon,
  MerchIcon,
  OfferIcon,
  PassIcon,
  PrizeIcon,
  StayIcon,
  TeamIcon,
  VenueIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { buildMapsUrl } from '../../helpers/venue-map-link.js';
import { formatPassDateRange, isFestLive } from './pass-format.js';
import './qr-pass.css';

const COPY = {
  qrAlt: (festName) => `Entry QR code for ${festName}`,
  participant: 'Participant',
  liveNow: 'Live now',
  backupCode: 'Backup code',
  entitlements: 'What this pass covers',
  entitlementsNote:
    'One code for all of it. A volunteer scans this and sees everything below.',
  suspended: 'This pass is suspended. Speak to the fest desk before you queue.',
  revoked: 'This pass has been revoked and will not scan.',
  usedUp: 'Used',
  remaining: (left, total) => `${left} of ${total} left`,
  events: 'My events',
  eventsScroll: 'My events. Scrollable list.',
  expandHint: (eventName) => `Details for ${eventName}`,
  directions: 'Directions',
  team: (teamName) => `Team ${teamName}`,
  /* "Semi-final, live now" / "Final, up next" / "Heats, finished". The status
     is words rather than a coloured dot: this panel is read at a gate, often
     one-handed, and a second colour code beside the row's own status dot would
     be two things to decode instead of one sentence. */
  round: (name, status) => {
    if (status === 'live') return `${name}, live now`;
    if (status === 'completed') return `${name}, finished`;
    return `${name}, up next`;
  },
};

/*
 * The status word behind each glyph. A dot is not a word, and every one of
 * these four states is something a person may need read to them — "did I
 * already do that one" is a real question halfway through a fest.
 */
const EVENT_STATUS_LABELS = {
  upcoming: 'Upcoming',
  live: 'Happening now',
  completed: 'You scanned in',
  missed: 'No scan recorded',
};

/*
 * SEVEN entitlement types, not three. The list is pass-constants.js and it has
 * grown twice; a type with no icon renders a row that looks broken rather than
 * one that looks unfamiliar, so the map is total and the fallback is a plain
 * parcel — "you are entitled to something we do not have a picture for" — which
 * is honest and legible, unlike reusing the ticket for everything.
 */
const ENTITLEMENT_ICONS = {
  gateAccess: GateIcon, // a door: the thing it actually opens
  eventEntry: PassIcon, // a ticket, one per event
  offerClaim: OfferIcon, // a shopping bag: a booked add-on of any kind
  meal: MealIcon, // cutlery
  accommodationNight: StayIcon, // a bed, per night
  merch: MerchIcon, // a t-shirt, which is what merch is at a college fest
  prizeClaim: PrizeIcon, // a trophy, collected at the desk
};

const ENTITLEMENT_LABELS = {
  gateAccess: 'Campus entry',
  eventEntry: 'Event entry',
  offerClaim: 'Add-on',
  meal: 'Meal',
  accommodationNight: 'Accommodation',
  merch: 'Merchandise',
  prizeClaim: 'Prize collection',
};

// "367939" → "367 939". Two groups, read aloud across a desk without either
// person losing their place.
function groupBackupCode(code) {
  if (!code) {
    return '';
  }
  return (String(code).match(/.{1,3}/g) ?? [code]).join(' ');
}

function readCollegeName(fest, user) {
  const host = fest?.hostCollegeId;
  if (host && typeof host === 'object') {
    return host.commonName ?? host.collegeName ?? '';
  }
  const own = user?.collegeId;
  if (own && typeof own === 'object') {
    return own.commonName ?? own.collegeName ?? '';
  }
  return '';
}

function entitlementName(entitlement) {
  if (entitlement.entitlementType === 'eventEntry' && entitlement.referenceId?.eventName) {
    return entitlement.referenceId.eventName;
  }
  if (entitlement.entitlementType === 'offerClaim') {
    return entitlement.offerName ?? ENTITLEMENT_LABELS.offerClaim;
  }
  return ENTITLEMENT_LABELS[entitlement.entitlementType] ?? entitlement.entitlementType;
}

// The second line: what makes an "Event entry" row tell you WHICH door.
function entitlementDetail(entitlement) {
  const event = entitlement.entitlementType === 'eventEntry' ? entitlement.referenceId : null;
  if (event && typeof event === 'object') {
    return [ENTITLEMENT_LABELS.eventEntry, event.venue].filter(Boolean).join(' · ');
  }
  if (entitlement.entitlementType === 'gateAccess') {
    return 'Every day of the fest';
  }
  return '';
}

function EntitlementRow({ entitlement }) {
  const Icon = ENTITLEMENT_ICONS[entitlement.entitlementType] ?? EntitlementFallbackIcon;
  /*
   * maximumUses === null is UNCAPPED, not zero. Gate access is the case: you may
   * walk in and out of campus all week. Rendering that as "0 of null left" is
   * the bug this branch exists to prevent, so the test is for null/undefined
   * explicitly rather than falsiness.
   */
  const isCapped = entitlement.maximumUses !== null && entitlement.maximumUses !== undefined;
  const remaining = isCapped
    ? Math.max(0, entitlement.maximumUses - (entitlement.usedCount ?? 0))
    : null;
  const detail = entitlementDetail(entitlement);

  return (
    <li className="dqp-ent">
      <span className="dqp-ent__icon">
        <Icon size="md" />
      </span>
      <span className="dqp-ent__body">
        <span className="dqp-ent__label">{entitlementName(entitlement)}</span>
        {detail ? <span className="dqp-ent__meta">{detail}</span> : null}
      </span>
      {isCapped ? (
        <span
          className={
            remaining > 0 ? 'dqp-ent__count' : 'dqp-ent__count dqp-ent__count--spent'
          }
        >
          {remaining > 0 ? COPY.remaining(remaining, entitlement.maximumUses) : COPY.usedUp}
        </span>
      ) : (
        /* Uncapped. A tick rather than a number, with the word behind it for
           anyone reading by ear — an icon alone says nothing to a screen
           reader, and "unlimited" is exactly the fact being conveyed. */
        <span className="dqp-ent__tick">
          <CheckCircleIcon size="md" />
          <span className="dqp-sr">No limit</span>
        </span>
      )}
    </li>
  );
}

/*
 * ONE ROW of the events list. A real <button> wrapping the whole row rather
 * than a div with an onClick: the row IS the control, so it must be the thing
 * that takes focus, announces `aria-expanded`, and responds to Enter and Space
 * without any of that being re-implemented here.
 *
 * The expand is deliberately small. Someone reading this is standing at a gate,
 * not browsing a programme, so tapping a row reveals the two or three facts
 * that get them to the door — where it is, and who they are with — and never
 * navigates away from the credential they are holding up.
 */
function PassEventRow({ row, isExpanded, onToggle }) {
  const panelId = `dqp-event-panel-${row.id}`;
  const mapsUrl = buildMapsUrl(row.venue);
  const timeClass = row.isStartingSoon
    ? 'dqp-event__time dqp-event__time--soon'
    : 'dqp-event__time';

  return (
    <li className={row.status === 'live' ? 'dqp-event dqp-event--live' : 'dqp-event'}>
      <button
        type="button"
        className="dqp-event__row"
        aria-expanded={isExpanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="dqp-event__status" aria-hidden="true">
          {row.status === 'completed' ? <CheckCircleIcon size="sm" /> : null}
          {row.status === 'missed' ? <DismissIcon size="sm" /> : null}
          {row.status === 'live' || row.status === 'upcoming' ? (
            <span
              className={
                row.status === 'live' ? 'dqp-event__dot dqp-event__dot--live' : 'dqp-event__dot'
              }
            />
          ) : null}
        </span>
        <span className="dqp-event__body">
          <span className="dqp-event__name">{row.eventName}</span>
          <span className="dqp-event__meta">
            {row.timeLabel ? <span className={timeClass}>{row.timeLabel}</span> : null}
            {row.venue ? <span className="dqp-event__venue">{row.venue}</span> : null}
          </span>
        </span>
        <span className="dqp-sr">
          {EVENT_STATUS_LABELS[row.status]}. {COPY.expandHint(row.eventName)}
        </span>
        <span
          className={
            isExpanded ? 'dqp-event__chevron dqp-event__chevron--open' : 'dqp-event__chevron'
          }
          aria-hidden="true"
        >
          <ExpandIcon size="sm" />
        </span>
      </button>

      {/* Plain show/hide, no height animation. This screen has no motion in it
          and a small inline expand is not the exception that earns one. */}
      {isExpanded ? (
        <div className="dqp-event__panel" id={panelId}>
          {row.venue ? (
            <p className="dqp-event__fact">
              <VenueIcon size="sm" />
              {/* buildMapsUrl returns null for an empty or whitespace venue, and
                  a link into an empty Maps search is worse than no link — so the
                  venue degrades to plain text rather than to a dead anchor. */}
              {mapsUrl ? (
                <a
                  className="dqp-event__link"
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {row.venue}
                  <span className="dqp-event__link-note">{COPY.directions}</span>
                </a>
              ) : (
                <span>{row.venue}</span>
              )}
            </p>
          ) : null}
          {row.teamName ? (
            <p className="dqp-event__fact">
              <TeamIcon size="sm" />
              <span>{COPY.team(row.teamName)}</span>
            </p>
          ) : null}
          {/*
            THE ROUND. This used to be absent with a comment explaining that it
            could not exist: rounds are child events and every rounds route is
            coordinator-or-admin, so a participant could not read their own.
            The pass service now resolves it server-side and hands it over on
            the entitlement, so the student finally learns WHERE TO STAND — the
            one thing a multi-round event never told them.

            The status word is included because "Semi-final" alone does not say
            whether it is running; at a gate that is the difference between
            walking in and waiting.
          */}
          {row.activeRound?.eventName ? (
            <p className="dqp-event__fact">
              <ExpandIcon size="sm" />
              <span>
                {COPY.round(row.activeRound.eventName, row.activeRound.status)}
                {row.activeRound.venue && row.activeRound.venue !== row.venue ? (
                  <span className="dqp-event__link-note">{row.activeRound.venue}</span>
                ) : null}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/*
 * THE EVENTS LIST — one implementation, two homes, exactly like PassCard.
 *
 * The pass screen builds this element ONCE and hands it either to PassCard (on
 * a phone, where it renders inside the card beneath the perforation) or to the
 * desktop panel, which is where the old "Your events at this fest" list used to
 * live. That older list is gone: it was fed by /registrations/mine, said
 * strictly less than this one, and keeping both would have put two answers to
 * "what am I registered for" on one screen from two sources of truth.
 *
 * `variant` chooses chrome only — `card` adds the in-card scroll region the CSS
 * describes, `panel` does not, because the desktop column has the room and an
 * inner scroller inside a half-empty column is just a trap.
 *
 * Absent, not empty: a student with gate access and no event entries gets no
 * heading and no empty state. There is nothing to tell them here.
 */
export function PassEventList({ rows, variant = 'card' }) {
  const headingId = useId();
  // ONE row open at a time. An accordion rather than independent toggles: the
  // point of the in-card scroller is that the credential stays on screen, and
  // three rows expanded at once defeats it.
  const [expandedId, setExpandedId] = useState(null);

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const list = (
    <ul className="dqp-events__list">
      {rows.map((row) => (
        <PassEventRow
          key={row.id}
          row={row}
          isExpanded={expandedId === row.id}
          onToggle={() => setExpandedId((current) => (current === row.id ? null : row.id))}
        />
      ))}
    </ul>
  );

  return (
    <section
      className={variant === 'panel' ? 'dqp-events dqp-events--panel' : 'dqp-events'}
      aria-labelledby={headingId}
    >
      <h3 className="dqp-section__title" id={headingId}>
        {COPY.events}
      </h3>
      {variant === 'panel' ? (
        list
      ) : (
        /* The scroll region is tabbable and labelled. A scroll container that
           cannot take focus cannot be scrolled without a pointer, and the rows
           inside it are buttons, so focus moving into them scrolls the region
           anyway — this is the entry point for someone who wants to read the
           list before choosing a row. */
        <div className="dqp-events__scroll" tabIndex={0} role="group" aria-label={COPY.eventsScroll}>
          {list}
        </div>
      )}
    </section>
  );
}

/*
 * `entitlements` is optional. The sheet's list endpoint does not return them,
 * and a heading over an empty box is worse than no heading, so the section is
 * absent from the DOM rather than rendered empty.
 */
function PassCard({
  pass,
  fest,
  user,
  entitlements = null,
  compact = false,
  /* The events list, already built by the caller, or null. A SLOT rather than
     something the card assembles for itself, because on desktop that very same
     element is rendered in the right-hand panel instead — see PassEventList.
     PassSheet passes nothing, so its compact card is byte-for-byte what it
     was. */
  eventsSlot = null,
  /* No Date.now() default: reading the clock during render makes the "live now"
     badge answer differently on two renders of identical data. Callers stamp it
     once (both do), and without one the badge is simply absent. */
  nowMs = null,
  cardRef = null,
  onPointerDown = undefined,
  onPointerMove = undefined,
  onPointerUp = undefined,
  onPointerCancel = undefined,
}) {
  if (!pass || !fest) {
    return null;
  }

  const collegeName = readCollegeName(fest, user);
  const dateRange = formatPassDateRange(fest.startsOn, fest.endsOn);
  const live = typeof nowMs === 'number' && isFestLive(fest, nowMs);
  const qrSize = compact ? 208 : 240;
  const shownEntitlements = Array.isArray(entitlements) ? entitlements : [];

  return (
    <div
      ref={cardRef}
      className={compact ? 'dqp-card dqp-card--compact' : 'dqp-card'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="dqp-card__head">
        <h2 className="dqp-card__fest">{fest.festName}</h2>
        {collegeName ? <p className="dqp-card__host">{collegeName}</p> : null}
        {dateRange && !compact ? <p className="dqp-card__dates">{dateRange}</p> : null}
        {live ? (
          <span className="dqp-card__live">
            <span className="dqp-card__live-dot" aria-hidden="true" />
            {COPY.liveNow}
          </span>
        ) : null}
      </div>

      <div className="dqp-card__rule" />

      <div className="dqp-card__who">
        <p className="dqp-card__name">{user?.fullName ?? COPY.participant}</p>
        {user?.participantId ? <p className="dqp-card__id">{user.participantId}</p> : null}
        {/* A marshal settling a dispute needs a way to identify the holder, and
            the emailed pass carries the same fields. Trimmed in the sheet,
            where there is not room and the holder is the one looking. */}
        {!compact && user?.emailAddress ? (
          <p className="dqp-card__contact">{user.emailAddress}</p>
        ) : null}
      </div>

      <div className="dqp-plate">
        <div className="dqp-plate__inner">
          {pass.qrToken ? (
            <QRCodeSVG
              value={pass.qrToken}
              size={qrSize}
              level="H"
              marginSize={2}
              fgColor="#000000"
              bgColor="#FFFFFF"
              role="img"
              aria-label={COPY.qrAlt(fest.festName)}
            />
          ) : null}
        </div>
      </div>

      <div className="dqp-tear" aria-hidden="true" />

      <div className="dqp-code">
        <span className="dqp-code__label">{COPY.backupCode}</span>
        <span className="dqp-code__value">{groupBackupCode(pass.backupCode)}</span>
      </div>

      {pass.status === 'suspended' ? (
        <p className="dqp-card__blocked" role="status">
          {COPY.suspended}
        </p>
      ) : null}
      {pass.status === 'revoked' ? (
        <p className="dqp-card__blocked" role="status">
          {COPY.revoked}
        </p>
      ) : null}

      {shownEntitlements.length > 0 ? (
        <>
          <h3 className="dqp-section__title">{COPY.entitlements}</h3>
          <p className="dqp-section__note">{COPY.entitlementsNote}</p>
          <ul className="dqp-ent-list">
            {shownEntitlements.map((entitlement, index) => (
              <EntitlementRow key={entitlement.id ?? index} entitlement={entitlement} />
            ))}
          </ul>
        </>
      ) : null}

      {/* Below the entitlements summary: the entitlements say what this one QR
          is good for, this says where to be and when. */}
      {eventsSlot}
    </div>
  );
}

export default PassCard;

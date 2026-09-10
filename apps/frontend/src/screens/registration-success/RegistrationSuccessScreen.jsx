// RegistrationSuccessScreen.jsx
// Route: /registration-success/:registrationId — the last step of the
// registration flow and the moment the whole flow exists to produce.
//
// THIS IS NOT A RECEIPT. Somebody who has just registered wants three things,
// in this order: proof it worked, the thing they now hold, and the way onward.
// So the screen is a drawn checkmark, a ticket, who paid for the fest, and two
// buttons. The reference material (the registration id, the amount) is not a
// section of its own any more — it is the stub half of the ticket, which is
// where a person already expects to look for a booking reference.
//
// Data: GET /registrations/:id (populated with event, fest and team), plus a
// side-load of the fest pass from GET /passes/mine. That side-load is allowed
// to fail and its failure means nothing — see the pass line below.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import gsap from 'gsap';
import apiClient from '../../api-client/api-client.js';
import { formatShortDate, formatClockTime, formatPaiseAmount } from '../../helpers/event-format.js';
import { REGISTRATION_SUCCESS_COPY } from '../../brand/brand-copy.js';
import { buildGoogleCalendarUrl, buildIcsUrl } from '../../helpers/calendar-links.js';
import { buildMapsUrl } from '../../helpers/venue-map-link.js';
import { eventPageSponsor } from '../../helpers/sponsor-hierarchy.js';
import {
  DateIcon,
  VenueIcon,
  TeamIcon,
  RetryIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import '../../design/registration.css';
import './registration-success.css';

/*
 * THE CHECKMARK — the one animated thing on the screen.
 *
 * Hand-built as an inline <svg> rather than taken from DetailIcons, because a
 * lucide component renders a finished glyph: there is no way to reach its two
 * subpaths and give the circle and the tick separate lengths, and the whole
 * point here is that the mark DRAWS. Circle over 400ms, tick starting 200ms
 * later, once, then static forever. Nothing loops — a success page that keeps
 * moving reads as a page still working.
 *
 * The mark is rendered COMPLETE in the markup, and the animation, if it runs at
 * all, rewinds it to zero and plays it forward inside a layout effect. That
 * ordering is deliberate: under prefers-reduced-motion, and equally if gsap
 * fails or JS throws before the effect, what is on screen is a finished
 * checkmark rather than an empty circle. The mark is information — it is the
 * sentence "this worked" — so it may be unanimated but must never be absent.
 */
function DrawnCheck() {
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      return undefined;
    }
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }
    const circle = root.querySelector('.drs-check__circle');
    const tick = root.querySelector('.drs-check__tick');

    // Measured, not guessed: getTotalLength is exact for the rendered geometry,
    // so the dash covers the path exactly however the SVG is scaled.
    const circleLength = circle.getTotalLength();
    const tickLength = tick.getTotalLength();

    const timeline = gsap.timeline();
    timeline
      .fromTo(
        circle,
        { strokeDasharray: circleLength, strokeDashoffset: circleLength },
        { strokeDashoffset: 0, duration: 0.4, ease: 'power2.out' },
      )
      .fromTo(
        tick,
        { strokeDasharray: tickLength, strokeDashoffset: tickLength },
        { strokeDashoffset: 0, duration: 0.28, ease: 'power2.out' },
        // 200ms after the circle STARTS, so the tick lands while the ring is
        // still closing and the two read as one gesture rather than two.
        0.2,
      );

    /*
     * progress(1) BEFORE kill(), and this is not a formality.
     *
     * gsap.kill() stops a tween exactly where it is and leaves the inline
     * styles at that frozen value. Measured in the browser: two seconds after
     * load the circle sat at strokeDashoffset 63 of 156 and the tick at 31 of
     * 31 — a permanently half-drawn ring and no tick at all. React StrictMode
     * mounts, cleans up and mounts again in development, and the pass side-load
     * re-renders this subtree on top of that, so a teardown mid-tween is the
     * normal case rather than an edge one.
     *
     * Jumping to the end first means every teardown path leaves a COMPLETE
     * mark, which is what this component promises above: the checkmark is the
     * sentence "this worked", so it may arrive unanimated but must never be
     * left unfinished.
     */
    return () => {
      timeline.progress(1);
      timeline.kill();
    };
  }, []);

  return (
    <svg
      ref={rootRef}
      className="drs-check"
      viewBox="0 0 56 56"
      width="56"
      height="56"
      fill="none"
      role="img"
      aria-label="Registration confirmed"
    >
      <circle className="drs-check__circle" cx="28" cy="28" r="25" />
      <path className="drs-check__tick" d="M17 28.5 L24.5 36 L39 21.5" />
    </svg>
  );
}

/*
 * The copy control's glyph, both halves of the morph in one 16px box. Not from
 * DetailIcons — that module has neither a copy nor a check mark, and it is not
 * this change's to extend — so the two paths live here at the same 1.8 stroke
 * weight the shared icons use, so they do not read as a second icon set.
 */
function CopyGlyph({ copied }) {
  return (
    <svg
      className="drs-copy__glyph"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {copied ? (
        <path d="M20 6 L9 17 L4 12" />
      ) : (
        <>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
        </>
      )}
    </svg>
  );
}

function RegistrationSuccessScreen() {
  const navigate = useNavigate();
  const { registrationId } = useParams();

  const [registration, setRegistration] = useState(null);
  const [passPayload, setPassPayload] = useState(null);
  const [loadState, setLoadState] = useState('loading');
  const [hasCopiedId, setHasCopiedId] = useState(false);
  /*
   * OTHER EVENTS AT THIS FEST.
   *
   * "Explore more events" is a button that asks somebody to go looking. At the
   * one moment they are most willing to enter a second thing, showing three
   * actual events is worth more than a link to a list — and on a wide screen it
   * is what turns the second column into content rather than margin.
   *
   * Fire-and-forget, exactly like the pass side-load: a failure here costs a
   * suggestion, never the confirmation the page exists to deliver.
   */
  const [siblingEvents, setSiblingEvents] = useState([]);
  const copyResetTimerRef = useRef(null);

  const loadRegistration = useCallback(async () => {
    setLoadState('loading');
    try {
      const detail = await apiClient.get(`/registrations/${registrationId}`);
      setRegistration(detail);
      setLoadState('ready');

      const festId = detail.eventId?.festId?.id;
      if (festId) {
        apiClient
          .get(`/public/fests/${festId}/events?includeChildren=true`)
          .then((tree) => {
            const all = Array.isArray(tree) ? tree : [];
            setSiblingEvents(
              all
                // Registerable only (a container is not something you enter),
                // never this event again, and never one that is already shut.
                .filter(
                  (candidate) =>
                    candidate.category &&
                    candidate.id !== detail.eventId?.id &&
                    candidate.registrationStatus !== 'closed',
                )
                .slice(0, 3),
            );
          })
          .catch(() => setSiblingEvents([]));

        apiClient
          .get(`/passes/mine?festId=${festId}`)
          .then((passResult) => setPassPayload(passResult))
          .catch(() => setPassPayload(null));
      }
    } catch {
      setLoadState('error');
    }
  }, [registrationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRegistration();
  }, [loadRegistration]);

  // A component that unmounts inside the 1.5s morph would otherwise set state
  // on a tree that is gone.
  useEffect(() => () => clearTimeout(copyResetTimerRef.current), []);

  if (loadState === 'loading') {
    return (
      <div className="drg-screen drs-screen drg-screen--success">
        <div className="drg-col drs-skeletons">
          <div className="drg-skel" style={{ height: '56px', width: '56px' }} />
          <div className="drg-skel" style={{ height: '32px', width: '60%' }} />
          <div className="drg-skel" style={{ height: '220px' }} />
        </div>
      </div>
    );
  }

  if (loadState === 'error' || !registration) {
    return (
      <div className="drg-screen drs-screen drg-screen--success">
        <div className="drg-col">
          <div className="drg-state drg-state--error">
            <p className="drg-state__text">{REGISTRATION_SUCCESS_COPY.errorMessage}</p>
            <button type="button" className="drg-button drg-button--quiet" onClick={loadRegistration}>
              <RetryIcon size="sm" />
              <span className="drg-button__label">Try again</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const event = registration.eventId ?? {};
  const fest = event.festId ?? {};
  const team = registration.teamId ?? null;
  const isPaid = (registration.totalFeePaise ?? 0) > 0;
  const festId = fest.id;
  const mapsUrl = buildMapsUrl(event.venue);
  const googleCalendarUrl = buildGoogleCalendarUrl(event);
  const icsUrl = buildIcsUrl(event.id);

  /*
   * THE PASS, and the only claim on this screen that could be dishonest.
   *
   * `pass.qrToken` in hand is the only evidence a pass exists. The side-load is
   * still in flight on first paint and is allowed to fail outright, and NEITHER
   * of those is evidence that a pass is missing — so the other branch is worded
   * "being issued", which is true while we are waiting, true if the request
   * failed, and true if it genuinely has not been cut yet. It never claims the
   * pass is absent and never promises a code we cannot produce.
   */
  const isPassIssued = Boolean(passPayload?.pass?.qrToken);

  /*
   * SPONSOR. This used to fire a second request through useFestSponsors, for
   * data the screen was already fetching: /passes/mine returns the whole fest
   * document, sponsors included. So the sponsor now reads off the pass payload
   * and there is no second call. When the side-load fails there is simply no
   * sponsor — a logo is not worth a network request on the screen a person is
   * staring at, and the pass line above already absorbs that same failure.
   *
   * The tier hierarchy is not re-derived: eventPageSponsor owns it. The
   * category ancestor is genuinely unknown here (a registration carries the
   * event, not the vertical it hangs under), and null is the correct argument —
   * it falls back to the fest's own top sponsor, which is what this placement is
   * worth anyway.
   */
  const sponsor = eventPageSponsor(event, null, passPayload?.fest)?.sponsor ?? null;

  /*
   * Itemised money, and only where itemising says something the total does not.
   * A free booking has one ₹0 "Registration" line and a plain single-fee
   * booking has one priced line; printing a one-row table under a number that
   * already says the same thing is receipt behaviour on a page that is not a
   * receipt. Two or more priced lines — a fee plus meals, a fee plus
   * accommodation — is the case where a lone total leaves somebody wondering
   * what exactly they were charged for.
   */
  const pricedLines = (registration.feeBreakdown ?? []).filter((line) => line.subtotalPaise > 0);
  const showsBreakdown = isPaid && pricedLines.length > 1;

  /*
   * The registration's mongo _id IS the identifier a coordinator searches on:
   * the admin registrations CSV exports exactly this value as `registrationId`.
   * participantId identifies the PERSON across the whole fest rather than this
   * booking, so using it here would leave disputes with two competing
   * references. One identifier only.
   */
  function handleCopyRegistrationId() {
    navigator.clipboard
      ?.writeText(registration.id)
      .then(() => {
        setHasCopiedId(true);
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = setTimeout(() => setHasCopiedId(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <div className="drg-screen drs-screen drg-screen--success">
      {/*
        TWO COLUMNS ON DESKTOP, ONE ON MOBILE — and the DOM order IS the mobile
        reading order, so the desktop grid only places what is already in the
        right sequence. Left is the confirmation itself (mark, headline, pass
        line, ticket); right is what to do next (sponsor, actions, calendar,
        other events at this fest).

        This screen was originally specified as a single 480px column, with "no
        empty side space — the narrow column IS the design". On a 1280px window
        that left roughly 800px of nothing on either side, which reads as an
        unfinished page rather than a deliberately quiet one. The answer is not
        a wider column of the same content — stretching the measure makes the
        ticket and the prose worse — it is a second column carrying something
        actually worth reading.
      */}
      <div className="drg-col drs-grid">
        <div className="drs-lead">
        {/*
          The checkmark REPLACES the old .drg-confirm-stroke here rather than
          sitting above it. Both were the same sentence — "it worked" — drawn in
          --primary within the same second, and running them together gave the
          moment two competing confirmations at opposite ends of the viewport.
          The stroke survives on the other screens in the flow, which have no
          checkmark; here the mark is the better carrier because it is where the
          eye already is, and it stays on the page instead of fading out after
          1.2 seconds.
        */}
        {/*
          Mark, headline and status line are ONE centred unit rather than a
          centred icon sitting above left-aligned text. They are three short
          lines that belong together; splitting their alignment made the mark
          look misplaced rather than deliberate.
        */}
        <div className="drs-celebrate">
          <div className="drs-mark">
            <DrawnCheck />
          </div>

          <h1 className="drs-headline">You&rsquo;re in</h1>

          {/* Step 4's one line. The whole two-block, four-paragraph pass
              explanation collapsed to this; the pass screen explains the pass. */}
          <p className={`drs-passline${isPassIssued ? '' : ' drs-passline--pending'}`}>
            {isPassIssued ? 'Your pass is ready' : 'Your fest pass is being issued'}
          </p>
        </div>

        {/*
          THE TICKET. Poster, event, when and where above the perforation; the
          stub — reference and amount — below it, which is exactly where anybody
          who has ever held a ticket looks for those two things.
        */}
        <section className="drs-ticket" aria-label="Your ticket">
          <div className="drs-ticket__top">
            <div className="drs-ticket__head">
              {event.posterImageUrl ? (
                <span className="drs-poster">
                  <img src={event.posterImageUrl} alt="" />
                </span>
              ) : null}
              <span className="drs-ticket__names">
                <span className="drs-event">{event.eventName}</span>
                {fest.festName ? <span className="drs-fest">{fest.festName}</span> : null}
              </span>
            </div>

            <p className="drs-fact">
              <span className="drs-fact__icon">
                <DateIcon size="sm" />
              </span>
              <span>
                {formatShortDate(event.startsAt)}, {formatClockTime(event.startsAt)}
              </span>
            </p>
            {event.venue ? (
              <p className="drs-fact">
                <span className="drs-fact__icon">
                  <VenueIcon size="sm" />
                </span>
                {mapsUrl ? (
                  <a
                    className="drs-fact__link"
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {event.venue}
                  </a>
                ) : (
                  <span>{event.venue}</span>
                )}
              </p>
            ) : null}

            {/*
              A captain's team is not reference material. The invite code is
              somebody ELSE'S next step and the only thing on this screen that
              expires in usefulness, so it stays above the perforation with the
              event it belongs to rather than in the stub.
            */}
            {team ? (
              <p className="drs-fact">
                <span className="drs-fact__icon">
                  <TeamIcon size="sm" />
                </span>
                <span>
                  {team.teamName}
                  {team.inviteCode ? (
                    <>
                      {', invite code '}
                      <span className="drs-mono">{team.inviteCode}</span>
                    </>
                  ) : null}
                </span>
              </p>
            ) : null}
          </div>

          <div className="drs-ticket__perf" aria-hidden="true" />

          {/*
            THE STUB IS TWO STACKED ROWS, not two columns.
            Side by side, the 24-character id and the amount fought for the same
            ~278px of a small phone: the id wrapped to two lines, the copy glyph
            floated between them, and the amount was pushed so hard against the
            right padding that it read as touching the card edge. Stacked, each
            gets the full width and neither has to compromise.
          */}
          <div className="drs-ticket__stub">
            <div className="drs-stub__block">
              <span className="drs-stub__label">Registration id</span>
              {/*
                Field and button WELDED into one control — a shared border with
                the radius split between them — so it reads as a single copyable
                unit rather than a string with a button parked next to it. The
                id is not truncated: somebody reads this aloud to a coordinator
                at a help desk, and a middle ellipsis would break exactly that.
              */}
              <span className="drs-stub__id">
                <span className="drs-mono drs-stub__value">{registration.id}</span>
                {/*
                  The whole copy interaction is this icon target. No label, no
                  text swap — the glyph becomes a check for 1.5s and returns.
                  Which is invisible to a screen reader, so the RESULT is spoken
                  by the polite live region below instead; the button's own
                  accessible name never changes, so nothing re-announces the
                  control itself while the morph is on screen.
                */}
                <button
                  type="button"
                  className="drs-copy"
                  onClick={handleCopyRegistrationId}
                  aria-label="Copy registration id"
                >
                  <CopyGlyph copied={hasCopiedId} />
                </button>
              </span>
            </div>

            <div className="drs-stub__block drs-stub__block--amount">
              <span className="drs-stub__label">{isPaid ? 'Paid' : 'Amount'}</span>
              <span className="drs-stub__amount">
                {isPaid ? formatPaiseAmount(registration.totalFeePaise) : 'Free'}
              </span>
              {showsBreakdown ? (
                <span className="drs-breakdown">
                  {pricedLines.map((line) => (
                    <span
                      className="drs-breakdown__line"
                      key={`${line.label}-${line.subtotalPaise}`}
                    >
                      <span>
                        {line.label}
                        {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                      </span>
                      <span className="drs-mono">{formatPaiseAmount(line.subtotalPaise)}</span>
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {/* The copy result, for people who cannot see a 16px glyph change
            shape. Always in the tree so the region is live before it fills. */}
        <p className="drs-live" role="status" aria-live="polite">
          {hasCopiedId ? 'Registration id copied' : ''}
        </p>

        </div>

        <div className="drs-aside">
        {/* Sponsors sit with the ticket they paid for rather than at the very
            bottom of the page, where nobody ever arrived. Visibility, not a
            call to action — so a pill, not a section. */}
        {sponsor ? (
          <p className="drs-sponsor">
            <span className="drs-sponsor__label">Sponsored by</span>
            <span className="drs-sponsor__box">
              <img src={sponsor.imageUrl} alt={sponsor.sponsorName} loading="lazy" />
            </span>
          </p>
        ) : null}

        <div className="drs-actions">
          {/*
            The QR and the backup code are NOT on this screen any more. The QR
            was the largest object on a page whose job is to say "it worked",
            and a code somebody needs at a gate three days from now belongs
            where they can find it AGAIN — not on a URL they reached once at the
            end of a form and will never navigate back to. /my-passes is that
            place, it already renders both, and it is one tap from here.
          */}
          <button
            type="button"
            className="drg-button drs-view-pass"
            onClick={() => navigate(festId ? `/my-passes/${festId}` : '/my-passes')}
          >
            <span className="drg-button__label">View pass</span>
          </button>
          <Link className="drg-button drg-button--quiet" to="/">
            <span className="drg-button__label">Explore more events</span>
          </Link>
        </div>

        {/*
          Add to calendar, rebuilt in this screen's own classes rather than
          rendering <AddToCalendar />: that component is shared with a screen
          this change does not own and carries the retired palette (and a
          Material Symbols ligature) internally, so restyling it here would
          either leak the old look onto this screen or change a screen that is
          not mine. The hrefs come from the same helpers it uses, so the
          behaviour — a real Google link, a real .ics download from the public
          endpoint — is identical. No heading: two pills that say "Google
          Calendar" and "Download .ics" do not need to be told they are a
          calendar section.
        */}
        {googleCalendarUrl && icsUrl ? (
          <div className="drs-calendar">
            <a
              className="drs-calendar__link"
              href={googleCalendarUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <DateIcon size="sm" />
              {/*
                "Google", not CALENDAR_COPY.googleCalendar ("Google Calendar").
                Measured at 310px these pills are 135px wide, and the full
                strings wrapped onto two lines inside a 44px control. The shared
                copy is left alone because AddToCalendar and the event page put
                it under a "Add to calendar" heading where the long form reads
                correctly; here the heading is gone by design, so the icon plus
                one word carries it.
              */}
              Google
            </a>
            {/* `download` is only a hint cross-origin — the endpoint's
                Content-Disposition is what actually forces the save. */}
            <a className="drs-calendar__link" href={icsUrl} download>
              <DateIcon size="sm" />
              .ics
            </a>
          </div>
        ) : null}

        {/*
          Three more events from the same fest. This is the content that makes
          the second column worth having: at the moment somebody has just
          committed to one thing they are more likely to enter a second than at
          any other point, and a list of real events beats a button that asks
          them to go and look. Renders nothing when the lookup failed or the
          fest has nothing else open, so a quiet fest never shows an empty
          heading.
        */}
        {siblingEvents.length > 0 ? (
          <section className="drs-more">
            <h2 className="drs-more__title">More at {fest.festName || 'this fest'}</h2>
            <ul className="drs-more__list">
              {siblingEvents.map((other) => (
                <li key={other.id}>
                  <Link className="drs-more__item" to={`/events/${other.eventSlug}`}>
                    <span className="drs-more__thumb" aria-hidden="true">
                      {other.posterImageUrl ? (
                        <img src={other.posterImageUrl} alt="" loading="lazy" />
                      ) : null}
                    </span>
                    <span className="drs-more__text">
                      <span className="drs-more__name">{other.eventName}</span>
                      <span className="drs-more__meta">
                        {formatShortDate(other.startsAt)}
                        {other.feeType === 'free' ? ' · Free' : ''}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        </div>
      </div>
    </div>
  );
}

export default RegistrationSuccessScreen;

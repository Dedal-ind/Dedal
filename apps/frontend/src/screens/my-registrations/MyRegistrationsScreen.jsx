// MyRegistrationsScreen.jsx
// Route: /my-registrations — everything this participant has signed up for.
//
// WHY IT IS GROUPED BY FEST NOW, and not by chronology.
//
// The previous version split the list three ways — happening now, upcoming,
// past — and rendered every registration as a full-bleed poster card. Two things
// were wrong with it. The first is that a student does not hold their weekend in
// their head as "three events at various times"; they hold it as "I am going to
// Alliance ONE, and these are my four events there". Splitting by clock tore
// each fest into pieces scattered down the page, so the four things you do at
// one place over one weekend were never once next to each other. The second is
// that eleven identical 300px cards is eleven screens of scrolling to answer a
// question — which of these do I need today — that a list of rows answers at a
// glance.
//
// So: one section per fest, each with the fest's own header, and the events as
// ROWS inside it. The fest you are going to NEXT is open when the screen loads;
// everything that has already happened is collapsed under a Past divider,
// present but not in the way.
//
// THIS COSTS NO EXTRA REQUESTS. GET /registrations/mine already returns
// eventId.festId fully populated — name, dates, banner and the host college —
// so the grouping is a reduce over data that was on the wire anyway. Nothing
// here fetches per fest.
//
// THE DETAIL IS NOT A SEPARATE PAGE ANY MORE, except when it is. Tapping a row
// opens the registration in a bottom sheet on a phone and in the right-hand
// panel on a desktop; /my-registrations/:registrationId still exists and still
// works, because confirmation emails point at it. All three render the very same
// `RegistrationDetail` component — see the header of RegistrationDetailScreen.jsx
// for how that was extracted.
//
// Dedal tokens only. No Tailwind, no Material Symbols ligatures.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import gsap from 'gsap';
import apiClient from '../../api-client/api-client.js';
import BottomSheet from '../../components/bottom-sheet/BottomSheet.jsx';
import ContingentVerticalCodes from '../../components/contingent-vertical-codes/ContingentVerticalCodes.jsx';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { prefersReducedMotion, seconds } from '../../design/motion.js';
import {
  ChevronIcon,
  ExpandIcon,
  OfflineIcon,
  PassIcon,
  RetryIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { formatClockTime, formatPaiseAmount } from '../../helpers/event-format.js';
import { formatPassDateRange } from '../qr-pass/pass-format.js';
import {
  RegistrationDetail,
  StatusBadge,
} from '../registration-detail/RegistrationDetailScreen.jsx';
import './my-registrations.css';

/*
 * Local, sentence-case copy. brand-copy.js still speaks the retired Heritage
 * voice for this screen — 'ACTIVE REGISTRATIONS', 'DISCOVER EVENTS →' — and it
 * is shared with screens that have not been redesigned, so rewriting it there
 * would change their labels too. The dedal strings live here until every
 * consumer has moved.
 */
/*
 * NOT formatShortDate(). That helper is the retired stamped-uppercase voice and
 * returns "SEP 11" — which sat directly under a fest header reading
 * "7 Sept – 12 Sept 2026". Two date formats two lines apart, one of them
 * shouting, is what made these rows read as unrelated fragments.
 *
 * IST like every other date in the app: an event at 00:30 must not show
 * yesterday's date because the reader's laptop is on UTC.
 */
const ROW_DAY = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' });
const ROW_MONTH = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'short' });

function toValidDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRowDay(value) {
  const date = toValidDate(value);
  return date ? ROW_DAY.format(date) : '';
}

function formatRowMonth(value) {
  const date = toValidDate(value);
  return date ? ROW_MONTH.format(date) : '';
}

const COPY = {
  title: 'My registrations',
  filterAll: 'All',
  filterUpcoming: 'Upcoming',
  filterPast: 'Past',
  filterPayment: 'Payment due',
  filterLegend: 'Show',
  pastDivider: 'Past',
  liveNow: 'Live now',
  viewPass: 'View pass',
  viewPassFor: (festName) => `View your pass for ${festName}`,
  eventCount: (count) => (count === 1 ? '1 event' : `${count} events`),
  soloLabel: 'Solo',
  free: 'Free',
  paid: 'Paid',
  paymentDue: 'Payment due',
  viaContingent: (name) => `Through ${name}`,
  openRow: (eventName, festName) => `Open your registration for ${eventName} at ${festName}`,
  sheetTitle: 'My registration',
  panelEmptyTitle: 'Pick a registration',
  panelEmptyText: 'Choose an event on the left and everything about it opens here.',
  loading: 'Loading your registrations',
  errorTitle: 'We could not load your registrations',
  errorText: 'This is a connection problem. Nothing you have registered for is affected.',
  offlineTitle: 'You are offline',
  offlineText: 'Reconnect and this list will load.',
  retry: 'Try again',
  /* One line, not a title and a subtitle. See components/empty-state. */
  emptyLine: 'Events you register for will show up here.',
  emptyAction: 'Browse fests',
  noMatchTitle: 'No matches',
  noMatchText: 'Nothing here matches what you typed. Try a shorter search.',
  // Contingent claims — a coach has bought this person a seat.
  claimsTitle: 'You have been added to a contingent',
  claimsInvitedBy: (who) => `Added by ${who}`,
  claimAccept: 'Accept the seat',
  claimDecline: 'Decline',
  claimCompleteProfile: 'Complete your profile first',
  claimWarning: 'Declining releases the seat. It cannot be undone from here.',
  claimAcceptFailed: 'We could not accept that. Please try again.',
  claimDeclineFailed: 'We could not decline that. Please try again.',
  // Contingent purchases — this person is the buyer.
  purchasesTitle: 'Contingents you bought',
  purchaseRefundPending: 'Refund on the way',
  purchaseCancel: 'Cancel this contingent',
  purchaseCancelConfirm: 'Cancelling releases every seat in this contingent at once.',
  purchaseCancelYes: 'Yes, cancel it',
  purchaseCancelNo: 'Keep it',
  purchaseCancelFailed: 'We could not cancel it. Please try again.',
  bannerJoinedVertical: (eventName, parentEventName) =>
    `You are in ${eventName}, part of ${parentEventName}.`,
  bannerPurchaseConfirmed: 'Your contingent is paid for. The seats are being sent out now.',
};

const CLAIM_STATUS_TEXT = {
  invited: 'Invited',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/* Desktop is where the two-column layout and the panel exist. Same 1024px the
   token ladder steps at, so the JS and the CSS cannot disagree about it. */
const DESKTOP_QUERY = '(min-width: 1024px)';

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(DESKTOP_QUERY).matches === true,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return undefined;
    }
    const query = window.matchMedia(DESKTOP_QUERY);
    const handle = (mediaEvent) => setIsDesktop(mediaEvent.matches);
    query.addEventListener('change', handle);
    return () => query.removeEventListener('change', handle);
  }, []);
  return isDesktop;
}

/*
 * THE COLLAPSE, on GSAP height.
 *
 * Height is a layout property, and design/motion.js says transform and opacity
 * only. This is the documented exception, and it is a real one: the alternative
 * for a section whose contents are of unknown height is a scaleY, which squashes
 * the type inside it, or a max-height guess, which either clips a long fest or
 * makes a short one animate mostly empty air. A handful of sections opening one
 * at a time is not the compositor pressure the rule was written against — a feed
 * of a hundred cards is.
 *
 * FIRST RENDER DOES NOT ANIMATE. The next fest is open when the screen loads, so
 * animating it from zero would make the page assemble itself in front of someone
 * who has not touched anything.
 *
 * REDUCED MOTION SETS THE HEIGHT AND RETURNS. Not "a very short tween" — this
 * one has no completion callback anybody waits on, so there is nothing to keep
 * alive, and a genuine no-op is cheaper than a 0.000001s tween.
 *
 * useLayoutEffect, NOT useEffect. A collapsed section renders at its natural
 * height until something sets it to zero; with useEffect that happens after the
 * paint, so every past fest flashes fully open for one frame on load and the
 * page visibly snaps shut. A layout effect runs before the browser paints, so
 * the first frame is already correct.
 */
function useCollapse(isExpanded) {
  const panelRef = useRef(null);
  const hasRenderedRef = useRef(false);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return undefined;
    }

    function settle() {
      panel.style.height = isExpanded ? 'auto' : '0px';
      panel.style.overflow = isExpanded ? '' : 'hidden';
    }

    if (!hasRenderedRef.current || prefersReducedMotion()) {
      hasRenderedRef.current = true;
      settle();
      return undefined;
    }

    gsap.killTweensOf(panel);
    /* Measure both ends before touching anything: the height it is at now, and
       the height 'auto' resolves to for the content that is in there. */
    const fromHeight = panel.offsetHeight;
    panel.style.height = 'auto';
    const toHeight = isExpanded ? panel.offsetHeight : 0;
    panel.style.height = `${fromHeight}px`;
    panel.style.overflow = 'hidden';

    const tween = gsap.to(panel, {
      height: toHeight,
      duration: seconds('move'),
      ease: 'power2.out',
      /* Back to auto on open, so a row added later is not clipped by a pixel
         height frozen at the moment the tween finished. */
      onComplete: settle,
    });
    /*
     * SETTLE ON THE WAY OUT TOO, and this is not belt-and-braces.
     *
     * `tween.kill()` stops the animation wherever it happens to be and leaves
     * that pixel height on the element — onComplete never runs, so the panel
     * keeps a frozen height instead of going back to `auto`. Under StrictMode
     * the effect is deliberately mounted, cleaned up and re-run, so this fires
     * on an ordinary first render: the panel was left at 210px against 300px of
     * content and the third event was cut in half. Settling in the cleanup
     * means the end state is correct however the tween ends.
     */
    return () => {
      tween.kill();
      settle();
    };
  }, [isExpanded]);

  return panelRef;
}

/* Initials of a name, two letters maximum. Same derivation the fest and event
   cards use — a three-letter monogram stops reading as a mark and starts reading
   as an acronym nobody chose. */
function readMonogram(name) {
  const letters = String(name ?? '')
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}]/gu, '').charAt(0))
    .filter(Boolean);
  return letters.slice(0, 2).join('').toUpperCase();
}

/*
 * The fest thumbnail. bannerImageUrl is null for every fest in this data, so the
 * monogram-over-tint is what people actually see and it is treated as the
 * primary case, not as a fallback: a grey square with a broken-image glyph in it
 * would tell a student their fest has nothing behind it.
 */
function FestThumb({ fest }) {
  const [hasFailed, setHasFailed] = useState(false);
  if (fest.bannerImageUrl && !hasFailed) {
    return (
      <img
        className="dmr-thumb dmr-thumb--image"
        src={fest.bannerImageUrl}
        alt=""
        loading="lazy"
        onError={() => setHasFailed(true)}
      />
    );
  }
  return (
    <span className="dmr-thumb dmr-thumb--mark" aria-hidden="true">
      {readMonogram(fest.festName)}
    </span>
  );
}

/* ── One event row ──────────────────────────────────────────────────────── */

function feeText(registration) {
  if ((registration.totalFeePaise ?? 0) === 0) {
    return COPY.free;
  }
  const amount = formatPaiseAmount(registration.totalFeePaise);
  return registration.paymentStatus === 'completed'
    ? `${amount} ${COPY.paid.toLowerCase()}`
    : `${amount} ${COPY.paymentDue.toLowerCase()}`;
}

function EventRow({ registration, isSelected, onOpen }) {
  const event = registration.eventId ?? {};
  const fest = event.festId ?? {};
  const team = registration.teamId ?? null;
  const isCancelled = ['cancelled', 'eventCancelled'].includes(registration.status);
  /*
   * THE DATE IS A RAIL, NOT A SENTENCE FRAGMENT.
   *
   * It used to be the first item in a wrapping run of four muted spans, so the
   * date, the venue, the entry mode and the fee all started at whatever x the
   * previous one happened to end at. Nothing lined up down the list and the
   * rows read as a pile.
   *
   * Every bookings list a student already uses — BookMyShow, District,
   * Eventbrite, Airbnb's trips — anchors the row on a fixed-width date block at
   * the leading edge, because the date is what you scan for. Giving it a column
   * of its own is what turns a stack of paragraphs into a table you can read
   * down. The clock stays in the meta line: the day is what you scan, the time
   * is what you check once you have found the row.
   */
  const dayNumber = formatRowDay(event.startsAt);
  const monthLabel = formatRowMonth(event.startsAt);
  const clock = formatClockTime(event.startsAt);

  return (
    <li>
      <button
        type="button"
        className={isSelected ? 'dmr-row dmr-row--selected' : 'dmr-row'}
        onClick={onOpen}
        aria-label={COPY.openRow(event.eventName, fest.festName)}
        /* On desktop the row stays on screen beside the panel it filled, so it
           has to say which one is showing. aria-current, not aria-selected: this
           is not a listbox and pretending it is breaks arrow-key expectations. */
        aria-current={isSelected ? 'true' : undefined}
      >
        {/* The rail. aria-hidden because the full date and time are already in
            the row's aria-label — a screen reader reading "11" then "Sept"
            then the name is worse than the sentence it already gets. */}
        <span className="dmr-row__date" aria-hidden="true">
          <span className="dmr-row__day">{dayNumber}</span>
          <span className="dmr-row__month">{monthLabel}</span>
        </span>

        <span className="dmr-row__body">
          <span className="dmr-row__top">
            <span className={isCancelled ? 'dmr-row__name dmr-row__name--off' : 'dmr-row__name'}>
              {event.eventName}
            </span>
            <StatusBadge
              status={registration.status}
              waitlistPosition={registration.waitlistPosition}
            />
          </span>
          {/* Meta as separate spans rather than one middle-dot-joined string:
              a screen reader reads "A · B · C" as one run-on line, and the dots
              are a tic that makes every row look like every other row. */}
          <span className="dmr-row__meta">
            {clock ? <span className="dmr-row__when">{clock}</span> : null}
            {event.venue ? <span>{event.venue}</span> : null}
            <span>{team ? team.teamName : COPY.soloLabel}</span>
            <span>{feeText(registration)}</span>
          </span>
          {registration.contingentClaimId?.contingentId?.contingentName ? (
            <span className="dmr-row__via">
              {COPY.viaContingent(registration.contingentClaimId.contingentId.contingentName)}
            </span>
          ) : null}
        </span>
        <span className="dmr-row__chevron">
          <ChevronIcon size="md" />
        </span>
      </button>
    </li>
  );
}

/* ── One fest section ───────────────────────────────────────────────────── */

function FestSection({ group, isExpanded, onToggle, selectedId, onOpenRow, headingId }) {
  const panelRef = useCollapse(isExpanded);
  const { fest, rows, isLive } = group;
  const panelId = `dmr-panel-${fest.id}`;
  const college = fest.hostCollegeId?.commonName ?? fest.hostCollegeId?.collegeName ?? '';
  const dates = formatPassDateRange(fest.startsOn, fest.endsOn);

  return (
    <section className="dmr-fest" aria-labelledby={headingId}>
      <div className="dmr-fest__bar">
        <h3 className="dmr-fest__heading" id={headingId}>
          <button
            type="button"
            className="dmr-fest__toggle"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-controls={panelId}
          >
            <FestThumb fest={fest} />
            <span className="dmr-fest__text">
              <span className="dmr-fest__name">
                {fest.festName}
                {isLive ? (
                  <span className="dmr-live">
                    <span className="dmr-live__dot" aria-hidden="true" />
                    {COPY.liveNow}
                  </span>
                ) : null}
              </span>
              {college ? <span className="dmr-fest__college">{college}</span> : null}
              {/*
                TWO FACTS, TWO ELEMENTS, not one string joined by a middle dot.
                Joined, the dot is just another glyph in the run and at 320px
                the line broke wherever it ran out of room — "7 Sept – 12 Sept"
                / "2026 · 4 events" — so the separator ended up leading the
                second line. As flex children they wrap as whole units, and the
                dot is a spacer that is simply not drawn once they stack.
              */}
              <span className="dmr-fest__when">
                {dates ? <span>{dates}</span> : null}
                {dates ? (
                  <span className="dmr-fest__dot" aria-hidden="true">
                    ·
                  </span>
                ) : null}
                <span>{COPY.eventCount(rows.length)}</span>
              </span>
            </span>
            <span className={isExpanded ? 'dmr-fest__caret dmr-fest__caret--up' : 'dmr-fest__caret'}>
              <ExpandIcon size="md" />
            </span>
          </button>
        </h3>
        {/*
          A SIBLING of the toggle, never a child of it. A link inside a button is
          invalid HTML and, in practice, the link swallows the toggle's click on
          some browsers and the toggle swallows the link's on others.
        */}
        <Link
          className="dmr-fest__pass"
          to={`/my-passes/${fest.id}`}
          aria-label={COPY.viewPassFor(fest.festName)}
        >
          <PassIcon size="sm" />
          {COPY.viewPass}
        </Link>
      </div>

      <div className="dmr-fest__panel" id={panelId} ref={panelRef}>
        <ul className="dmr-rows">
          {rows.map((registration) => (
            <EventRow
              key={registration.id}
              registration={registration}
              isSelected={registration.id === selectedId}
              onOpen={() => onOpenRow(registration.id)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ── Contingent claims someone else bought for this person ──────────────── */

function InvitedClaims({ claims, onChanged, isProfileComplete, navigate }) {
  const [busyClaimId, setBusyClaimId] = useState(null);
  const [claimError, setClaimError] = useState('');

  const invited = claims.filter((claim) => claim.claimStatus === 'invited');
  /* Length guard, deliberately at the top. This endpoint is empty in every seed
     account, so the common case is that this whole block does not exist. */
  if (invited.length === 0) {
    return null;
  }

  async function actOnClaim(claimId, action) {
    if (busyClaimId) {
      return;
    }
    setClaimError('');
    setBusyClaimId(claimId);
    try {
      await apiClient.post(`/contingent-claims/${claimId}/${action}`);
      await onChanged();
    } catch (error) {
      setClaimError(
        error?.message ||
          (action === 'accept' ? COPY.claimAcceptFailed : COPY.claimDeclineFailed),
      );
    } finally {
      setBusyClaimId(null);
    }
  }

  return (
    <section className="dmr-block">
      <h2 className="dmr-block__title">{COPY.claimsTitle}</h2>
      {claimError ? (
        <p className="dmr-block__error" role="alert">
          {claimError}
        </p>
      ) : null}
      <ul className="dmr-rows">
        {invited.map((claim) => (
          <li className="dmr-claim" key={claim.id}>
            <p className="dmr-claim__event">{claim.eventId?.eventName ?? '—'}</p>
            <p className="dmr-claim__who">
              {claim.contingentId?.contingentName ? `${claim.contingentId.contingentName}. ` : ''}
              {COPY.claimsInvitedBy(
                claim.buyerUserId?.fullName ?? claim.buyerUserId?.emailAddress ?? '—',
              )}
            </p>
            <p className="dmr-claim__warning">{COPY.claimWarning}</p>
            <div className="dmr-claim__actions">
              {/* An incomplete profile cannot accept — that flow is where terms
                  consent is captured — so the button says what it will actually
                  do rather than failing on press. */}
              {isProfileComplete ? (
                <button
                  type="button"
                  className="dmr-button dmr-button--primary"
                  disabled={busyClaimId === claim.id}
                  onClick={() => actOnClaim(claim.id, 'accept')}
                >
                  {COPY.claimAccept}
                </button>
              ) : (
                <button
                  type="button"
                  className="dmr-button dmr-button--primary"
                  onClick={() =>
                    navigate('/profile-completion', { state: { returnTo: '/my-registrations' } })
                  }
                >
                  {COPY.claimCompleteProfile}
                </button>
              )}
              <button
                type="button"
                className="dmr-button"
                disabled={busyClaimId === claim.id}
                onClick={() => actOnClaim(claim.id, 'decline')}
              >
                {COPY.claimDecline}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Contingents this person bought ─────────────────────────────────────── */

function ContingentPurchases({ purchases, onChanged }) {
  const [busyGroupId, setBusyGroupId] = useState(null);
  const [purchaseError, setPurchaseError] = useState('');
  const [confirmingGroupId, setConfirmingGroupId] = useState(null);

  if (purchases.length === 0) {
    return null;
  }

  async function cancelPurchase(groupId) {
    if (busyGroupId) {
      return;
    }
    setPurchaseError('');
    setBusyGroupId(groupId);
    try {
      await apiClient.post(`/contingent-purchases/${groupId}/cancel`);
      setConfirmingGroupId(null);
      await onChanged();
    } catch (error) {
      setPurchaseError(error?.message || COPY.purchaseCancelFailed);
      setConfirmingGroupId(null);
    } finally {
      setBusyGroupId(null);
    }
  }

  return (
    <section className="dmr-block">
      <h2 className="dmr-block__title">{COPY.purchasesTitle}</h2>
      {purchaseError ? (
        <p className="dmr-block__error" role="alert">
          {purchaseError}
        </p>
      ) : null}
      <ul className="dmr-rows">
        {purchases.map((purchase) => {
          const groupId = purchase.contingentPurchaseGroupId;
          const hasLiveClaims = (purchase.claims ?? []).some((claim) =>
            ['invited', 'accepted'].includes(claim.claimStatus),
          );
          return (
            <li className="dmr-purchase" key={groupId}>
              <div className="dmr-purchase__head">
                <p className="dmr-purchase__name">{purchase.contingentName ?? '—'}</p>
                {purchase.totalAmountPaise !== null &&
                purchase.totalAmountPaise !== undefined ? (
                  <p className="dmr-purchase__total">
                    {formatPaiseAmount(purchase.totalAmountPaise)}
                  </p>
                ) : null}
              </div>
              {purchase.orderStatus === 'refundPending' ? (
                <p className="dmr-purchase__flag">{COPY.purchaseRefundPending}</p>
              ) : null}
              <ul className="dmr-seats">
                {(purchase.claims ?? []).map((claim) => (
                  <li className="dmr-seats__row" key={claim.id}>
                    <span className="dmr-seats__who">
                      {claim.attendeeFullName} — {claim.eventName ?? '—'}
                    </span>
                    <span className="dmr-seats__state">
                      {CLAIM_STATUS_TEXT[claim.claimStatus] ?? claim.claimStatus}
                    </span>
                  </li>
                ))}
              </ul>
              {/* The buyer's per-vertical join codes. Renders nothing until the
                  payment captures, which is when the codes are minted. */}
              <ContingentVerticalCodes contingentPurchaseGroupId={groupId} />

              {hasLiveClaims ? (
                confirmingGroupId === groupId ? (
                  <div className="dmr-purchase__confirm">
                    <p className="dmr-purchase__confirmText">{COPY.purchaseCancelConfirm}</p>
                    <div className="dmr-claim__actions">
                      <button
                        type="button"
                        className="dmr-button dmr-button--primary"
                        disabled={busyGroupId === groupId}
                        onClick={() => cancelPurchase(groupId)}
                      >
                        {COPY.purchaseCancelYes}
                      </button>
                      <button
                        type="button"
                        className="dmr-button"
                        onClick={() => setConfirmingGroupId(null)}
                      >
                        {COPY.purchaseCancelNo}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="dmr-linkish"
                    onClick={() => setConfirmingGroupId(groupId)}
                  >
                    {COPY.purchaseCancel}
                  </button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/*
 * THE CERTIFICATES BLOCK IS GONE FROM THIS SCREEN.
 *
 * It listed every certificate the participant had earned, with its own
 * download button, underneath the fest accordion — a second subject on a screen
 * whose name says it has one. Certificates already have a whole screen of their
 * own at /my-certificates, grouped by fest, reachable from the account drawer,
 * and that screen does everything this block did and more. Two lists of the
 * same objects, one of them worse, is one list too many.
 *
 * Removed with it: the `certificates` state, the /certificates/mine call in
 * loadAll, the five COPY keys it owned, the PrizeIcon import and the .dmr-cert*
 * rules in my-registrations.css. Nothing else on this screen read any of them.
 */

/* ── Grouping ───────────────────────────────────────────────────────────── */

function readMs(value) {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

/*
 * Registrations → fest sections.
 *
 * A registration whose event or fest failed to populate would otherwise vanish
 * from the participant's own history, which is the one thing this screen must
 * never do, so it lands in an "Other" group keyed by the literal string rather
 * than being filtered out.
 *
 * ORDER: live fests first, then upcoming soonest-first, then past most-recent-
 * first. Inside a fest, rows sort by startsAt ascending — a fest is a schedule
 * and a schedule reads forwards, including one that has already happened.
 */
const OTHER_GROUP_ID = '__ungrouped__';

function groupByFest(registrations, nowMs) {
  const groups = new Map();
  registrations.forEach((registration) => {
    const fest = registration.eventId?.festId ?? null;
    const id = fest?.id ?? OTHER_GROUP_ID;
    if (!groups.has(id)) {
      groups.set(id, {
        fest: fest ?? { id: OTHER_GROUP_ID, festName: 'Other registrations' },
        rows: [],
      });
    }
    groups.get(id).rows.push(registration);
  });

  const list = [...groups.values()].map((group) => {
    const startsOnMs = readMs(group.fest.startsOn);
    const endsOnMs = readMs(group.fest.endsOn);
    /* Live is the fest's own window, not the event's: the pass, the gate and
       the shuttle are all fest-scoped, so "am I there right now" is a fest
       question. */
    const isLive =
      startsOnMs !== null && endsOnMs !== null && startsOnMs <= nowMs && nowMs <= endsOnMs;
    const isPast = endsOnMs !== null && endsOnMs < nowMs;
    group.rows.sort((first, second) => {
      const firstMs = readMs(first.eventId?.startsAt) ?? 0;
      const secondMs = readMs(second.eventId?.startsAt) ?? 0;
      return firstMs - secondMs;
    });
    return { ...group, startsOnMs, endsOnMs, isLive, isPast };
  });

  list.sort((first, second) => {
    if (first.isPast !== second.isPast) {
      return first.isPast ? 1 : -1;
    }
    if (first.isLive !== second.isLive) {
      return first.isLive ? -1 : 1;
    }
    if (first.isPast) {
      return (second.endsOnMs ?? 0) - (first.endsOnMs ?? 0);
    }
    return (first.startsOnMs ?? Infinity) - (second.startsOnMs ?? Infinity);
  });
  return list;
}


const PAYMENT_DUE_STATUSES = ['pendingPayment'];

/* ═══════════════════════════════════════════════════════════════════════════ */

function MyRegistrationsScreen() {
  const navigate = useTransitionNavigate();
  const location = useLocation();
  const isOnline = useOnlineStatus();
  const isDesktop = useIsDesktop();
  const { currentUser } = useAuthentication();

  const [registrations, setRegistrations] = useState([]);
  const [claims, setClaims] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error

  const [filter, setFilter] = useState('all'); // all | upcoming | past | payment
  const [selectedId, setSelectedId] = useState(null);
  /* Which fests the person has toggled AWAY from their default. Storing the
     overrides rather than the open set means the default (the next fest is open)
     survives a refetch that reorders the groups. */
  const [toggledFestIds, setToggledFestIds] = useState(() => new Set());

  // Captured once so the live/past split is a pure computation and does not
  // answer differently on two renders of the same data.
  const [nowMs] = useState(() => Date.now());

  const isProfileComplete = Boolean(currentUser?.isProfileComplete);
  const joinedVertical = location.state?.justJoinedVertical ?? null;
  const showPurchaseConfirmed = Boolean(location.state?.contingentPurchaseConfirmed);

  const loadAll = useCallback(async () => {
    setLoadState('loading');
    try {
      /*
        One round trip each, in parallel. Only /registrations/mine is allowed to
        fail the screen — the other two are supporting blocks, and a contingent
        endpoint being down is not a reason to hide somebody's registrations.

        THE ENVELOPES DIFFER and that is not a typo: claims and purchases come
        back wrapped ({ claims: [...] }, { purchases: [...] }). Each is
        unwrapped for its own shape.
      */
      const [list, claimsResult, purchasesResult] = await Promise.all([
        apiClient.get('/registrations/mine'),
        apiClient.get('/contingent-claims/mine').catch(() => null),
        apiClient.get('/contingent-purchases/mine').catch(() => null),
      ]);
      setRegistrations(Array.isArray(list) ? list : []);
      setClaims(Array.isArray(claimsResult?.claims) ? claimsResult.claims : []);
      setPurchases(Array.isArray(purchasesResult?.purchases) ? purchasesResult.purchases : []);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll();
  }, [loadAll]);

  /*
   * The filter and the search run over data that is ALREADY IN MEMORY. No
   * debounce: a debounce buys time for a network round trip, and there is no
   * round trip here — the delay would be latency this screen invented.
   */
  const hasPaymentDue = useMemo(
    () => registrations.some((row) => PAYMENT_DUE_STATUSES.includes(row.status)),
    [registrations],
  );

  const filteredRegistrations = useMemo(() => {
    return registrations.filter((registration) => {
      if (filter === 'payment') {
        return PAYMENT_DUE_STATUSES.includes(registration.status);
      }
      if (filter === 'upcoming' || filter === 'past') {
        const endsMs =
          readMs(registration.eventId?.endsAt) ?? readMs(registration.eventId?.startsAt);
        /* An event with no schedule at all counts as past rather than being
           dropped: a row must never disappear from somebody's own history. */
        const hasEnded = endsMs === null || endsMs < nowMs;
        return filter === 'past' ? hasEnded : !hasEnded;
      }
      return true;
    });
  }, [registrations, filter, nowMs]);

  const groups = useMemo(
    () => groupByFest(filteredRegistrations, nowMs),
    [filteredRegistrations, nowMs],
  );

  /*
   * THE FEST THAT IS OPEN ON ARRIVAL: the one the student is going to next.
   * Live beats upcoming, because if a fest is running right now that is where
   * they are standing. Past fests are never the default — the screen would open
   * on a memory.
   */
  const defaultOpenFestId = useMemo(() => {
    const live = groups.find((group) => group.isLive);
    if (live) {
      return live.fest.id;
    }
    const next = groups.find((group) => !group.isPast);
    return next?.fest.id ?? null;
  }, [groups]);

  const isSearching = filter !== 'all';

  function isFestExpanded(group) {
    /*
     * A SEARCH OPENS EVERYTHING IT MATCHED. Leaving the sections collapsed would
     * mean typing a word, being told there are results, and seeing none of them
     * — the single most common way a filtered accordion goes wrong.
     */
    if (isSearching) {
      return true;
    }
    const isOpenByDefault = group.fest.id === defaultOpenFestId;
    return toggledFestIds.has(group.fest.id) ? !isOpenByDefault : isOpenByDefault;
  }

  function toggleFest(festId) {
    setToggledFestIds((previous) => {
      const next = new Set(previous);
      if (next.has(festId)) {
        next.delete(festId);
      } else {
        next.add(festId);
      }
      return next;
    });
  }

  /* On a phone the detail is a sheet; on a desktop it fills the panel and no
     sheet is ever mounted. One piece of state either way. */
  function openRegistration(registrationId) {
    setSelectedId(registrationId);
  }

  const firstPastIndex = groups.findIndex((group) => group.isPast);

  /*
   * THE SHEET IS TITLED WITH THE EVENT, NOT WITH "Your registration".
   *
   * The old title restated the screen you were already on — you opened it from
   * a list called My registrations, so being told this is a registration
   * answers nothing. Worse, it pushed the one fact you actually needed, WHICH
   * event, down into the body. A detail sheet is named after the thing it is
   * about; that is the convention every booking app follows and it costs
   * nothing to honour.
   *
   * Falls back to the generic label only if the row cannot be found, so the
   * sheet is never left with an empty accessible name.
   */
  const selectedEventName =
    registrations.find((registration) => registration.id === selectedId)?.eventId?.eventName ??
    COPY.sheetTitle;

  const detail = selectedId ? (
    <RegistrationDetail
      key={selectedId}
      registrationId={selectedId}
      variant="embedded"
      onChanged={loadAll}
    />
  ) : null;

  return (
    <div className="dmr-screen">
      {/* Back and the screen's name in one bar, which also stands the app
          header down — this screen is reached from the account menu, so it is
          always a push, never a tab root. */}
      <ScreenHeader title={COPY.title} />

      <div className={isDesktop ? 'dmr-page dmr-page--split' : 'dmr-page'}>
        <div className="dmr-main">

          {/* Banners from the flows that route here. */}
          {joinedVertical ? (
            <p className="dmr-banner">
              {COPY.bannerJoinedVertical(
                joinedVertical.eventName,
                joinedVertical.parentEventName,
              )}
            </p>
          ) : null}
          {showPurchaseConfirmed ? (
            <p className="dmr-banner">{COPY.bannerPurchaseConfirmed}</p>
          ) : null}

          {loadState === 'loading' ? (
            <div className="dmr-skeletons" aria-busy="true" aria-label={COPY.loading}>
              <div className="dmr-skel dmr-skel--head" />
              <div className="dmr-skel" />
              <div className="dmr-skel" />
            </div>
          ) : null}

          {loadState === 'error' ? (
            <div className="dmr-state">
              <span className="dmr-state__icon">
                {isOnline ? <RetryIcon size="lg" /> : <OfflineIcon size="lg" />}
              </span>
              <p className="dmr-state__title">
                {isOnline ? COPY.errorTitle : COPY.offlineTitle}
              </p>
              <p className="dmr-state__text">{isOnline ? COPY.errorText : COPY.offlineText}</p>
              <button type="button" className="dmr-button" onClick={loadAll}>
                {COPY.retry}
              </button>
            </div>
          ) : null}

          {loadState === 'ready' ? (
            <>
              <InvitedClaims
                claims={claims}
                onChanged={loadAll}
                isProfileComplete={isProfileComplete}
                navigate={navigate}
              />
              <ContingentPurchases purchases={purchases} onChanged={loadAll} />

              {registrations.length === 0 ? (
                <EmptyState
                  line={COPY.emptyLine}
                  actionLabel={COPY.emptyAction}
                  onAction={() => navigate('/')}
                />
              ) : (
                <>
                  {/*
                    * NO SEARCH BOX. A fest registration has a short life — the
                    * fest runs, it is over, and what is left is a handful of
                    * rows you scroll past in a second. Search earns its 44px
                    * and its permanent presence on a list you cannot see the
                    * end of; this is not one. The filter chips stay, because
                    * "what is still ahead of me" is the question people
                    * actually arrive with, and a chip answers it in one tap
                    * where a search box asks them to think of a word first.
                    */}
                  {registrations.length > 3 ? (
                    <div className="dmr-tools">
                      <div className="dmr-chips" role="group" aria-label={COPY.filterLegend}>
                        {[
                          { id: 'all', label: COPY.filterAll },
                          { id: 'upcoming', label: COPY.filterUpcoming },
                          { id: 'past', label: COPY.filterPast },
                          /* Only when something is actually owed. A chip that is
                             permanently empty teaches people to stop reading
                             chips. */
                          ...(hasPaymentDue
                            ? [{ id: 'payment', label: COPY.filterPayment }]
                            : []),
                        ].map((chip) => (
                          <button
                            key={chip.id}
                            type="button"
                            className="dmr-chip"
                            aria-pressed={filter === chip.id}
                            onClick={() => setFilter(chip.id)}
                          >
                            {chip.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {groups.length === 0 ? (
                    <div className="dmr-state">
                      <p className="dmr-state__title">{COPY.noMatchTitle}</p>
                      <p className="dmr-state__text">{COPY.noMatchText}</p>
                      <button
                        type="button"
                        className="dmr-button"
                        onClick={() => {
                          setFilter('all');
                        }}
                      >
                        {COPY.filterAll}
                      </button>
                    </div>
                  ) : (
                    <div className="dmr-fests">
                      {groups.map((group, index) => (
                        <div key={group.fest.id}>
                          {/* The Past divider, drawn once, in front of the first
                              fest that has finished. A heading rather than a
                              rule, so it is in the document outline. */}
                          {index === firstPastIndex ? (
                            <h2 className="dmr-divider">{COPY.pastDivider}</h2>
                          ) : null}
                          <FestSection
                            group={group}
                            headingId={`dmr-fest-${group.fest.id}`}
                            isExpanded={isFestExpanded(group)}
                            onToggle={() => toggleFest(group.fest.id)}
                            selectedId={isDesktop ? selectedId : null}
                            onOpenRow={openRegistration}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          ) : null}
        </div>

        {/* ── The desktop panel ───────────────────────────────────────────
            Rendered only on desktop, so the detail is never mounted twice and
            the two surfaces cannot fight over the same fetch. */}
        {isDesktop ? (
          <aside className="dmr-panel" aria-label={COPY.sheetTitle}>
            <div className="dmr-panel__inner">
              {detail ?? (
                <div className="dmr-state">
                  <span className="dmr-state__icon">
                    <ChevronIcon size="lg" />
                  </span>
                  <p className="dmr-state__title">{COPY.panelEmptyTitle}</p>
                  <p className="dmr-state__text">{COPY.panelEmptyText}</p>
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </div>

      {/* ── The mobile sheet ────────────────────────────────────────────────
          The shared BottomSheet primitive: one implementation of the scrim, the
          swipe-to-dismiss, the focus return and the scroll lock, the same one
          the pass shortcut and the account menu use. */}
      {!isDesktop ? (
        <BottomSheet
          isOpen={Boolean(selectedId)}
          onClose={() => setSelectedId(null)}
          title={selectedEventName}
        >
          {detail}
        </BottomSheet>
      ) : null}
    </div>
  );
}

export default MyRegistrationsScreen;

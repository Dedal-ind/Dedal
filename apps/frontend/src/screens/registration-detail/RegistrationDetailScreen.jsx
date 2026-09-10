// RegistrationDetailScreen.jsx
// ONE registration, rendered in THREE PLACES.
//
// This file used to be a route and nothing else. The hub now wants the same
// content in a bottom sheet on a phone and in the right-hand panel on a desktop,
// and the deep link /my-registrations/:registrationId still has to work — a
// confirmation email points at it. Three surfaces, one truth, so the content was
// EXTRACTED rather than forked:
//
//   · `RegistrationDetail` — the whole thing: its own fetch, its own error and
//     loading states, its own cancel flow. It takes a registrationId and a
//     `variant`, and NOTHING else about where it is rendered. That is the part
//     the hub imports, for both the sheet and the panel.
//   · `RegistrationDetailScreen` (default) — the route. Reads the param, renders
//     the same component with variant="page", adds the page chrome (back
//     control, heading) that only a full page needs.
//
// The variant changes CHROME, never CONTENT. Every section below renders
// identically in all three places; what differs is the frame around them and the
// heading level, because a sheet already carries its own <h2> title and a second
// one inside it would announce twice.
//
// WHY THE CANCEL CONFIRM IS INLINE AND NOT A MODAL. It was a fixed-position
// dialog. Inside the bottom sheet that is a dialog inside a dialog: two elements
// claiming aria-modal, two focus traps fighting, and Escape ambiguous between
// them. An inline confirm block is one focus order, works the same on all three
// surfaces, and is scrolled to rather than layered over.
//
// Dedal tokens only — see registration-detail.css. No Tailwind, no Material
// Symbols ligatures; icons are the shared lucide set.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import apiClient from '../../api-client/api-client.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import {
  formatClockTime,
  formatPaiseAmount,
  formatEventTypeFull,
  formatScoringFormat,
} from '../../helpers/event-format.js';
import { formatCategoryLabel } from '../../helpers/category-format.js';
import UserAvatar from '../../components/user-avatar/UserAvatar.jsx';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { festTitleSponsor } from '../../helpers/sponsor-hierarchy.js';
import {
  CheckCircleIcon,
  DateIcon,
  PassIcon,
  PrizeIcon,
  RetryIcon,
  TeamIcon,
  VenueIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import EventFeedbackCard from '../../components/event-feedback-card/EventFeedbackCard.jsx';
import { FOOD_PREFERENCE_OPTIONS } from '../../brand/brand-copy.js';
import './registration-detail.css';

const CANCELLABLE_SELF_STATUSES = ['confirmed', 'waitlisted'];
const CANCELLATION_FREEZE_MINUTES = 120;
const MINIMUM_REASON_LENGTH = 10;
const MAXIMUM_REASON_LENGTH = 500;
/* The copied-glyph hold. Long enough to be seen, short enough that the button
   is back to offering the action before anyone reaches for it again. */
const COPIED_HOLD_MS = 1500;

/*
 * COPY LIVES HERE, not in brand-copy.js.
 *
 * brand-copy's REGISTRATION_DETAIL_COPY is written in SHOUTING CAPS — 'COPY',
 * 'INVITE CODE', 'CANCEL REGISTRATION' — which is the retired Heritage voice.
 * Dedal is sentence case. brand-copy is shared with screens that have not been
 * redesigned and rewriting it there would change their labels too, so the dedal
 * strings for this surface are declared locally and the shared file is left
 * alone until every consumer has moved.
 */
const COPY = {
  pageTitle: 'My registration',
  sponsorLabel: 'Supported by',
  back: 'Back',
  loading: 'Loading this registration',
  errorTitle: 'We could not load this registration',
  errorText: 'This is a connection problem. Your registration is safe.',
  retry: 'Try again',
  registeredOn: (when) => `Registered ${when}`,
  soloLabel: 'Solo entry',
  teamHeader: 'My team',
  teamManage: 'Manage my teams',
  roleLeader: 'Leader',
  roleMember: 'Member',
  inviteCodeLabel: 'Invite code',
  copyCode: 'Copy',
  copied: 'Copied',
  copyCodeFor: (teamName) => `Copy the invite code for ${teamName}`,
  copyAnnouncement: 'Invite code copied to the clipboard.',
  copyFailed: 'We could not reach the clipboard. Select the code and copy it.',
  participantHeader: 'My details',
  labelName: 'Name',
  labelRegNumber: 'Registration number',
  labelEmail: 'Email',
  labelCollege: 'College',
  passHeader: 'Entry pass',
  passHint: 'Show this at the gate. It is your pass for the whole fest.',
  openFullPass: 'Open the full pass',
  answersHeader: 'What you answered',
  categoriesHeader: 'Your category',
  labelWeight: 'Weight',
  labelGender: 'Gender',
  labelAge: 'Age',
  foodLabel: 'Food preference',
  accommodationLabel: 'Accommodation',
  accommodationYes: 'Requested',
  accommodationNo: 'Not requested',
  extrasHeader: 'Food and stay',
  paymentHeader: 'Payment',
  paymentAmount: 'Amount',
  paymentStatusLabel: 'Status',
  paymentRef: 'Reference',
  free: 'Free',
  cancelOpen: 'Cancel registration',
  cancelConfirmTitle: 'Cancel this registration?',
  cancelConfirmBody: 'Your place is released to the next person in the queue. This cannot be undone.',
  cancelReasonLabel: 'Why are you cancelling?',
  cancelReasonPlaceholder: 'A sentence is enough (at least 10 characters)',
  cancelReasonShort: (remaining) => `${remaining} more characters needed`,
  cancelConfirm: 'Yes, cancel it',
  cancelKeep: 'Keep my place',
  cancelFailed: 'We could not cancel it. Please try again.',
  cancelledHeader: 'Cancelled',
  cancelledBy: (role) => `Cancelled by the ${role}`,
  cancelWindowClosed: 'Cancellation has closed',
  cancelWindowHint: 'Cancelling closes two hours before the event starts. Talk to the organiser if you need to.',
  eventCancelledHeader: 'The organiser cancelled this event',
  eventCancelledHint: 'You do not need to do anything. Any payment is refunded to the source.',
};

/* Payment status → a sentence, because "notRequired" is a database value. */
const PAYMENT_STATUS_TEXT = {
  notRequired: 'Not required',
  pending: 'Awaiting payment',
  processing: 'Processing',
  completed: 'Paid',
  failed: 'Failed',
  expired: 'Expired',
  refundPending: 'Refund on the way',
  refunded: 'Refunded',
};

/*
 * STATUS → LABEL AND TREATMENT. ONE table, because the hub's row badges and this
 * screen's status line have to agree: a row that says one thing in the list and
 * another when opened is the single most alarming inconsistency this surface can
 * produce, so both read this table.
 *
 * Every key here is a real member of REGISTRATION_STATUSES in
 * apps/backend/src/constants/registration-constants.js — checked against the
 * enum rather than guessed, including the winner and advanced families, which DO
 * exist (winner1st/2nd/3rd, advancedToR2/R3/QuarterFinal/SemiFinal/Final) and so
 * earn the trophy treatment.
 *
 * ON THE COLOURS, and on keeping --primary rare:
 *
 *   · `pendingPayment` is the ONLY status wearing a solid --primary fill. It is
 *     the only one with a clock running against it — the seat is held, and
 *     paymentExpired is what happens when the hold lapses — which is precisely
 *     the urgent/error register --primary is reserved for. --accent was the
 *     other candidate and is wrong: --accent means featured and secondary, so a
 *     seat about to evaporate would read as a promotion. There is deliberately
 *     no amber; the six-token system has no warning colour and inventing one
 *     would be a seventh.
 *   · `confirmed` is --primary too, per the design brief, but as a HAIRLINE
 *     OUTLINE, never a fill. Most rows in a healthy account are confirmed, and a
 *     list of solid red pills turns the signature colour into wallpaper — at
 *     which point the one pill that means "pay now" has nothing left to shout
 *     with. Outline for the norm, fill for the one that needs a hand.
 *   · The quiet end (noShow, eliminated, disqualified, paymentExpired,
 *     eventCancelled, cancelled) sits on --ink-dim-4 with --ink text rather than
 *     --muted text. Badge type is 11px and --muted is only ~3.5:1 on --surface;
 *     these labels carry meaning, so they may not be the ones that fail.
 */
const REGISTRATION_STATUS_META = {
  confirmed: { label: 'Confirmed', tone: 'confirmed' },
  waitlisted: { label: 'Waitlisted', tone: 'waiting' },
  pendingPayment: { label: 'Payment due', tone: 'urgent' },
  cancelled: { label: 'Cancelled', tone: 'quiet' },
  attended: { label: 'Attended', tone: 'done', icon: 'check' },
  noShow: { label: 'Did not attend', tone: 'quiet' },
  winner1st: { label: 'First place', tone: 'prize', icon: 'trophy' },
  winner2nd: { label: 'Second place', tone: 'prize', icon: 'trophy' },
  winner3rd: { label: 'Third place', tone: 'prize', icon: 'trophy' },
  advancedToR2: { label: 'Through to round 2', tone: 'prize' },
  advancedToR3: { label: 'Through to round 3', tone: 'prize' },
  advancedToQuarterFinal: { label: 'Through to the quarter-final', tone: 'prize' },
  advancedToSemiFinal: { label: 'Through to the semi-final', tone: 'prize' },
  advancedToFinal: { label: 'Through to the final', tone: 'prize' },
  eliminated: { label: 'Eliminated', tone: 'quiet' },
  disqualified: { label: 'Disqualified', tone: 'quiet' },
  paymentExpired: { label: 'Payment expired', tone: 'quiet' },
  eventCancelled: { label: 'Event cancelled', tone: 'quiet' },
};

/* An unknown status is shown VERBATIM rather than hidden. A status this build
   has never heard of is a deploy skew, and swallowing it would tell the
   participant their registration has no state at all. */
function readStatusMeta(status) {
  return REGISTRATION_STATUS_META[status] ?? { label: String(status ?? '—'), tone: 'quiet' };
}

/*
 * The status badge, shared by the hub's rows and this screen's header.
 * `size="lg"` is the detail's own line; the hub uses the default.
 *
 * THE COMPONENT is the export, not the table behind it. The table and its
 * lookup stay module-private deliberately: react-refresh only keeps its state
 * across edits while a file exports components and nothing else, and the hub
 * has no use for the raw map anyway — it wants a badge, and letting it read the
 * table would be a second place that decides what a status looks like.
 */
export function StatusBadge({ status, waitlistPosition = null, size = 'md' }) {
  const meta = readStatusMeta(status);
  const className = ['drd-badge', `drd-badge--${meta.tone}`, size === 'lg' ? 'drd-badge--lg' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <span className={className}>
      {meta.icon === 'trophy' ? <PrizeIcon size="sm" /> : null}
      {meta.icon === 'check' ? <CheckCircleIcon size="sm" /> : null}
      {meta.label}
      {/* The queue place is the whole point of a waitlisted row. Without it the
          badge says "wait" and answers nothing. */}
      {status === 'waitlisted' && waitlistPosition ? ` — number ${waitlistPosition}` : ''}
    </span>
  );
}

/*
 * COPY-TO-CLIPBOARD, with the bit an icon morph always forgets.
 *
 * The glyph swapping to a tick is silent to a screen reader: nothing about the
 * button's accessible name changes, so a blind user presses copy and is told
 * nothing at all. The aria-live region below is the announcement, and it is
 * VISUALLY HIDDEN rather than aria-label churn, because changing a button's own
 * name mid-press is announced inconsistently across screen readers.
 *
 * The 1.5s timer is cleared on unmount. Inside a bottom sheet that is not
 * hypothetical: copy the code, dismiss the sheet, and the callback fires into an
 * unmounted component.
 */
function CopyCodeButton({ value, accessibleName }) {
  const [state, setState] = useState('idle'); // idle | copied | failed
  const timerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  async function handleCopy() {
    window.clearTimeout(timerRef.current);
    try {
      /* navigator.clipboard is absent on an insecure origin and refusable even
         on a secure one, so failure is REPORTED. A code someone believes they
         copied and did not is worse than a visible failure. */
      await navigator.clipboard.writeText(value);
      setState('copied');
      timerRef.current = window.setTimeout(() => setState('idle'), COPIED_HOLD_MS);
    } catch {
      setState('failed');
    }
  }

  return (
    <>
      <button
        type="button"
        className={state === 'copied' ? 'drd-copy drd-copy--done' : 'drd-copy'}
        onClick={handleCopy}
        aria-label={accessibleName}
      >
        <span className="drd-copy__glyph" aria-hidden="true">
          {state === 'copied' ? <CheckCircleIcon size="sm" /> : null}
        </span>
        {state === 'copied' ? COPY.copied : COPY.copyCode}
      </button>
      <span className="drd-sr" role="status" aria-live="polite">
        {state === 'copied' ? COPY.copyAnnouncement : ''}
        {state === 'failed' ? COPY.copyFailed : ''}
      </span>
    </>
  );
}

/*
 * The thumbnail. Every poster in this data is null, so the placeholder is not an
 * edge case — it is what everybody sees. A grey box would be an admission that
 * the screen has nothing; the event's own initials over the --primary/--accent
 * wash is the same derived mark the fest and event cards already use, so a
 * posterless registration looks designed rather than broken.
 */
function readMonogram(name) {
  const letters = String(name ?? '')
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}]/gu, '').charAt(0))
    .filter(Boolean);
  return letters.slice(0, 2).join('').toUpperCase();
}

function EventThumb({ event }) {
  const [failed, setFailed] = useState(false);
  if (event.posterImageUrl && !failed) {
    return (
      <img
        className="drd-thumb drd-thumb--image"
        src={event.posterImageUrl}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="drd-thumb drd-thumb--mark" aria-hidden="true">
      {readMonogram(event.eventName)}
    </span>
  );
}

/* One labelled value. A definition list, not a grid of spans: name/value pairs
   are what <dl> is for, and it is how a screen reader gets the pairing. */
function Field({ label, value }) {
  if (!value) {
    return null;
  }
  return (
    <div className="drd-field">
      <dt className="drd-field__label">{label}</dt>
      <dd className="drd-field__value">{value}</dd>
    </div>
  );
}

function Section({ title, children, headingLevel }) {
  const Heading = headingLevel;
  return (
    <section className="drd-section">
      <Heading className="drd-section__title">{title}</Heading>
      {children}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   The component the three surfaces share.
   ═══════════════════════════════════════════════════════════════════════════ */

/*
 * Sentence case, IST. Replaces formatDetailDate(), which is the retired
 * stamped-uppercase voice: it rendered "SEP 11" and "Registered SEP 9" inside a
 * sheet whose every other line is sentence case, and a single shouting
 * fragment mid-paragraph is more conspicuous than it sounds.
 */
const DETAIL_DATE = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
});

function formatDetailDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : DETAIL_DATE.format(date);
}

export function RegistrationDetail({
  registrationId,
  /* 'page' = the route; 'embedded' = inside the sheet or the desktop panel. */
  variant = 'page',
  /* Called after a successful cancel so the hub can refresh its list. The detail
     refetches itself regardless — this is only for the list behind it. */
  onChanged = null,
}) {
  const navigate = useNavigate();
  const { currentUser } = useAuthentication();

  const [registration, setRegistration] = useState(null);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [collegeName, setCollegeName] = useState('');
  const [pass, setPass] = useState(null);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [cancellationReason, setCancellationReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  // Captured once so the cancellation-window check is a pure computation for
  // this render pass and cannot answer differently twice for the same data.
  const [nowMs] = useState(() => Date.now());

  /* Inside the sheet and the panel the section titles sit under a title the
     parent already rendered, so they are h3 there and h2 on the page. */
  const headingLevel = variant === 'page' ? 'h2' : 'h3';

  const loadRegistration = useCallback(async () => {
    setLoadState('loading');
    try {
      const detail = await apiClient.get(`/registrations/${registrationId}`);
      setRegistration(detail);
      setLoadState('ready');
      /* The entry pass is FEST-scoped, not registration-scoped, and is
         best-effort: no pass, no section, and never an error on this screen —
         a missing pass is not a failure to load the registration. */
      const festId = detail?.eventId?.festId?.id;
      if (festId) {
        apiClient
          .get(`/passes/mine?festId=${festId}`)
          .then((passPayload) => setPass(passPayload ?? null))
          .catch(() => setPass(null));
      }
    } catch {
      setLoadState('error');
    }
  }, [registrationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRegistration();
  }, [loadRegistration]);

  /* Switching rows in the desktop panel must not leave the previous row's pass
     QR on screen under the new row's name. */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPass(null);
    setIsConfirmingCancel(false);
    setCancelError('');
    setCancellationReason('');
  }, [registrationId]);

  // The auth user carries only a collegeId; this is the same resolution the
  // profile screen uses. Silent failure just hides the row.
  useEffect(() => {
    if (!currentUser?.collegeId) {
      return;
    }
    apiClient
      .get('/colleges')
      .then((payload) => {
        const colleges = payload?.colleges ?? payload ?? [];
        const college = colleges.find((candidate) => candidate.id === currentUser.collegeId);
        setCollegeName(college?.commonName ?? college?.collegeName ?? '');
      })
      .catch(() => {});
  }, [currentUser?.collegeId]);

  const answeredResponses = useMemo(
    () =>
      (registration?.customResponses ?? []).filter(
        (response) => response.answerText || response.answerChoice,
      ),
    [registration],
  );

  async function handleCancel() {
    if (cancellationReason.trim().length < MINIMUM_REASON_LENGTH || isCancelling) {
      return;
    }
    setCancelError('');
    setIsCancelling(true);
    try {
      await apiClient.post(`/registrations/${registrationId}/cancel`, {
        cancellationReason: cancellationReason.trim(),
      });
      setIsConfirmingCancel(false);
      setCancellationReason('');
      await loadRegistration();
      await onChanged?.();
    } catch (error) {
      setCancelError(error?.message || COPY.cancelFailed);
    } finally {
      setIsCancelling(false);
    }
  }

  if (loadState === 'loading') {
    return (
      <div className={variant === 'page' ? 'drd-screen' : ''}>
        <div className={variant === 'page' ? 'drd-page' : ''}>
          <div className="drd-skeletons" aria-busy="true" aria-label={COPY.loading}>
            <div className="drd-skel drd-skel--head" />
            <div className="drd-skel" />
            <div className="drd-skel" />
          </div>
        </div>
      </div>
    );
  }

  if (loadState === 'error' || !registration) {
    return (
      <div className={variant === 'page' ? 'drd-screen' : ''}>
        <div className={variant === 'page' ? 'drd-page' : ''}>
          <div className="drd-state">
            <span className="drd-state__icon">
              <RetryIcon size="lg" />
            </span>
            <p className="drd-state__title">{COPY.errorTitle}</p>
            <p className="drd-state__text">{COPY.errorText}</p>
            <button type="button" className="drd-button" onClick={loadRegistration}>
              {COPY.retry}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const event = registration.eventId ?? {};
  const fest = event.festId ?? {};
  const sponsor = festTitleSponsor(fest);
  const team = registration.teamId ?? null;
  const status = registration.status;
  const isPaid = (registration.totalFeePaise ?? 0) > 0;

  const eventStartsMs = event.startsAt ? new Date(event.startsAt).getTime() : 0;
  const minutesUntilEvent = (eventStartsMs - nowMs) / 60000;
  const isCancellable =
    CANCELLABLE_SELF_STATUSES.includes(status) && minutesUntilEvent > CANCELLATION_FREEZE_MINUTES;

  const foodLabel = FOOD_PREFERENCE_OPTIONS.find(
    (option) => option.value === registration.foodPreference,
  )?.label;
  const hasAccommodationAnswer =
    registration.needsAccommodation !== null && registration.needsAccommodation !== undefined;

  /* The QR is the credential. It appears only for a status that can actually
     walk through a gate, and only when a pass exists. */
  const showPass = ['confirmed', 'attended'].includes(status) && Boolean(pass?.qrToken);

  const leaderId = team?.leaderUserId?.id ?? team?.leaderUserId ?? null;
  /* Ended, from the event's own schedule rather than the registration's — the
     question the feedback prompt asks is "has this thing happened yet". */
  const endsAtMs = event.endsAt ? new Date(event.endsAt).getTime() : eventStartsMs;
  const hasEnded = Boolean(endsAtMs) && endsAtMs < nowMs;
  const reasonRemaining = MINIMUM_REASON_LENGTH - cancellationReason.trim().length;

  const body = (
    <div className="drd-body">
      {/*
        ── THE TWO WRAPPERS BELOW ARE LAYOUT AND NOTHING ELSE. ────────────
        On a phone, and inside the sheet and the desktop panel, both are
        `display: contents` — they contribute no box at all, so the blocks stay
        exactly the flat stack they were, in exactly the order they are
        written. They become real boxes only on the
        /my-registrations/:id ROUTE at desktop widths, where .drd-page turns
        them into the 8/4 split. No content moves and no state changes.
      */}
      <div className="drd-aside">
      {/* ── Identity. Thumbnail, name, when, where, status. The one block that
             answers "which registration is this" without scrolling. ────────── */}
      <div className="drd-head">
        <EventThumb event={event} />
        <div className="drd-head__text">
          {event.category ? (
            <p className="drd-head__kicker">{formatCategoryLabel(event.category)}</p>
          ) : null}
          {/*
            * The name is omitted in the sheet, where the sheet's own title is
            * already the event name — printing it twice, 40px apart, in two
            * different sizes, is the redundancy the sheet title was moved here
            * to remove. On the full page there is no such title, so the name
            * has to be here.
            */}
          {variant === 'page' ? <p className="drd-head__name">{event.eventName}</p> : null}
          <p className="drd-head__fest">{fest.festName}</p>
        </div>
      </div>

      {/*
        * The fest's title sponsor, as a credit under the fest it belongs to.
        *
        * Placed here rather than at the foot of the page on purpose: a sponsor
        * is a co-production credit on the EVENT, and at the bottom of a list of
        * payment rows it reads as an advertisement bolted onto a receipt. Next
        * to the fest name it is the same treatment the fest and event pages
        * already use, so the three surfaces agree.
        *
        * Renders nothing at all when the fest has no sponsors, which is most of
        * them — an empty "Sponsored by" strip is worse than none.
        */}
      {sponsor ? (
        <div className="drd-sponsor">
          <span className="drd-sponsor__label">{COPY.sponsorLabel}</span>
          {sponsor.logoUrl ? (
            <img className="drd-sponsor__logo" src={sponsor.logoUrl} alt={sponsor.sponsorName} />
          ) : (
            <span className="drd-sponsor__name">{sponsor.sponsorName}</span>
          )}
        </div>
      ) : null}

      <div className="drd-statusline">
        <StatusBadge status={status} waitlistPosition={registration.waitlistPosition} size="lg" />
        {registration.registeredAt ? (
          <span className="drd-statusline__when">
            {COPY.registeredOn(formatDetailDate(registration.registeredAt))}
          </span>
        ) : null}
      </div>

      {/* The organiser pulling the event is not the same thing as the
          participant walking away, and the copy must not blame them for it. */}
      {status === 'eventCancelled' || registration.eventCancelledAt ? (
        <div className="drd-notice">
          <p className="drd-notice__title">{COPY.eventCancelledHeader}</p>
          <p className="drd-notice__text">{COPY.eventCancelledHint}</p>
        </div>
      ) : null}

      <dl className="drd-facts">
        {event.startsAt ? (
          <div className="drd-fact">
            <dt className="drd-sr">When</dt>
            <dd className="drd-fact__value">
              <span className="drd-fact__icon">
                <DateIcon size="sm" />
              </span>
              {[formatDetailDate(event.startsAt), formatClockTime(event.startsAt)]
                .filter(Boolean)
                .join(', ')}
            </dd>
          </div>
        ) : null}
        {event.venue ? (
          <div className="drd-fact">
            <dt className="drd-sr">Where</dt>
            <dd className="drd-fact__value">
              <span className="drd-fact__icon">
                <VenueIcon size="sm" />
              </span>
              {event.venue}
            </dd>
          </div>
        ) : null}
        <div className="drd-fact">
          <dt className="drd-sr">Entry</dt>
          <dd className="drd-fact__value">
            <span className="drd-fact__icon">
              <TeamIcon size="sm" />
            </span>
            {team ? formatEventTypeFull(event) : COPY.soloLabel}
            {event.scoringFormat && event.scoringFormat !== 'none'
              ? `, ${formatScoringFormat(event)}`
              : ''}
          </dd>
        </div>
      </dl>
      </div>

      <div className="drd-main">

      {/* ── Team ──────────────────────────────────────────────────────────── */}
      {team ? (
        <Section title={COPY.teamHeader} headingLevel={headingLevel}>
          <p className="drd-teamname">{team.teamName}</p>
          <ul className="drd-roster">
            {(team.memberUserIds ?? []).map((member, index) => {
              const isLeader = leaderId && (member.id ?? member._id) === leaderId;
              return (
                <li className="drd-roster__row" key={member.emailAddress ?? member.id ?? index}>
                  <UserAvatar user={member} size="small" />
                  <span className="drd-roster__name">{member.fullName ?? member.emailAddress}</span>
                  <span className="drd-roster__role">
                    {isLeader ? COPY.roleLeader : COPY.roleMember}
                  </span>
                </li>
              );
            })}
          </ul>
          {team.inviteCode ? (
            <div className="drd-code">
              <span className="drd-code__label">{COPY.inviteCodeLabel}</span>
              <code className="drd-code__value">{team.inviteCode}</code>
              <CopyCodeButton
                value={team.inviteCode}
                accessibleName={COPY.copyCodeFor(team.teamName)}
              />
            </div>
          ) : null}
          {/*
            Locking a team and claiming the captaincy live on /my-teams and stay
            there. NOT an oversight: the populated team on this endpoint carries
            teamName, inviteCode, leaderUserId and members and nothing else — no
            lock state, no captain — so a lock button here would have to render
            without knowing whether the team is already locked. A link to the
            screen that does know is honest; a button that guesses is not.
          */}
          <button type="button" className="drd-linkish" onClick={() => navigate('/my-teams')}>
            {COPY.teamManage}
          </button>
        </Section>
      ) : null}

      {/* ── Entry pass ────────────────────────────────────────────────────── */}
      {showPass ? (
        <Section title={COPY.passHeader} headingLevel={headingLevel}>
          <div className="drd-pass">
            <div className="drd-pass__code">
              <QRCodeSVG value={pass.qrToken} size={148} level="H" marginSize={2} />
            </div>
            <p className="drd-pass__hint">{COPY.passHint}</p>
            {/*
              THE ONE PRIMARY ACTION on this surface. Everything else here is a
              record; this is the thing somebody standing at a gate is reaching
              for, and the small QR above is a reassurance that it exists rather
              than the thing they should present — the pass screen is built to be
              the brightest thing in a scanner's frame, and this is not.
            */}
            <button
              type="button"
              className="drd-button drd-button--primary"
              onClick={() => navigate(`/my-passes/${fest.id}`)}
            >
              <PassIcon size="sm" />
              {COPY.openFullPass}
            </button>
          </div>
        </Section>
      ) : null}

      {/* ── Your details ──────────────────────────────────────────────────── */}
      <Section title={COPY.participantHeader} headingLevel={headingLevel}>
        <dl className="drd-fields">
          <Field label={COPY.labelName} value={currentUser?.fullName} />
          <Field label={COPY.labelRegNumber} value={currentUser?.usn} />
          <Field label={COPY.labelEmail} value={currentUser?.emailAddress} />
          <Field label={COPY.labelCollege} value={collegeName} />
        </dl>
      </Section>

      {/* Weight/gender/age only exist for events that ask for them. */}
      {registration.weightCategory || registration.genderCategory || registration.ageCategory ? (
        <Section title={COPY.categoriesHeader} headingLevel={headingLevel}>
          <dl className="drd-fields">
            <Field label={COPY.labelWeight} value={registration.weightCategory} />
            <Field label={COPY.labelGender} value={registration.genderCategory} />
            <Field label={COPY.labelAge} value={registration.ageCategory} />
          </dl>
        </Section>
      ) : null}

      {/* ── Custom answers ────────────────────────────────────────────────── */}
      {answeredResponses.length > 0 ? (
        <Section title={COPY.answersHeader} headingLevel={headingLevel}>
          <dl className="drd-fields">
            {answeredResponses.map((response, index) => (
              <Field
                key={response.questionId ?? index}
                label={response.questionText ?? '—'}
                value={response.answerText ?? response.answerChoice}
              />
            ))}
          </dl>
        </Section>
      ) : null}

      {/* ── Food and stay ─────────────────────────────────────────────────── */}
      {foodLabel || hasAccommodationAnswer ? (
        <Section title={COPY.extrasHeader} headingLevel={headingLevel}>
          <dl className="drd-fields">
            <Field label={COPY.foodLabel} value={foodLabel} />
            {hasAccommodationAnswer ? (
              <Field
                label={COPY.accommodationLabel}
                value={
                  registration.needsAccommodation ? COPY.accommodationYes : COPY.accommodationNo
                }
              />
            ) : null}
          </dl>
        </Section>
      ) : null}

      {/* ── Payment ───────────────────────────────────────────────────────── */}
      {isPaid ? (
        <Section title={COPY.paymentHeader} headingLevel={headingLevel}>
          <dl className="drd-fields">
            <Field
              label={COPY.paymentAmount}
              value={formatPaiseAmount(registration.totalFeePaise)}
            />
            <Field
              label={COPY.paymentStatusLabel}
              value={
                PAYMENT_STATUS_TEXT[registration.paymentStatus] ?? registration.paymentStatus
              }
            />
            <Field label={COPY.paymentRef} value={registration.paymentReference} />
          </dl>
          {/* The line-by-line breakdown, when the API sent one. Two rows of
              "Registration ₹0" is noise, so it only appears past one line. */}
          {(registration.feeBreakdown ?? []).length > 1 ? (
            <ul className="drd-breakdown">
              {registration.feeBreakdown.map((line, index) => (
                <li className="drd-breakdown__row" key={line.label ?? index}>
                  <span>
                    {line.label}
                    {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                  </span>
                  <span className="drd-breakdown__amount">
                    {formatPaiseAmount(line.subtotalPaise)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}

      {/*
        ── Rate it ─────────────────────────────────────────────────────────
        Only once the event is over. The card decides for itself whether this
        person is entitled to rate — it asks GET /events/:id/feedback/me, which
        answers from accepted scans — and renders nothing if not, so somebody
        who registered and never turned up sees no prompt.

        A NOTE FOR WHOEVER REDESIGNS IT NEXT: EventFeedbackCard is still on the
        retired Heritage palette (surface-container, on-surface-variant, olive)
        and is shared with screens that have not moved, so it is deliberately
        untouched here. Inside a dedal sheet its greys and its caps labels read
        as a different application. It should be converted in its own pass,
        with its other callers, rather than diverged for this one.
      */}
      {hasEnded && event.id ? (
        <div className="drd-feedback">
          <EventFeedbackCard eventId={event.id} />
        </div>
      ) : null}

      {/* ── The cancellation record, or the way out ───────────────────────── */}
      {status === 'cancelled' ? (
        <div className="drd-notice">
          <p className="drd-notice__title">
            {registration.cancelledByRole
              ? COPY.cancelledBy(registration.cancelledByRole)
              : COPY.cancelledHeader}
          </p>
          {registration.cancellationReason ? (
            <p className="drd-notice__text">{registration.cancellationReason}</p>
          ) : null}
          {registration.cancelledAt ? (
            <p className="drd-notice__when">
              {formatDetailDate(registration.cancelledAt)}, {formatClockTime(registration.cancelledAt)}
            </p>
          ) : null}
        </div>
      ) : isConfirmingCancel ? (
        <div className="drd-confirm">
          <p className="drd-confirm__title">{COPY.cancelConfirmTitle}</p>
          <p className="drd-confirm__text">{COPY.cancelConfirmBody}</p>
          <label className="drd-confirm__label" htmlFor="drd-cancel-reason">
            {COPY.cancelReasonLabel}
          </label>
          <textarea
            id="drd-cancel-reason"
            className="drd-textarea"
            value={cancellationReason}
            onChange={(changeEvent) => setCancellationReason(changeEvent.target.value)}
            maxLength={MAXIMUM_REASON_LENGTH}
            rows={3}
            placeholder={COPY.cancelReasonPlaceholder}
          />
          {/* Says what is missing rather than leaving a disabled button with no
              explanation — the commonest reason a form feels broken. */}
          {reasonRemaining > 0 ? (
            <p className="drd-confirm__hint">{COPY.cancelReasonShort(reasonRemaining)}</p>
          ) : null}
          {cancelError ? (
            <p className="drd-confirm__error" role="alert">
              {cancelError}
            </p>
          ) : null}
          <div className="drd-confirm__actions">
            <button
              type="button"
              className="drd-button drd-button--primary"
              onClick={handleCancel}
              disabled={reasonRemaining > 0 || isCancelling}
            >
              {COPY.cancelConfirm}
            </button>
            <button
              type="button"
              className="drd-button"
              onClick={() => setIsConfirmingCancel(false)}
              disabled={isCancelling}
            >
              {COPY.cancelKeep}
            </button>
          </div>
        </div>
      ) : isCancellable ? (
        <button
          type="button"
          className="drd-danger"
          onClick={() => setIsConfirmingCancel(true)}
        >
          {COPY.cancelOpen}
        </button>
      ) : CANCELLABLE_SELF_STATUSES.includes(status) ? (
        <div className="drd-notice">
          <p className="drd-notice__title">{COPY.cancelWindowClosed}</p>
          <p className="drd-notice__text">{COPY.cancelWindowHint}</p>
        </div>
      ) : null}
      </div>
    </div>
  );

  if (variant === 'page') {
    return (
      <div className="drd-screen">
        {/* One bar, not three rows. This page used to spend a row on a "Back"
            button, then a second on a display-size "My registration" heading,
            then start the content — 120px of chrome before the event name,
            which is the thing you opened the page for. ScreenHeader carries
            both, and standing the app header down with it. */}
        <ScreenHeader title={COPY.pageTitle} />

        <div className="drd-page">{body}</div>
      </div>
    );
  }

  return body;
}

/* The route. Deep links from confirmation emails land here and must keep
   working, so it stays the default export under the same filename. */
function RegistrationDetailScreen() {
  const { registrationId } = useParams();
  return <RegistrationDetail registrationId={registrationId} variant="page" />;
}

export default RegistrationDetailScreen;

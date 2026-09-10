// RegistrationFormScreen.jsx
// Route: /register/:eventId — the last screen before a commitment.
//
// THE SHAPE IS THE EVENT'S, NOT THE FORM'S. A free solo sign-up and a paid
// five-person team are not the same act and must not wear the same chrome, so
// this screen resolves to one of three shapes on load:
//
//   solo + free   one screen, no step bar, one button: "Register".
//   solo + paid   the same screen; the button carries the price.
//   team          two steps — describe the team, then review and commit —
//                 with the shared .drg-steps bar, because here there genuinely
//                 is a second step. A progress bar that only ever reads 1 of 1
//                 invents a journey out of a single tap, so solo gets none.
//
// Everything visual comes from design/dedal-tokens.css → design/registration.css
// (the `drg-` furniture shared with checkout, success and contingent purchase)
// → registration-form.css. There are no Tailwind utilities and no icon-font
// ligatures on this screen; every glyph is an SVG from DetailIcons or a shape
// drawn in CSS.
//
// SUBMIT PATHS, unchanged from the version this replaces:
//   solo            POST /events/:eventId/registrations/solo
//   team, roster    POST /events/:eventId/registrations/team  { memberEmails }
//   team, by code   POST /teams  { eventId, teamName } → a forming team whose
//                   invite code the captain shares; members self-join later.
// A nonzero total is handed to /checkout, which owns the gateway. Nothing on
// this screen talks to Razorpay.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import apiClient from '../../api-client/api-client.js';
import { fetchEventWithFest } from '../../helpers/public-catalog.js';
import {
  computeCapacityState,
  formatEventTypeFull,
  formatShortDate,
  isRegistrationClosed,
} from '../../helpers/event-format.js';
import {
  computeRegistrationFeePaise,
  formatOfferRateLabel,
  formatPaiseAsRupees,
} from '../../helpers/fee-math.js';
import EventContextCard from '../../components/event-context-card/EventContextCard.jsx';
import { BackIcon, OfflineIcon, RetryIcon } from '../../components/detail-icons/DetailIcons.jsx';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { formatTeamErrorMessage } from '../../helpers/team-error-messages.js';
import '../../design/registration.css';
import './registration-form.css';

/*
 * The four custom-question types the backend enum actually defines. There is no
 * file-upload, checkbox or multi-select type: rendering one would collect an
 * answer the API has nowhere to put.
 *
 * TODO: a file-upload question needs a backend field (a stored object key on
 * the response, plus an upload endpoint) before it can exist here at all.
 */
const QUESTION_TYPES = {
  SHORT_TEXT: 'shortText',
  LONG_TEXT: 'longText',
  SINGLE_CHOICE: 'singleChoice',
  YES_NO: 'yesNo',
};

/* Above this many options the radio list is taller than the viewport on a
   phone and a native select — which opens as a scrollable sheet — is the
   kinder control. Below it, radios: everything visible, one tap to answer. */
const CHOICES_AS_SELECT_ABOVE = 6;

/* Mirrors the backend's CONTACT_PHONE_PATTERN (registration-validator.js), so
   the field refuses locally exactly what the API would refuse remotely rather
   than inventing a stricter rule of its own. */
const CONTACT_PHONE_PATTERN = /^\+?[0-9][0-9 -]{3,18}[0-9]$/;
/* Deliberately loose. The server runs validator.isEmail; anything narrower here
   would reject addresses the API accepts, and this check exists to catch typing
   mistakes, not to police the RFC. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FOOD_PREFERENCES = [
  { value: 'veg', label: 'Vegetarian' },
  { value: 'nonVeg', label: 'Non-vegetarian' },
  { value: 'noMealNeeded', label: 'No meal needed' },
];

/* Sentence-case rate wording for fee-math's formatOfferRateLabel. The shared
   REGISTRATION_FORM_COPY strings are the retired all-caps voice, so this screen
   passes its own. */
const RATE_COPY = {
  offerFree: 'Free',
  ratePerPersonPerDay: (rupees) => `₹${rupees} per person per day`,
  ratePerPerson: (rupees) => `₹${rupees} per person`,
  ratePerDay: (rupees) => `₹${rupees} per day`,
  rateTotal: (rupees) => `₹${rupees}`,
};

/* Category values arrive as raw enum-ish strings ("under60kg", "womens"). */
function humanise(value) {
  const spaced = String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/* ── Small local controls ────────────────────────────────────────────────── */

function Field({ id, label, optional, hint, error, children }) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={error ? 'drg-field drg-field--error' : 'drg-field'}>
      <label className="drg-field__label" htmlFor={id}>
        {label}
        {optional ? <span className="drg-field__optional">Optional</span> : null}
      </label>
      {typeof children === 'function' ? children(describedBy || undefined) : children}
      {hint ? (
        <span className="drg-field__hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="drg-field__error" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/* The minus/plus stepper. Local rather than components/quantity-stepper, which
   is still built from the retired Heritage utilities and a material-symbols
   ligature — see registration-form.css. Bounds disable rather than clamp
   silently, and the value is announced. */
function Stepper({ label, value, minimum, maximum, onChange, disabled }) {
  return (
    <div className="drf-stepper">
      <span className="drf-stepper__label">{label}</span>
      <div className="drf-stepper__controls">
        <button
          type="button"
          className="drf-stepper__button"
          aria-label={`Decrease ${label}`}
          disabled={disabled || value <= minimum}
          onClick={() => onChange(value - 1)}
        />
        <span className="drf-stepper__value" role="status" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          className="drf-stepper__button drf-stepper__button--plus"
          aria-label={`Increase ${label}`}
          disabled={disabled || value >= maximum}
          onClick={() => onChange(value + 1)}
        />
      </div>
    </div>
  );
}

/* A wrapping row of single-select chips built on real radios, used for the
   optional category selectors. "No preference" is a real option rather than a
   second tap that clears the first: a toggle-to-clear pill is undiscoverable
   and has no keyboard equivalent. */
function ChipGroup({ name, legend, options, value, onChange, disabled }) {
  return (
    <fieldset className="drf-chips" disabled={disabled}>
      <legend className="drg-field__label">{legend}</legend>
      {[{ value: '', label: 'No preference' }, ...options].map((option) => (
        <label className="drf-chip" key={option.value || 'none'}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

/* ── The screen ──────────────────────────────────────────────────────────── */

function RegistrationFormScreen() {
  const navigate = useTransitionNavigate();
  const { eventId } = useParams();
  const { currentUser } = useAuthentication();
  const isOnline = useOnlineStatus();

  const [event, setEvent] = useState(null);
  const [fest, setFest] = useState(null);
  const [loadState, setLoadState] = useState('loading');

  const [step, setStep] = useState(1);
  /*
   * THE TEAM TRADE-OFF, made visible rather than argued away.
   *
   * The screen this replaces used ONLY the invite-code path: the captain names
   * a team, the server returns a code, members join themselves. That is a real
   * product decision — it never asks the captain for addresses they may not
   * have, and each joiner passes their own profile checks. Replacing it with a
   * roster is a reversal, not a restyle.
   *
   * So both live here. Roster is the default because the brief asks for member
   * slots, and the code path is one tap away on step 1. They post to different
   * endpoints and produce different teams (LOCKED vs FORMING), which is why
   * this is a mode and not a rendering detail.
   */
  const [teamMode, setTeamMode] = useState('roster');

  const [answers, setAnswers] = useState({});
  const [contactPhone, setContactPhone] = useState(() => currentUser?.phoneNumber ?? '');
  const [teamName, setTeamName] = useState('');
  const [memberEmails, setMemberEmails] = useState([]);
  const [categories, setCategories] = useState({ weight: '', gender: '', age: '' });
  const [acceptedMedical, setAcceptedMedical] = useState(false);
  const [isFoodSelected, setIsFoodSelected] = useState(false);
  const [foodPreference, setFoodPreference] = useState('');
  const [foodOrderCount, setFoodOrderCount] = useState(1);
  const [needsAccommodation, setNeedsAccommodation] = useState(false);
  /* Non-reserved add-ons keyed "scope:offerKey" — NOT by key alone: a fest-wide
     "Travel" and this event's "Travel" are different offers at different rates
     and both may be ticked. */
  const [offerChoices, setOfferChoices] = useState({});

  /* Which fields have been left once. Inline validation fires on blur, never on
     first keystroke: telling somebody their address is invalid while they are
     still on the second character is noise, not help. */
  const [touched, setTouched] = useState({});
  const [submitState, setSubmitState] = useState('idle'); // idle | sending | done
  const [submitError, setSubmitError] = useState('');
  const [pendingConflict, setPendingConflict] = useState(null);

  const loadEvent = useCallback(async () => {
    setLoadState('loading');
    try {
      const result = await fetchEventWithFest(eventId);
      if (!result) {
        setLoadState('error');
        return;
      }
      setEvent(result.event);
      setFest(result.fest);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [eventId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEvent();
  }, [loadEvent]);

  const isTeam = event?.eventType === 'team';
  const minimumTeamSize = event?.minimumTeamSize ?? 1;
  const maximumTeamSize = event?.maximumTeamSize ?? 1;

  /* Open with exactly the slots the event requires. Fewer would make the first
     thing the form says be "add more"; more would make it "delete some". */
  const slotsPrimed = useRef(false);
  useEffect(() => {
    if (!isTeam || slotsPrimed.current) {
      return;
    }
    slotsPrimed.current = true;
    setMemberEmails(Array.from({ length: Math.max(0, minimumTeamSize - 1) }, () => ''));
  }, [isTeam, minimumTeamSize]);

  const captainEmail = (currentUser?.emailAddress ?? '').trim().toLowerCase();

  const questions = useMemo(
    () =>
      [...(event?.customQuestions ?? [])].sort(
        (left, right) => (left.displayOrder ?? 0) - (right.displayOrder ?? 0),
      ),
    [event],
  );

  const activeOffers = useMemo(() => {
    const festOffers = (fest?.offers ?? [])
      .filter((offer) => offer.isActive !== false)
      .map((offer) => ({ offer, scope: 'fest' }));
    const eventOffers = (event?.offers ?? [])
      .filter((offer) => offer.isActive !== false)
      .map((offer) => ({ offer, scope: 'event' }));
    return [...festOffers, ...eventOffers];
  }, [fest, event]);

  const hasFoodOffer = activeOffers.some(({ offer }) => offer.offerKey === 'food');
  const hasAccommodationOffer = activeOffers.some(
    ({ offer }) => offer.offerKey === 'accommodation',
  );

  const filledEmails = memberEmails.map((value) => value.trim()).filter(Boolean);
  /*
   * Seats billed. The roster endpoint charges the WHOLE team (captain + roster)
   * so a perPerson event multiplies by the full count; the invite-code path
   * registers the captain alone and each joiner pays their own share later.
   */
  const teamSize = isTeam && teamMode === 'roster' ? 1 + filledEmails.length : 1;

  function readChoice(scopedKey) {
    return offerChoices[scopedKey] ?? { selected: false, numberOfPeople: 1, numberOfDays: 1 };
  }

  const feeSelections = activeOffers
    .map(({ offer, scope }) => {
      if (offer.offerKey === 'food') {
        const booked = isFoodSelected && foodPreference && foodPreference !== 'noMealNeeded';
        return booked
          ? { offer, numberOfPeople: isTeam ? foodOrderCount : 1, numberOfDays: 1 }
          : null;
      }
      if (offer.offerKey === 'accommodation') {
        return needsAccommodation ? { offer, numberOfPeople: 1, numberOfDays: 1 } : null;
      }
      const choice = readChoice(`${scope}:${offer.offerKey}`);
      return choice.selected
        ? { offer, numberOfPeople: choice.numberOfPeople, numberOfDays: choice.numberOfDays }
        : null;
    })
    .filter(Boolean);

  const fee = computeRegistrationFeePaise(event, teamSize, feeSelections);
  const isPaid = fee.totalFeePaise > 0;
  const totalLabel = formatPaiseAsRupees(fee.totalFeePaise);

  /*
   * THE DOOR, READ FRESH ON THIS SCREEN.
   *
   * A place can be taken between the event page and here, so the gate is
   * computed from the event this screen just loaded rather than from anything
   * carried in navigation state. Cancelled is tested BEFORE closed: "not
   * happening" and "too late" are different news, and only one of them changes
   * whether somebody gets on a bus.
   */
  const gate = useMemo(() => {
    if (!event) {
      return null;
    }
    if (event.status === 'cancelled') {
      return {
        kind: 'cancelled',
        headline: 'This event was cancelled.',
        body: 'The organiser called it off, so there is nothing to register for. Anything you already paid for it is refunded through the same channel.',
        label: 'Event cancelled',
      };
    }
    if (isRegistrationClosed(event)) {
      const closedOn = event.registrationClosesAt
        ? ` Registration closed on ${formatShortDate(event.registrationClosesAt)}.`
        : '';
      return {
        kind: 'closed',
        headline: 'Registration has closed.',
        body: `The organiser is no longer taking sign-ups for this event.${closedOn}`,
        label: 'Registration closed',
      };
    }
    const state = computeCapacityState(event);
    if (state.isFull && !event.waitlistEnabled) {
      return {
        kind: 'full',
        headline: 'Every place is taken.',
        body: `${event.registeredCount ?? 0}/${event.capacity} slots filled. The organiser has not opened a waitlist for this event.`,
        label: 'Event full',
      };
    }
    if (state.isFull) {
      /* Live, not blocked. There is no separate waitlist endpoint — the same
         registration call is what the server turns into a waitlist row — so
         only the label changes here. */
      return { kind: 'waitlist', label: 'Join waitlist' };
    }
    return null;
  }, [event]);
  const isBlocked = Boolean(gate) && gate.kind !== 'waitlist';

  /* ── Validation, per field ─────────────────────────────────────────────── */

  function answerOf(questionId) {
    return answers[questionId] ?? {};
  }

  const questionErrors = {};
  for (const question of questions) {
    const answer = answerOf(question.questionId);
    const isAnswered = Boolean(answer.answerText?.trim() || answer.answerChoice);
    if (question.isRequired && !isAnswered) {
      questionErrors[question.questionId] = 'This one is required.';
    }
  }

  const phoneError =
    contactPhone.trim() && !CONTACT_PHONE_PATTERN.test(contactPhone.trim())
      ? 'Enter a phone number — digits, spaces or dashes, with an optional leading +.'
      : '';

  const trimmedTeamName = teamName.trim();
  const teamNameError = !isTeam
    ? ''
    : trimmedTeamName.length === 0
      ? 'Your team needs a name.'
      : trimmedTeamName.length < 2 || trimmedTeamName.length > 60
        ? 'Use between 2 and 60 characters.'
        : '';

  /* Per-slot errors. Duplicates are flagged on the LATER slot so the first
     occurrence stays the one that looks correct. */
  const memberErrors = memberEmails.map((raw, index) => {
    const value = raw.trim().toLowerCase();
    const isRequiredSlot = index < minimumTeamSize - 1;
    if (!value) {
      return isRequiredSlot ? 'Add an email address for this member.' : '';
    }
    if (!EMAIL_PATTERN.test(value)) {
      return 'That does not look like an email address.';
    }
    if (value === captainEmail) {
      return 'You are already on the team as captain.';
    }
    if (memberEmails.slice(0, index).some((other) => other.trim().toLowerCase() === value)) {
      return 'This address is already on the roster.';
    }
    return '';
  });

  const rosterSize = 1 + filledEmails.length;
  const rosterSizeError =
    isTeam && teamMode === 'roster' && rosterSize > maximumTeamSize
      ? `This event allows at most ${maximumTeamSize} people per team.`
      : '';

  const medicalError =
    event?.requiresMedicalDeclaration && !acceptedMedical
      ? 'Accept the declaration to continue.'
      : '';
  const foodError =
    hasFoodOffer && isFoodSelected && !foodPreference
      ? 'Pick one — including "no meal needed", which is a real answer.'
      : '';

  const stepOneValid =
    !teamNameError &&
    !rosterSizeError &&
    (teamMode === 'code' || memberErrors.every((message) => !message));

  const formValid =
    Object.keys(questionErrors).length === 0 &&
    !phoneError &&
    !medicalError &&
    !foodError &&
    (!isTeam || stepOneValid);

  const isSending = submitState === 'sending';
  const isDone = submitState === 'done';
  /* Team step 1 does not submit, so it is gated on step-1 fields alone —
     holding the whole form to account before the person has seen the rest of it
     would disable the button for reasons not yet on screen. */
  const isStepOne = isTeam && teamMode === 'roster' && step === 1;
  const canAct =
    isOnline && !isBlocked && !isSending && !isDone && (isStepOne ? stepOneValid : formValid);

  /* ── Submitting ────────────────────────────────────────────────────────── */

  function buildSharedPayload() {
    const payload = {
      customResponses: Object.entries(answers)
        .filter(([, answer]) => answer && (answer.answerText || answer.answerChoice))
        .map(([questionId, answer]) => ({ questionId, ...answer })),
    };
    /* Persisted only when actually changed — an untouched prefill means "use my
       account number" and stays null server-side. */
    const phone = contactPhone.trim();
    if (phone && phone !== (currentUser?.phoneNumber ?? '').trim()) {
      payload.contactPhoneOverride = phone;
    }
    if (event.requiresMedicalDeclaration) {
      payload.hasAcceptedMedicalDeclaration = acceptedMedical;
    }
    if (hasFoodOffer) {
      // An unticked food add-on IS "no meal needed": the backend always requires
      // an answer on a food-offering fest.
      payload.foodPreference = isFoodSelected ? foodPreference : 'noMealNeeded';
      if (isTeam && isFoodSelected && foodPreference !== 'noMealNeeded') {
        payload.foodOrderCount = foodOrderCount;
      }
    }
    if (hasAccommodationOffer) {
      payload.needsAccommodation = needsAccommodation;
    }
    const selectedOffers = Object.entries(offerChoices)
      .filter(([, choice]) => choice.selected)
      .map(([scopedKey, choice]) => {
        const [scope, ...keyParts] = scopedKey.split(':');
        return {
          scope,
          offerKey: keyParts.join(':'),
          numberOfPeople: choice.numberOfPeople ?? 1,
          numberOfDays: choice.numberOfDays ?? 1,
        };
      });
    if (selectedOffers.length > 0) {
      payload.offerSelections = selectedOffers;
    }
    return payload;
  }

  async function submitRegistration() {
    setSubmitError('');
    setPendingConflict(null);
    setSubmitState('sending');
    const sharedPayload = buildSharedPayload();

    try {
      let result;
      if (isTeam && teamMode === 'roster') {
        result = await apiClient.post(`/events/${event.id}/registrations/team`, {
          ...sharedPayload,
          teamName: trimmedTeamName,
          memberEmails: filledEmails,
        });
      } else if (isTeam) {
        result = await apiClient.post('/teams', {
          ...sharedPayload,
          eventId: event.id,
          teamName: trimmedTeamName,
        });
      } else {
        result = await apiClient.post(`/events/${event.id}/registrations/solo`, sharedPayload);
      }

      // A team result carries `registrations` (captain at index 0) and no
      // singular `registration`; solo carries `registration`.
      const created = result.registration ?? result.registrations?.[0] ?? null;
      setSubmitState('done');

      if (result.payment) {
        navigate(`/checkout/${result.payment.paymentGroupId}`, {
          state: {
            registrationId: created?.id ?? null,
            event,
            registration: created,
            team: result.team ?? null,
            payment: result.payment,
          },
        });
      } else if (isTeam) {
        navigate('/my-teams', { replace: true });
      } else if (typeof created?.id === 'string' && created.id !== '') {
        navigate(`/registration-success/${created.id}`);
      } else {
        /* A missing id must not navigate: "/registration-success/" matches no
           route and the catch-all would silently land them on home. The
           registration itself succeeded — send them to the list that proves it. */
        navigate('/my-registrations', { replace: true });
      }
    } catch (error) {
      setSubmitState('idle');
      if (error.code === 'PENDING_PAYMENT_EXISTS') {
        // A bare retry can never get past this, so offer the only two moves
        // that can: finish the payment already open, or throw it away.
        setPendingConflict({ paymentGroupId: error.details?.paymentGroupId ?? null });
      } else {
        setSubmitError(
          formatTeamErrorMessage(
            error,
            'Could not complete this registration. Check your answers and try again.',
          ),
        );
      }
    }
  }

  function handleAction() {
    if (!canAct) {
      return;
    }
    if (isStepOne) {
      setStep(2);
      window.scrollTo({ top: 0 });
      return;
    }
    submitRegistration();
  }

  async function handleCancelPendingAndRetry() {
    setPendingConflict(null);
    setSubmitError('');
    setSubmitState('sending');
    try {
      await apiClient.post(`/events/${event.id}/registrations/mine/cancel-pending`);
    } catch (error) {
      // A hold that vanished under us (expired, already cancelled) is not a
      // failure; anything else surfaces rather than retrying into the same wall.
      if (error.code !== 'REGISTRATION_NOT_FOUND') {
        setSubmitError(error.message || 'Could not release the pending registration.');
        setSubmitState('idle');
        return;
      }
    }
    setSubmitState('idle');
    await submitRegistration();
  }

  /* ── Copy for the one action ───────────────────────────────────────────── */

  function readActionLabel() {
    if (gate) {
      return gate.label;
    }
    if (isStepOne) {
      return 'Review team';
    }
    if (isTeam && teamMode === 'roster') {
      return isPaid ? `Pay ${totalLabel} for ${rosterSize} members` : 'Register team';
    }
    if (isTeam) {
      return isPaid ? `Pay ${totalLabel} and get a code` : 'Create team and get a code';
    }
    return isPaid ? `Pay ${totalLabel}` : 'Register';
  }

  function readDisabledReason() {
    if (!isOnline) {
      return "You're offline — registration needs a connection.";
    }
    if (gate && gate.kind === 'full') {
      return `${event.registeredCount ?? 0}/${event.capacity} slots filled.`;
    }
    if (gate && gate.kind === 'closed') {
      return event.registrationClosesAt
        ? `Closed on ${formatShortDate(event.registrationClosesAt)}.`
        : 'This event is no longer taking registrations.';
    }
    if (isStepOne ? !stepOneValid : !formValid) {
      return 'Fill all required fields.';
    }
    return null;
  }

  /* ── Render ────────────────────────────────────────────────────────────── */

  if (loadState === 'loading') {
    return (
      <div className={`drg-screen drf-screen ${event?.eventType === 'team' ? 'drg-screen--team' : 'drg-screen--solo'}`}>
        <div className="drg-col drf-skel-stack" aria-busy="true" aria-label="Loading this event">
          <div className="drg-skel" style={{ height: 72 }} />
          <div className="drg-skel" style={{ height: 160 }} />
          <div className="drg-skel" style={{ height: 52 }} />
        </div>
      </div>
    );
  }

  if (loadState === 'error' || !event) {
    return (
      <div className={`drg-screen drf-screen ${event?.eventType === 'team' ? 'drg-screen--team' : 'drg-screen--solo'}`}>
        <div className="drg-col">
          <div className="drg-state drg-state--error" role="alert">
            <p className="drg-state__text">
              {isOnline
                ? 'Could not load this event.'
                : "You're offline, so this event could not be loaded."}
            </p>
            <button type="button" className="drg-button" onClick={loadEvent}>
              <RetryIcon size="sm" />
              <span className="drg-button__label">Try again</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const disabledReason = readDisabledReason();
  const isRosterFlow = isTeam && teamMode === 'roster';
  const fieldsDisabled = !isOnline || isBlocked || isSending || isDone;
  const hasCategories =
    (event.weightCategories?.length ?? 0) > 0 ||
    (event.genderCategories?.length ?? 0) > 0 ||
    (event.ageCategories?.length ?? 0) > 0;

  return (
    <div className={`drg-screen drf-screen ${event?.eventType === 'team' ? 'drg-screen--team' : 'drg-screen--solo'}`}>
      {!isOnline ? (
        <div className="drg-offline" role="status">
          <OfflineIcon size="sm" />
          You&rsquo;re offline — registration needs a connection
        </div>
      ) : null}

      <div className="drf-top">
        <button
          type="button"
          className="drf-back"
          onClick={() => (isStepOne || !isRosterFlow ? navigate(-1) : setStep(1))}
          aria-label={isRosterFlow && step === 2 ? 'Back to team details' : 'Back'}
        >
          <BackIcon size="lg" />
        </button>
      </div>

      <EventContextCard
        event={event}
        festName={event.festName}
        typeLabel={formatEventTypeFull(event)}
        /* The total rides in the card's price slot for the whole form, so
           "what am I paying" survives the context card collapsing. */
        priceLabel={isPaid ? totalLabel : 'Free'}
      />

      <form
        className="drg-col"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          handleAction();
        }}
      >
        {/* The step bar exists only where there genuinely are two steps. */}
        {isRosterFlow ? (
          <div className="drg-steps" aria-label={`Step ${step} of 2`}>
            <span className={`drg-steps__item ${step >= 1 ? 'drg-steps__item--active' : ''}`}>
              <span className="drg-steps__bar" />
              <span className="drg-steps__label">Team details</span>
            </span>
            <span className={`drg-steps__item ${step === 2 ? 'drg-steps__item--active' : ''}`}>
              <span className="drg-steps__bar" />
              <span className="drg-steps__label">Review</span>
            </span>
          </div>
        ) : null}

        {isBlocked ? (
          <div className="drg-state" role="status">
            <p className="drg-state__text">{gate.headline}</p>
            <p className="drg-field__hint">{gate.body}</p>
          </div>
        ) : null}

        {/* ── Step 1 (team) or the single solo screen ─────────────────────── */}
        {!isBlocked && (!isRosterFlow || step === 1) ? (
          <>
            {isTeam ? (
              <section className="drg-section">
                <h2 className="drg-section__title">Your team</h2>
                <Field id="team-name" label="Team name" error={touched.teamName ? teamNameError : ''}>
                  {(describedBy) => (
                    <input
                      id="team-name"
                      className="drg-input"
                      type="text"
                      value={teamName}
                      maxLength={60}
                      disabled={fieldsDisabled}
                      aria-invalid={Boolean(touched.teamName && teamNameError)}
                      aria-describedby={describedBy}
                      onChange={(changeEvent) => setTeamName(changeEvent.target.value)}
                      onBlur={() => setTouched((previous) => ({ ...previous, teamName: true }))}
                    />
                  )}
                </Field>

                {/* The captain is the signed-in user and cannot be edited here:
                    an editable name would imply it changes who is registering. */}
                <dl className="drf-facts">
                  <div className="drf-fact">
                    <dt className="drf-fact__key">Captain</dt>
                    <dd className="drf-fact__value">{currentUser?.fullName ?? 'You'}</dd>
                  </div>
                  <div className="drf-fact">
                    <dt className="drf-fact__key">Email</dt>
                    <dd className="drf-fact__value">{currentUser?.emailAddress ?? '—'}</dd>
                  </div>
                </dl>
              </section>
            ) : null}

            {isRosterFlow ? (
              <section className="drg-section">
                <h2 className="drg-section__title">Members</h2>
                {/*
                  EMAIL ONLY, AND SAID PLAINLY.
                  The server's roster endpoint takes memberEmails and nothing
                  else — there is no name field on a team member. A name box
                  here would be typed, validated, and then dropped on the way
                  out, which is worse than not asking. The address is what
                  identifies the person and what the invitation is sent to.
                */}
                <p className="drg-field__hint">
                  {minimumTeamSize === maximumTeamSize
                    ? `This event needs teams of exactly ${minimumTeamSize}, including you.`
                    : `Teams are ${minimumTeamSize} to ${maximumTeamSize} people, including you.`}{' '}
                  We invite each member by email; they do not need an account yet.
                </p>

                <div className="drf-slots">
                  {memberEmails.map((value, index) => {
                    const slotId = `member-${index}`;
                    const error = touched[slotId] ? memberErrors[index] : '';
                    return (
                      <Field
                        key={slotId}
                        id={slotId}
                        label={`Member ${index + 2}`}
                        optional={index >= minimumTeamSize - 1}
                        error={error}
                      >
                        {(describedBy) => (
                          <span className="drf-slot__row">
                            <input
                              id={slotId}
                              className="drg-input"
                              type="email"
                              inputMode="email"
                              autoComplete="off"
                              placeholder="teammate@college.edu"
                              value={value}
                              disabled={fieldsDisabled}
                              aria-invalid={Boolean(error)}
                              aria-describedby={describedBy}
                              onChange={(changeEvent) =>
                                setMemberEmails((previous) =>
                                  previous.map((entry, position) =>
                                    position === index ? changeEvent.target.value : entry,
                                  ),
                                )
                              }
                              onBlur={() =>
                                setTouched((previous) => ({ ...previous, [slotId]: true }))
                              }
                            />
                            <button
                              type="button"
                              className="drf-remove"
                              aria-label={`Remove member ${index + 2}`}
                              disabled={fieldsDisabled || memberEmails.length <= minimumTeamSize - 1}
                              onClick={() =>
                                setMemberEmails((previous) =>
                                  previous.filter((_, position) => position !== index),
                                )
                              }
                            />
                          </span>
                        )}
                      </Field>
                    );
                  })}

                  <button
                    type="button"
                    className="drf-add"
                    disabled={fieldsDisabled || rosterSize >= maximumTeamSize}
                    onClick={() => setMemberEmails((previous) => [...previous, ''])}
                  >
                    Add another member
                  </button>

                  {rosterSizeError ? (
                    <span className="drg-field__error" role="alert">
                      {rosterSizeError}
                    </span>
                  ) : null}
                </div>
              </section>
            ) : null}

            {isTeam ? (
              <section className="drg-section">
                {/* The old flow, kept reachable. See the teamMode comment. */}
                <button
                  type="button"
                  className="drg-button drg-button--quiet"
                  disabled={fieldsDisabled}
                  onClick={() => {
                    setTeamMode(isRosterFlow ? 'code' : 'roster');
                    setStep(1);
                  }}
                >
                  <span className="drg-button__label">
                    {isRosterFlow ? 'Invite by code instead' : 'Enter member emails instead'}
                  </span>
                </button>
                <p className="drg-field__hint" style={{ marginTop: 'var(--s2)' }}>
                  {isRosterFlow
                    ? 'Creates the team once everyone is listed. Choose the code if you do not have their addresses yet.'
                    : 'You get an invite code to share; members join themselves and each pays their own share.'}
                </p>
              </section>
            ) : null}

            {/* Custom questions. Nothing at all is rendered when the event
                defines none — no heading, no empty section, no gap. */}
            {questions.length > 0 ? (
              <section className="drg-section">
                <h2 className="drg-section__title">A few questions</h2>
                {questions.map((question) => {
                  const fieldId = `question-${question.questionId}`;
                  const answer = answerOf(question.questionId);
                  const error = touched[fieldId] ? questionErrors[question.questionId] : '';
                  const options = question.options ?? [];
                  const setAnswer = (next) =>
                    setAnswers((previous) => ({ ...previous, [question.questionId]: next }));
                  const markTouched = () =>
                    setTouched((previous) => ({ ...previous, [fieldId]: true }));

                  return (
                    <Field
                      key={question.questionId}
                      id={fieldId}
                      label={question.questionText}
                      optional={!question.isRequired}
                      error={error}
                    >
                      {(describedBy) => {
                        if (question.questionType === QUESTION_TYPES.LONG_TEXT) {
                          return (
                            <textarea
                              id={fieldId}
                              className="drg-textarea"
                              maxLength={2000}
                              value={answer.answerText ?? ''}
                              disabled={fieldsDisabled}
                              aria-invalid={Boolean(error)}
                              aria-describedby={describedBy}
                              onChange={(changeEvent) =>
                                setAnswer({ answerText: changeEvent.target.value })
                              }
                              onBlur={markTouched}
                            />
                          );
                        }
                        if (question.questionType === QUESTION_TYPES.SHORT_TEXT) {
                          return (
                            <input
                              id={fieldId}
                              className="drg-input"
                              type="text"
                              maxLength={300}
                              value={answer.answerText ?? ''}
                              disabled={fieldsDisabled}
                              aria-invalid={Boolean(error)}
                              aria-describedby={describedBy}
                              onChange={(changeEvent) =>
                                setAnswer({ answerText: changeEvent.target.value })
                              }
                              onBlur={markTouched}
                            />
                          );
                        }
                        const choices =
                          question.questionType === QUESTION_TYPES.YES_NO
                            ? [
                                { value: 'yes', label: 'Yes' },
                                { value: 'no', label: 'No' },
                              ]
                            : options.map((option) => ({ value: option, label: option }));
                        /* Past six, the radio list is taller than the phone and
                           a native select — which opens as a scrollable sheet —
                           is the kinder control. */
                        if (choices.length > CHOICES_AS_SELECT_ABOVE) {
                          return (
                            <select
                              id={fieldId}
                              className="drg-select"
                              value={answer.answerChoice ?? ''}
                              disabled={fieldsDisabled}
                              aria-invalid={Boolean(error)}
                              aria-describedby={describedBy}
                              onChange={(changeEvent) => {
                                setAnswer({ answerChoice: changeEvent.target.value });
                                markTouched();
                              }}
                            >
                              <option value="">Choose one</option>
                              {choices.map((choice) => (
                                <option key={choice.value} value={choice.value}>
                                  {choice.label}
                                </option>
                              ))}
                            </select>
                          );
                        }
                        return (
                          <span
                            className="drg-choices"
                            role="radiogroup"
                            aria-label={question.questionText}
                            aria-describedby={describedBy}
                          >
                            {choices.map((choice) => (
                              <label className="drg-choice" key={choice.value}>
                                <input
                                  type="radio"
                                  name={fieldId}
                                  value={choice.value}
                                  checked={answer.answerChoice === choice.value}
                                  disabled={fieldsDisabled}
                                  onChange={() => {
                                    setAnswer({ answerChoice: choice.value });
                                    markTouched();
                                  }}
                                />
                                {choice.label}
                              </label>
                            ))}
                          </span>
                        );
                      }}
                    </Field>
                  );
                })}
              </section>
            ) : null}

            <section className="drg-section">
              <h2 className="drg-section__title">Contact</h2>
              <Field
                id="contact-phone"
                label="Phone for this event"
                optional
                hint="We use your account number unless you change it here."
                error={touched.contactPhone ? phoneError : ''}
              >
                {(describedBy) => (
                  <input
                    id="contact-phone"
                    className="drg-input"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={contactPhone}
                    disabled={fieldsDisabled}
                    aria-invalid={Boolean(touched.contactPhone && phoneError)}
                    aria-describedby={describedBy}
                    onChange={(changeEvent) => setContactPhone(changeEvent.target.value)}
                    onBlur={() => setTouched((previous) => ({ ...previous, contactPhone: true }))}
                  />
                )}
              </Field>
            </section>

            {hasCategories ? (
              <section className="drg-section">
                <h2 className="drg-section__title">Category</h2>
                {/*
                  KEPT, and honest about its limit. The event defines these
                  brackets and a participant plainly needs to say which one they
                  are in, but NO registration endpoint accepts a category: the
                  payload has customResponses, the reserved add-on fields and
                  nothing else. The choice is therefore local until the API
                  grows a field for it — which is why it is not counted as a
                  required answer and never blocks the button.
                */}
                {(event.weightCategories?.length ?? 0) > 0 ? (
                  <div className="drg-field">
                    <ChipGroup
                      name="weight-category"
                      legend="Weight"
                      disabled={fieldsDisabled}
                      value={categories.weight}
                      options={event.weightCategories.map((value) => ({
                        value,
                        label: humanise(value),
                      }))}
                      onChange={(value) =>
                        setCategories((previous) => ({ ...previous, weight: value }))
                      }
                    />
                  </div>
                ) : null}
                {(event.genderCategories?.length ?? 0) > 0 ? (
                  <div className="drg-field">
                    <ChipGroup
                      name="gender-category"
                      legend="Gender"
                      disabled={fieldsDisabled}
                      value={categories.gender}
                      options={event.genderCategories.map((value) => ({
                        value,
                        label: humanise(value),
                      }))}
                      onChange={(value) =>
                        setCategories((previous) => ({ ...previous, gender: value }))
                      }
                    />
                  </div>
                ) : null}
                {(event.ageCategories?.length ?? 0) > 0 ? (
                  <div className="drg-field">
                    <ChipGroup
                      name="age-category"
                      legend="Age"
                      disabled={fieldsDisabled}
                      value={categories.age}
                      options={event.ageCategories.map((value) => ({
                        value,
                        label: humanise(value),
                      }))}
                      onChange={(value) =>
                        setCategories((previous) => ({ ...previous, age: value }))
                      }
                    />
                  </div>
                ) : null}
              </section>
            ) : null}

            {activeOffers.length > 0 ? (
              <section className="drg-section">
                <h2 className="drg-section__title">Add-ons</h2>
                {activeOffers.map(({ offer, scope }) => {
                  const scopedKey = `${scope}:${offer.offerKey}`;
                  const isFood = offer.offerKey === 'food';
                  const isAccommodation = offer.offerKey === 'accommodation';
                  const choice = readChoice(scopedKey);
                  const isSelected = isFood
                    ? isFoodSelected
                    : isAccommodation
                      ? needsAccommodation
                      : choice.selected;
                  const peopleMaximum = Math.min(
                    offer.numberOfPeopleMaximum ?? 99,
                    isTeam ? maximumTeamSize : 99,
                  );

                  function updateChoice(changes) {
                    setOfferChoices((previous) => ({
                      ...previous,
                      [scopedKey]: { ...readChoice(scopedKey), ...changes },
                    }));
                  }

                  function toggle(checked) {
                    if (isFood) {
                      setIsFoodSelected(checked);
                      if (!checked) {
                        setFoodPreference('');
                        setFoodOrderCount(1);
                      }
                    } else if (isAccommodation) {
                      setNeedsAccommodation(checked);
                    } else {
                      updateChoice({ selected: checked });
                    }
                  }

                  return (
                    <div
                      key={scopedKey}
                      className={isSelected ? 'drf-addon drf-addon--on' : 'drf-addon'}
                    >
                      <div className="drf-addon__head">
                        <label className="drf-check">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={fieldsDisabled}
                            onChange={(changeEvent) => toggle(changeEvent.target.checked)}
                          />
                          {offer.offerName}
                        </label>
                        <span className="drf-addon__price">
                          {formatOfferRateLabel(offer, RATE_COPY)}
                          <span className="drf-addon__scope">
                            {scope === 'event' ? 'This event' : 'Fest-wide'}
                          </span>
                        </span>
                      </div>
                      {offer.description ? (
                        <p className="drf-addon__note">{offer.description}</p>
                      ) : null}

                      {isFood && isSelected ? (
                        <div className="drf-addon__body">
                          <span
                            className="drg-choices"
                            role="radiogroup"
                            aria-label="Food preference"
                          >
                            {FOOD_PREFERENCES.map((preference) => (
                              <label className="drg-choice" key={preference.value}>
                                <input
                                  type="radio"
                                  name="food-preference"
                                  value={preference.value}
                                  checked={foodPreference === preference.value}
                                  disabled={fieldsDisabled}
                                  onChange={() => {
                                    setFoodPreference(preference.value);
                                    // "No meal needed" forces the count to zero;
                                    // switching back restores one.
                                    setFoodOrderCount(
                                      preference.value === 'noMealNeeded' ? 0 : 1,
                                    );
                                  }}
                                />
                                {preference.label}
                              </label>
                            ))}
                          </span>
                          {foodError ? (
                            <span className="drg-field__error">{foodError}</span>
                          ) : null}
                          {/* Solo derives one meal server-side; only a captain
                              chooses how many meals the team books. */}
                          {isTeam && foodPreference && foodPreference !== 'noMealNeeded' ? (
                            <Stepper
                              label="Meals for the team"
                              value={foodOrderCount}
                              minimum={1}
                              maximum={maximumTeamSize}
                              disabled={fieldsDisabled}
                              onChange={setFoodOrderCount}
                            />
                          ) : null}
                        </div>
                      ) : null}

                      {!isFood && !isAccommodation && isSelected ? (
                        <div className="drf-addon__body">
                          {offer.collectsNumberOfPeople ? (
                            <Stepper
                              label="How many people"
                              value={choice.numberOfPeople}
                              minimum={Math.max(1, offer.numberOfPeopleMinimum ?? 1)}
                              maximum={peopleMaximum}
                              disabled={fieldsDisabled}
                              onChange={(numberOfPeople) => updateChoice({ numberOfPeople })}
                            />
                          ) : null}
                          {offer.collectsNumberOfDays ? (
                            <Stepper
                              label="How many days"
                              value={choice.numberOfDays}
                              minimum={Math.max(1, offer.numberOfDaysMinimum ?? 1)}
                              maximum={offer.numberOfDaysMaximum ?? 99}
                              disabled={fieldsDisabled}
                              onChange={(numberOfDays) => updateChoice({ numberOfDays })}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </section>
            ) : null}

            {event.requiresMedicalDeclaration ? (
              <section className="drg-section">
                <h2 className="drg-section__title">Medical declaration</h2>
                <label className="drf-check">
                  <input
                    type="checkbox"
                    checked={acceptedMedical}
                    disabled={fieldsDisabled}
                    aria-describedby={medicalError ? 'medical-error' : undefined}
                    aria-invalid={Boolean(touched.medical && medicalError)}
                    onChange={(changeEvent) => {
                      setAcceptedMedical(changeEvent.target.checked);
                      setTouched((previous) => ({ ...previous, medical: true }));
                    }}
                  />
                  I have read the medical declaration and accept the risks of taking part.
                </label>
                {touched.medical && medicalError ? (
                  <span className="drg-field__error" id="medical-error">
                    {medicalError}
                  </span>
                ) : null}
              </section>
            ) : null}

            {isPaid ? (
              <section className="drg-section">
                <h2 className="drg-section__title">What you pay</h2>
                {/* Display only — the backend recomputes this authoritatively on
                    submit, from the same formula (helpers/fee-math.js). */}
                <div className="drf-sum">
                  {fee.breakdown
                    .filter((line) => line.subtotalPaise > 0)
                    .map((line) => (
                      <span className="drf-sum__line" key={line.label}>
                        <span>
                          {line.label}
                          {line.quantity > 1 ? ` × ${line.quantity}` : ''}
                        </span>
                        <span className="drf-sum__amount">
                          {formatPaiseAsRupees(line.subtotalPaise)}
                        </span>
                      </span>
                    ))}
                  <span className="drf-sum__line drf-sum__line--total">
                    <span>Total</span>
                    <span className="drf-sum__amount">{totalLabel}</span>
                  </span>
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {/* ── Step 2: review ─────────────────────────────────────────────── */}
        {!isBlocked && isRosterFlow && step === 2 ? (
          <section className="drg-section">
            <h2 className="drg-section__title">Check this over</h2>
            <dl className="drf-facts">
              <div className="drf-fact">
                <dt className="drf-fact__key">Event</dt>
                <dd className="drf-fact__value">{event.eventName}</dd>
              </div>
              {event.festName ? (
                <div className="drf-fact">
                  <dt className="drf-fact__key">Fest</dt>
                  <dd className="drf-fact__value">{event.festName}</dd>
                </div>
              ) : null}
              <div className="drf-fact">
                <dt className="drf-fact__key">Team</dt>
                <dd className="drf-fact__value">{trimmedTeamName}</dd>
              </div>
              <div className="drf-fact">
                <dt className="drf-fact__key">Captain</dt>
                <dd className="drf-fact__value">{currentUser?.emailAddress ?? '—'}</dd>
              </div>
              {filledEmails.map((email, index) => (
                <div className="drf-fact" key={email}>
                  <dt className="drf-fact__key">Member {index + 2}</dt>
                  <dd className="drf-fact__value">{email}</dd>
                </div>
              ))}
              <div className="drf-fact">
                <dt className="drf-fact__key">Total</dt>
                <dd className="drf-fact__value">{isPaid ? totalLabel : 'Free'}</dd>
              </div>
            </dl>
            <p className="drg-field__hint" style={{ marginTop: 'var(--s3)' }}>
              Everyone listed is invited by email and holds a place as soon as this goes through.
            </p>
          </section>
        ) : null}
      </form>

      <div className="drg-actions">
        <div className="drg-actions__inner">
          {submitError ? (
            <p className="drg-actions__reason drg-actions__reason--alert" role="alert">
              {submitError}
            </p>
          ) : null}

          {pendingConflict ? (
            <>
              <p className="drg-actions__reason">
                You already have a registration for this event waiting to be paid for. Finish that
                one, or cancel it and start again.
              </p>
              <div className="drf-pair">
                <button
                  type="button"
                  className="drg-button"
                  disabled={!pendingConflict.paymentGroupId || isSending}
                  onClick={() => navigate(`/checkout/${pendingConflict.paymentGroupId}`)}
                >
                  <span className="drg-button__label">Resume payment</span>
                </button>
                <button
                  type="button"
                  className="drg-button drg-button--quiet"
                  disabled={isSending}
                  onClick={handleCancelPendingAndRetry}
                >
                  <span className="drg-button__label">Cancel and retry</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className={[
                  'drg-button',
                  isSending ? 'drg-button--loading' : '',
                  isDone ? 'drg-button--done' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!canAct}
                onClick={handleAction}
              >
                <span className="drg-button__label">{readActionLabel()}</span>
                <span className="drf-tick" aria-hidden="true" />
                {isSending ? <span className="drg-button__progress" aria-hidden="true" /> : null}
              </button>
              {disabledReason ? (
                <p
                  className={
                    isOnline
                      ? 'drg-actions__reason'
                      : 'drg-actions__reason drg-actions__reason--alert'
                  }
                >
                  {disabledReason}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default RegistrationFormScreen;

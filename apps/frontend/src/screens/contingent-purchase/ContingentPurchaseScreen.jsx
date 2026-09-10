// ContingentPurchaseScreen.jsx
// Route: /contingents/:contingentId/purchase
//
// This is a BULK BUY ON BEHALF OF OTHERS, which is why it is its own screen and
// not a variant of the registration form. The buyer names ONE attendee — name,
// email, phone — per event included in the bundle, pays once, and each named
// attendee is then invited to claim their own seat. Nobody on this screen is
// necessarily registering themselves.
//
// The screen fetches its own data so refreshes, back-navigation, shared links
// and bookmarks all work. Router state from the fest or event detail page is a
// fast path to paint immediately, never the only source.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { formatPaiseAmount } from '../../helpers/event-format.js';
import EventContextCard from '../../components/event-context-card/EventContextCard.jsx';
import { BackIcon, OfflineIcon, RetryIcon, TeamIcon, PassIcon } from '../../components/detail-icons/DetailIcons.jsx';
import { PARTICIPANT_CONTINGENT_COPY as COPY } from '../../brand/brand-copy.js';
import { EMAIL_ADDRESS_PATTERN } from '@dedal/shared';

import '../../design/registration.css';
import './contingent-purchase.css';

/*
 * Phone validation. Deliberately shape-only: strip anything that is not a digit
 * and require 10–15 of them, which admits `+91 98765 43210`, `098765-43210` and
 * a foreign number, and rejects the two things that actually get typed by
 * mistake — a truncated number and a second copy of the email address. Anything
 * stricter than this rejects real attendees, and the seat is confirmed by the
 * INVITE EMAIL, so a wrong digit is recoverable while a rejected buyer is not.
 */
function isSensiblePhoneNumber(value) {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function validateRow(row) {
  return {
    fullName: row.fullName.trim().length >= 2 ? '' : 'Enter the attendee’s full name.',
    emailAddress: EMAIL_ADDRESS_PATTERN.test(row.emailAddress.trim())
      ? ''
      : 'Enter a valid email address — the invite goes here.',
    phoneNumber: isSensiblePhoneNumber(row.phoneNumber) ? '' : 'Enter a phone number of at least 10 digits.',
  };
}

/*
 * One attendee field. The error is rendered under the input and tied by
 * aria-describedby rather than announced only in colour, and it appears on BLUR
 * (or once the field has been touched), never mid-keystroke: telling somebody
 * their email is invalid while they are on the third character of it is noise.
 */
function AttendeeField({ id, label, type, inputMode, autoComplete, value, error, disabled, onChange, onBlur }) {
  const errorId = `${id}-error`;
  const showError = Boolean(error);
  return (
    <div className={`drg-field${showError ? ' drg-field--error' : ''}${disabled ? ' drg-field--disabled' : ''}`}>
      <label className="drg-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="drg-input"
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        disabled={disabled}
        aria-invalid={showError || undefined}
        aria-describedby={showError ? errorId : undefined}
        onChange={onChange}
        onBlur={onBlur}
      />
      {showError ? (
        <p className="drg-field__error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ContingentPurchaseScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { contingentId } = useParams();
  const { currentUser } = useAuthentication();
  const isOnline = useOnlineStatus();
  /*
   * The mounted guard MUST re-arm on mount, not only disarm on unmount.
   *
   * Written as `useRef(true)` with a cleanup-only effect, this breaks under
   * React StrictMode, which in development mounts, immediately cleans up, and
   * mounts again. The cleanup sets the ref false, the second mount runs no body
   * to set it back, and every setState afterwards is silently skipped — so the
   * screen sits on its loading skeletons forever while the network tab shows the
   * data arriving perfectly. Setting it true in the effect body is what makes
   * the second mount recover.
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const stateContingent = location.state?.contingent ?? null;
  const stateFestId = location.state?.festId ?? null;
  const stateParentEventId = location.state?.parentEventId ?? null;

  const [contingent, setContingent] = useState(stateContingent);
  const [festId, setFestId] = useState(stateFestId ?? stateContingent?.festId ?? null);
  const [loadState, setLoadState] = useState(stateContingent && stateFestId ? 'ready' : 'loading');
  const [unavailable, setUnavailable] = useState(false);
  // Context for the sticky card: the fest always, the parent event when the
  // bundle has one. Fetched separately so a failure here degrades the header
  // rather than the purchase.
  const [fest, setFest] = useState(null);
  const [parentEvent, setParentEvent] = useState(null);

  /*
   * RESOLVING THE BUNDLE. A contingent's parentEventId is NULLABLE: null means a
   * FEST-LEVEL bundle hanging off the fest itself and covering its top-level
   * events. Resolving from the parent event, as this screen used to, therefore
   * dead-ended every fest-level bundle on "unavailable" — and the fest detail
   * page now surfaces them, so that was a live dead end.
   *
   * The order is cheapest-and-most-general first:
   *   1. A festId (router state, or the contingent we were handed) → the
   *      batched fest endpoint, which returns BOTH buckets. This is the only
   *      path that can find a fest-level bundle, and it also finds every
   *      per-event one, so it is the primary.
   *   2. Only a parentEventId → the per-event endpoint. A bundle reachable this
   *      way is by definition NOT fest-level, and the contingent it returns
   *      carries the festId we were missing.
   *   3. Neither — a cold refresh or a shared link, which carries no router
   *      state at all — → ask /public/fests and try each published fest's
   *      bundle list. Bounded (fests are few, and this runs only when nothing
   *      else is known) and it is the difference between a bookmark working and
   *      a bookmark dead-ending, which is the whole reason this screen refetches
   *      instead of trusting router state.
   *
   * `status === 'published'` is still required in both paths: an unpublished
   * bundle must not be purchasable even by someone holding the link.
   */
  const fetchContingent = useCallback(async () => {
    setLoadState('loading');
    setUnavailable(false);

    const knownFestId = stateFestId ?? stateContingent?.festId ?? contingent?.festId;
    const parentEventId = stateParentEventId ?? stateContingent?.parentEventId ?? contingent?.parentEventId;

    // Both buckets of the batched fest response are searched: the per-parent map
    // AND the fest-level list. The objects in the two are identical in shape, so
    // which bucket a bundle came from is not something the rest of this screen
    // ever has to know.
    async function findInFest(searchFestId) {
      const response = await apiClient.get(`/public/fests/${searchFestId}/contingents`);
      const byParent = response?.contingentsByParentEventId ?? {};
      const candidates = [
        ...Object.values(byParent).flat(),
        ...(response?.festLevelContingents ?? []),
      ];
      return candidates.find((candidate) => candidate.id === contingentId) ?? null;
    }

    try {
      let found = null;
      if (knownFestId) {
        found = await findInFest(knownFestId);
      } else if (parentEventId) {
        const response = await apiClient.get(`/public/events/${parentEventId}/contingents`);
        const candidates = response?.contingents ?? (Array.isArray(response) ? response : []);
        found = candidates.find((candidate) => candidate.id === contingentId) ?? null;
      } else {
        const fests = await apiClient.get('/public/fests');
        const festList = Array.isArray(fests) ? fests : (fests?.fests ?? []);
        for (const candidateFest of festList) {
          // Sequential on purpose: the common case is a hit in the first few,
          // and firing one request per fest in parallel is how a public list
          // screen trips the rate limiter.
          found = await findInFest(candidateFest.id);
          if (found) {
            break;
          }
        }
      }

      if (!found || found.status !== 'published') {
        if (mountedRef.current) { setUnavailable(true); setLoadState('error'); }
        return;
      }
      if (mountedRef.current) {
        setContingent(found);
        setFestId(found.festId ?? knownFestId ?? null);
        setLoadState('ready');
      }
    } catch {
      if (mountedRef.current) { setLoadState('error'); }
    }
  }, [
    contingentId,
    stateFestId,
    stateParentEventId,
    stateContingent?.festId,
    stateContingent?.parentEventId,
    contingent?.festId,
    contingent?.parentEventId,
  ]);

  // Router state has already seeded `contingent`/`festId`/`loadState` in their
  // initialisers, so the mount effect only has to revalidate against the API.
  useEffect(() => {
    // set-state-in-effect: fetchContingent flips loadState synchronously before
    // it awaits. That IS the effect's job here — fetching on mount is exactly
    // the "synchronise with an external system" case the rule exempts, and the
    // spinner has to be on screen before the request, not after it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContingent();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * The context card wants the MOST SPECIFIC thing we have: the parent event
   * when the bundle hangs under one, the fest when it is fest-level. Both come
   * from the fest, so one fest read plus (only when needed) its event list.
   */
  useEffect(() => {
    if (!festId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const loadedFest = await apiClient.get(`/public/fests/${festId}`);
        if (!cancelled && mountedRef.current) {
          setFest(loadedFest ?? null);
        }
      } catch {
        // A missing header is not worth failing the purchase over.
      }
      const parentEventId = contingent?.parentEventId;
      if (!parentEventId) {
        return;
      }
      try {
        const events = await apiClient.get(`/public/fests/${festId}/events`);
        const list = Array.isArray(events) ? events : (events?.events ?? []);
        const match = list.find((candidate) => candidate.id === parentEventId) ?? null;
        if (!cancelled && mountedRef.current) {
          setParentEvent(match);
        }
      } catch {
        // Same: degrade to the fest in the card.
      }
    })();
    return () => { cancelled = true; };
  }, [festId, contingent?.parentEventId]);

  const includedEvents = useMemo(() => contingent?.includedEvents ?? [], [contingent]);

  /*
   * The attendee rows are DERIVED from includedEvents rather than copied into
   * state by an effect. Seeding an array of blank rows from an effect meant the
   * form rendered once with no rows at all, and it silently kept the old row
   * count if the bundle was re-resolved with a different set of events. Keying
   * the typed values by eventId makes the rows a pure function of the bundle:
   * whatever the buyer has typed survives a refetch, and a row that is no
   * longer in the bundle simply stops being rendered.
   */
  const [attendeeValues, setAttendeeValues] = useState({});
  const [touchedFields, setTouchedFields] = useState({});

  const attendeeRows = useMemo(
    () =>
      includedEvents.map((included) => ({
        eventId: included.id,
        fullName: '',
        emailAddress: '',
        phoneNumber: '',
        ...(attendeeValues[included.id] ?? {}),
      })),
    [includedEvents, attendeeValues],
  );

  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setRowField(eventId, field, value) {
    setAttendeeValues((previous) => ({
      ...previous,
      [eventId]: { ...(previous[eventId] ?? {}), [field]: value },
    }));
  }

  function markTouched(rowIndex, field) {
    setTouchedFields((previous) => ({ ...previous, [`${rowIndex}.${field}`]: true }));
  }

  const buyerEmailAddress = (currentUser?.emailAddress ?? '').toLowerCase();

  const hasDuplicateEmails = useMemo(() => {
    const filled = attendeeRows
      .map((row) => row.emailAddress.trim().toLowerCase())
      .filter((address) => address !== '');
    return new Set(filled).size !== filled.length;
  }, [attendeeRows]);

  const rowErrors = useMemo(() => attendeeRows.map(validateRow), [attendeeRows]);

  const allRowsValid =
    attendeeRows.length > 0 &&
    rowErrors.every((errors) => !errors.fullName && !errors.emailAddress && !errors.phoneNumber);

  // A row counts as "named" once every one of its three fields is valid — the
  // progress line has to mean the same thing the disabled button means, or it
  // reads "3 of 3" beside a dead button.
  const namedCount = rowErrors.filter(
    (errors) => !errors.fullName && !errors.emailAddress && !errors.phoneNumber,
  ).length;

  const isSoldOut =
    contingent?.maximumBundleClaims != null &&
    (contingent?.soldBundleCount ?? 0) >= contingent.maximumBundleClaims;

  async function handleSubmit(submitEvent) {
    submitEvent.preventDefault();
    if (!allRowsValid || isSubmitting || !festId || isSoldOut || !isOnline) {
      return;
    }
    setSubmitError('');
    setIsSubmitting(true);
    try {
      const purchase = await apiClient.post(
        `/fests/${festId}/contingents/${contingentId}/purchase`,
        {
          attendees: attendeeRows.map((row) => ({
            eventId: row.eventId,
            fullName: row.fullName.trim(),
            emailAddress: row.emailAddress.trim().toLowerCase(),
            phoneNumber: row.phoneNumber.trim(),
          })),
        },
      );
      navigate(`/checkout/${purchase.contingentPurchaseGroupId}`, {
        state: {
          event: { eventName: contingent.contingentName, festName: fest?.festName ?? '' },
        },
      });
    } catch (error) {
      setSubmitError(error?.message || 'The purchase could not be completed.');
    } finally {
      if (mountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }

  if (loadState === 'loading' && !contingent) {
    return (
      <div className="drg-screen drg-screen--purchase">
      {/*
        The way out. This screen drops the app's floating ScreenHeader — it is
        positioned over the content and would land on top of the sticky context
        card — so the back control is part of the flow's own furniture instead.
        Without it somebody mid-purchase has no route back except the browser's,
        which an installed PWA may not show at all.
      */}
      <div className="drg-backbar">
        <button
          type="button"
          className="drg-backbar__button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <BackIcon size="lg" />
        </button>
      </div>

        <div className="drg-skel dcp-skel-context" />
        <div className="drg-col">
          <div className="drg-skel dcp-skel-line" style={{ width: '70%' }} />
          <div className="drg-skel dcp-skel-row" />
          <div className="drg-skel dcp-skel-row" />
          <div className="drg-skel dcp-skel-total" />
        </div>
      </div>
    );
  }

  if (unavailable || loadState === 'error' || !contingent || !festId) {
    const isUnavailable = unavailable;
    return (
      <div className="drg-screen drg-screen--purchase">
      {/*
        The way out. This screen drops the app's floating ScreenHeader — it is
        positioned over the content and would land on top of the sticky context
        card — so the back control is part of the flow's own furniture instead.
        Without it somebody mid-purchase has no route back except the browser's,
        which an installed PWA may not show at all.
      */}
      <div className="drg-backbar">
        <button
          type="button"
          className="drg-backbar__button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <BackIcon size="lg" />
        </button>
      </div>

        <div className="drg-col">
          <div className="drg-state">
            <div className="drg-state--error">
              <p className="drg-state__text">
                {isUnavailable
                  ? 'This bundle is no longer available. It may have been cancelled or unpublished.'
                  : 'This bundle could not be loaded.'}
              </p>
            </div>
            <button
              type="button"
              className="drg-button drg-button--quiet"
              onClick={isUnavailable ? () => navigate('/') : fetchContingent}
            >
              {isUnavailable ? <PassIcon /> : <RetryIcon />}
              <span className="drg-button__label">{isUnavailable ? 'Back to explore' : 'Try again'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const priceLabel = formatPaiseAmount(contingent.pricePaise);
  const individualTotalPaise = contingent.individualTotalPaise ?? 0;
  const savingPaise = individualTotalPaise - contingent.pricePaise;
  const showSaving = savingPaise > 0;

  // The card takes the parent event when there is one, and the fest presented as
  // an event when the bundle is fest-level — a fest-level bundle has no parent
  // to name, and an empty header is worse than the fest's own poster and name.
  const contextEvent = parentEvent
    ? { eventName: parentEvent.eventName, posterImageUrl: parentEvent.posterImageUrl }
    : fest
      ? { eventName: fest.festName, posterImageUrl: fest.bannerImageUrl }
      : { eventName: contingent.contingentName, posterImageUrl: null };

  const formDisabled = !isOnline || isSubmitting || isSoldOut;

  let reasonText = '';
  if (!isOnline) {
    reasonText = 'You’re offline — this needs a connection';
  } else if (isSoldOut) {
    reasonText = `Sold out — all ${contingent.maximumBundleClaims} bundles claimed`;
  } else if (!allRowsValid) {
    reasonText = 'Fill all attendee details';
  }

  return (
    <div className="drg-screen drg-screen--purchase">
      {/*
        The way out. This screen drops the app's floating ScreenHeader — it is
        positioned over the content and would land on top of the sticky context
        card — so the back control is part of the flow's own furniture instead.
        Without it somebody mid-purchase has no route back except the browser's,
        which an installed PWA may not show at all.
      */}
      <div className="drg-backbar">
        <button
          type="button"
          className="drg-backbar__button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
        >
          <BackIcon size="lg" />
        </button>
      </div>

      {!isOnline ? (
        <div className="drg-offline" role="status">
          <OfflineIcon size="sm" />
          <span>You’re offline — this needs a connection</span>
        </div>
      ) : null}

      <EventContextCard
        event={contextEvent}
        festName={parentEvent ? (fest?.festName ?? '') : ''}
        typeLabel={contingent.contingentName}
        priceLabel={priceLabel}
      />

      <form className="drg-col" onSubmit={handleSubmit} noValidate>
        <p className="dcp-lede">{COPY.groupAccessBody(includedEvents.length)}</p>

        <section className="drg-section">
          <p className="dcp-notice">
            <TeamIcon size="sm" />
            <span>{COPY.dpdpNotice}</span>
          </p>
        </section>

        <section className="drg-section">
          <h2 className="drg-section__title">
            Attendees ({includedEvents.length})
          </h2>

          {includedEvents.map((included, rowIndex) => {
            const row = attendeeRows[rowIndex];
            if (!row) {
              return null;
            }
            const errors = rowErrors[rowIndex] ?? {};
            const isTouched = (field) => Boolean(touchedFields[`${rowIndex}.${field}`]);
            const isSelf =
              row.emailAddress.trim().toLowerCase() !== '' &&
              row.emailAddress.trim().toLowerCase() === buyerEmailAddress;
            return (
              <div className="dcp-row" key={included.id}>
                <h3 className="dcp-row__title">
                  <span className="dcp-row__for">Attendee for</span>
                  {included.eventName}
                </h3>

                <AttendeeField
                  id={`attendee-${rowIndex}-name`}
                  label="Full name"
                  type="text"
                  autoComplete="off"
                  value={row.fullName}
                  error={isTouched('fullName') ? errors.fullName : ''}
                  disabled={formDisabled}
                  onChange={(changeEvent) => setRowField(included.id, 'fullName', changeEvent.target.value)}
                  onBlur={() => markTouched(rowIndex, 'fullName')}
                />
                <AttendeeField
                  id={`attendee-${rowIndex}-email`}
                  label="Email address"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  value={row.emailAddress}
                  error={isTouched('emailAddress') ? errors.emailAddress : ''}
                  disabled={formDisabled}
                  onChange={(changeEvent) => setRowField(included.id, 'emailAddress', changeEvent.target.value)}
                  onBlur={() => markTouched(rowIndex, 'emailAddress')}
                />
                <AttendeeField
                  id={`attendee-${rowIndex}-phone`}
                  label="Phone number"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  value={row.phoneNumber}
                  error={isTouched('phoneNumber') ? errors.phoneNumber : ''}
                  disabled={formDisabled}
                  onChange={(changeEvent) => setRowField(included.id, 'phoneNumber', changeEvent.target.value)}
                  onBlur={() => markTouched(rowIndex, 'phoneNumber')}
                />

                {isSelf ? (
                  <p className="dcp-row__self">This is you — no invite email needed.</p>
                ) : null}
              </div>
            );
          })}

          {hasDuplicateEmails ? (
            <p className="dcp-notice" style={{ marginTop: 'var(--s3)' }}>
              <TeamIcon size="sm" />
              <span>{COPY.duplicateEmailNote}</span>
            </p>
          ) : null}
        </section>

        {/* The running total. Above the fold of the action bar and never
            collapsed, because on a bulk buy the price and the remaining work
            are the two things the buyer keeps checking. */}
        <section className="drg-section">
          <div className="dcp-total">
            <div>
              <p className="dcp-total__label">
                {includedEvents.length} event{includedEvents.length === 1 ? '' : 's'} in this bundle
              </p>
              <p className="dcp-total__progress" aria-live="polite">
                {namedCount} of {includedEvents.length} attendees named
              </p>
            </div>
            <div>
              {showSaving ? (
                <span className="dcp-total__struck">{formatPaiseAmount(individualTotalPaise)}</span>
              ) : null}
              <span className="dcp-total__amount">{priceLabel}</span>
              {showSaving ? (
                <span className="dcp-total__saving">You save {formatPaiseAmount(savingPaise)}</span>
              ) : null}
            </div>
          </div>

          <p className="dcp-notice dcp-notice--fine">{COPY.buyerTermsNote}</p>

          {submitError ? (
            <div className="drg-state--error" role="alert">
              <p className="drg-state__text">{submitError}</p>
            </div>
          ) : null}
        </section>

        <div className="drg-actions">
          <div className="drg-actions__inner">
            <button
              type="submit"
              className={`drg-button${isSubmitting ? ' drg-button--loading' : ''}`}
              disabled={!allRowsValid || isSubmitting || isSoldOut || !isOnline}
            >
              <span className="drg-button__label">Pay {priceLabel}</span>
              {isSubmitting ? <span className="drg-button__progress" /> : null}
            </button>
            {reasonText ? (
              <p className={`drg-actions__reason${isSoldOut ? ' drg-actions__reason--alert' : ''}`}>
                {reasonText}
              </p>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}

export default ContingentPurchaseScreen;

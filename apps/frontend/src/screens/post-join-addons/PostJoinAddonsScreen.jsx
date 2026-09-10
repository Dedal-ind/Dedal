// PostJoinAddonsScreen.jsx
// Route: /registrations/:registrationId/add-ons
//
// The step that was missing after joining by code. Somebody who registers
// through the form picks their add-ons there; somebody who joins a team with an
// invite code — or redeems a contingent vertical code — never sees that form, so
// until now they had no way to buy food or accommodation at all.
//
// SKIP IS A FIRST-CLASS EXIT, not a nag to dismiss. The seat is already
// confirmed by the time this screen renders; add-ons are genuinely optional and
// can be bought later from the registration, so nothing here blocks the
// participant from leaving. In the redesign that argument is finally visible:
// Skip is a real full-width control under Continue rather than an underlined
// word in the corner.
//
// Paid selections hand off to the SAME /checkout/:paymentGroupId screen every
// other payment uses. Free ones are applied inline, because a zero-rupee order
// is not a thing Razorpay will open. Both flows, and every endpoint and payload
// below, are exactly as they were.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import {
  CaptainIcon,
  OfflineIcon,
  StepDownIcon,
  StepUpIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { formatPaiseAmount } from '../../helpers/event-format.js';
import { POST_JOIN_ADDONS_COPY as COPY } from '../../brand/brand-copy.js';
import { TEAM_CAPTAIN_COPY, CONNECTION_COPY } from '../../brand/brand-copy.js';
import '../../design/post-join-addons.css';

const QUANTITY_CEILING = 20;

/*
 * Price of one selection, mirroring computeOfferTotalPaise on the server: rate x
 * people x days, where an axis the offer does not collect contributes 1. This is
 * a DISPLAY estimate only — the server reprices from the live offer before
 * charging anything, so a stale rate here cannot become a wrong charge.
 */
function computeSelectionPaise(offer, selection) {
  if (!offer.isPaid) {
    return 0;
  }
  const people = offer.collectsNumberOfPeople ? selection.numberOfPeople : 1;
  const days = offer.collectsNumberOfDays ? selection.numberOfDays : 1;
  return offer.ratePaise * people * days;
}

function offerKeyOf(offer) {
  return `${offer.scope}:${offer.offerKey}`;
}

/*
 * The stepper, local to this screen.
 *
 * The shared QuantityStepper is still on the Heritage palette and draws its
 * plus and minus as Material Symbols ligatures, so it cannot be used here and
 * is not mine to rewrite. Its BEHAVIOUR is reproduced exactly, because that is
 * the part worth keeping: the buttons disable at the bounds rather than
 * clamping silently, the value is announced through role="status" +
 * aria-live, and the field is type="text" with inputMode="numeric" — NOT
 * type="number", which screen readers do not announce as numeric and which
 * brings a spinner nobody wants.
 */
function Stepper({ label, value, minimum, maximum, onChange, disabled = false }) {
  function handleTypedValue(rawValue) {
    const digitsOnly = rawValue.replace(/[^0-9]/g, '');
    if (digitsOnly === '') {
      onChange(minimum);
      return;
    }
    const parsed = Number.parseInt(digitsOnly, 10);
    if (parsed >= minimum && parsed <= maximum) {
      onChange(parsed);
    }
  }

  return (
    <div className="dpj-stepper">
      <span className="dpj-stepper__label">{label}</span>
      <div className="dpj-stepper__controls">
        <button
          type="button"
          className="dpj-stepper__button"
          onClick={() => onChange(value - 1)}
          disabled={disabled || value <= minimum}
          aria-label={`Fewer ${label.toLowerCase()}`}
        >
          <StepDownIcon size="sm" />
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          role="status"
          aria-live="polite"
          aria-label={label}
          className="dpj-stepper__value"
          value={value}
          onChange={(changeEvent) => handleTypedValue(changeEvent.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          className="dpj-stepper__button"
          onClick={() => onChange(value + 1)}
          disabled={disabled || value >= maximum}
          aria-label={`More ${label.toLowerCase()}`}
        >
          <StepUpIcon size="sm" />
        </button>
      </div>
    </div>
  );
}

function PostJoinAddonsScreen() {
  const { registrationId } = useParams();
  const location = useLocation();
  /* Set by the join flow when the captaincy was forced rather than volunteered
     for — see resolveCaptaincyOnJoin. */
  const captaincyNotice = location.state?.captaincyNotice === true;
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();

  const [status, setStatus] = useState('loading');
  const [context, setContext] = useState(null);
  const [offers, setOffers] = useState([]);
  const [selections, setSelections] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadOffers = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await apiClient.get(`/registrations/${registrationId}/add-ons`);
      setContext({ eventName: result?.eventName ?? '', festName: result?.festName ?? '' });
      setOffers(Array.isArray(result?.offers) ? result.offers : []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [registrationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadOffers();
  }, [loadOffers]);

  const toggleOffer = useCallback((offer) => {
    const key = offerKeyOf(offer);
    setSelections((previous) => {
      const next = { ...previous };
      if (next[key]) {
        delete next[key];
        return next;
      }
      next[key] = {
        numberOfPeople: offer.numberOfPeopleMinimum ?? 1,
        numberOfDays: offer.numberOfDaysMinimum ?? 1,
      };
      return next;
    });
  }, []);

  const setQuantity = useCallback((offer, axis, value) => {
    const key = offerKeyOf(offer);
    setSelections((previous) =>
      previous[key] ? { ...previous, [key]: { ...previous[key], [axis]: value } } : previous,
    );
  }, []);

  const { chosenLines, totalPaise } = useMemo(() => {
    const lines = [];
    let runningTotal = 0;
    for (const offer of offers) {
      const selection = selections[offerKeyOf(offer)];
      if (!selection) {
        continue;
      }
      const amountPaise = computeSelectionPaise(offer, selection);
      runningTotal += amountPaise;
      lines.push({ key: offerKeyOf(offer), offerName: offer.offerName, amountPaise });
    }
    return { chosenLines: lines, totalPaise: runningTotal };
  }, [offers, selections]);

  const handleContinue = useCallback(async () => {
    if (isSubmitting || chosenLines.length === 0) {
      return;
    }
    setSubmitError('');
    setIsSubmitting(true);
    try {
      const offerSelections = offers
        .filter((offer) => selections[offerKeyOf(offer)])
        .map((offer) => {
          const selection = selections[offerKeyOf(offer)];
          return {
            offerKey: offer.offerKey,
            scope: offer.scope,
            ...(offer.collectsNumberOfPeople ? { numberOfPeople: selection.numberOfPeople } : {}),
            ...(offer.collectsNumberOfDays ? { numberOfDays: selection.numberOfDays } : {}),
          };
        });

      const result = await apiClient.post(`/registrations/${registrationId}/add-ons`, {
        offerSelections,
      });

      if (result?.paid) {
        // The existing checkout screen owns the Razorpay modal from here.
        navigate(`/checkout/${result.paymentGroupId}`, {
          state: { registrationId, isAddOnPurchase: true },
        });
        return;
      }
      navigate(`/registration-success/${registrationId}`, { replace: true });
    } catch (error) {
      setSubmitError(error?.message || COPY.submitFailed);
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, chosenLines, offers, selections, registrationId, navigate]);

  const handleSkip = useCallback(() => {
    navigate(`/registration-success/${registrationId}`, { replace: true });
  }, [navigate, registrationId]);

  return (
    <div className="dpj-screen">
      {/*
       * The bar IS the heading, so this screen renders no <h1> of its own. This
       * route sits outside ParticipantLayout, so there is no app header above
       * it to suppress — the registration is simply a no-op here.
       */}
      <ScreenHeader title={COPY.heading} />

      <div className="dpj-col">
        <div className="dpj-intro">
          <p className="dpj-lede">{COPY.subheading}</p>

          {captaincyNotice ? (
            <p className="dpj-notice">
              <CaptainIcon size="sm" />
              {TEAM_CAPTAIN_COPY.autoAssignedNotice}
            </p>
          ) : null}
        </div>

        {status === 'loading' ? (
          <>
            <div className="dpj-skeleton dpj-skeleton--context" aria-hidden="true" />
            <div className="dpj-section">
              <ul className="dpj-offers" aria-hidden="true">
                {[0, 1, 2, 3].map((index) => (
                  <li key={index} className="dpj-skeleton dpj-skeleton--offer" />
                ))}
              </ul>
            </div>
          </>
        ) : (
          <>
            {/* Context card — which seat these add-ons attach to. */}
            <div className="dpj-context">
              <p className="dpj-context__label">{COPY.yourRegistration}</p>
              <p className="dpj-context__event">{context?.eventName}</p>
              {context?.festName ? <p className="dpj-context__fest">{context.festName}</p> : null}
            </div>

            {status === 'error' || offers.length === 0 ? (
              <div className="dpj-note">
                <p>{status === 'error' ? COPY.loadFailed : COPY.noneAvailable}</p>
              </div>
            ) : (
              <>
                <section className="dpj-section">
                  <h2 className="dpj-section__title">{COPY.availableAddOns}</h2>

                  <ul className="dpj-offers">
                    {offers.map((offer) => {
                      const key = offerKeyOf(offer);
                      const selection = selections[key];
                      const isSelected = Boolean(selection);
                      return (
                        <li
                          key={key}
                          className={
                            isSelected ? 'dpj-offer dpj-offer--selected' : 'dpj-offer'
                          }
                        >
                          <label className="dpj-offer__label">
                            <input
                              type="checkbox"
                              className="dpj-offer__box"
                              checked={isSelected}
                              onChange={() => toggleOffer(offer)}
                            />
                            <span className="dpj-offer__text">
                              <span className="dpj-offer__head">
                                <span className="dpj-offer__name">{offer.offerName}</span>
                                <span className="dpj-offer__price">
                                  {offer.isPaid ? formatPaiseAmount(offer.ratePaise) : COPY.free}
                                </span>
                              </span>
                              {offer.description ? (
                                <span className="dpj-offer__description">{offer.description}</span>
                              ) : null}
                            </span>
                          </label>

                          {/* Quantity axes appear only once the offer is taken — an
                              inert stepper on an unselected row invites a change that
                              does nothing. */}
                          {isSelected &&
                          (offer.collectsNumberOfPeople || offer.collectsNumberOfDays) ? (
                            <div className="dpj-offer__axes">
                              {offer.collectsNumberOfPeople ? (
                                <Stepper
                                  label={COPY.people}
                                  value={selection.numberOfPeople}
                                  minimum={offer.numberOfPeopleMinimum ?? 1}
                                  maximum={offer.numberOfPeopleMaximum ?? QUANTITY_CEILING}
                                  onChange={(value) =>
                                    setQuantity(offer, 'numberOfPeople', value)
                                  }
                                />
                              ) : null}
                              {offer.collectsNumberOfDays ? (
                                <Stepper
                                  label={COPY.days}
                                  value={selection.numberOfDays}
                                  minimum={offer.numberOfDaysMinimum ?? 1}
                                  maximum={offer.numberOfDaysMaximum ?? QUANTITY_CEILING}
                                  onChange={(value) => setQuantity(offer, 'numberOfDays', value)}
                                />
                              ) : null}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>

                {chosenLines.length > 0 ? (
                  <section className="dpj-summary">
                    <h2 className="dpj-summary__title">{COPY.summary}</h2>
                    <ul className="dpj-summary__lines">
                      {chosenLines.map((line) => (
                        <li key={line.key} className="dpj-summary__line">
                          <span>{line.offerName}</span>
                          <span>
                            {line.amountPaise === 0
                              ? COPY.free
                              : formatPaiseAmount(line.amountPaise)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="dpj-summary__total">
                      <span>{COPY.total}</span>
                      <span>{totalPaise === 0 ? COPY.free : formatPaiseAmount(totalPaise)}</span>
                    </div>
                    {/* Said before the tap, not after: a free basket never opens a
                        payment screen, and a paid one always does. */}
                    <p className="dpj-summary__note">
                      {totalPaise === 0 ? COPY.freeNote : COPY.paidNote}
                    </p>
                  </section>
                ) : null}
              </>
            )}
          </>
        )}

        {submitError ? (
          <p className="dpj-error" role="alert">
            {submitError}
          </p>
        ) : null}
      </div>

      <div className="dpj-actions">
        <div className="dpj-actions__inner">
          {/* Offline: the read above still renders from whatever was fetched,
              but a purchase cannot be posted, and the reason is stated rather
              than left as an unexplained dead button. */}
          {!isOnline ? (
            <p className="dpj-offline">
              <OfflineIcon size="sm" />
              {CONNECTION_COPY.offlineTitle}
            </p>
          ) : null}
          <button
            type="button"
            onClick={handleContinue}
            disabled={chosenLines.length === 0 || isSubmitting || !isOnline}
            className="dpj-button dpj-button--primary"
          >
            {isSubmitting ? COPY.working : COPY.continue}
          </button>
          <button type="button" onClick={handleSkip} className="dpj-button dpj-button--quiet">
            {COPY.skip}
          </button>
        </div>
      </div>
    </div>
  );
}

export default PostJoinAddonsScreen;

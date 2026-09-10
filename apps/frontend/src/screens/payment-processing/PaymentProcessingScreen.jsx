// PaymentProcessingScreen.jsx
// Route: /payment-processing/:paymentGroupId — the waiting room for a payment
// Razorpay captured but the app has not yet seen confirmed. Reached when the
// verify call failed after capture (the webhook confirms server-side) or when a
// success had no registration id to land on. Polls the payment status and NEVER
// auto-redirects home: it terminates on the success screen or on an explicit
// still-pending state with manual actions.
//
// THE POLLING LOOP, ITS WINDOW, ITS REDIRECT TARGETS AND ITS PERMISSION_DENIED
// STOP CONDITION ARE MOVED VERBATIM. This was a visual migration; nothing about
// when this screen calls the API, or where it sends you, has changed.
//
// NO NAVIGATION CHROME AT ALL — no back control, and therefore no ScreenHeader
// (with showBack false and no title or action it renders null anyway). Leaving
// mid-confirmation is the exact mistake this screen exists to prevent. It also
// sits outside ParticipantLayout, so there is no app header above it. That
// makes it the one screen in this migration that owns its own <h1>: there is no
// bar to carry the heading.
//
// It deliberately does NOT use useTransitionNavigate. The two navigations here
// are `replace: true` terminations of a payment flow, and a cross-fade between
// "confirming" and "confirmed" is a moment where the state must land hard.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import { LockIcon, PendingIcon, RetryIcon } from '../../components/detail-icons/DetailIcons.jsx';
import { formatPaiseAmount } from '../../helpers/event-format.js';
import { PAYMENT_STATUS_COPY } from '../../brand/brand-copy.js';
import '../../design/payment-processing.css';

// The 270° processing arc: an SVG circle with a dasharray gap, spun by a CSS
// animation in the stylesheet (reduced motion stops it there, not here).
function ProcessingArc() {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className="dpp-arc" viewBox="0 0 56 56" aria-hidden="true">
      <circle
        cx="28"
        cy="28"
        r={radius}
        fill="transparent"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * 0.25}
      />
    </svg>
  );
}

const POLL_INTERVAL_MILLISECONDS = 3000;
const POLL_WINDOW_MILLISECONDS = 90000;

function PaymentProcessingScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { paymentGroupId } = useParams();
  // Optional context from checkout: { eventName, amountPaise } — the
  // transaction card renders only when it was actually passed.
  const passedState = location.state ?? {};

  // 'polling' | 'stillPending' | 'error'
  const [pollState, setPollState] = useState('polling');
  // Stamped lazily inside the effect/handlers (Date.now is impure for render).
  const pollWindowStartedAtReference = useRef(null);

  const checkStatus = useCallback(async () => {
    try {
      const status = await apiClient.get(`/payments/status/${paymentGroupId}`);
      const isConfirmed =
        status?.paymentStatus === 'completed' || status?.registrationStatus === 'confirmed';
      // A contingent purchase has no single registration to land on: the
      // attendees' claims are the outcome, so success ends on /my-registrations
      // where the buyer's purchases panel shows them.
      if (isConfirmed && status?.purposeType === 'contingent') {
        navigate('/my-registrations', {
          replace: true,
          state: { contingentPurchaseConfirmed: true },
        });
        return true;
      }
      if (
        isConfirmed &&
        typeof status.registrationId === 'string' &&
        status.registrationId !== ''
      ) {
        navigate(`/registration-success/${status.registrationId}`, { replace: true });
        return true;
      }
      return false;
    } catch (statusError) {
      // 403 means the caller cannot see this group at all — stop polling and say so.
      if (statusError.code === 'PERMISSION_DENIED') {
        setPollState('error');
        return true;
      }
      // A transient failure keeps the poll going; the window cap bounds it.
      return false;
    }
  }, [paymentGroupId, navigate]);

  useEffect(() => {
    if (pollState !== 'polling') {
      return undefined;
    }
    let isActive = true;
    if (pollWindowStartedAtReference.current === null) {
      pollWindowStartedAtReference.current = Date.now();
    }
    async function pollOnce() {
      const isDone = await checkStatus();
      if (!isActive) {
        return;
      }
      if (
        !isDone &&
        Date.now() - pollWindowStartedAtReference.current >= POLL_WINDOW_MILLISECONDS
      ) {
        setPollState('stillPending');
      }
    }
    const intervalId = window.setInterval(pollOnce, POLL_INTERVAL_MILLISECONDS);
    pollOnce();
    return () => {
      isActive = false;
      window.clearInterval(intervalId);
    };
  }, [pollState, checkStatus]);

  // Manual re-check restarts a fresh polling window.
  function handleCheckAgain() {
    pollWindowStartedAtReference.current = Date.now();
    setPollState('polling');
  }

  if (pollState === 'error') {
    return (
      <div className="dpp-screen">
        <div className="dpp-col">
          <div className="dpp-error">
            <p className="dpp-error__line">{PAYMENT_STATUS_COPY.processingError}</p>
            <button type="button" onClick={handleCheckAgain} className="dpp-error__retry">
              <RetryIcon size="sm" />
              {PAYMENT_STATUS_COPY.checkAgain}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isPolling = pollState === 'polling';

  return (
    <div className="dpp-screen">
      <div className="dpp-col">
        {isPolling ? (
          <ProcessingArc />
        ) : (
          <span className="dpp-mark">
            <PendingIcon size="lg" />
          </span>
        )}

        {/*
         * aria-live on the pair, because the ONLY thing that happens on this
         * screen without the participant doing anything is these two strings
         * changing after ninety seconds. Without it a screen-reader user is
         * told nothing at all for the whole wait and then nothing again when it
         * ends. 'polite', because the change is not an interruption.
         */}
        <h1 className="dpp-title" aria-live="polite">
          {isPolling
            ? PAYMENT_STATUS_COPY.processingTitle
            : PAYMENT_STATUS_COPY.stillPendingTitle}
        </h1>
        <p className="dpp-body" aria-live="polite">
          {isPolling ? PAYMENT_STATUS_COPY.processingBody : PAYMENT_STATUS_COPY.stillPendingBody}
        </p>

        {/* The one instruction that matters, in body type rather than the
            bordered uppercase caption it used to be. */}
        {isPolling ? <p className="dpp-hint">{PAYMENT_STATUS_COPY.processingHint}</p> : null}

        {/* Transaction details, when checkout passed them along. */}
        {passedState.eventName || passedState.amountPaise != null ? (
          <div className="dpp-card">
            <p className="dpp-card__title">{PAYMENT_STATUS_COPY.transactionTitle}</p>
            {passedState.eventName ? (
              <div className="dpp-card__row">
                <span>{PAYMENT_STATUS_COPY.eventLabel}</span>
                <span className="dpp-card__value">{passedState.eventName}</span>
              </div>
            ) : null}
            {passedState.amountPaise != null ? (
              <div className="dpp-card__row">
                <span>{PAYMENT_STATUS_COPY.totalAmountLabel}</span>
                <span className="dpp-card__amount">
                  {formatPaiseAmount(passedState.amountPaise)}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {isPolling ? (
          <p className="dpp-secure">
            <LockIcon size="sm" />
            {PAYMENT_STATUS_COPY.secureNote}
          </p>
        ) : (
          <div className="dpp-actions">
            <button type="button" onClick={handleCheckAgain} className="dpp-button">
              <RetryIcon size="sm" />
              {PAYMENT_STATUS_COPY.checkAgain}
            </button>
            <button
              type="button"
              onClick={() => navigate('/my-registrations')}
              className="dpp-button"
            >
              {PAYMENT_STATUS_COPY.viewRegistrations}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default PaymentProcessingScreen;

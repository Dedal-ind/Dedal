// PaymentFailedScreen.jsx
// Route: /payment-failed/:paymentGroupId — the explicit report for a payment
// Razorpay rejected (declined card, failed UPI collect, expired VPA). Shows
// Razorpay's own end-user description, the amount, and the group id as a support
// reference. Both exits are explicit taps — no timers, no automatic navigation:
// retry (the hold and order still stand) or cancel the pending hold and return
// to the event.
//
// The one thing this screen must say louder than anything else is that NO MONEY
// WAS TAKEN. A failed payment is the moment a student reaches for their bank
// app, and every minute they spend unsure is a support ticket. So that sentence
// is body text at the top, not a footnote, and the retry button carries the
// amount still outstanding as its own quiet proof.
//
// Restyled onto the flow's shared furniture (registration.css) and checkout's
// own classes: this is the same payment step, seen from its failure side, and
// it should not look like a different product.

import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import { formatPaiseAmount } from '../../helpers/event-format.js';
import { PAYMENT_STATUS_COPY } from '../../brand/brand-copy.js';
import { BackIcon } from '../../components/detail-icons/DetailIcons.jsx';
import '../../design/registration.css';
import '../checkout/checkout.css';

function PaymentFailedScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { paymentGroupId } = useParams();

  const passedState = location.state ?? {};
  const failureDescription = passedState.failureDescription || '';
  const amountPaise = passedState.amountPaise ?? null;
  const event = passedState.event ?? null;

  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  async function handleCancelHold() {
    if (!event?.id || isCancelling) {
      return;
    }
    setCancelError('');
    setIsCancelling(true);
    try {
      await apiClient.post(`/events/${event.id}/registrations/mine/cancel-pending`);
      navigate(event.eventSlug ? `/events/${event.eventSlug}` : '/my-registrations', {
        replace: true,
      });
    } catch (cancelRequestError) {
      // A hold that vanished under us (expired, already cancelled) is not a
      // failure to report — the participant's goal is reached either way.
      if (cancelRequestError.code === 'REGISTRATION_NOT_FOUND') {
        navigate(event.eventSlug ? `/events/${event.eventSlug}` : '/my-registrations', {
          replace: true,
        });
        return;
      }
      setCancelError(cancelRequestError.message || PAYMENT_STATUS_COPY.cancelFailed);
      setIsCancelling(false);
    }
  }

  const amountLabel = amountPaise !== null ? formatPaiseAmount(amountPaise) : '';

  return (
    <div className="drg-screen dck-screen drg-screen--solo">
      <button type="button" className="dck-back" onClick={() => navigate(-1)} aria-label="Back">
        <BackIcon />
      </button>

      <div className="drg-col">
        <div className="dck-expired" style={{ paddingTop: 'var(--s8)' }}>
          <h1 className="dck-expired__title">That payment did not go through</h1>
          {/* Razorpay writes its description for end users, so it goes first —
              it is the only thing on this screen that says WHY. The
              no-charge line follows it either way. */}
          {failureDescription ? (
            <p className="dck-expired__body">{failureDescription}</p>
          ) : null}
          <p className="dck-retry__body">
            No money was taken. Your seat is still held, so you can try the payment again.
          </p>
        </div>

        <section className="drg-section">
          {amountPaise !== null ? (
            <p className="dck-line">
              <span>Amount</span>
              <span className="dck-line__amount">{amountLabel}</span>
            </p>
          ) : null}
          {/* The group id is what support searches on. It is a reference, not a
              thing to act on, so it sits here rather than beside the buttons. */}
          <p className="dck-line">
            <span>Support reference</span>
            <span className="dck-line__amount" style={{ overflowWrap: 'anywhere' }}>
              {paymentGroupId}
            </span>
          </p>
        </section>
      </div>

      <div className="drg-actions">
        <div className="drg-actions__inner">
          {cancelError ? (
            <p className="drg-actions__reason drg-actions__reason--alert" role="alert">
              {cancelError}
            </p>
          ) : null}
          <button
            type="button"
            className="drg-button"
            onClick={() =>
              navigate(`/checkout/${paymentGroupId}`, {
                replace: true,
                state: { event, registrationId: passedState.registrationId ?? null },
              })
            }
          >
            <span className="drg-button__label">
              {amountLabel ? `Try again — ${amountLabel}` : 'Try again'}
            </span>
          </button>
          {event?.id ? (
            <button
              type="button"
              className={isCancelling ? 'drg-button drg-button--quiet drg-button--loading' : 'drg-button drg-button--quiet'}
              onClick={handleCancelHold}
              disabled={isCancelling}
            >
              <span className="drg-button__label">Cancel and return to the event</span>
              {isCancelling ? <span className="drg-button__progress" aria-hidden="true" /> : null}
            </button>
          ) : (
            <button
              type="button"
              className="drg-button drg-button--quiet"
              onClick={() => navigate('/my-registrations')}
            >
              <span className="drg-button__label">View my registrations</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default PaymentFailedScreen;

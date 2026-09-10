// CheckoutScreen.jsx
// Route: /checkout/:paymentGroupId — the payment step of the registration flow.
//
// WHAT THIS SCREEN DOES AND DOES NOT OWN. Razorpay owns the payment surface:
// the card form, the UPI list, the error it shows on a decline. This screen
// owns everything around it — the order, the hold countdown, the amount, and
// the four states a student can be in on either side of that modal: ready,
// opening, dismissed-or-failed, and expired. There is deliberately no custom
// payment UI here; re-implementing one would mean handling card data.
//
// It is the sixth screen of ONE flow, so it wears the same furniture as the
// form before it: the sticky EventContextCard at the top with the amount in its
// price slot, and the shared action bar at the bottom with a single button.
// Loads (or re-opens) the Razorpay order for the payment group, runs a live
// countdown against the server's own hold window, and on a verified payment
// advances to the success screen.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import apiClient from '../../api-client/api-client.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { formatPaiseAmount, formatEventTypeFull } from '../../helpers/event-format.js';
import { BRAND_IDENTITY } from '../../brand/brand-identity.js';
import { CHECKOUT_COPY } from '../../brand/brand-copy.js';
import EventContextCard from '../../components/event-context-card/EventContextCard.jsx';
import { BackIcon, RetryIcon, OfflineIcon } from '../../components/detail-icons/DetailIcons.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import '../../design/registration.css';
import './checkout.css';

const RAZORPAY_SCRIPT_SOURCE = 'https://checkout.razorpay.com/v1/checkout.js';

/*
 * In-app browsers Razorpay documents as NOT supporting the checkout iframe:
 * Instagram, Facebook Messenger (FBAN/FBAV/FB_IAB), Opera Mini, and UC. A fest
 * link shared on Instagram is the normal case for this audience, so these
 * agents get the documented callback_url + redirect flow instead — full-page
 * checkout that returns to the processing screen, which polls the status
 * endpoint (the webhook confirms server-side). Every normal browser keeps the
 * handler path.
 */
const RESTRICTED_IN_APP_BROWSER_PATTERN = /instagram|fban|fbav|fb_iab|messenger|opera mini|ucbrowser/i;

function isRestrictedInAppBrowser() {
  return RESTRICTED_IN_APP_BROWSER_PATTERN.test(window.navigator.userAgent ?? '');
}

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_SOURCE;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function formatCountdown(millisecondsRemaining) {
  const totalSeconds = Math.max(0, Math.floor(millisecondsRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const URGENT_THRESHOLD_MILLISECONDS = 5 * 60 * 1000;

function CheckoutScreen() {
  const navigate = useTransitionNavigate();
  const location = useLocation();
  const { paymentGroupId } = useParams();
  const { currentUser } = useAuthentication();
  const isOnline = useOnlineStatus();

  const passedState = location.state ?? {};
  const event = passedState.event ?? null;
  const team = passedState.team ?? null;

  const [order, setOrder] = useState(null);
  const [expiresAtMilliseconds, setExpiresAtMilliseconds] = useState(null);
  const [loadState, setLoadState] = useState('loading');
  const [payError, setPayError] = useState('');
  const [isPaying, setIsPaying] = useState(false);
  /*
   * Whether the student has already been through the Razorpay modal once and
   * come back without paying — dismissed it, or had a payment declined in a
   * flow that returned here. It exists purely so the copy can change: the
   * button becomes "Try again" and the screen states, unprompted, that nothing
   * was charged. That sentence is the entire reason this state is tracked.
   */
  const [hasAttempted, setHasAttempted] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  /*
   * Whether a payment.failed event already routed us to the failure screen. The
   * modal's ondismiss also fires after a failure, and without this flag it would
   * immediately overwrite the failure screen's state.
   */
  const hasHandledFailureReference = useRef(false);

  /*
   * The registration to land on after a verified payment. Router state carries it
   * on the normal form → checkout hop, but a refresh, deep link, or the "resume
   * pending payment" path arrives with no state at all — there the order response
   * supplies it (the backend returns the group's leader registration id), so a
   * successful payment can never dead-end on /registration-success/null.
   */
  const registrationId = passedState.registrationId ?? order?.registrationId ?? null;

  const millisecondsRemaining = expiresAtMilliseconds ? expiresAtMilliseconds - now : null;
  const isExpired = millisecondsRemaining !== null && millisecondsRemaining <= 0;
  const isUrgent =
    millisecondsRemaining !== null && millisecondsRemaining <= URGENT_THRESHOLD_MILLISECONDS;

  const loadOrder = useCallback(async () => {
    setLoadState('loading');
    try {
      // The status call is the server's own view of the hold window — the client
      // no longer mirrors PAYMENT_EXPIRY_MINUTES, which would drift.
      const [createdOrder, groupStatus] = await Promise.all([
        apiClient.post('/payments/create-order', { paymentGroupId }),
        apiClient.get(`/payments/status/${paymentGroupId}`),
      ]);
      setOrder(createdOrder);
      setExpiresAtMilliseconds(
        groupStatus?.expiresAt ? new Date(groupStatus.expiresAt).getTime() : null
      );
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [paymentGroupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadOrder();
  }, [loadOrder]);

  // Tick the countdown once a second.
  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  async function handlePay() {
    if (isPaying || isExpired || !order || !isOnline) {
      return;
    }
    setPayError('');
    setIsPaying(true);

    const scriptLoaded = await loadRazorpayScript();
    if (!scriptLoaded || !window.Razorpay) {
      setPayError(CHECKOUT_COPY.razorpayUnavailable);
      setIsPaying(false);
      return;
    }

    hasHandledFailureReference.current = false;

    // The modal's own timeout runs out with the hold window, floored at a minute
    // so a participant arriving late still gets a usable modal.
    const remainingSeconds =
      millisecondsRemaining !== null ? Math.max(60, Math.floor(millisecondsRemaining / 1000)) : undefined;

    // The documented in-app-browser fallback: a full-page redirect flow whose
    // return address is the processing screen. Success is confirmed there by
    // polling (plus the webhook); a failure simply never confirms and the screen
    // ends on its explicit still-pending state — never a dead modal.
    const useRedirectFlow = isRestrictedInAppBrowser();

    const razorpayCheckout = new window.Razorpay({
      key: order.razorpayKeyId,
      order_id: order.razorpayOrderId,
      amount: order.totalAmountPaise,
      currency: 'INR',
      name: BRAND_IDENTITY.appName,
      description: event?.eventName ?? '',
      prefill: {
        email: currentUser?.emailAddress ?? '',
        name: currentUser?.fullName ?? '',
        contact: currentUser?.phoneNumber ?? '',
      },
      notes: { paymentGroupId },
      // Without this Razorpay runs its own internal retry loop and ondismiss is
      // not reliably called after a failure — retries are ours to offer.
      retry: { enabled: false },
      ...(remainingSeconds ? { timeout: remainingSeconds } : {}),
      ...(useRedirectFlow
        ? {
            callback_url: `${window.location.origin}/payment-processing/${paymentGroupId}`,
            redirect: true,
          }
        : {}),
      handler: async (razorpayResponse) => {
        try {
          await apiClient.post('/payments/verify', {
            razorpayOrderId: razorpayResponse.razorpay_order_id,
            razorpayPaymentId: razorpayResponse.razorpay_payment_id,
            razorpaySignature: razorpayResponse.razorpay_signature,
          });
          if (typeof registrationId === 'string' && registrationId !== '') {
            navigate(`/registration-success/${registrationId}`, { replace: true });
          } else {
            // No known destination — let the processing screen resolve it from
            // the status endpoint rather than dead-end on a broken path.
            navigate(`/payment-processing/${paymentGroupId}`, {
              replace: true,
              state: { eventName: event?.eventName ?? '', amountPaise: order.totalAmountPaise },
            });
          }
        } catch {
          /*
           * Razorpay has ALREADY captured the money here — only our verify call
           * failed. Never leave the user on the pay button (a second tap charges
           * them twice): the webhook confirms the group server-side, so hand off
           * to the processing screen to wait and poll.
           */
          navigate(`/payment-processing/${paymentGroupId}`, {
            replace: true,
            state: { eventName: event?.eventName ?? '', amountPaise: order.totalAmountPaise },
          });
        }
      },
      modal: {
        ondismiss: () => {
          // A dismissal after payment.failed was already routed — do nothing, or
          // the failure screen's navigation would be undone.
          if (!hasHandledFailureReference.current) {
            setIsPaying(false);
            setHasAttempted(true);
          }
        },
      },
    });

    // handler fires only on success; this is the only channel for a declined
    // card, failed UPI collect, or expired VPA. Registered before open().
    razorpayCheckout.on('payment.failed', (failureResponse) => {
      hasHandledFailureReference.current = true;
      const failureError = failureResponse?.error ?? {};
      navigate(`/payment-failed/${paymentGroupId}`, {
        state: {
          failureDescription: failureError.description ?? '',
          failureCode: failureError.code ?? '',
          failureReason: failureError.reason ?? '',
          failureStep: failureError.step ?? '',
          razorpayPaymentId: failureError.metadata?.payment_id ?? '',
          razorpayOrderId: failureError.metadata?.order_id ?? '',
          amountPaise: order.totalAmountPaise,
          event,
          registrationId,
        },
      });
    });

    razorpayCheckout.open();
  }

  // Fee line rows — only those the backend actually charged.
  const feeRows = order
    ? [
        { label: 'Registration', amountPaise: order.registrationFeePaise },
        order.platformFeePaise > 0
          ? { label: 'Platform fee', amountPaise: order.platformFeePaise }
          : null,
        order.gstAmountPaise > 0 ? { label: 'GST (18%)', amountPaise: order.gstAmountPaise } : null,
      ].filter(Boolean)
    : [];

  const amountLabel = order ? formatPaiseAmount(order.totalAmountPaise) : '';
  /*
   * The button always carries the EXACT amount, in both states. "Proceed" asks
   * somebody to commit without restating what they are committing to, and after
   * a dismissed attempt "Try again — ₹1,000" is also the plainest possible
   * evidence that the first attempt did not take the money: the same figure is
   * still outstanding.
   */
  const payLabel = hasAttempted ? `Try again — ${amountLabel}` : `Pay ${amountLabel}`;
  const isPayDisabled = isPaying || !isOnline;

  return (
    <div className="drg-screen dck-screen drg-screen--solo">
      {!isOnline ? (
        <div className="drg-offline" role="status">
          <OfflineIcon size="sm" />
          <span>You&rsquo;re offline</span>
        </div>
      ) : null}

      <button type="button" className="dck-back" onClick={() => navigate(-1)} aria-label="Back">
        <BackIcon />
      </button>

      {/* The same card that has been on screen since the form, with the amount
          in its price slot — so what is being paid for never has to be taken on
          trust at the one step where money changes hands. */}
      <EventContextCard
        event={event}
        festName={event?.festName}
        priceLabel={amountLabel}
        typeLabel={event ? formatEventTypeFull(event) : ''}
      />

      <div className="drg-col">
        {loadState === 'loading' ? (
          <div className="dck-skeletons">
            <div className="drg-skel" style={{ height: '96px' }} />
            <div className="drg-skel" style={{ height: '160px' }} />
          </div>
        ) : null}

        {loadState === 'error' ? (
          <div className="drg-state drg-state--error">
            <p className="drg-state__text">{CHECKOUT_COPY.errorMessage}</p>
            <button type="button" className="drg-button drg-button--quiet" onClick={loadOrder}>
              <RetryIcon size="sm" />
              <span className="drg-button__label">Try again</span>
            </button>
          </div>
        ) : null}

        {loadState === 'ready' && isExpired ? (
          <div className="dck-expired">
            <h1 className="dck-expired__title">The payment window closed</h1>
            <p className="dck-expired__body">
              Your seat was held for a limited time and the hold has ended. Nothing was charged —
              register again and the seat is yours if it is still open.
            </p>
            <button
              type="button"
              className="drg-button"
              onClick={() => navigate(event?.eventSlug ? `/events/${event.eventSlug}` : '/')}
            >
              <span className="drg-button__label">Register again</span>
            </button>
          </div>
        ) : null}

        {loadState === 'ready' && !isExpired && order ? (
          <main>
            <section className="drg-section">
              <h2 className="drg-section__title">Registering</h2>
              <p className="dck-for">
                <span>{team ? team.teamName : (currentUser?.fullName ?? 'You')}</span>
                {team ? (
                  <span className="dck-for__meta">
                    {(team.memberUserIds?.length ?? 0) + 1} members
                  </span>
                ) : null}
              </p>
            </section>

            <section className="drg-section">
              <h2 className="drg-section__title">What you&rsquo;re paying</h2>
              <div className="dck-lines">
                {feeRows.map((row) => (
                  <p key={row.label} className="dck-line">
                    <span>{row.label}</span>
                    <span className="dck-line__amount">{formatPaiseAmount(row.amountPaise)}</span>
                  </p>
                ))}
                <p className="dck-line dck-line--total">
                  <span>Total</span>
                  <span className="dck-line__amount">
                    {formatPaiseAmount(order.totalAmountPaise)}
                  </span>
                </p>
              </div>

              {millisecondsRemaining !== null ? (
                <p className={isUrgent ? 'dck-hold dck-hold--urgent' : 'dck-hold'}>
                  <span>Your seat is held for</span>
                  <span className="dck-hold__time">{formatCountdown(millisecondsRemaining)}</span>
                </p>
              ) : null}
            </section>

            {/* The reassurance, stated before it is asked for. */}
            {hasAttempted ? (
              <div className="dck-retry" role="status">
                <p className="dck-retry__title">That payment did not go through</p>
                <p className="dck-retry__body">
                  No money was taken. Your seat is still held and the amount below is still
                  outstanding — try again whenever you are ready.
                </p>
              </div>
            ) : null}

            <p className="dck-note">{CHECKOUT_COPY.disclaimer}</p>
            <p className="dck-note">Payments are processed by Razorpay.</p>
          </main>
        ) : null}
      </div>

      {loadState === 'ready' && !isExpired && order ? (
        <div className="drg-actions">
          <div className="drg-actions__inner">
            {payError ? (
              <p className="drg-actions__reason drg-actions__reason--alert" role="alert">
                {payError}
              </p>
            ) : null}
            <button
              type="button"
              className={isPaying ? 'drg-button drg-button--loading' : 'drg-button'}
              onClick={handlePay}
              disabled={isPayDisabled}
            >
              <span className="drg-button__label">{payLabel}</span>
              {/* The 2px stroke under the label while the order opens. The
                  button keeps its width and its label: at the moment somebody
                  has just committed money, the control under their thumb must
                  not move or change what it says. */}
              {isPaying ? <span className="drg-button__progress" aria-hidden="true" /> : null}
            </button>
            {!isOnline ? (
              <p className="drg-actions__reason">
                You&rsquo;re offline — payment needs a connection
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CheckoutScreen;

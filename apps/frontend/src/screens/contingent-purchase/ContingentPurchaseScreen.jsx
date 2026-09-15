// ContingentPurchaseScreen.jsx
// Route: /contingents/:contingentId/purchase
//
// Buying a contingent is BUYING CODES. The buyer does not name anybody: they see
// the main event, the events the bundle covers and the price, and they buy. What
// comes back is one shareable code per included event, which they hand out —
// each person who enters a code registers themselves for that event.
//
// Free: the codes arrive immediately and the screen hands over to the codes
// view. Paid: the same checkout screen every registration uses owns the Razorpay
// modal, and a captured payment lands on the codes view.
//
// The screen fetches its own data so refreshes, back-navigation, shared links
// and bookmarks all work. Router state from the fest or event page is a fast
// path to paint immediately, never the only source.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { formatPaiseAmount } from '../../helpers/event-format.js';
import { BackIcon, OfflineIcon, PassIcon, RetryIcon } from '../../components/detail-icons/DetailIcons.jsx';

import '../../design/registration.css';
import './contingent-purchase.css';
import { navigateBack } from '../../helpers/navigate-back.js';

const COPY = {
  kicker: 'Contingent',
  includedTitle: (count) => `${count} ${count === 1 ? 'event' : 'events'} included`,
  total: 'Total',
  free: 'Free',
  getCodes: 'Get codes',
  buyFor: (amount) => `Buy for ${amount}`,
  working: 'Getting your codes…',
  offline: 'You’re offline — this needs a connection',
  unavailable: 'This contingent is no longer on sale. It may have been cancelled or unpublished.',
  loadFailed: 'This contingent couldn’t be loaded.',
  backToExplore: 'Back to explore',
  retry: 'Try again',
  purchaseFailed: 'The purchase couldn’t be completed. Try again.',
};

function Backbar({ onBack }) {
  return (
    <div className="drg-backbar">
      <button type="button" className="drg-backbar__button" onClick={onBack} aria-label="Go back">
        <BackIcon size="lg" />
      </button>
    </div>
  );
}

function ContingentPurchaseScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { contingentId } = useParams();
  const isOnline = useOnlineStatus();

  /* Re-armed on mount so StrictMode's mount/unmount/mount cannot leave it false. */
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
  const [fest, setFest] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  /*
   * RESOLVING THE BUNDLE. parentEventId is nullable (a fest-level bundle), so the
   * batched fest endpoint is the primary lookup; a parent event id is the second
   * path; a cold link with no state searches the published fests.
   *
   * A bundle is sold here only if it is published AND sells codes. A contingent
   * from the older name-the-attendees flow carries no flowType and is not on
   * sale through this screen.
   */
  const fetchContingent = useCallback(async () => {
    setLoadState('loading');
    setUnavailable(false);

    const knownFestId = stateFestId ?? stateContingent?.festId ?? contingent?.festId;
    const parentEventId = stateParentEventId ?? stateContingent?.parentEventId ?? contingent?.parentEventId;

    async function findInFest(searchFestId) {
      const response = await apiClient.get(`/public/fests/${searchFestId}/contingents`);
      const byParent = response?.contingentsByParentEventId ?? {};
      const candidates = [...Object.values(byParent).flat(), ...(response?.festLevelContingents ?? [])];
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
          // Sequential: the common case hits early, and a parallel fan-out is how
          // a public list screen trips the rate limiter.
          found = await findInFest(candidateFest.id);
          if (found) {
            break;
          }
        }
      }

      if (!found || found.status !== 'published' || found.flowType !== 'codeDistribution') {
        if (mountedRef.current) {
          setUnavailable(true);
          setLoadState('error');
        }
        return;
      }
      if (mountedRef.current) {
        setContingent(found);
        setFestId(found.festId ?? knownFestId ?? null);
        setLoadState('ready');
      }
    } catch {
      if (mountedRef.current) {
        setLoadState('error');
      }
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

  useEffect(() => {
    // Fetching on mount is the effect's job; the spinner must precede the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContingent();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* The fest's name. A failure here degrades the heading, never the purchase. */
  useEffect(() => {
    if (!festId) {
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const loadedFest = await apiClient.get(`/public/fests/${festId}`);
        if (!cancelled && mountedRef.current) {
          setFest(loadedFest ?? null);
        }
      } catch {
        // Heading only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [festId]);

  async function handleBuy() {
    if (isSubmitting || !isOnline || !contingent) {
      return;
    }
    setSubmitError('');
    setIsSubmitting(true);
    try {
      const result = await apiClient.post(`/contingents/${contingentId}/purchase`, {});
      const purchase = result?.purchase ?? null;
      if (result?.payment?.paymentGroupId) {
        // The same checkout every registration uses; capture lands on the codes.
        navigate(`/checkout/${result.payment.paymentGroupId}`, {
          state: { event: { eventName: contingent.contingentName, festName: fest?.festName ?? '' } },
        });
        return;
      }
      if (purchase?.id) {
        navigate(`/my-codes/${purchase.id}`, { replace: true, state: { justPurchased: true, purchase } });
        return;
      }
      setSubmitError(COPY.purchaseFailed);
    } catch (error) {
      if (mountedRef.current) {
        setSubmitError(error?.message || COPY.purchaseFailed);
      }
    } finally {
      if (mountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }

  const goBack = () => navigateBack(navigate, '/');

  if (loadState === 'loading' && !contingent) {
    return (
      <div className="drg-screen drg-screen--purchase">
        <Backbar onBack={goBack} />
        <div className="drg-col dcp-page" aria-busy="true">
          <div className="drg-skel dcp-skel-line" style={{ width: '40%' }} />
          <div className="drg-skel dcp-skel-title" />
          <div className="drg-skel dcp-skel-row" />
          <div className="drg-skel dcp-skel-row" />
          <div className="drg-skel dcp-skel-total" />
        </div>
      </div>
    );
  }

  if (unavailable || loadState === 'error' || !contingent) {
    return (
      <div className="drg-screen drg-screen--purchase">
        <Backbar onBack={goBack} />
        <div className="drg-col dcp-page">
          <div className="drg-state">
            <div className="drg-state--error">
              <p className="drg-state__text">
                {unavailable ? COPY.unavailable : isOnline ? COPY.loadFailed : COPY.offline}
              </p>
            </div>
            <button
              type="button"
              className="drg-button drg-button--quiet"
              onClick={unavailable ? () => navigate('/') : fetchContingent}
            >
              {unavailable ? <PassIcon /> : <RetryIcon />}
              <span className="drg-button__label">{unavailable ? COPY.backToExplore : COPY.retry}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const includedEvents = contingent.includedEvents ?? [];
  const isFree = (contingent.pricePaise ?? 0) === 0;
  const priceLabel = formatPaiseAmount(contingent.pricePaise ?? 0);
  const isSoldOut =
    contingent.maximumBundleClaims != null &&
    (contingent.soldBundleCount ?? 0) >= contingent.maximumBundleClaims;

  let reasonText = '';
  if (!isOnline) {
    reasonText = COPY.offline;
  } else if (isSoldOut) {
    reasonText = 'Sold out';
  }

  return (
    <div className="drg-screen drg-screen--purchase">
      <Backbar onBack={goBack} />

      {!isOnline ? (
        <div className="drg-offline" role="status">
          <OfflineIcon size="sm" />
          <span>{COPY.offline}</span>
        </div>
      ) : null}

      <div className="drg-col dcp-page">
        <header className="dcp-head">
          <p className="dcp-head__kicker">
            {COPY.kicker}
            {fest?.festName ? ` · ${fest.festName}` : ''}
          </p>
          <h1 className="dcp-head__title">{contingent.contingentName}</h1>
        </header>

        <section className="drg-section">
          <h2 className="drg-section__title">{COPY.includedTitle(includedEvents.length)}</h2>
          <ul className="dcp-events">
            {includedEvents.map((included) => (
              <li className="dcp-events__item" key={included.id}>
                <span className="dcp-events__name">{included.eventName}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="drg-section">
          <div className="dcp-total">
            <span className="dcp-total__label">{COPY.total}</span>
            <span className="dcp-total__amount">{isFree ? COPY.free : priceLabel}</span>
          </div>
          {submitError ? (
            <div className="drg-state--error" role="alert">
              <p className="drg-state__text">{submitError}</p>
            </div>
          ) : null}
        </section>
      </div>

      <div className="drg-actions dcp-actions">
        <div className="drg-actions__inner">
          <button
            type="button"
            className={`drg-button${isSubmitting ? ' drg-button--loading' : ''}`}
            onClick={handleBuy}
            disabled={isSubmitting || !isOnline || isSoldOut}
          >
            <span className="drg-button__label">
              {isSubmitting ? COPY.working : isFree ? COPY.getCodes : COPY.buyFor(priceLabel)}
            </span>
            {isSubmitting ? <span className="drg-button__progress" /> : null}
          </button>
          {reasonText ? (
            <p className={`drg-actions__reason${isSoldOut ? ' drg-actions__reason--alert' : ''}`}>
              {reasonText}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default ContingentPurchaseScreen;

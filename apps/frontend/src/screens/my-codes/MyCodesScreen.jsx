// MyCodesScreen.jsx
// Routes: /my-codes            — every contingent purchase the participant made
//         /my-codes/:purchaseId — one purchase; after buying, with the celebration
//
// The buyer is a distributor: these screens answer "which codes have I handed
// out, and has each team assembled yet". Solo codes say who claimed them; team
// codes show a roster and the places left.

import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import DrawnCheck from '../../components/drawn-check/DrawnCheck.jsx';
import ContingentCodeList from '../../components/contingent-code-card/ContingentCodeList.jsx';
import { OfflineIcon, RetryIcon } from '../../components/detail-icons/DetailIcons.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import '../../design/contingent-codes.css';

const COPY = {
  listTitle: 'My codes',
  purchaseTitle: 'Your codes',
  readyHeadline: 'Your codes are ready',
  loading: 'Loading your codes',
  loadFailed: 'Your codes couldn’t be loaded.',
  offline: 'You’re offline — reconnect to see your latest codes.',
  retry: 'Try again',
  empty: 'You haven’t bought any contingent codes yet.',
  explore: 'Explore fests',
  notFound: 'This purchase couldn’t be found.',
  seeAll: 'See all my codes',
  pending: 'Waiting for your payment to confirm. Your codes appear here as soon as it does.',
  checkAgain: 'Check again',
  cancelled: 'This purchase was cancelled — its unused codes no longer work.',
  expired: 'This purchase expired before it was paid. No codes were issued.',
};

function PurchaseBlock({ purchase, showHeading, onRefresh }) {
  const shareTitle = [purchase.contingentName, purchase.festName].filter(Boolean).join(' — ');
  return (
    <section className="dmc-purchase">
      {showHeading ? (
        <div>
          <h2 className="dmc-purchase__title">{purchase.contingentName ?? 'Contingent'}</h2>
          {purchase.festName ? <p className="dmc-purchase__fest">{purchase.festName}</p> : null}
        </div>
      ) : purchase.festName ? (
        <p className="dmc-purchase__fest">{purchase.festName}</p>
      ) : null}

      {purchase.status === 'pending' ? (
        <>
          <p className="dmc-note">{COPY.pending}</p>
          <button type="button" className="dmc-button" onClick={onRefresh}>
            {COPY.checkAgain}
          </button>
        </>
      ) : null}
      {purchase.status === 'cancelled' ? <p className="dmc-note">{COPY.cancelled}</p> : null}
      {purchase.status === 'expired' ? <p className="dmc-note">{COPY.expired}</p> : null}

      {purchase.codes?.length > 0 ? (
        <ContingentCodeList
          codes={purchase.codes}
          shareTitle={shareTitle}
          showMessage={purchase.status === 'completed'}
        />
      ) : null}
    </section>
  );
}

function MyCodesScreen() {
  const { purchaseId = null } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();

  const justPurchased = location.state?.justPurchased === true;
  const statePurchase = location.state?.purchase ?? null;

  const [purchases, setPurchases] = useState(() => (statePurchase ? [statePurchase] : []));
  const [loadState, setLoadState] = useState(statePurchase ? 'ready' : 'loading');

  const loadPurchases = useCallback(async () => {
    try {
      const result = await apiClient.get('/contingents/codes/mine');
      setPurchases(Array.isArray(result?.purchases) ? result.purchases : []);
      setLoadState('ready');
    } catch {
      // Anything already on screen stays readable; only an empty screen fails.
      setLoadState((previous) => (previous === 'ready' ? 'ready' : 'error'));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPurchases();
  }, [loadPurchases]);

  const visible = purchaseId ? purchases.filter((purchase) => purchase.id === purchaseId) : purchases;
  const title = purchaseId ? visible[0]?.contingentName ?? COPY.purchaseTitle : COPY.listTitle;

  return (
    <div className="dmc-screen">
      <ScreenHeader title={title} />

      <main className="dmc-page">
        {!isOnline ? (
          <p className="dmc-offline" role="status">
            <OfflineIcon size="sm" />
            {COPY.offline}
          </p>
        ) : null}

        {purchaseId && justPurchased && visible.length > 0 ? (
          <div className="dmc-celebrate">
            <DrawnCheck label="Codes ready" />
            <h1 className="dmc-title">{COPY.readyHeadline}</h1>
          </div>
        ) : null}

        {loadState === 'loading' ? (
          <div aria-busy="true" aria-label={COPY.loading}>
            <div className="dmc-skel" />
          </div>
        ) : null}

        {loadState === 'error' ? (
          <div className="dmc-state">
            {isOnline ? <RetryIcon size="lg" /> : <OfflineIcon size="lg" />}
            <p className="dmc-state__text">{isOnline ? COPY.loadFailed : COPY.offline}</p>
            <button type="button" className="dmc-button" onClick={loadPurchases}>
              {COPY.retry}
            </button>
          </div>
        ) : null}

        {loadState === 'ready' && visible.length === 0 ? (
          <div className="dmc-state">
            <p className="dmc-state__text">{purchaseId ? COPY.notFound : COPY.empty}</p>
            <button
              type="button"
              className="dmc-button"
              onClick={() => navigate(purchaseId ? '/my-codes' : '/')}
            >
              {purchaseId ? COPY.seeAll : COPY.explore}
            </button>
          </div>
        ) : null}

        {loadState === 'ready'
          ? visible.map((purchase) => (
              <PurchaseBlock
                key={purchase.id}
                purchase={purchase}
                showHeading={!purchaseId}
                onRefresh={loadPurchases}
              />
            ))
          : null}
      </main>
    </div>
  );
}

export default MyCodesScreen;

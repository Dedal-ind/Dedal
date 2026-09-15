// AddOnShop.jsx
// The add-ons a participant can still buy for one registration, as compact rows:
// name, price, Buy. Used on the pass screen (the most important place — they are
// at the venue, looking at their pass, and want food now) and in the event
// page's add-ons sheet.
//
// Renders nothing while loading, on error, or when there is nothing left to buy:
// an empty "Add-ons" heading under a pass is noise at a gate.

import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api-client/api-client.js';
import { formatPaiseAmount } from '../../helpers/event-format.js';
import { addOnKeyOf, useAddOnPurchase } from '../../hooks/use-add-on-purchase/use-add-on-purchase.js';
import './add-on-shop.css';

function AddOnShop({ registrationId, returnTo = null, onApplied = null, title = 'Add-ons', hideTitle = false }) {
  const [offers, setOffers] = useState([]);

  const loadOffers = useCallback(async () => {
    try {
      const result = await apiClient.get(`/registrations/${registrationId}/add-ons`);
      setOffers(Array.isArray(result?.offers) ? result.offers : []);
    } catch {
      setOffers([]);
    }
  }, [registrationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadOffers();
  }, [loadOffers]);

  const handleApplied = useCallback(async () => {
    await loadOffers();
    await onApplied?.();
  }, [loadOffers, onApplied]);

  const { buy, busyKey, error } = useAddOnPurchase({
    registrationId,
    returnTo,
    onApplied: handleApplied,
  });

  if (offers.length === 0) {
    return null;
  }

  return (
    <section className="das-shop" aria-label={title}>
      {hideTitle ? null : <h2 className="das-shop__title">{title}</h2>}
      <ul className="das-shop__list">
        {offers.map((offer) => {
          const key = addOnKeyOf(offer);
          const isBusy = busyKey === key;
          return (
            <li className="das-row" key={key}>
              <span className="das-row__body">
                <span className="das-row__name">{offer.offerName}</span>
                {offer.description ? <span className="das-row__note">{offer.description}</span> : null}
              </span>
              <span className="das-row__price">
                {offer.isPaid === false || !offer.ratePaise ? 'Free' : formatPaiseAmount(offer.ratePaise)}
              </span>
              <button
                type="button"
                className="das-row__buy"
                onClick={() => buy(offer)}
                disabled={Boolean(busyKey)}
              >
                {isBusy ? 'Adding…' : 'Buy'}
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="das-shop__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export default AddOnShop;

// use-add-on-purchase.js
// Buying one add-on for a registration that already exists — from the pass,
// from the event page, or from the registration detail. One hook, so all three
// buy the same way through the same endpoint.
//
//   · free           → applied inline; onApplied refreshes the caller, and the
//                      pass picks up the new entitlement on its next read.
//   · paid           → the existing checkout; returnTo brings the participant
//                      back to where they bought it rather than to a receipt.
//   · needs quantity → an offer that asks for people or days opens the add-ons
//                      screen, which owns the steppers.
//
// POST /registrations/:registrationId/add-ons validates that the registration
// is the caller's own and confirmed, parks paid selections on an add-on order,
// and grants the entitlement on the SAME pass once the money lands.

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';

export function addOnKeyOf(offer) {
  return `${offer.scope}:${offer.offerKey}`;
}

export function useAddOnPurchase({ registrationId, returnTo = null, onApplied = null }) {
  const navigate = useNavigate();
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState('');

  const buy = useCallback(
    async (offer) => {
      if (!registrationId || busyKey) {
        return;
      }
      if (offer.collectsNumberOfPeople || offer.collectsNumberOfDays) {
        navigate(`/registrations/${registrationId}/add-ons`, { state: { returnTo } });
        return;
      }
      setError('');
      setBusyKey(addOnKeyOf(offer));
      try {
        const result = await apiClient.post(`/registrations/${registrationId}/add-ons`, {
          offerSelections: [{ offerKey: offer.offerKey, scope: offer.scope }],
        });
        if (result?.paid && result.paymentGroupId) {
          navigate(`/checkout/${result.paymentGroupId}`, {
            state: { registrationId, isAddOnPurchase: true, returnTo },
          });
          return;
        }
        await onApplied?.();
      } catch (purchaseError) {
        setError(purchaseError?.message || 'Couldn’t add that. Try again.');
      } finally {
        setBusyKey(null);
      }
    },
    [registrationId, busyKey, navigate, returnTo, onApplied],
  );

  return { buy, busyKey, error };
}

export default useAddOnPurchase;

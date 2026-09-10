// use-consent-standing.js
// What the signed-in person currently stands accepted on, per legal document,
// from GET /users/me/consents — the append-only consent records, not the
// deprecated timestamps on the user. Shared by the participant settings screen
// and the admin profile screen, which render it in their own registers.
//
// status: 'loading' | 'ready' | 'error'. `standing` is the endpoint's shape:
// { [kind]: { status, policyVersionId, versionLabel, consentedAt,
//             effectiveVersionId, isCurrentVersion } }.

import { useCallback, useEffect, useState } from 'react';
import { fetchConsentStanding, isNetworkError } from '../../helpers/policy-documents.js';

export function useConsentStanding() {
  const [status, setStatus] = useState('loading');
  const [standing, setStanding] = useState(null);
  const [errorIsNetwork, setErrorIsNetwork] = useState(false);

  const reload = useCallback(async () => {
    setStatus('loading');
    try {
      const payload = await fetchConsentStanding();
      setStanding(payload && typeof payload === 'object' ? payload : {});
      setStatus('ready');
    } catch (error) {
      setErrorIsNetwork(isNetworkError(error));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  return { status, standing, errorIsNetwork, reload };
}

export default useConsentStanding;

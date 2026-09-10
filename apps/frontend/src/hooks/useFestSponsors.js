// useFestSponsors.js
// Sponsors for a fest, for the surfaces that know a festId but not the fest.
//
// The success, event-detail and pass screens each load something else entirely
// (a registration, an event, a pass) and none of them carries the fest's
// sponsor array. Rather than widen three unrelated endpoints' projections to
// carry sponsors they otherwise have no use for, each screen asks the public
// fest endpoint for them here.
//
// A failure resolves to an empty list, never an error: SponsorStrip renders
// nothing for an empty list, so a sponsor fetch that fails degrades to the
// screen exactly as it was before sponsors existed.

import { useEffect, useState } from 'react';
import apiClient from '../api-client/api-client.js';

export function useFestSponsors(festId) {
  const [sponsors, setSponsors] = useState([]);

  useEffect(() => {
    if (!festId) {
      return undefined;
    }
    let isActive = true;
    apiClient
      .get(`/public/fests/${festId}`)
      .then((fest) => {
        if (isActive) {
          setSponsors(Array.isArray(fest?.sponsors) ? fest.sponsors : []);
        }
      })
      .catch(() => isActive && setSponsors([]));
    return () => {
      isActive = false;
    };
  }, [festId]);

  return sponsors;
}

export default useFestSponsors;

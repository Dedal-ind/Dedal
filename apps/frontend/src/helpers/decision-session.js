// decision-session.js
// The client side of the promotions decision endpoint, and the one place the
// anonymous session key lives.
//
// THE SESSION KEY IS HELD IN MEMORY ONLY. The server mints it for an
// age-restricted or unknown-age participant so frequency caps can accumulate
// within a browsing session, and it expires on its own. It is echoed back on
// every decision request for the life of this page load and then forgotten.
// It is NEVER written to localStorage, sessionStorage, IndexedDB, a cookie,
// or anywhere else: persisted, it would become a durable identifier of a
// child, which is exactly what it exists to avoid being.

import apiClient from '../api-client/api-client.js';

let sessionKey = null;

/* Exposed for the reporter's sake only; not for storage. */
export function getDecisionSessionKey() {
  return sessionKey;
}

/*
 * One decision for one placement. Returns the endpoint's payload:
 * { fill: true, decision } or { fill: false, reason }. A failed request is
 * reported as a no-fill — a promotion that does not load is a normal outcome,
 * not an error the participant should see.
 */
export async function fetchDecision(placementKey) {
  try {
    const response = await apiClient.get('/decisions', {
      params: { placement: placementKey },
      headers: sessionKey ? { 'X-Session-Key': sessionKey } : undefined,
    });
    if (response && typeof response.sessionKey === 'string' && response.sessionKey.length > 0) {
      sessionKey = response.sessionKey;
    }
    return response ?? { fill: false, reason: 'empty' };
  } catch {
    return { fill: false, reason: 'requestFailed' };
  }
}

/*
 * Up to `count` DISTINCT decisions for a placement, for a surface that shows
 * several at once. Each call is one decision; the loop stops at the first
 * no-fill or the first repeated campaign, so a placement with one eligible
 * campaign yields one slide rather than the same creative three times.
 */
export async function fetchDistinctDecisions(placementKey, count) {
  const decisions = [];
  const seenCampaignIds = new Set();
  for (let index = 0; index < count; index += 1) {
    const result = await fetchDecision(placementKey);
    if (!result.fill || !result.decision) {
      break;
    }
    if (seenCampaignIds.has(result.decision.campaignId)) {
      break;
    }
    seenCampaignIds.add(result.decision.campaignId);
    decisions.push(result.decision);
  }
  return decisions;
}

/*
 * The slide shape the carousel renders, from a decision. The decision token
 * rides along as `decisionToken`; that is the only thing the reporter needs.
 */
export function toPromotionSlide(decision) {
  return {
    id: decision.token,
    decisionToken: decision.token,
    title: decision.creative.title,
    mediaType: decision.creative.mediaType,
    imageUrl: decision.creative.imageUrl,
    videoUrl: decision.creative.videoUrl,
    linkUrl: decision.creative.linkUrl,
    description: decision.creative.description,
    collegeName: decision.promoter?.kind === 'college' ? decision.promoter.displayName : null,
    /*
     * Who is promoting, WHATEVER kind of promoter they are. The feed card
     * prints this where a fest card prints its host college, so a sponsor and
     * a college both say who they are in the same place. `collegeName` above
     * is unchanged and still college-only — the carousel that reads it is
     * gone, but nothing else about the decision payload should shift under a
     * consumer that has not been rewritten.
     */
    promoterName: decision.promoter?.displayName ?? null,
  };
}

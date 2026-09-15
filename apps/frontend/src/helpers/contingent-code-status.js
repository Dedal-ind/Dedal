// contingent-code-status.js
// How a contingent code is described to the person holding it — the buyer on
// the codes screen, and anyone joining with one.
//
// A SOLO code admits one person; a TEAM code admits the whole team, and every
// redeemer joins the same team. The copy and share gestures are identical for
// both. What differs is the LABEL: whether the buyer sends it to one person or
// to a group, and how progress is counted.

export const SHARE_CODES_MESSAGE =
  'Share these codes with your group. Each person enters a code to join that event.';

function spotsText(count) {
  return `${count} ${count === 1 ? 'spot' : 'spots'} remaining`;
}

/*
 * One code from GET /contingents/codes/mine (or a purchase response):
 * { code, eventName, eventType, maxUses, claimCount, isFull, isExpired,
 *   isRedeemable, claims: [{ userId, fullName, claimedAt, isCaptain? }] }
 */
export function describeContingentCode(entry) {
  const isTeam = entry?.eventType === 'team';
  const claims = Array.isArray(entry?.claims) ? entry.claims : [];
  const maxUses = entry?.maxUses ?? 1;
  const claimCount = entry?.claimCount ?? claims.length;
  const isFull = entry?.isFull ?? claimCount >= maxUses;
  const isExpired = entry?.isExpired === true;
  // isRedeemable false on a code that is neither full nor expired means its
  // purchase or bundle was cancelled.
  const isInvalidated = entry?.isRedeemable === false && !isFull && !isExpired;
  const eventName = entry?.eventName || 'Event';

  let statusText;
  let tone;
  if (isTeam) {
    if (isFull) {
      statusText = 'Full — team complete';
      tone = 'done';
    } else if (isExpired) {
      statusText = 'Expired';
      tone = 'dead';
    } else if (isInvalidated) {
      statusText = 'No longer valid';
      tone = 'dead';
    } else {
      statusText = `${claimCount} of ${maxUses} joined`;
      tone = claimCount > 0 ? 'progress' : 'open';
    }
  } else if (isFull) {
    statusText = `Claimed by ${claims[0]?.fullName || 'a participant'}`;
    tone = 'done';
  } else if (isExpired) {
    statusText = 'Expired';
    tone = 'dead';
  } else if (isInvalidated) {
    statusText = 'No longer valid';
    tone = 'dead';
  } else {
    statusText = 'Available';
    tone = 'open';
  }

  const spotsRemaining = Math.max(0, maxUses - claimCount);
  const canUse = !isFull && !isExpired && !isInvalidated;

  return {
    code: entry?.code ?? '',
    isTeam,
    label: isTeam ? `${eventName} (Team of ${maxUses})` : eventName,
    hint: isTeam ? `Share this code with all ${maxUses} team members` : 'Give this code to one person',
    statusText,
    tone,
    canCopy: canUse,
    roster: isTeam
      ? claims.map((claim, index) => ({
          key: `${claim.userId ?? index}`,
          name: claim.fullName || 'A participant',
          isCaptain: claim.isCaptain === true,
        }))
      : [],
    spotsRemaining,
    spotsText: isTeam && canUse ? spotsText(spotsRemaining) : null,
  };
}

/* The text a native share sheet (or the clipboard fallback) receives. */
export function formatCodesForSharing(codes, heading = '') {
  const lines = codes.map((entry) => {
    const described = describeContingentCode(entry);
    return `${described.label} — CODE: ${described.code}`;
  });
  return [heading, heading ? '' : null, ...lines, '', SHARE_CODES_MESSAGE]
    .filter((line) => line !== null)
    .join('\n');
}

/*
 * The words a joiner reads for every refusal the redeem/inspect endpoints give.
 * TEAM_FULL counts as "used": on a contingent team code the team IS the code.
 */
export function describeCodeRefusal(errorCode, fallback = 'This code could not be used.') {
  switch (errorCode) {
    case 'INVITE_CODE_NOT_FOUND':
    case 'VALIDATION_FAILED':
      return 'Invalid code — check and try again';
    case 'CONTINGENT_CODE_FULLY_CLAIMED':
    case 'CONTINGENT_CODE_ALREADY_REDEEMED':
    case 'TEAM_FULL':
      return 'This code has already been used';
    case 'CONTINGENT_CODE_EXPIRED':
      return 'This code has expired';
    case 'EVENT_FULL':
      return 'This event is full — your code is still valid if a slot opens';
    case 'CONTINGENT_CODE_INVALIDATED':
      return 'This code is no longer valid';
    case 'ALREADY_REGISTERED':
      return 'You’re already registered for this event';
    default:
      return fallback;
  }
}

// ContingentVerticalCodes.jsx
// The buyer's per-vertical join codes for one contingent purchase.
//
// A code is a seat the buyer has ALREADY PAID FOR, handed to whoever is actually
// competing in that vertical. So the block leads with the thing the buyer has to
// act on — the code itself, and how many seats are left on it — rather than with
// the event metadata they already know.
//
// Codes are minted when the payment captures, so this renders nothing until then
// rather than showing an empty table that looks like a failure.
//
// STYLING. Dedal tokens, via `dmr-codes*` classes declared in
// screens/my-registrations/my-registrations.css. It has no stylesheet of its own
// on purpose: MyRegistrationsScreen is its only caller, the block only ever
// appears inside a purchase row on that screen, and a second CSS file for eight
// rules would be a file somebody has to remember exists. If a second caller
// appears, that is the moment to lift these rules into a component stylesheet.
//
// The retired Heritage palette classes and the caps labels are gone; nothing
// here names a colour that is not one of the six tokens.

import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../api-client/api-client.js';
import { CheckCircleIcon } from '../detail-icons/DetailIcons.jsx';
import { PARTICIPANT_CONTINGENT_COPY } from '../../brand/brand-copy.js';

/* Sentence-case dedal strings. PARTICIPANT_CONTINGENT_COPY is still shouting for
   screens that have not been redesigned, so only the two functions that build a
   sentence from data are taken from it. */
const COPY = {
  title: 'Join codes',
  help: 'Give each code to the person competing in that event. They redeem it to claim the seat you paid for.',
  copy: 'Copy',
  copied: 'Copied',
  copyAll: 'Copy all',
  copyAllLabel: 'Copy every join code',
  copyCodeFor: (eventName) => `Copy the join code for ${eventName}`,
  copiedAnnouncement: 'Copied to the clipboard.',
  copyFailed: 'We could not reach the clipboard. Select the code and copy it.',
  slots: (remaining, maximum) =>
    remaining === 0 ? 'All seats claimed' : `${remaining} of ${maximum} seats left`,
  shareWith: PARTICIPANT_CONTINGENT_COPY.shareCodeWith,
};

/* The copied-glyph hold, matched to the invite-code button on the registration
   detail so the same gesture takes the same time everywhere. */
const COPIED_HOLD_MS = 1500;

/*
 * navigator.clipboard is unavailable on an insecure origin and can be refused
 * even on a secure one, so every copy path reports rather than silently doing
 * nothing — a code the buyer believes they copied and did not is worse than a
 * visible failure.
 */
async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function ContingentVerticalCodes({ contingentPurchaseGroupId }) {
  const [codes, setCodes] = useState([]);
  const [copiedKey, setCopiedKey] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  const resetTimerRef = useRef(null);

  const loadCodes = useCallback(async () => {
    try {
      const result = await apiClient.get(
        `/contingent-purchases/${contingentPurchaseGroupId}/vertical-codes`,
      );
      setCodes(Array.isArray(result) ? result : []);
    } catch {
      setCodes([]);
    }
  }, [contingentPurchaseGroupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCodes();
  }, [loadCodes]);

  /* The tick reverts after 1.5s, and the timer is cleared on unmount — this
     block lives inside a purchase row that disappears the moment the purchase
     is cancelled, so firing into an unmounted component is not hypothetical. */
  useEffect(() => () => window.clearTimeout(resetTimerRef.current), []);

  const handleCopy = useCallback(async (key, value) => {
    window.clearTimeout(resetTimerRef.current);
    const didCopy = await copyText(value);
    setCopyFailed(!didCopy);
    setCopiedKey(didCopy ? key : '');
    if (didCopy) {
      resetTimerRef.current = window.setTimeout(() => setCopiedKey(''), COPIED_HOLD_MS);
    }
  }, []);

  if (codes.length === 0) {
    return null;
  }

  const allCodesText = codes.map((code) => `${code.eventName}: ${code.inviteCode}`).join('\n');

  return (
    <div className="dmr-codes">
      <div className="dmr-codes__head">
        <h4 className="dmr-codes__title">{COPY.title}</h4>
        <button
          type="button"
          className="dmr-button"
          onClick={() => handleCopy('all', allCodesText)}
          aria-label={COPY.copyAllLabel}
        >
          {copiedKey === 'all' ? COPY.copied : COPY.copyAll}
        </button>
      </div>

      <p className="dmr-codes__help">{COPY.help}</p>

      <ul className="dmr-codes__list">
        {codes.map((code) => (
          <li className="dmr-codes__item" key={code.id}>
            <div className="dmr-codes__row">
              <span className="dmr-codes__event">{code.eventName}</span>
              {/*
                Seats left. At zero it becomes --primary: a code that can no
                longer be redeemed is the one fact in this block that changes
                what the buyer has to do next. Everything else stays --ink or
                --muted so that one line has somewhere to stand out from.
              */}
              <span
                className={
                  code.remainingSlots === 0
                    ? 'dmr-codes__slots dmr-codes__slots--none'
                    : 'dmr-codes__slots'
                }
              >
                {COPY.slots(code.remainingSlots, code.maxClaims)}
              </span>
            </div>

            <div className="dmr-codes__row">
              <code className="dmr-codes__code">{code.inviteCode}</code>
              <button
                type="button"
                className={
                  copiedKey === code.id ? 'dmr-button dmr-button--done' : 'dmr-button'
                }
                onClick={() => handleCopy(code.id, code.inviteCode)}
                aria-label={COPY.copyCodeFor(code.eventName)}
              >
                <span className="dmr-codes__glyph" aria-hidden="true">
                  {copiedKey === code.id ? <CheckCircleIcon size="sm" /> : null}
                </span>
                {copiedKey === code.id ? COPY.copied : COPY.copy}
              </button>
            </div>

            <p className="dmr-codes__hint">{COPY.shareWith(code.eventName)}</p>
          </li>
        ))}
      </ul>

      {/*
        THE ANNOUNCEMENT. The icon swapping to a tick is completely silent to a
        screen reader — the button's accessible name does not change — so the
        result of the press is stated here instead. Visually hidden, polite, and
        one region for the whole block rather than one per row, because five live
        regions on one card is five things competing to interrupt.
      */}
      <span className="dmr-sr" role="status" aria-live="polite">
        {copiedKey ? COPY.copiedAnnouncement : ''}
      </span>

      {copyFailed ? (
        <p className="dmr-codes__failed" role="alert">
          {COPY.copyFailed}
        </p>
      ) : null}
    </div>
  );
}

export default ContingentVerticalCodes;

// ContingentCodeCard.jsx
// One shareable contingent code: which event it is for, the code, whether it
// goes to one person or a whole team, where it stands, and — for a team code —
// who has joined so far.
//
// Copy is the same gesture for solo and team codes. The icon morphs to a tick
// for 1.5s and a polite live region says it happened, because a swapped glyph
// is silent to a screen reader.

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon } from '../detail-icons/DetailIcons.jsx';
import { describeContingentCode } from '../../helpers/contingent-code-status.js';
import { copyToClipboard } from '../../helpers/clipboard.js';
import '../../design/contingent-codes.css';

const COPIED_HOLD_MS = 1500;

function ContingentCodeCard({ entry }) {
  const described = describeContingentCode(entry);
  const [copyState, setCopyState] = useState('idle'); // idle | copied | failed
  const resetTimerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(resetTimerRef.current), []);

  async function handleCopy() {
    window.clearTimeout(resetTimerRef.current);
    const didCopy = await copyToClipboard(described.code);
    setCopyState(didCopy ? 'copied' : 'failed');
    if (didCopy) {
      resetTimerRef.current = window.setTimeout(() => setCopyState('idle'), COPIED_HOLD_MS);
    }
  }

  const isCopied = copyState === 'copied';

  return (
    <li className="dcc-card">
      <div className="dcc-card__head">
        <p className="dcc-card__event">{described.label}</p>
        <span className={`dcc-status dcc-status--${described.tone}`}>{described.statusText}</span>
      </div>

      <div className="dcc-card__code-row">
        <span className="dcc-card__code-label">CODE</span>
        <code className={described.tone === 'dead' ? 'dcc-card__code dcc-card__code--dead' : 'dcc-card__code'}>
          {described.code}
        </code>
        {described.canCopy ? (
          <button
            type="button"
            className={isCopied ? 'dcc-copy dcc-copy--done' : 'dcc-copy'}
            onClick={handleCopy}
            aria-label={`Copy the code for ${described.label}`}
          >
            {/* Keyed so the glyph remounts and plays its pop on each change. */}
            <span className="dcc-copy__glyph" key={isCopied ? 'check' : 'copy'} aria-hidden="true">
              {isCopied ? <CheckIcon size="sm" /> : <CopyIcon size="sm" />}
            </span>
          </button>
        ) : null}
      </div>

      <p className="dcc-card__hint">{described.hint}</p>

      {described.isTeam && (described.roster.length > 0 || described.spotsText) ? (
        <div className="dcc-roster">
          {described.roster.length > 0 ? (
            <ul className="dcc-roster__list">
              {described.roster.map((member) => (
                <li className="dcc-roster__member" key={member.key}>
                  <span>{member.name}</span>
                  {member.isCaptain ? <span className="dcc-roster__role">Captain</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {described.spotsText ? <p className="dcc-roster__spots">{described.spotsText}</p> : null}
        </div>
      ) : null}

      <span className="dcc-sr" role="status" aria-live="polite">
        {isCopied ? 'Code copied.' : ''}
      </span>
      {copyState === 'failed' ? (
        <p className="dcc-card__failed" role="alert">
          Couldn’t reach the clipboard. Select the code and copy it.
        </p>
      ) : null}
    </li>
  );
}

export default ContingentCodeCard;

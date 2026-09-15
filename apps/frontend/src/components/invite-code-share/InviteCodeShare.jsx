// InviteCodeShare.jsx
// One shareable code with its two gestures: copy and share. Used for contingent
// codes and a captain's team invite code, so both behave identically.
//
// Share opens the native sheet; where there is none (most desktops) the text
// goes to the clipboard instead. The copy glyph morphs to a tick for 1.5s and a
// polite live region announces it.

import { useEffect, useRef, useState } from 'react';
import { CheckIcon, CopyIcon, ShareIcon } from '../detail-icons/DetailIcons.jsx';
import { copyToClipboard } from '../../helpers/clipboard.js';
import '../../design/contingent-codes.css';

const COPIED_HOLD_MS = 1500;

function InviteCodeShare({ code, label, shareTitle = '', shareText, isDead = false }) {
  const [notice, setNotice] = useState(''); // '' | copied | shared | failed
  const resetTimerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(resetTimerRef.current), []);

  function flash(next) {
    window.clearTimeout(resetTimerRef.current);
    setNotice(next);
    if (next !== 'failed') {
      resetTimerRef.current = window.setTimeout(() => setNotice(''), COPIED_HOLD_MS);
    }
  }

  async function handleCopy() {
    flash((await copyToClipboard(code)) ? 'copied' : 'failed');
  }

  async function handleShare() {
    const text = shareText ?? `${label ? `${label}: ` : ''}${code}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: shareTitle || label || 'Code', text });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }
      }
    }
    flash((await copyToClipboard(text)) ? 'shared' : 'failed');
  }

  const isCopied = notice === 'copied';

  return (
    <>
      <div className="dcc-card__code-row">
        <span className="dcc-card__code-label">CODE</span>
        <code className={isDead ? 'dcc-card__code dcc-card__code--dead' : 'dcc-card__code'}>{code}</code>
        {isDead ? null : (
          <>
            <button
              type="button"
              className={isCopied ? 'dcc-copy dcc-copy--done' : 'dcc-copy'}
              onClick={handleCopy}
              aria-label={label ? `Copy the code for ${label}` : 'Copy code'}
            >
              <span className="dcc-copy__glyph" key={isCopied ? 'check' : 'copy'} aria-hidden="true">
                {isCopied ? <CheckIcon size="sm" /> : <CopyIcon size="sm" />}
              </span>
            </button>
            <button
              type="button"
              className="dcc-copy dcc-copy--share"
              onClick={handleShare}
              aria-label={label ? `Share the code for ${label}` : 'Share code'}
            >
              <ShareIcon size="sm" />
            </button>
          </>
        )}
      </div>
      <span className="dcc-sr" role="status" aria-live="polite">
        {isCopied ? 'Code copied.' : notice === 'shared' ? 'Code copied to share.' : ''}
      </span>
      {notice === 'failed' ? (
        <p className="dcc-card__failed" role="alert">
          Couldn’t reach the clipboard. Select the code and copy it.
        </p>
      ) : null}
    </>
  );
}

export default InviteCodeShare;

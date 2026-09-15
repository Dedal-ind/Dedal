// ContingentCodeList.jsx
// Every code in one purchase, with the one sentence that says what to do with
// them and a "Share all codes" action.
//
// Share opens the native share sheet with every code as text. Where the browser
// has no share sheet (most desktops) the same text goes to the clipboard, and
// the screen says so — a button that does nothing on a laptop is a dead end.

import { useState } from 'react';
import { ShareIcon } from '../detail-icons/DetailIcons.jsx';
import ContingentCodeCard from './ContingentCodeCard.jsx';
import { copyToClipboard } from '../../helpers/clipboard.js';
import {
  SHARE_CODES_MESSAGE,
  describeContingentCode,
  formatCodesForSharing,
} from '../../helpers/contingent-code-status.js';
import '../../design/contingent-codes.css';

function ContingentCodeList({ codes, shareTitle = '', showMessage = true }) {
  const [shareNotice, setShareNotice] = useState('');
  const hasShareableCode = codes.some((entry) => describeContingentCode(entry).canCopy);

  async function handleShareAll() {
    setShareNotice('');
    const text = formatCodesForSharing(codes, shareTitle);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: shareTitle || 'Contingent codes', text });
        return;
      } catch (error) {
        // Closing the sheet is a choice, not a failure.
        if (error?.name === 'AbortError') {
          return;
        }
      }
    }
    const didCopy = await copyToClipboard(text);
    setShareNotice(
      didCopy
        ? 'All codes copied — paste them into your group chat.'
        : 'Couldn’t share the codes. Copy each one below instead.',
    );
  }

  return (
    <div className="dcc-list">
      {showMessage ? <p className="dcc-message">{SHARE_CODES_MESSAGE}</p> : null}

      {hasShareableCode ? (
        <button type="button" className="dcc-share" onClick={handleShareAll}>
          <ShareIcon size="sm" />
          Share all codes
        </button>
      ) : null}
      {shareNotice ? (
        <p className="dcc-notice" role="status">
          {shareNotice}
        </p>
      ) : null}

      <ul className="dcc-cards">
        {codes.map((entry) => (
          <ContingentCodeCard key={entry.code} entry={entry} shareTitle={shareTitle} />
        ))}
      </ul>
    </div>
  );
}

export default ContingentCodeList;

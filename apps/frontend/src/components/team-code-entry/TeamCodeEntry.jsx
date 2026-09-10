// TeamCodeEntry.jsx
// The 8-box invite-code entry shared by the event detail screen and /my-teams —
// one implementation, not two. ALPHANUMERIC (A–Z 0–9, uppercased), not the
// OTP's digits. Owns the character boxes and, when the event requires one, the
// joiner's OWN medical declaration (never inherited from the leader); the
// caller performs the join — onSubmit receives (inviteCode,
// hasAcceptedMedicalDeclaration) — and passes back errorMessage / isJoining.
// TODO(client decision): joiners currently pay the event share only and cannot
// add their own offers (add-ons) here; the client will decide whether joiners
// get an add-ons step later. Mirrors the TODO in joinTeamByInviteCode.
//
// ── THE FORK IS GONE ──────────────────────────────────────────────────────
// screens/team-management/TeamJoinCodeEntry.jsx was a copy of this file, made
// because restyling this one onto the design system would have restyled the
// then-unmigrated Heritage event-detail screen from underneath it. Event detail
// is migrated, so that reason expired: the copy's dedal markup was folded back
// in here, the copy was deleted, and both screens render this component again.
// Its styling is design/team-code-entry.css (prefix `dtc-`), which is the
// component's own sheet — it does not borrow from a screen's stylesheet.

import { useEffect, useRef, useState } from 'react';
import { INVITE_CODE_LENGTH } from '../../constants/registration-constants.js';
import { TEAMS_COPY, REGISTRATION_FORM_COPY } from '../../brand/brand-copy.js';

/* The label while the join is in flight. Not in brand-copy.js because it is the
   busy state of one button and nothing else reads it. */
const JOINING_LABEL = 'Joining…';

function TeamCodeEntry({
  onSubmit,
  isJoining = false,
  errorMessage = '',
  showMedicalDeclaration = false,
  /*
   * Optional. Fires with the code so far, so a caller can look it up while it is
   * being typed (the contingent join box reports which vertical a code opens and
   * how many seats are left). Optional because the plain team-join callers do not
   * want a lookup on every keystroke.
   */
  onCodeChange = null,
  /* Rendered under the boxes — the caller's live verdict on the current code. */
  feedback = null,
  /* Joining is a write. Offline it cannot succeed, so the submit is disabled
     with the reason stated rather than failing after the tap. */
  disabledReason = '',
}) {
  const [codeCharacters, setCodeCharacters] = useState(() => Array(INVITE_CODE_LENGTH).fill(''));
  const [hasAcceptedMedicalDeclaration, setHasAcceptedMedicalDeclaration] = useState(false);
  const inputReferences = useRef([]);

  const inviteCode = codeCharacters.join('');
  const isMedicalSatisfied = !showMedicalDeclaration || hasAcceptedMedicalDeclaration;
  const isSubmitBlocked =
    inviteCode.length !== INVITE_CODE_LENGTH ||
    isJoining ||
    !isMedicalSatisfied ||
    Boolean(disabledReason);

  /*
   * Reports upward whenever the assembled code changes. In an effect rather than
   * inside the keystroke handlers so a paste — which fills every box in one go —
   * reports once with the finished code instead of not at all.
   */
  useEffect(() => {
    if (onCodeChange) {
      onCodeChange(inviteCode);
    }
  }, [inviteCode, onCodeChange]);

  function handleCharacterChange(index, rawValue) {
    const character = rawValue.replace(/[^A-Za-z0-9]/g, '').slice(-1).toUpperCase();
    setCodeCharacters((previous) => {
      const next = [...previous];
      next[index] = character;
      return next;
    });
    if (character && index < INVITE_CODE_LENGTH - 1) {
      inputReferences.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index, keyboardEvent) {
    if (keyboardEvent.key === 'Backspace' && !codeCharacters[index] && index > 0) {
      inputReferences.current[index - 1]?.focus();
    }
  }

  // A pasted code fills all eight boxes at once and focuses past the last
  // pasted character — nobody should retype a code they were sent whole.
  function handlePaste(pasteEvent) {
    const pasted = pasteEvent.clipboardData
      .getData('text')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, INVITE_CODE_LENGTH);
    if (!pasted) {
      return;
    }
    pasteEvent.preventDefault();
    const next = Array(INVITE_CODE_LENGTH).fill('');
    for (let position = 0; position < pasted.length; position += 1) {
      next[position] = pasted[position];
    }
    setCodeCharacters(next);
    inputReferences.current[Math.min(pasted.length, INVITE_CODE_LENGTH - 1)]?.focus();
  }

  function handleSubmit() {
    if (isSubmitBlocked) {
      return;
    }
    onSubmit(inviteCode, showMedicalDeclaration ? hasAcceptedMedicalDeclaration : undefined);
  }

  return (
    <div className="dtc-form">
      <div className="dtc-codes" onPaste={handlePaste}>
        {codeCharacters.map((character, index) => (
          <input
            key={index}
            ref={(element) => {
              inputReferences.current[index] = element;
            }}
            type="text"
            maxLength={1}
            value={character}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-label={`Character ${index + 1}`}
            onChange={(changeEvent) => handleCharacterChange(index, changeEvent.target.value)}
            onKeyDown={(keyboardEvent) => handleKeyDown(index, keyboardEvent)}
            className="dtc-code"
          />
        ))}
      </div>

      {showMedicalDeclaration ? (
        <label className="dtc-check">
          <input
            type="checkbox"
            checked={hasAcceptedMedicalDeclaration}
            onChange={(changeEvent) => setHasAcceptedMedicalDeclaration(changeEvent.target.checked)}
          />
          <span>{REGISTRATION_FORM_COPY.medicalLabel}</span>
        </label>
      ) : null}

      {/* The caller's live verdict. Yields to a submit error, which is the more
          recent and more specific news about the same code. */}
      {feedback && !errorMessage ? feedback : null}

      {errorMessage ? (
        <p className="dtc-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {disabledReason ? <p className="dtc-hint">{disabledReason}</p> : null}

      <button type="button" onClick={handleSubmit} disabled={isSubmitBlocked} className="dtc-submit">
        {isJoining ? JOINING_LABEL : TEAMS_COPY.joinSubmit}
      </button>
    </div>
  );
}

export default TeamCodeEntry;

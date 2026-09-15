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

/* The code generator's alphabet (backend generate-invite-code.js): no 0, O, 1, I or L. */
const CODE_CHARACTER_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]$/;

function describeInvalidCharacter(character) {
  return /[0O1IL]/.test(character)
    ? 'Codes never use 0, O, 1, I or L — check that character.'
    : 'Codes use letters and numbers only.';
}

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
  /* Fires onSubmit the moment the last box is filled, once per distinct code —
     the join-with-code screen has nothing else to ask before looking it up. */
  autoSubmit = false,
  /* Overrides the button label; null keeps the team-join wording. */
  submitLabel = null,
  /* An auto-submitting caller owns its own action further down the screen. */
  hideSubmit = false,
}) {
  const [codeCharacters, setCodeCharacters] = useState(() => Array(INVITE_CODE_LENGTH).fill(''));
  const [hasAcceptedMedicalDeclaration, setHasAcceptedMedicalDeclaration] = useState(false);
  const inputReferences = useRef([]);
  /* { index, message } for the box holding a character codes never use. */
  const [invalidEntry, setInvalidEntry] = useState(null);
  const lastAutoSubmittedReference = useRef('');

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

  /* Auto-submit once per distinct complete code; editing a box re-arms it. */
  useEffect(() => {
    if (!autoSubmit) {
      return;
    }
    if (inviteCode.length < INVITE_CODE_LENGTH) {
      lastAutoSubmittedReference.current = '';
      return;
    }
    if (isSubmitBlocked || inviteCode === lastAutoSubmittedReference.current) {
      return;
    }
    lastAutoSubmittedReference.current = inviteCode;
    onSubmit(inviteCode, showMedicalDeclaration ? hasAcceptedMedicalDeclaration : undefined);
  }, [
    autoSubmit,
    inviteCode,
    isSubmitBlocked,
    onSubmit,
    showMedicalDeclaration,
    hasAcceptedMedicalDeclaration,
  ]);

  function handleCharacterChange(index, rawValue) {
    const typed = rawValue.slice(-1).toUpperCase();
    /*
     * Inline validation, per box. A character the code alphabet never uses —
     * punctuation, or one of the confusable 0 O 1 I L — is refused in place,
     * with the box marked and the reason stated, instead of being dropped
     * silently or discovered only when the lookup fails.
     */
    if (typed && !CODE_CHARACTER_PATTERN.test(typed)) {
      setInvalidEntry({ index, message: describeInvalidCharacter(typed) });
      return;
    }
    setInvalidEntry(null);
    const character = typed;
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
      .toUpperCase()
      .replace(/[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g, '')
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
            className={invalidEntry?.index === index ? 'dtc-code dtc-code--invalid' : 'dtc-code'}
            aria-invalid={invalidEntry?.index === index || undefined}
          />
        ))}
      </div>

      {invalidEntry ? (
        <p className="dtc-error" role="alert">
          {invalidEntry.message}
        </p>
      ) : null}

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

      {hideSubmit ? null : (
        <button type="button" onClick={handleSubmit} disabled={isSubmitBlocked} className="dtc-submit">
          {isJoining ? JOINING_LABEL : (submitLabel ?? TEAMS_COPY.joinSubmit)}
        </button>
      )}
    </div>
  );
}

export default TeamCodeEntry;

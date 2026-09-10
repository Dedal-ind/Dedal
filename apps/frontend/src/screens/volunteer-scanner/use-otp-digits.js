// use-otp-digits.js
// The six-box code-entry behaviour, shared between the scanner's backup-code
// sheet and (in spirit) the auth OTP row.
//
// WHY THIS IS A HOOK AND NOT A COMPONENT IMPORT. screens/auth-sign-in exports
// an <OtpRow>, and reusing it was the first thing tried. It could not be used
// here for two reasons, neither cosmetic: it renders `.dsi-otp__box`, which is
// the light auth surface's 56px box, where this screen's spec is a 48px square
// on --ink; and it carries a shake animation on error, which this screen is
// not allowed to have at all. Restyling it would have meant editing the auth
// screen, which this change does not own.
//
// So the BEHAVIOUR is what is shared, lifted out verbatim from the auth screen
// rather than reinvented: same one-digit-per-box rule, same Android
// autofill-as-one-change handling, same backspace semantics, same paste. The
// markup is the only thing that differs, which is the only thing that should.

import { useCallback, useRef, useState } from 'react';

/**
 * @param {number} length      how many boxes
 * @param {(code: string) => void} onComplete  called once, on the keystroke
 *                             that fills the last box
 */
export function useOtpDigits(length, onComplete) {
  const [digits, setDigits] = useState(() => Array(length).fill(''));
  const inputReferences = useRef([]);
  /*
   * The digits mirrored into a ref. The handlers below have to read the
   * CURRENT digits and then decide whether the code is complete — a decision
   * with a side effect (onComplete), which must not live inside a setState
   * updater, because React may call an updater twice in StrictMode and the
   * scan would be submitted twice.
   */
  const digitsRef = useRef(digits);
  /*
   * The same guard the auth screen uses: auto-submit fires on the value, and a
   * re-render must not send the same six digits twice — at a gate that is a
   * duplicate scan attempt, not just a wasted request.
   */
  const lastSubmittedRef = useRef('');

  const setInputReference = useCallback((index) => (element) => {
    inputReferences.current[index] = element;
  }, []);

  const reset = useCallback(() => {
    const cleared = Array(length).fill('');
    digitsRef.current = cleared;
    setDigits(cleared);
    lastSubmittedRef.current = '';
    inputReferences.current[0]?.focus();
  }, [length]);

  // One place decides "these digits are now complete", so both the typed path
  // and the pasted path submit identically.
  const commit = useCallback(
    (nextDigits) => {
      digitsRef.current = nextDigits;
      setDigits(nextDigits);
      const code = nextDigits.join('');
      if (code.length === length && lastSubmittedRef.current !== code) {
        lastSubmittedRef.current = code;
        onComplete(code);
      }
    },
    [length, onComplete],
  );

  const fillFromCode = useCallback(
    (rawCode) => {
      const cleaned = rawCode.replace(/\D/g, '').slice(0, length);
      if (!cleaned) {
        return;
      }
      const nextDigits = Array(length).fill('');
      for (let position = 0; position < cleaned.length; position += 1) {
        nextDigits[position] = cleaned[position];
      }
      commit(nextDigits);
      inputReferences.current[Math.min(cleaned.length, length - 1)]?.focus();
    },
    [commit, length],
  );

  const handleDigitChange = useCallback(
    (index, rawValue) => {
      // Android delivers an SMS/keyboard autofill as ONE change event carrying
      // the whole code, so anything longer than a digit is a fill rather than
      // a keystroke.
      const cleaned = rawValue.replace(/\D/g, '');
      if (cleaned.length > 1) {
        fillFromCode(cleaned);
        return;
      }
      const digit = cleaned.slice(-1);
      const next = [...digitsRef.current];
      next[index] = digit;
      commit(next);
      if (digit && index < length - 1) {
        inputReferences.current[index + 1]?.focus();
      }
    },
    [commit, fillFromCode, length],
  );

  const handleKeyDown = useCallback((index, keyboardEvent) => {
    if (keyboardEvent.key !== 'Backspace') {
      return;
    }
    keyboardEvent.preventDefault();
    const next = [...digitsRef.current];
    if (next[index]) {
      // This box has a digit — clear it and stay put.
      next[index] = '';
    } else if (index > 0) {
      // Empty box — step back to the previous box and clear that one.
      next[index - 1] = '';
      inputReferences.current[index - 1]?.focus();
    }
    digitsRef.current = next;
    setDigits(next);
    // A correction re-opens submission: the next complete code is a new attempt.
    lastSubmittedRef.current = '';
  }, []);

  const handlePaste = useCallback(
    (pasteEvent) => {
      const pasted = pasteEvent.clipboardData.getData('text');
      if (!/\d/.test(pasted)) {
        return;
      }
      pasteEvent.preventDefault();
      fillFromCode(pasted);
    },
    [fillFromCode],
  );

  return {
    digits,
    setInputReference,
    handleDigitChange,
    handleKeyDown,
    handlePaste,
    reset,
  };
}

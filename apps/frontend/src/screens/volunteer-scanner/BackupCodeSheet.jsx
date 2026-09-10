// BackupCodeSheet.jsx
// The manual fallback: six digits off the participant's pass when the QR will
// not read (cracked screen, dead battery, a printed pass that has been in a
// pocket all day). Split out of VolunteerScannerScreen only for size; it owns
// no scan logic, it just collects six digits and hands them up.
//
// It is a SHEET, not a route and not a mode swap of the whole screen, so the
// scanner never unmounts underneath it.

import { useEffect, useState } from 'react';
import { SCANNER_COPY } from '../../brand/brand-copy.js';
import { useOtpDigits } from './use-otp-digits.js';

const BACKUP_CODE_LENGTH = 6;

function BackupCodeSheet({ onSubmit, onCancel }) {
  const { digits, setInputReference, handleDigitChange, handleKeyDown, handlePaste } =
    useOtpDigits(BACKUP_CODE_LENGTH, onSubmit);

  /*
   * The slide. Mounted at translateY(100%) and moved to 0 on the first frame
   * after mount — this is the ONE transform on this screen, and it exists
   * because a 240px panel that simply appears reads as a rendering fault
   * rather than as something that arrived. It animates `transform` only, so it
   * stays on the compositor and cannot cost the decode loop a layout pass.
   */
  const [hasEntered, setHasEntered] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setHasEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="dvs-scrim" role="dialog" aria-modal="true" aria-label={SCANNER_COPY.backupCode}>
      <div className={`dvs-sheet dvs-sheet--slide${hasEntered ? '' : ' dvs-sheet--enter'}`}>
        <h2 className="dvs-sheet__title">{SCANNER_COPY.backupCode}</h2>
        <p className="dvs-sheet__subtitle">{SCANNER_COPY.backupCodeInstruction}</p>

        {/* No Verify button: the sixth digit IS the submit, matching the auth
            OTP row. At a gate, one fewer tap per manual entry is the point. */}
        <div className="dvs-digits" onPaste={handlePaste}>
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={setInputReference(index)}
              className="dvs-digits__box"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              /* Not maxLength=1: a pasted or autofilled six-digit string has to
                 be allowed INTO the field before the handler can spread it. */
              autoComplete="off"
              value={digit}
              aria-label={`Digit ${index + 1}`}
              onChange={(changeEvent) => handleDigitChange(index, changeEvent.target.value)}
              onKeyDown={(keyboardEvent) => handleKeyDown(index, keyboardEvent)}
            />
          ))}
        </div>

        <div className="dvs-sheet__footer">
          <button type="button" className="dvs-textaction" onClick={onCancel}>
            {SCANNER_COPY.cancelScan}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BackupCodeSheet;
export { BACKUP_CODE_LENGTH };

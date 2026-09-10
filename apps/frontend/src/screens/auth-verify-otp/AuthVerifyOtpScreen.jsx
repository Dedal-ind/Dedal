// AuthVerifyOtpScreen.jsx
// Route: /auth/verify-otp — the STANDALONE verification screen.
//
// WHY THIS FILE STILL EXISTS. Verification is inline on /auth/email now: email →
// OTP with no route change. This route is the older, second implementation of the
// same step, and it is still wired into App.jsx and still reachable — anything
// that navigates here with { state: { emailAddress } }, plus any deep link
// somebody has kept. Deleting it would 404 those; leaving it on the retired
// palette would leave a second, differently-dressed verification screen in a
// product that has exactly one.
//
// So it was neither deleted nor rebuilt. It renders the SAME <OtpRow> component
// and the SAME auth-sign-in.css that the inline step renders, and it keeps its
// own state, its own copy of the handlers and its own deep-link guard. There is
// one row of boxes in this codebase and two routes that mount it; the styling
// cannot drift again because there is only one of it.
//
// Behaviour matches the inline step: verification fires on the sixth digit (no
// button), the resend cooldown is 30s, a rejected code shakes and clears, and a
// pasted six-digit string fills all six boxes.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { resolvePostSignInRoute } from '../../helpers/post-sign-in-redirect.js';
import { AUTH_COPY } from '../../brand/brand-copy.js';
import DedalWordmark from '../../components/dedal-wordmark/DedalWordmark.jsx';
import { OtpRow } from '../auth-sign-in/AuthSignInScreen.jsx';
import '../auth-sign-in/auth-sign-in.css';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

const LOCAL_COPY = {
  heading: 'Check your email',
  subtextPrefix: 'We sent a 6-digit code to',
  resendWait: (seconds) => `Resend in ${seconds}s`,
  resendReady: 'Resend code',
  resendAvailable: 'You can request a new code now.',
  verifying: 'Checking your code…',
};

function AuthVerifyOtpScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn } = useAuthentication();

  const emailAddress = location.state?.emailAddress ?? '';

  const [otpDigits, setOtpDigits] = useState(() => Array(OTP_LENGTH).fill(''));
  const [hasError, setHasError] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [secondsUntilResend, setSecondsUntilResend] = useState(RESEND_COOLDOWN_SECONDS);
  const lastAttemptedCodeRef = useRef('');

  const inputReferences = useRef([]);
  /*
   * One ref callback per box, created once and never re-created. An inline
   * `ref={(element) => …}` is a NEW function on every render, which makes React
   * detach and re-attach the DOM node's ref each time — on Android that tears
   * down and rebuilds the input's IME connection, which is what made the
   * keyboard flip between the numeric and alphabetic layouts mid-entry.
   */
  const setInputReference = useMemo(
    () =>
      Array.from({ length: OTP_LENGTH }, (_, index) => (element) => {
        inputReferences.current[index] = element;
      }),
    [],
  );

  // No email in state means the user deep-linked here — send them back.
  useEffect(() => {
    if (!emailAddress) {
      navigate('/', { replace: true });
    }
  }, [emailAddress, navigate]);

  // Focus the first box on mount.
  useEffect(() => {
    inputReferences.current[0]?.focus();
  }, []);

  /* One interval for the whole countdown, cleared on unmount. Depending on the
     seconds themselves rebuilt the timer once a second and accumulated drift. */
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setSecondsUntilResend((previousSeconds) => (previousSeconds <= 0 ? 0 : previousSeconds - 1));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const otpCode = otpDigits.join('');
  const isOtpComplete = otpCode.length === OTP_LENGTH;
  const canResend = secondsUntilResend <= 0;

  function clearErrorState() {
    if (hasError) {
      setHasError(false);
      setErrorMessage('');
      setIsShaking(false);
    }
  }

  function fillFromCode(rawCode) {
    const digits = rawCode.replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!digits) return;
    const nextDigits = Array(OTP_LENGTH).fill('');
    for (let position = 0; position < digits.length; position += 1) {
      nextDigits[position] = digits[position];
    }
    setOtpDigits(nextDigits);
    clearErrorState();
    inputReferences.current[Math.min(digits.length, OTP_LENGTH - 1)]?.focus();
  }

  function handleDigitChange(index, rawValue) {
    // Android delivers an SMS autofill as one change event carrying the whole
    // code, so anything longer than a digit is a fill rather than a keystroke.
    const cleaned = rawValue.replace(/\D/g, '');
    if (cleaned.length > 1) {
      fillFromCode(cleaned);
      return;
    }
    const digit = cleaned.slice(-1);
    setOtpDigits((previousDigits) => {
      const nextDigits = [...previousDigits];
      nextDigits[index] = digit;
      return nextDigits;
    });
    clearErrorState();
    if (digit && index < OTP_LENGTH - 1) {
      inputReferences.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index, keyboardEvent) {
    if (keyboardEvent.key !== 'Backspace') {
      return;
    }
    keyboardEvent.preventDefault();
    if (otpDigits[index]) {
      // This box has a digit — clear it and stay put.
      setOtpDigits((previousDigits) => {
        const nextDigits = [...previousDigits];
        nextDigits[index] = '';
        return nextDigits;
      });
      clearErrorState();
    } else if (index > 0) {
      // Empty box — step back to the previous box and clear that one.
      setOtpDigits((previousDigits) => {
        const nextDigits = [...previousDigits];
        nextDigits[index - 1] = '';
        return nextDigits;
      });
      inputReferences.current[index - 1]?.focus();
      clearErrorState();
    }
  }

  function handlePaste(pasteEvent) {
    const pasted = pasteEvent.clipboardData.getData('text');
    if (!/\d/.test(pasted)) {
      return;
    }
    pasteEvent.preventDefault();
    fillFromCode(pasted);
  }

  async function verifyCode(code) {
    setIsVerifying(true);
    try {
      // The backend reads the field as `code` and returns `authenticationToken`.
      const verification = await apiClient.post('/authentication/verify-otp', {
        emailAddress,
        code,
      });
      signIn(verification.authenticationToken, verification.user);
      // The route they were headed for (e.g. a saved /admin deep link), else "/",
      // which routes by role once staff assignments resolve.
      navigate(resolvePostSignInRoute(), { replace: true });
    } catch (verificationError) {
      // OTP_INVALID for a wrong or never-requested code, plus the expiry and
      // attempt-limit codes. All are code rejections: shake, say why, wipe the
      // digits and refocus. A transport failure keeps what the person typed.
      const errorCode = verificationError?.code;
      const isCodeRejection =
        errorCode === 'OTP_INVALID' ||
        errorCode === 'OTP_EXPIRED' ||
        errorCode === 'OTP_ATTEMPTS_EXCEEDED' ||
        errorCode === 'OTP_ATTEMPT_LIMIT_EXCEEDED';
      setHasError(true);
      setIsShaking(true);
      setErrorMessage(
        errorCode === 'OTP_INVALID'
          ? AUTH_COPY.invalidCode
          : verificationError?.message || AUTH_COPY.invalidCode,
      );
      if (isCodeRejection) {
        setOtpDigits(Array(OTP_LENGTH).fill(''));
        lastAttemptedCodeRef.current = '';
        inputReferences.current[0]?.focus();
      }
    } finally {
      setIsVerifying(false);
    }
  }

  // The sixth digit is the submit; the ref stops a re-render from sending the
  // same six digits twice and burning an attempt on a code that was correct.
  useEffect(() => {
    if (!isOtpComplete || isVerifying) return;
    if (lastAttemptedCodeRef.current === otpCode) return;
    lastAttemptedCodeRef.current = otpCode;
    verifyCode(otpCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpCode, isOtpComplete, isVerifying]);


  async function handleResend() {
    if (!canResend) {
      return;
    }
    try {
      await apiClient.post('/authentication/request-otp', { emailAddress });
      setSecondsUntilResend(RESEND_COOLDOWN_SECONDS);
      setOtpDigits(Array(OTP_LENGTH).fill(''));
      lastAttemptedCodeRef.current = '';
      clearErrorState();
      inputReferences.current[0]?.focus();
    } catch {
      // Leave the current state; the person can try the resend control again.
    }
  }

  return (
    <div className="dsi-screen">
      <div className="dsi-split">
        {/* The same inert decorative half as /auth/email: desktop only,
            aria-hidden, nothing focusable inside it. */}
        <aside className="dsi-aside" aria-hidden="true">
          <div className="dsi-aside__inner">
            <DedalWordmark size={64} />
            <p className="dsi-aside__tagline">{AUTH_COPY.tagline}</p>
          </div>
        </aside>

        <main className="dsi-main">
          <div className="dsi-card">
            <div className="dsi-brand">
              <DedalWordmark size={40} />
            </div>

            <div className="dsi-step">
              <div>
                <h1 className="dsi-title">{LOCAL_COPY.heading}</h1>
                <p className="dsi-sub">
                  {LOCAL_COPY.subtextPrefix}{' '}
                  <span className="dsi-sub__address">{emailAddress}</span>
                </p>
              </div>

              <OtpRow
                digits={otpDigits}
                hasError={hasError}
                isShaking={isShaking}
                onShakeEnd={() => setIsShaking(false)}
                isBusy={isVerifying}
                setInputReference={setInputReference}
                onDigitChange={handleDigitChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                describedById="verify-otp-status"
              />

              <p
                id="verify-otp-status"
                className={hasError ? 'dsi-otp__status dsi-otp__status--error' : 'dsi-otp__status'}
                aria-live="polite"
              >
                {hasError ? errorMessage : isVerifying ? LOCAL_COPY.verifying : ''}
              </p>

              <div className="dsi-resend">
                {canResend ? (
                  <button type="button" className="dsi-textbtn" onClick={handleResend}>
                    {LOCAL_COPY.resendReady}
                  </button>
                ) : (
                  <p className="dsi-resend__wait" aria-hidden="true">
                    {LOCAL_COPY.resendWait(secondsUntilResend)}
                  </p>
                )}
                <span className="dsi-sr" aria-live="polite">
                  {canResend ? LOCAL_COPY.resendAvailable : ''}
                </span>
                <button
                  type="button"
                  className="dsi-textbtn dsi-textbtn--quiet"
                  onClick={() => navigate('/auth/email')}
                >
                  {AUTH_COPY.useDifferentEmail}
                </button>
              </div>

              <div className="dsi-foot">
                <p className="dsi-foot__line dsi-foot__line--fine">{AUTH_COPY.checkSpamHint}</p>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

export default AuthVerifyOtpScreen;

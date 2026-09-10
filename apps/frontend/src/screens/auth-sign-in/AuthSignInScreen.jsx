// AuthSignInScreen.jsx
// Route: /auth/email — the way in, on the dedal design system.
//
// The state machine is unchanged from the screen this replaces: 'email' → 'otp',
// both steps on ONE route, no navigation between them. That was already the
// architecture and it is the right one — a route change between "type your
// address" and "type the code we just sent it" loses the address on back, and on
// iOS it loses the SMS/mail autofill suggestion with it. What changed here is
// everything visual, plus three behaviours:
//
//   1. Verification fires on the sixth digit. There is no Verify button, because
//      there is nothing to decide once six digits are in the boxes — the button
//      was a second tap that could only ever be "yes".
//   2. The resend cooldown is 30s, counted down in seconds ("Resend in 28s")
//      rather than as mm:ss. A code that has not arrived in half a minute is not
//      going to; a 60s wait just teaches people to close the tab.
//   3. A rejected code shakes the row and clears it, rather than leaving six
//      wrong digits in place for the person to delete by hand.
//
// Backend integration points are untouched: POST /authentication/request-otp,
// POST /authentication/verify-otp, POST /authentication/google,
// GET /authentication/google/config, GET /public/metrics.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import apiClient, { clearStoredAuthToken } from '../../api-client/api-client.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { resolvePostSignInRoute, peekIntendedRoute } from '../../helpers/post-sign-in-redirect.js';
import { formatGoogleSignInErrorMessage } from '../../helpers/google-sign-in-error-messages.js';
import { AUTH_COPY } from '../../brand/brand-copy.js';
import DedalWordmark from '../../components/dedal-wordmark/DedalWordmark.jsx';
import { AlertIcon } from '../../components/detail-icons/DetailIcons.jsx';
import './auth-sign-in.css';

import { EMAIL_ADDRESS_PATTERN } from '@dedal/shared';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;
const GOOGLE_SDK_TIMEOUT_MILLISECONDS = 10000;
const GOOGLE_SDK_POLL_INTERVAL_MILLISECONDS = 250;

let gsiInitialized = false;

/*
 * Copy that is set in sentence case here rather than read from AUTH_COPY.
 *
 * The corresponding AUTH_COPY entries are ALL CAPS ("EMAIL ADDRESS", "ADMIN?
 * SIGN IN HERE — YOU'LL LAND IN THE CONSOLE"), which belongs to the retired
 * Heritage register and which brand-copy.js is not mine to edit in this pass.
 * Everything else on the screen still comes from AUTH_COPY, so there is exactly
 * one small list to fold back into it when that file is next opened.
 */
const LOCAL_COPY = {
  emailFieldLabel: 'Email address',
  /* "Continue", not AUTH_COPY.sendOtpButton ("Login with OTP"). The button
     starts a flow whose next step is a code, and naming the mechanism rather
     than the outcome makes the user think about OTPs instead of signing in.
     The shared string stays as it is — other screens still use it. */
  continueLabel: 'Continue',
  or: 'or',
  adminBoundHint: 'Signing in here also gets you into the admin console.',
  paymentBoundHint: 'Your session expired. Sign in to pick up your payment where you left off.',
  otpHeading: 'Check your email',
  otpSubtextPrefix: 'We sent a 6-digit code to',
  resendWait: (seconds) => `Resend in ${seconds}s`,
  resendReady: 'Resend code',
  resendAvailable: 'You can request a new code now.',
  verifying: 'Checking your code…',
  metricFests: 'fests',
  metricEvents: 'events',
  metricColleges: 'colleges',
  metricScans: 'passes scanned',
};

function AuthSignInScreen() {
  const navigate = useNavigate();
  const { signIn } = useAuthentication();
  const isAdminBound = (peekIntendedRoute() || '').startsWith('/admin');
  const isPaymentBound = ['/checkout/', '/payment-processing/', '/payment-failed/'].some(
    (prefix) => (peekIntendedRoute() || '').startsWith(prefix),
  );

  // ── State machine: 'email' | 'otp' ──
  const [authStep, setAuthStep] = useState('email');
  const [emailAddress, setEmailAddress] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // OTP state (inline, not a separate route)
  const [otpDigits, setOtpDigits] = useState(() => Array(OTP_LENGTH).fill(''));
  const [otpError, setOtpError] = useState('');
  const [hasOtpError, setHasOtpError] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [secondsUntilResend, setSecondsUntilResend] = useState(RESEND_COOLDOWN_SECONDS);
  /*
   * The shake is its own flag rather than being derived from `hasOtpError`,
   * because a CSS animation only replays when the class is added, not while it
   * stays on. Two wrong codes in a row would have shaken once. This is set on
   * each rejection and cleared by the row's own animationend — and under
   * `prefers-reduced-motion: reduce` no animation runs, so nothing clears it and
   * the static --primary wash the stylesheet substitutes stays up until the
   * person starts typing again. That is the intended degradation: the error must
   * remain perceivable when the motion is removed.
   */
  const [isShaking, setIsShaking] = useState(false);
  /*
   * The code most recently sent to the server. There is no Verify button any
   * more, so the sixth digit is the submit — and without this guard a re-render
   * during the request (the countdown ticks once a second) would fire a second
   * verification for the same six digits, burning one of the backend's limited
   * attempts and returning OTP_ATTEMPTS_EXCEEDED on a code that was correct.
   */
  const lastAttemptedCodeRef = useRef('');

  const inputReferences = useRef([]);
  /*
   * One ref callback per box, created once. An inline `ref={(el) => …}` is a new
   * function every render, so React detaches and re-attaches the DOM ref each
   * time — on Android that rebuilds the input's IME connection mid-entry and the
   * keyboard flips between numeric and alphabetic layouts.
   */
  const setInputReference = useMemo(
    () =>
      Array.from({ length: OTP_LENGTH }, (_, index) => (element) => {
        inputReferences.current[index] = element;
      }),
    [],
  );

  // Google state
  const [googleClientId, setGoogleClientId] = useState(null);
  const [isGoogleReady, setIsGoogleReady] = useState(false);
  const [googleLoadFailed, setGoogleLoadFailed] = useState(false);
  const [googleStatus, setGoogleStatus] = useState('idle');
  const [googleError, setGoogleError] = useState('');
  const credentialHandlerRef = useRef(null);
  const googleButtonContainerRef = useRef(null);

  // ── Google credential handler ──
  async function handleGoogleCredentialResponse(response) {
    const credential = response?.credential;
    if (!credential) {
      setGoogleStatus('idle');
      setGoogleError(AUTH_COPY.googleFailed);
      return;
    }
    setGoogleError('');
    setGoogleStatus('signing');
    try {
      let result;
      try {
        result = await apiClient.post('/authentication/google', { googleIdToken: credential });
      } catch (firstAttemptError) {
        if (firstAttemptError.code !== 'USER_ALREADY_SIGNED_IN') throw firstAttemptError;
        clearStoredAuthToken();
        result = await apiClient.post('/authentication/google', { googleIdToken: credential });
      }
      signIn(result.authenticationToken, result.user);
      setGoogleStatus('success');
      navigate(resolvePostSignInRoute(), { replace: true });
    } catch (googleSignInError) {
      setGoogleStatus('idle');
      setGoogleError(formatGoogleSignInErrorMessage(googleSignInError));
    }
  }
  useEffect(() => { credentialHandlerRef.current = handleGoogleCredentialResponse; });

  // ── Fetch Google client id ──
  useEffect(() => {
    let isActive = true;
    apiClient.get('/authentication/google/config')
      .then((config) => {
        if (isActive && config?.clientId) setGoogleClientId(config.clientId);
        else if (isActive) setGoogleLoadFailed(true);
      })
      .catch(() => { if (isActive) setGoogleLoadFailed(true); });
    return () => { isActive = false; };
  }, []);

  // ── Live platform metrics (public, no auth needed) ──
  const [metrics, setMetrics] = useState(null);
  useEffect(() => {
    let isActive = true;
    apiClient.get('/public/metrics')
      .then((data) => { if (isActive) setMetrics(data); })
      .catch(() => { /* metrics are cosmetic — a failure must never block the login */ });
    return () => { isActive = false; };
  }, []);

  /*
   * ── Initialise GSI ──
   *
   * THE BUTTON INSIDE THIS CONTAINER IS GOOGLE'S, NOT OURS. renderButton injects
   * Google's own markup (an iframe-backed element) carrying the official mark,
   * the white fill and the "Sign in with Google" wording — all of which Google's
   * branding terms require to be left alone. So the redesign styles the CONTAINER
   * (`.dsi-google` sizes and centres the slot, and reserves 44px so the layout
   * does not jump when the SDK lands) and sets nothing inside it. shape:'pill'
   * became shape:'rectangular' for the one reason we are allowed to change: the
   * corner radius is a layout choice Google exposes, and 'rectangular' is the
   * closest thing the SDK offers to --r-card, so it sits level with the email
   * field above it instead of reading as a control from another screen.
   */
  useEffect(() => {
    if (!googleClientId) return undefined;
    let isSettled = false, intervalId = null, timeoutId = null;
    function setUpGoogleButton() {
      if (isSettled) return;
      isSettled = true;
      clearInterval(intervalId);
      clearTimeout(timeoutId);
      if (!gsiInitialized) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (r) => credentialHandlerRef.current(r),
          use_fedcm_for_prompt: true,
        });
        gsiInitialized = true;
      }
      const container = googleButtonContainerRef.current;
      if (container) {
        container.innerHTML = '';
        const frameWidth = container.parentElement?.clientWidth ?? 320;
        window.google.accounts.id.renderButton(container, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          width: Math.max(200, Math.min(frameWidth, 400)),
        });
      }
      setIsGoogleReady(true);
    }
    function declareGoogleUnavailable() {
      if (isSettled) return;
      isSettled = true;
      clearInterval(intervalId);
      clearTimeout(timeoutId);
      setGoogleLoadFailed(true);
    }
    if (window.google?.accounts?.id) { setUpGoogleButton(); return undefined; }
    const gsiScript = document.querySelector('script[src^="https://accounts.google.com/gsi/client"]');
    function handleScriptLoad() { if (window.google?.accounts?.id) setUpGoogleButton(); }
    gsiScript?.addEventListener('load', handleScriptLoad);
    gsiScript?.addEventListener('error', declareGoogleUnavailable);
    intervalId = setInterval(() => {
      if (window.google?.accounts?.id) setUpGoogleButton();
    }, GOOGLE_SDK_POLL_INTERVAL_MILLISECONDS);
    timeoutId = setTimeout(declareGoogleUnavailable, GOOGLE_SDK_TIMEOUT_MILLISECONDS);
    return () => {
      isSettled = true;
      clearInterval(intervalId);
      clearTimeout(timeoutId);
      gsiScript?.removeEventListener('load', handleScriptLoad);
      gsiScript?.removeEventListener('error', declareGoogleUnavailable);
    };
  }, [googleClientId]);

  /*
   * ── Resend cooldown ──
   *
   * One interval for the whole countdown rather than one per tick: the previous
   * version depended on `secondsUntilResend`, so every tick tore the interval
   * down and set a new one, and the drift accumulated. The cleanup runs on
   * unmount and on leaving the OTP step, which is what stops a timer writing
   * state into an unmounted screen.
   */
  useEffect(() => {
    if (authStep !== 'otp') return undefined;
    const intervalId = window.setInterval(() => {
      setSecondsUntilResend((previous) => (previous <= 0 ? 0 : previous - 1));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [authStep]);

  // ── Email submit → request OTP ──
  // One source of truth for "is this address worth sending": the button's
  // enabled state and the submit guard read the same expression, so they can
  // never disagree about whether a tap should have been possible.
  const isEmailUsable = EMAIL_ADDRESS_PATTERN.test(emailAddress.trim());

  async function handleEmailSubmit(submitEvent) {
    submitEvent.preventDefault();
    if (!isEmailUsable) {
      setErrorMessage(AUTH_COPY.invalidEmail);
      return;
    }
    const trimmed = emailAddress.trim();
    if (!EMAIL_ADDRESS_PATTERN.test(trimmed)) { setErrorMessage(AUTH_COPY.invalidEmail); return; }
    setErrorMessage('');
    setIsSubmitting(true);
    try {
      await apiClient.post('/authentication/request-otp', { emailAddress: trimmed });
      setAuthStep('otp');
      setSecondsUntilResend(RESEND_COOLDOWN_SECONDS);
      setOtpDigits(Array(OTP_LENGTH).fill(''));
      setHasOtpError(false);
      setOtpError('');
      lastAttemptedCodeRef.current = '';
      // After the step swaps, not during: the boxes do not exist yet on this tick.
      window.setTimeout(() => inputReferences.current[0]?.focus(), 60);
    } catch (requestError) {
      setErrorMessage(requestError.message || AUTH_COPY.requestOtpFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── OTP input handlers ──
  function clearOtpError() {
    if (hasOtpError) { setHasOtpError(false); setOtpError(''); setIsShaking(false); }
  }

  function handleDigitChange(index, rawValue) {
    /*
     * Android's Gboard delivers an SMS autofill as a single change event on the
     * focused box carrying the whole code, not as six keystrokes — so a change
     * longer than one character is treated as a fill, not as a digit. Without
     * this branch autofill lands one digit (the last) in one box.
     */
    const cleaned = rawValue.replace(/\D/g, '');
    if (cleaned.length > 1) {
      fillFromCode(cleaned);
      return;
    }
    const digit = cleaned.slice(-1);
    setOtpDigits((previous) => {
      const next = [...previous];
      next[index] = digit;
      return next;
    });
    clearOtpError();
    if (digit && index < OTP_LENGTH - 1) inputReferences.current[index + 1]?.focus();
  }

  function handleKeyDown(index, keyboardEvent) {
    if (keyboardEvent.key !== 'Backspace') return;
    keyboardEvent.preventDefault();
    if (otpDigits[index]) {
      setOtpDigits((previous) => { const next = [...previous]; next[index] = ''; return next; });
      clearOtpError();
    } else if (index > 0) {
      setOtpDigits((previous) => { const next = [...previous]; next[index - 1] = ''; return next; });
      inputReferences.current[index - 1]?.focus();
      clearOtpError();
    }
  }

  /*
   * Spread a whole code across the boxes. Shared by paste and by the Android
   * autofill path above, so the two cannot behave differently. Anything
   * non-numeric is stripped first: people paste "Your code is 481920" out of the
   * mail body far more often than they paste six bare digits, and refusing that
   * is the difference between the feature working and the feature existing.
   */
  function fillFromCode(rawCode) {
    const digits = rawCode.replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!digits) return;
    const next = Array(OTP_LENGTH).fill('');
    for (let position = 0; position < digits.length; position += 1) next[position] = digits[position];
    setOtpDigits(next);
    clearOtpError();
    inputReferences.current[Math.min(digits.length, OTP_LENGTH - 1)]?.focus();
  }

  // Bound on the ROW, so a paste into any of the six boxes fills all six — the
  // first box is where people aim, but it is not where they always land.
  function handlePaste(pasteEvent) {
    const pasted = pasteEvent.clipboardData.getData('text');
    if (!/\d/.test(pasted)) return;
    pasteEvent.preventDefault();
    fillFromCode(pasted);
  }

  const otpCode = otpDigits.join('');
  const isOtpComplete = otpCode.length === OTP_LENGTH;
  const canResend = secondsUntilResend <= 0;

  async function verifyCode(code) {
    setIsVerifying(true);
    try {
      const verification = await apiClient.post('/authentication/verify-otp', {
        emailAddress: emailAddress.trim(),
        code,
      });
      signIn(verification.authenticationToken, verification.user);
      navigate(resolvePostSignInRoute(), { replace: true });
    } catch (verificationError) {
      const errorCode = verificationError?.code;
      const isCodeRejection = [
        'OTP_INVALID',
        'OTP_EXPIRED',
        'OTP_ATTEMPTS_EXCEEDED',
        'OTP_ATTEMPT_LIMIT_EXCEEDED',
      ].includes(errorCode);
      setHasOtpError(true);
      setIsShaking(true);
      setOtpError(
        errorCode === 'OTP_INVALID'
          ? AUTH_COPY.invalidCode
          : verificationError?.message || AUTH_COPY.invalidCode,
      );
      if (isCodeRejection) {
        // Shake, then empty the row. A rejected code that stays in the boxes has
        // to be deleted six times before the next one can be typed.
        setOtpDigits(Array(OTP_LENGTH).fill(''));
        lastAttemptedCodeRef.current = '';
        inputReferences.current[0]?.focus();
      }
      // A transport failure keeps the digits, so a retry is one tap and not six.
    } finally {
      setIsVerifying(false);
    }
  }

  useEffect(() => {
    if (authStep !== 'otp') return;
    if (!isOtpComplete || isVerifying) return;
    if (lastAttemptedCodeRef.current === otpCode) return;
    lastAttemptedCodeRef.current = otpCode;
    verifyCode(otpCode);
    // verifyCode is re-created every render; depending on it would re-run this
    // on every tick of the countdown. The code itself is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStep, otpCode, isOtpComplete, isVerifying]);


  // ── Resend ──
  async function handleResend() {
    if (!canResend) return;
    try {
      await apiClient.post('/authentication/request-otp', { emailAddress: emailAddress.trim() });
      setSecondsUntilResend(RESEND_COOLDOWN_SECONDS);
      setOtpDigits(Array(OTP_LENGTH).fill(''));
      lastAttemptedCodeRef.current = '';
      clearOtpError();
      inputReferences.current[0]?.focus();
    } catch { /* leave current state; the resend control stays active */ }
  }

  // ── Back to email ──
  function switchToEmail() {
    setAuthStep('email');
    setOtpDigits(Array(OTP_LENGTH).fill(''));
    lastAttemptedCodeRef.current = '';
    clearOtpError();
  }

  const isSigningInWithGoogle = googleStatus === 'signing';
  const hasMetrics = metrics != null;

  return (
    <div className="dsi-screen">
      <div className="dsi-split">
        {/*
          THE DECORATIVE HALF. Desktop only, aria-hidden, and containing nothing
          focusable — so a keyboard user's first Tab from the address bar lands in
          the email field rather than walking three ornaments first. The wordmark
          is repeated for sighted desktop users only; the accessible name of this
          page comes from the <h1> in the form column.
        */}
        <aside className="dsi-aside" aria-hidden="true">
          <div className="dsi-aside__inner">
            <DedalWordmark size={64} />
            <p className="dsi-aside__tagline">{AUTH_COPY.tagline}</p>
            <p className="dsi-aside__note">{AUTH_COPY.signInSubtext}</p>
          </div>
        </aside>

        <main className="dsi-main">
          <div className="dsi-card">
            <div className="dsi-brand">
              <DedalWordmark size={40} />
            </div>

            {isAdminBound ? <p className="dsi-notice">{LOCAL_COPY.adminBoundHint}</p> : null}
            {isPaymentBound ? <p className="dsi-notice">{LOCAL_COPY.paymentBoundHint}</p> : null}

            {/* ── EMAIL STEP ── */}
            {authStep === 'email' ? (
              /* key: the step change is what restarts the enter animation. */
              <div className="dsi-step" key="email">
                <div>
                  <h1 className="dsi-title">{AUTH_COPY.signInHeading}</h1>
                  <p className="dsi-sub">{AUTH_COPY.signInSubtext}</p>
                </div>

                <form className="dsi-form" onSubmit={handleEmailSubmit} noValidate>
                  <div className="dsi-field">
                    <label className="dsi-label" htmlFor="sign-in-email">
                      {LOCAL_COPY.emailFieldLabel}
                    </label>
                    <input
                      id="sign-in-email"
                      className="dsi-input"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck="false"
                      value={emailAddress}
                      onChange={(changeEvent) => setEmailAddress(changeEvent.target.value)}
                      onInput={() => errorMessage && setErrorMessage('')}
                      placeholder={AUTH_COPY.emailFieldPlaceholder}
                      aria-invalid={errorMessage ? 'true' : undefined}
                      aria-describedby={errorMessage ? 'sign-in-email-error' : undefined}
                    />
                    {errorMessage ? (
                      <p className="dsi-error" id="sign-in-email-error" role="alert">
                        <AlertIcon size="sm" className="dsi-error__icon" />
                        {errorMessage}
                      </p>
                    ) : null}
                  </div>

                  {/*
                    Disabled until the address could actually be one. The field's
                    own inline error is the explanation, so the button carries no
                    reason text — but leaving it live invites a tap that can only
                    produce a validation message the person has already been
                    shown. aria-disabled rather than disabled while merely
                    incomplete, so a keyboard user can still reach it and hear
                    why; genuinely disabled only while the request is in flight.
                  */}
                  <button
                    type="submit"
                    className={
                      isEmailUsable ? 'dsi-cta' : 'dsi-cta dsi-cta--inert'
                    }
                    disabled={isSubmitting}
                    aria-disabled={!isEmailUsable}
                  >
                    {isSubmitting ? <span className="dsi-spin" aria-hidden="true" /> : null}
                    {LOCAL_COPY.continueLabel}
                  </button>
                </form>

                <div className="dsi-or">{LOCAL_COPY.or}</div>

                <div className="dsi-field">
                  {googleLoadFailed ? (
                    <p className="dsi-google__note">{AUTH_COPY.googleUnavailable}</p>
                  ) : (
                    <div className="dsi-google">
                      {/* Google renders into this node. Nothing styles its child. */}
                      <div ref={googleButtonContainerRef} />
                      {!isGoogleReady ? (
                        <p className="dsi-google__pending">{AUTH_COPY.googleLoading}</p>
                      ) : null}
                    </div>
                  )}
                  {googleError ? (
                    <p className="dsi-google__note dsi-google__note--error" role="alert">
                      {googleError}
                    </p>
                  ) : null}
                </div>

                <div className="dsi-foot">
                  <p className="dsi-foot__line">
                    {AUTH_COPY.newToDedalPrefix}{' '}
                    <Link className="dsi-link" to="/register-college">
                      {AUTH_COPY.registerCollegeLink}
                    </Link>
                  </p>
                  <p className="dsi-foot__line dsi-foot__line--fine">
                    {AUTH_COPY.termsPrefix}{' '}
                    <Link className="dsi-link" to="/terms-of-service">{AUTH_COPY.termsOfService}</Link>{' '}
                    {AUTH_COPY.and}{' '}
                    <Link className="dsi-link" to="/privacy-policy">{AUTH_COPY.privacyPolicy}</Link>
                  </p>
                </div>
              </div>
            ) : null}

            {/* ── OTP STEP (same route, same card) ── */}
            {authStep === 'otp' ? (
              <div className="dsi-step" key="otp">
                <div>
                  <h1 className="dsi-title">{LOCAL_COPY.otpHeading}</h1>
                  <p className="dsi-sub">
                    {LOCAL_COPY.otpSubtextPrefix}{' '}
                    <span className="dsi-sub__address">{emailAddress.trim()}</span>
                  </p>
                </div>

                <OtpRow
                  digits={otpDigits}
                  hasError={hasOtpError}
                  isShaking={isShaking}
                  onShakeEnd={() => setIsShaking(false)}
                  isBusy={isVerifying}
                  setInputReference={setInputReference}
                  onDigitChange={handleDigitChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  describedById="sign-in-otp-status"
                />

                {/*
                  One polite region for the whole line. The rejection message and
                  the "verifying" note occupy the same row, and two live regions
                  stacked here announce over each other.
                */}
                <p
                  id="sign-in-otp-status"
                  className={hasOtpError ? 'dsi-otp__status dsi-otp__status--error' : 'dsi-otp__status'}
                  aria-live="polite"
                >
                  {hasOtpError ? otpError : isVerifying ? LOCAL_COPY.verifying : ''}
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
                  <button type="button" className="dsi-textbtn dsi-textbtn--quiet" onClick={switchToEmail}>
                    {AUTH_COPY.useDifferentEmail}
                  </button>
                </div>

                <div className="dsi-foot">
                  <p className="dsi-foot__line dsi-foot__line--fine">{AUTH_COPY.checkSpamHint}</p>
                </div>
              </div>
            ) : null}
          </div>
        </main>
      </div>

      {/*
        The metrics line. Real, public, and unauthenticated — but demoted to one
        row of figures, and dropped entirely when the fetch fails: a row of
        em-dashes says less than nothing on the screen where somebody is deciding
        whether this platform is real.
      */}
      {hasMetrics ? (
        <section className="dsi-metrics">
          {[
            [metrics.totalFests, LOCAL_COPY.metricFests],
            [metrics.totalEvents, LOCAL_COPY.metricEvents],
            [metrics.totalColleges, LOCAL_COPY.metricColleges],
            [metrics.totalScans, LOCAL_COPY.metricScans],
          ]
            .filter(([value]) => value != null)
            .map(([value, label]) => (
              <p className="dsi-metric" key={label}>
                <span className="dsi-metric__value">{Number(value).toLocaleString()}</span>
                {label}
              </p>
            ))}
        </section>
      ) : null}

      <nav className="dsi-legal" aria-label="Legal">
        <Link to="/privacy-policy">{AUTH_COPY.privacyPolicy}</Link>
        <Link to="/terms-of-service">{AUTH_COPY.termsOfService}</Link>
        <a href="/legal/refunds">Cancellation and refunds</a>
        <a href="/legal/customer-satisfaction">Customer satisfaction</a>
      </nav>

      {isSigningInWithGoogle ? (
        <div className="dsi-scrim" role="status" aria-live="polite">
          <span className="dsi-spin" aria-hidden="true" />
          <p>{AUTH_COPY.googleSigningIn}</p>
        </div>
      ) : null}
    </div>
  );
}

/*
 * THE SIX BOXES, exported so /auth/verify-otp renders the same component rather
 * than a second copy of it. That route is a duplicate implementation of this step
 * that predates the inline one and is still reachable by deep link; sharing the
 * row is what stops the two drifting apart again.
 *
 * inputMode="numeric" raises the keypad; autoComplete="one-time-code" on the
 * FIRST box only is what enables iOS's SMS/mail autofill — repeated on all six it
 * makes the suggestion bar flicker from box to box. type="text" rather than
 * "number", which brings spinners and accepts "e" and "-".
 */
export function OtpRow({
  digits,
  hasError,
  isShaking,
  onShakeEnd,
  isBusy,
  setInputReference,
  onDigitChange,
  onKeyDown,
  onPaste,
  describedById,
}) {
  const rowClassName = [
    'dsi-otp',
    hasError ? 'dsi-otp--error' : '',
    isShaking ? 'dsi-otp--shake' : '',
    isBusy ? 'dsi-otp--busy' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rowClassName} onPaste={onPaste} onAnimationEnd={onShakeEnd}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={setInputReference[index]}
          className="dsi-otp__box"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          /* Not maxLength=1: a pasted or autofilled six-digit string has to be
             allowed INTO the field before handleDigitChange can spread it. */
          value={digit}
          aria-label={AUTH_COPY.otpDigitLabel(index + 1)}
          aria-invalid={hasError ? 'true' : undefined}
          aria-describedby={describedById}
          readOnly={isBusy}
          onChange={(changeEvent) => onDigitChange(index, changeEvent.target.value)}
          onKeyDown={(keyboardEvent) => onKeyDown(index, keyboardEvent)}
        />
      ))}
      {isBusy ? <span className="dsi-otp__track" aria-hidden="true" /> : null}
    </div>
  );
}

export default AuthSignInScreen;

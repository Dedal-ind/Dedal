// QrPassScreen.jsx
// Route: /my-passes/:festId — the pass, at the gate, in a queue.
//
// EVERY DECISION ON THIS SCREEN IS MADE FOR ONE MOMENT: a phone held out at
// arm's length under a marquee, a volunteer with a cheap scanner, and eleven
// people behind. That is why the screen is dark and stays dark (qr-pass.css
// explains the hardcoded palette at length), why the QR never shrinks below
// 200px, why the display is kept awake, and why there is no motion anywhere on
// it except a skeleton pulse. An animation is a frame in which the pass is not
// yet readable.
//
// WHAT IS FETCHED, AND WHAT HAPPENS WHEN IT FAILS:
//
//   /passes/mine?festId=   the pass. The only request whose failure is visible;
//                          without it there is no screen.
//   /passes/mine/all       the other passes, for the switcher. Fails silently:
//                          one pass still works, you just cannot swipe.
//   /passes/mine/:id/gate-status   whether they are on campus today. Silent.
//   /registrations/mine    their events at this fest. Silent. NOTE: the events
//                          list itself is built from the pass's own eventEntry
//                          entitlements; this request exists solely to supply
//                          the TEAM NAME, which the entitlement's populated
//                          event does not carry. It is the one fetch, reused —
//                          not a second request added for the list.
//
// Three of the four are fire-and-forget on purpose. The QR is the reason this
// screen exists and no secondary outage may stop it rendering.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import apiClient from '../../api-client/api-client.js';
import {
  BackIcon,
  BrightnessIcon,
  CheckCircleIcon,
  DateIcon,
  DismissIcon,
  GateIcon,
  MailIcon,
  MobileIcon,
  RetryIcon,
  ShareIcon,
  VenueIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { sortedByTier } from '../../helpers/sponsor-hierarchy.js';
import { maskEmailAddress } from '../../helpers/mask-email-address.js';
import PassCard, { PassEventList } from './PassCard.jsx';
import { buildPassEventRows, formatPassDateRange } from './pass-format.js';
import './qr-pass.css';

const COPY = {
  title: 'My pass',
  back: 'Go back',
  loadFailedTitle: 'We could not load your pass',
  loadFailedText:
    'Your pass is still valid. This is a connection problem, not a problem with the pass.',
  retry: 'Try again',
  offlineText:
    'You are offline. Your pass needs one connection to load; once it is on screen it stays.',
  brightness: 'Turn your screen brightness up. A dim screen is the most common reason a pass will not scan.',
  brightnessDismiss: 'Dismiss the brightness tip',
  otherPasses: 'Switch pass',
  sharePass: 'Share pass',
  emailPass: 'Email this pass to me',
  emailSending: 'Sending',
  emailSent: 'Sent. Check your inbox.',
  emailFailed: 'That did not send. Try again in a moment.',
  emailedTo: (address) => `Emailed to ${address}`,
  notEmailed: 'This pass has not been emailed yet.',
  campusHeading: 'Campus access',
  checkedIn: (time) => `Checked in today at ${time}`,
  notCheckedIn: 'Not checked in today',
  notCheckedInHint: 'Show this pass at the campus gate before you head to an event.',
  earlierDays: 'Earlier days',
  aboutHeading: 'About this fest',
  sponsorsHeading: 'Presented by',
  handoffHeading: 'Open on your phone',
  handoffText: 'Scan this with your phone camera to open the pass there. It is a link, not your entry code.',
  handoffAlt: 'Link to open this pass on a phone',
};

const BRIGHTNESS_DISMISSED_KEY = 'dedal.pass.brightnessDismissed';

const IST_CLOCK = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const IST_WEEKDAY = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

function clockTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? IST_CLOCK.format(date) : '';
}

// The gate-status key is already the fest's calendar day ('YYYY-MM-DD'). Parsed
// as UTC midnight so the label cannot slip a day on a western clock.
function dayLabel(dayKey) {
  const date = new Date(`${dayKey}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? dayKey : IST_WEEKDAY.format(date);
}

/*
 * THE WAKE LOCK, done properly.
 *
 * The previous implementation requested a sentinel on mount and released it on
 * unmount, and that is only half the API. A wake lock is released BY THE
 * BROWSER whenever the document stops being visible — the user locks the phone,
 * takes a call, switches to WhatsApp to tell someone they are at the gate — and
 * it is NOT reacquired when they come back. The sentinel is gone for good, the
 * screen dims thirty seconds later, and it dims at precisely the moment the
 * pass is being held up to a scanner.
 *
 * So this is the MDN pattern: request on mount, and re-request on every
 * `visibilitychange` that lands on `visible`. Kept as a hook because the
 * listener, the sentinel and the release are one unit and splitting them is how
 * the bug got in.
 *
 * Everything is best-effort. Wake Lock is unsupported on iOS Safari before
 * 16.4 and behind a flag in some browsers; a rejected request must be silent,
 * because there is nothing the user could do about it and the brightness
 * prompt already covers the case.
 */
function useScreenWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) {
      return undefined;
    }
    let sentinel = null;
    let cancelled = false;

    async function request() {
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) {
          next.release().catch(() => {});
          return;
        }
        sentinel = next;
      } catch {
        // Unsupported, denied, or the document was not visible. Nothing to say.
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && sentinel === null) {
        request();
      }
    }

    request();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      sentinel?.release?.().catch(() => {});
      sentinel = null;
    };
  }, []);
}

/*
 * THE SWIPE.
 *
 * Pointer events, no library. The only subtle part is INTENT: a card that
 * captures every pointermove eats vertical scrolling, and this page scrolls.
 * So the first move decides — if the gesture is more vertical than horizontal
 * it is abandoned for good and the browser keeps the touch. `touch-action:
 * pan-y` on the card (see the CSS) hands us the horizontal axis and lets the
 * browser keep the vertical one natively, which is what makes the scroll stay
 * smooth rather than being re-implemented here.
 *
 * The threshold is 56px, roughly a thumb's travel, and deliberately larger than
 * a tap's slop. There is no follow-the-finger transform: the no-motion rule
 * applies, and dragging a QR around under a scanner is not a feature.
 */
const SWIPE_DISTANCE = 56;
const SWIPE_INTENT_RATIO = 1.2;

function useHorizontalSwipe(onSwipe) {
  const gesture = useRef(null);

  const onPointerDown = useCallback((event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    gesture.current = { x: event.clientX, y: event.clientY, decided: null };
  }, []);

  const onPointerMove = useCallback((event) => {
    const current = gesture.current;
    if (!current || current.decided === 'vertical') {
      return;
    }
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (current.decided === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      current.decided =
        Math.abs(dx) > Math.abs(dy) * SWIPE_INTENT_RATIO ? 'horizontal' : 'vertical';
    }
  }, []);

  const onPointerUp = useCallback(
    (event) => {
      const current = gesture.current;
      gesture.current = null;
      if (!current || current.decided !== 'horizontal') {
        return;
      }
      const dx = event.clientX - current.x;
      if (Math.abs(dx) < SWIPE_DISTANCE) {
        return;
      }
      onSwipe(dx < 0 ? 1 : -1);
    },
    [onSwipe],
  );

  const onPointerCancel = useCallback(() => {
    gesture.current = null;
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}

/*
 * WHERE THE EVENTS LIST GOES, and why this is the one thing on the screen that
 * asks JavaScript about the viewport.
 *
 * Everything else here is placed by CSS — `.dqp-aside` is simply `display:
 * none` below 768px — because a JS width check costs a layout flash on first
 * paint. The events list cannot be done that way: on a phone it must be a CHILD
 * of the card, so it scrolls beneath the perforation while the QR stays pinned,
 * and on desktop it must be a child of the right-hand panel. No stylesheet can
 * move a node between two parents, and rendering it twice and hiding one copy
 * would put duplicate headings, duplicate ids and a duplicate list in the
 * accessibility tree — on the screen where that matters most.
 *
 * So it is rendered ONCE, into one of two slots. useSyncExternalStore rather
 * than useState + an effect: the first snapshot is read synchronously during
 * the first render, so there is no frame in which the list is in the wrong
 * place, and there is no state-in-effect for the linter to object to.
 *
 * 768px is the same breakpoint the stylesheet uses for the split; if one moves
 * the other must move with it.
 */
const DESKTOP_QUERY = '(min-width: 768px)';

function subscribeToDesktopQuery(onChange) {
  const list = window.matchMedia(DESKTOP_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function readDesktopQuery() {
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function CampusAccess({ gateStatus }) {
  if (!gateStatus?.today) {
    return null;
  }
  const { today, history } = gateStatus;
  const earlier = (history ?? []).filter((entry) => entry.date !== today.date);

  return (
    <section className="dqp-section" aria-labelledby="dqp-campus">
      <h3 className="dqp-section__title" id="dqp-campus">
        {COPY.campusHeading}
      </h3>
      <div className="dqp-gate">
        <span className={today.checkedIn ? 'dqp-gate__badge dqp-gate__badge--in' : 'dqp-gate__badge'}>
          {today.checkedIn ? <CheckCircleIcon size="lg" /> : <GateIcon size="lg" />}
        </span>
        <span>
          <span className="dqp-gate__state">
            {today.checkedIn ? COPY.checkedIn(clockTime(today.checkedInAt)) : COPY.notCheckedIn}
          </span>
          {/* An empty state that says what to DO, not just what is missing. */}
          {!today.checkedIn ? (
            <span className="dqp-gate__hint">{COPY.notCheckedInHint}</span>
          ) : null}
        </span>
      </div>
      {/* Multi-day fests get the earlier days: "did I check in yesterday" is a
          real question when attendance is per-day and a certificate depends on
          it. */}
      {earlier.length > 0 ? (
        <ul className="dqp-gate__history" aria-label={COPY.earlierDays}>
          {earlier.map((entry) => (
            <li className="dqp-gate__day" key={entry.date}>
              <span>{dayLabel(entry.date)}</span>
              <span>{clockTime(entry.checkedInAt)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function QrPassScreen() {
  const navigate = useNavigate();
  const { festId } = useParams();

  const [passData, setPassData] = useState(null);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [gateStatus, setGateStatus] = useState(null);
  const [allPasses, setAllPasses] = useState([]);
  const [festRegistrations, setFestRegistrations] = useState([]);
  const [emailState, setEmailState] = useState('idle'); // idle | sending | sent | failed
  // Stamped once. Date.now() read during render makes "is this fest live"
  // answer differently on two renders of identical data.
  const [nowMs] = useState(() => Date.now());

  const [brightnessDismissed, setBrightnessDismissed] = useState(() => {
    /*
     * ONE PROMPT PER SESSION. sessionStorage, not localStorage: turning the
     * brightness up is something you do per visit to a gate, not once in your
     * life, and a tip dismissed in March should still appear at the next fest.
     * Wrapped because sessionStorage throws outright in Safari private mode.
     */
    try {
      return window.sessionStorage.getItem(BRIGHTNESS_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  useScreenWakeLock();

  const loadPass = useCallback(async () => {
    setLoadState('loading');
    try {
      const data = await apiClient.get(`/passes/mine?festId=${festId}`);
      setPassData(data);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPass();
  }, [loadPass]);

  // The other passes, for the switcher. A failure leaves the list empty, which
  // hides the switcher — correct, and quiet.
  useEffect(() => {
    let live = true;
    apiClient
      .get('/passes/mine/all')
      .then((list) => live && setAllPasses(Array.isArray(list) ? list : []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const pass = passData?.pass ?? null;
  const fest = passData?.fest ?? null;
  const user = passData?.user ?? null;
  /* Memoised only so the `?? []` fallback does not mint a fresh array on every
     render and re-run the events-list build below for nothing. */
  const entitlements = useMemo(() => passData?.entitlements ?? [], [passData]);
  const passId = pass?.id ?? null;

  useEffect(() => {
    if (!passId) {
      return undefined;
    }
    let live = true;
    apiClient
      .get(`/passes/mine/${passId}/gate-status`)
      .then((status) => live && setGateStatus(status))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [passId]);

  /*
   * Their registrations for THIS fest. There is no per-fest endpoint, so the
   * whole list is fetched and filtered on eventId.festId.id — cheap, and the
   * response is already populated two levels deep. Silent on failure and absent
   * when empty; it is a desktop nicety, not part of the pass.
   */
  useEffect(() => {
    if (!festId) {
      return undefined;
    }
    let live = true;
    apiClient
      .get('/registrations/mine')
      .then((rows) => {
        if (!live || !Array.isArray(rows)) {
          return;
        }
        setFestRegistrations(
          rows.filter((row) => row?.eventId?.festId?.id === festId && row.status !== 'cancelled'),
        );
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [festId]);

  /*
   * The switcher's order. Only passes that are themselves active — a revoked
   * pass in a swipe rail is a trap — and sorted by when the fest starts, so
   * "the next one" is the one next to you.
   */
  const switchable = useMemo(
    () =>
      allPasses
        .filter((entry) => entry?.fest?.id && entry?.pass?.status === 'active')
        .sort(
          (a, b) =>
            new Date(a.fest.startsOn ?? 0).getTime() - new Date(b.fest.startsOn ?? 0).getTime(),
        ),
    [allPasses],
  );
  const currentIndex = switchable.findIndex((entry) => entry.fest.id === festId);

  const goToPassAt = useCallback(
    (index) => {
      const target = switchable[index];
      if (target && target.fest.id !== festId) {
        navigate(`/my-passes/${target.fest.id}`);
      }
    },
    [switchable, festId, navigate],
  );

  const handleSwipe = useCallback(
    (direction) => {
      if (currentIndex === -1 || switchable.length < 2) {
        return;
      }
      // Clamped, not wrapped. Wrapping means a swipe can silently land you back
      // on the pass you started from, which at a gate reads as "nothing
      // happened".
      const next = Math.min(switchable.length - 1, Math.max(0, currentIndex + direction));
      goToPassAt(next);
    },
    [currentIndex, switchable.length, goToPassAt],
  );

  const swipeHandlers = useHorizontalSwipe(handleSwipe);

  const isDesktop = useSyncExternalStore(subscribeToDesktopQuery, readDesktopQuery);

  /*
   * The list itself: the pass's own eventEntry entitlements, sorted next-first,
   * joined to the registrations only for the team name. `nowMs` is the stamped
   * one, so the statuses on the rows and the "live now" badge on the card can
   * never disagree.
   */
  const eventRows = useMemo(
    () => buildPassEventRows(entitlements, festRegistrations, nowMs),
    [entitlements, festRegistrations, nowMs],
  );

  const eventsList =
    eventRows.length > 0 ? (
      <PassEventList rows={eventRows} variant={isDesktop ? 'panel' : 'card'} />
    ) : null;

  function dismissBrightness() {
    setBrightnessDismissed(true);
    try {
      window.sessionStorage.setItem(BRIGHTNESS_DISMISSED_KEY, '1');
    } catch {
      // Private mode. The tip simply reappears; nothing breaks.
    }
  }

  const passUrl = `${window.location.origin}/my-passes/${festId}`;

  function handleShare() {
    if (navigator.share) {
      navigator.share({ title: fest?.festName ?? COPY.title, url: passUrl }).catch(() => {});
      return;
    }
    navigator.clipboard?.writeText(passUrl).catch(() => {});
  }

  /*
   * Re-sends to the SAME registered address the pass was issued to. It cannot
   * redirect a pass anywhere, which is why it can be a one-tap button with no
   * confirmation: this is the recovery path for an email that was filtered or
   * deleted, and asking "are you sure" at a gate helps nobody.
   */
  async function handleResendEmail() {
    if (!passId) {
      return;
    }
    setEmailState('sending');
    try {
      await apiClient.post(`/passes/${passId}/resend-email`);
      setEmailState('sent');
    } catch {
      setEmailState('failed');
    }
  }

  const sponsors = sortedByTier(fest?.sponsors);
  const dateRange = fest ? formatPassDateRange(fest.startsOn, fest.endsOn) : '';
  const hostName =
    fest?.hostCollegeId && typeof fest.hostCollegeId === 'object'
      ? fest.hostCollegeId.commonName ?? fest.hostCollegeId.collegeName ?? ''
      : '';
  const hostCity =
    fest?.hostCollegeId && typeof fest.hostCollegeId === 'object'
      ? fest.hostCollegeId.city ?? ''
      : '';

  return (
    <div className="dqp-screen">
      <header className="dqp-bar">
        <button
          type="button"
          className="dqp-bar__back"
          onClick={() => navigate(-1)}
          aria-label={COPY.back}
        >
          <BackIcon size="lg" />
        </button>
        <h1 className="dqp-bar__title">{COPY.title}</h1>
      </header>

      {loadState === 'loading' ? (
        <div className="dqp-layout">
          <div className="dqp-main">
            <div className="dqp-skel dqp-skel--card" />
            <div className="dqp-skel dqp-skel--row" />
          </div>
        </div>
      ) : null}

      {loadState === 'error' ? (
        <div className="dqp-fail">
          <p className="dqp-fail__title">{COPY.loadFailedTitle}</p>
          <p className="dqp-fail__text">
            {typeof navigator !== 'undefined' && navigator.onLine === false
              ? COPY.offlineText
              : COPY.loadFailedText}
          </p>
          <button type="button" className="dqp-button dqp-button--primary" onClick={loadPass}>
            <RetryIcon size="sm" />
            {COPY.retry}
          </button>
        </div>
      ) : null}

      {loadState === 'ready' && pass && fest ? (
        <div className="dqp-layout">
          <div className="dqp-main">
            {!brightnessDismissed ? (
              <div className="dqp-prompt">
                <span className="dqp-prompt__icon">
                  <BrightnessIcon size="md" />
                </span>
                <p className="dqp-prompt__text">{COPY.brightness}</p>
                <button
                  type="button"
                  className="dqp-prompt__dismiss"
                  onClick={dismissBrightness}
                  aria-label={COPY.brightnessDismiss}
                >
                  <DismissIcon size="md" />
                </button>
              </div>
            ) : null}

            {/* The switcher is only rendered when there is genuinely something
                to switch between. The pills are the primary control; the swipe
                is an accelerator on top of them, never a replacement. */}
            {switchable.length > 1 ? (
              <div className="dqp-switch" role="group" aria-label={COPY.otherPasses}>
                {switchable.map((entry, index) => (
                  <button
                    key={entry.pass.id}
                    type="button"
                    className="dqp-switch__pill"
                    aria-current={entry.fest.id === festId ? 'true' : 'false'}
                    onClick={() => goToPassAt(index)}
                  >
                    {entry.fest.festName}
                  </button>
                ))}
              </div>
            ) : null}

            <PassCard
              pass={pass}
              fest={fest}
              user={user}
              entitlements={entitlements}
              eventsSlot={isDesktop ? null : eventsList}
              nowMs={nowMs}
              {...swipeHandlers}
            />

            <div className="dqp-actions">
              <button type="button" className="dqp-button" onClick={handleShare}>
                <ShareIcon size="sm" />
                {COPY.sharePass}
              </button>

              {emailState === 'sent' ? (
                <p className="dqp-note dqp-note--ok" role="status">
                  {COPY.emailSent}
                </p>
              ) : (
                <button
                  type="button"
                  className="dqp-button"
                  onClick={handleResendEmail}
                  disabled={emailState === 'sending'}
                >
                  <MailIcon size="sm" />
                  {emailState === 'sending' ? COPY.emailSending : COPY.emailPass}
                </button>
              )}
              {emailState === 'failed' ? (
                <p className="dqp-note dqp-note--bad" role="alert">
                  {COPY.emailFailed}
                </p>
              ) : null}
              {/* Which inbox, masked: enough for the owner to recognise it,
                  nothing for a bystander at a crowded gate. */}
              <p className="dqp-note">
                {pass.passEmailSentAt && user?.emailAddress
                  ? COPY.emailedTo(maskEmailAddress(user.emailAddress))
                  : COPY.notEmailed}
              </p>
            </div>

            {/* Campus access sits under the card and above nothing else on a
                phone: it is the precondition for every entitlement on the card,
                so it reads immediately after them. */}
            <CampusAccess gateStatus={gateStatus} />
          </div>

          {/*
            THE DESKTOP COLUMN. Hidden below 768px in CSS rather than gated on a
            JS width, so there is no layout flash on first paint and no resize
            listener. Everything here is context, not credential — a phone
            deliberately shows none of it.
          */}
          <aside className="dqp-aside">
            <section>
              <h2 className="dqp-aside__title">{COPY.aboutHeading}</h2>
              {fest.description ? <p className="dqp-aside__text">{fest.description}</p> : null}
              <div className="dqp-facts">
                {dateRange ? (
                  <p className="dqp-fact">
                    <DateIcon size="sm" />
                    {dateRange}
                  </p>
                ) : null}
                {hostName ? (
                  <p className="dqp-fact">
                    <VenueIcon size="sm" />
                    {[hostName, hostCity].filter(Boolean).join(', ')}
                  </p>
                ) : null}
              </div>
            </section>

            {/*
              THE SAME LIST THE PHONE PUTS INSIDE THE CARD, moved here rather
              than duplicated. This slot used to hold a separate "Your events at
              this fest" list built straight from /registrations/mine; it is
              gone, because two lists of the same events from two sources is how
              they drift apart. On desktop the card has no scroll region — the
              column has the room — so the list runs at its full height here.
            */}
            {isDesktop ? eventsList : null}

            {sponsors.length > 0 ? (
              <section>
                <h2 className="dqp-aside__title">{COPY.sponsorsHeading}</h2>
                <div className="dqp-sponsors">
                  {sponsors.map((sponsor) => (
                    <span className="dqp-sponsor" key={sponsor._id ?? sponsor.sponsorName}>
                      <img src={sponsor.imageUrl} alt={sponsor.sponsorName ?? ''} loading="lazy" />
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            <section>
              <h2 className="dqp-aside__title">{COPY.handoffHeading}</h2>
              <div className="dqp-handoff">
                <span className="dqp-handoff__plate">
                  {/*
                    THE URL, NOT THE TOKEN. This is the one QR on the platform
                    that is not a credential, and confusing the two would put a
                    working entry code on a laptop screen in a library. Level M
                    is right here — a short URL with plenty of room, and unlike
                    the pass it is scanned once, indoors, by its owner.
                  */}
                  <QRCodeSVG
                    value={passUrl}
                    size={104}
                    level="M"
                    marginSize={1}
                    fgColor="#000000"
                    bgColor="#FFFFFF"
                    role="img"
                    aria-label={COPY.handoffAlt}
                  />
                </span>
                <span className="dqp-handoff__body">
                  <p className="dqp-aside__text">{COPY.handoffText}</p>
                  {/* The other way to get it onto a phone, for anyone whose
                      camera is in the other room. Same handler as the button on
                      the card, so there is one definition of "share". */}
                  <button type="button" className="dqp-button" onClick={handleShare}>
                    <MobileIcon size="sm" />
                    {COPY.sharePass}
                  </button>
                </span>
              </div>
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

export default QrPassScreen;

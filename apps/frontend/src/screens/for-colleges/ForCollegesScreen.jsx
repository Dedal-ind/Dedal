// ForCollegesScreen.jsx
// Route: /for-colleges — the public marketing landing for college onboarding.
// No authentication. A college representative arrives cold (a search, a flyer,
// the Discover footer line), is pitched the platform in about four screenfuls,
// and is sent to /register-college.
//
// THIS IS THE ONE PARTICIPANT PAGE WHERE SCROLL-DRIVEN MOTION IS THE RIGHT
// ANSWER. It is a pitch rather than a tool: nobody has a task here, the reader
// is deciding whether the thing is real, and each section is sized to about one
// viewport on a phone so scrolling advances it like a short deck. All of that
// motion is CSS (`animation-timeline: scroll()` / `view()`, in
// design/for-colleges.css) — no animation library, no scroll listener. The one
// piece of JavaScript-driven motion is the count-up, and the reason it is not
// CSS is written where it lives, below.
//
// Network: GET /public/metrics, the same unauthenticated endpoint the sign-in
// screen already draws its figures from. Nothing else.

import { useEffect, useRef, useState } from 'react';
import apiClient from '../../api-client/api-client.js';
import { BRAND_IDENTITY } from '../../brand/brand-identity.js';
import PublicWordmarkHeader from '../../components/public-wordmark-header/PublicWordmarkHeader.jsx';
import DedalWordmark from '../../components/dedal-wordmark/DedalWordmark.jsx';
import {
  CertificateIcon,
  ExpandIcon,
  QrIcon,
  RegistrationsFeatureIcon,
  StaffAccessFeatureIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';

/*
 * COPY LIVES HERE, NOT IN COLLEGE_ONBOARDING_COPY, and this is the same call
 * AuthSignInScreen made when it was redesigned.
 *
 * The existing entries for this screen are in the retired Heritage register —
 * "REGISTER YOUR COLLEGE →", "Engineered for Excellence", "Ready to Transform
 * Your College Fest?", "TRUSTED BY NUMBERS", stamped uppercase with an arrow
 * baked into a button label — and the same object is read by /register-college,
 * its success screen and the status screen, which another pass owns and which
 * are being worked on concurrently. Rewriting the shared strings would change
 * three screens nobody asked me to change; adding a parallel set of sentence-
 * case keys beside the shouty ones would leave the file with two voices and no
 * way to tell which is current. So the landing page's own strings are set here,
 * in one block, to be folded back into brand-copy.js when that file is next
 * opened for this flow.
 *
 * Voice: plain, from the representative's side of the table. No "unlock", no
 * "seamless", no claim the product cannot back.
 */
const COPY = {
  tagline: 'Your way through the fest',
  lede: 'The platform colleges use to run fests that actually work.',
  cta: 'Register your college',
  featuresHeading: 'What your fest gets',
  statsHeading: 'Where Dedal is today',
  bandHeading: 'Ready to bring Dedal to your campus?',
  scrollCue: 'Scroll for more',
};

const FEATURES = [
  {
    id: 'registrations',
    Icon: RegistrationsFeatureIcon,
    title: 'Registrations',
    body: 'Solo and team sign-ups, your own questions, payments collected, and a live roster for every event.',
  },
  {
    id: 'passes',
    Icon: QrIcon,
    title: 'Passes',
    body: 'Every participant carries a QR pass. Volunteers scan it at the gate and at each event. No paper lists.',
  },
  {
    id: 'staff',
    Icon: StaffAccessFeatureIcon,
    title: 'Staff',
    body: 'Add coordinators and volunteers, and give each of them access to their events and nothing else.',
  },
  {
    id: 'certificates',
    Icon: CertificateIcon,
    title: 'Certificates',
    body: 'Issue participation and winner certificates in bulk, each with a code anyone can verify online.',
  },
];

/* Which figures from /public/metrics the page shows, in order. The endpoint
   also returns totalScans; three large numbers is a row that reads at a glance
   on a phone and four is a table. */
const STAT_FIELDS = [
  { key: 'totalColleges', label: 'colleges' },
  { key: 'totalFests', label: 'fests' },
  { key: 'totalEvents', label: 'events' },
];

const COUNT_UP_MILLISECONDS = 900;

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/*
 * ── THE COUNT-UP ────────────────────────────────────────────────────────────
 *
 * CSS FIRST WAS TRIED AND REJECTED, for two reasons rather than one.
 *
 * The clean CSS version is `@property` on an integer custom property, animated
 * on a `view()` timeline, rendered with `counter-reset` + `content: counter(n)`.
 * It renders the digits in a ::before, and generated content is not text: it is
 * not selectable, not reliably exposed to assistive technology, and not there
 * for a browser without scroll-driven animations — which on this page is Safari,
 * i.e. most of the iPhones this flyer gets opened on. A marketing page whose
 * only concrete evidence is three numbers cannot have those numbers vanish on
 * half the devices.
 *
 * Second, the value is not known at author time. It arrives from the network,
 * so the keyframe's end state would have to be written from JavaScript anyway —
 * the CSS version is not actually CSS-only, it is JavaScript that sets a custom
 * property and CSS that cannot be trusted to render it.
 *
 * So: ONE requestAnimationFrame loop per figure, started by an
 * IntersectionObserver when the row enters the viewport, which stops itself at
 * the end and never restarts. No setInterval — an interval keeps firing after
 * the animation has finished and after the tab is backgrounded, and there is
 * nothing here worth a permanent timer. The DOM always holds real text, so with
 * script mid-flight, with reduced motion, or with the row never scrolled into
 * view at all, what is on screen is the final number.
 */
function StatFigure({ value, label }) {
  /*
   * The decision to animate at all is taken once, in the initialiser, so the
   * non-animating case NEVER renders a zero it then has to correct — no
   * cascading render, and no frame of "0 colleges" for somebody who asked the
   * OS for less motion. StatFigure is mounted only once the metrics have
   * arrived, so `value` is settled by the time this runs.
   */
  const [shown, setShown] = useState(() =>
    prefersReducedMotion() || typeof IntersectionObserver === 'undefined' ? value : 0,
  );
  const valueRef = useRef(null);

  useEffect(() => {
    const node = valueRef.current;
    if (!node) return undefined;

    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    let frame = null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        /* One shot: disconnect before the first frame, so scrolling back up
           does not re-run it and two loops can never overlap. */
        observer.disconnect();
        const startedAt = performance.now();
        const step = (now) => {
          const progress = Math.min(1, (now - startedAt) / COUNT_UP_MILLISECONDS);
          /* Ease-out: the figure lands rather than stopping dead. */
          const eased = 1 - (1 - progress) ** 3;
          setShown(Math.round(value * eased));
          frame = progress < 1 ? requestAnimationFrame(step) : null;
        };
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [value]);

  return (
    <p className="dfc-stat">
      {/*
        aria-hidden on the animating number and the real figure in the label's
        text: a live-updating digit read out by a screen reader is thirty
        announcements of a number nobody asked for.
      */}
      <span className="dfc-stat__value" ref={valueRef} aria-hidden="true">
        {shown.toLocaleString()}
      </span>
      <span className="dfc-stat__label">
        <span className="dfc-visually-hidden">{`${value.toLocaleString()} `}</span>
        {label}
      </span>
    </p>
  );
}

function ForCollegesScreen() {
  const navigate = useTransitionNavigate();
  const [metrics, setMetrics] = useState(null);

  /*
   * The figures are public and unauthenticated. A failure drops the whole stats
   * section rather than showing zeroes or dashes — on the screen where somebody
   * is deciding whether this platform is real, "0 colleges" is worse than no
   * claim at all. Same policy as the sign-in screen, which reads the same
   * endpoint.
   */
  useEffect(() => {
    let isActive = true;
    apiClient
      .get('/public/metrics')
      .then((data) => {
        if (isActive) setMetrics(data);
      })
      .catch(() => {
        /* cosmetic; the pitch stands without it */
      });
    return () => {
      isActive = false;
    };
  }, []);

  const stats = STAT_FIELDS.map((field) => ({
    ...field,
    value: Number(metrics?.[field.key]),
  })).filter((stat) => Number.isFinite(stat.value));

  /*
   * A real <a> to a real route, driven through the transition hook on click:
   * middle-click, long-press and "open in new tab" all still work, and a
   * crawler following the flyer's URL can see where the page leads. Modified
   * clicks fall through to the browser untouched.
   */
  function goToRegister(event) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    navigate('/register-college');
  }

  return (
    <div className="dfc-screen">
      <div className="dfc-wash" aria-hidden="true" />
      <PublicWordmarkHeader />

      <main className="dfc-main">
        <section className="dfc-hero dfc-col">
          <h1 className="dfc-hero__title">
            <DedalWordmark size={72} title="dedal" className="dfc-hero__mark" />
            <span className="dfc-hero__tagline">{COPY.tagline}</span>
          </h1>
          <p className="dfc-hero__lede">{COPY.lede}</p>
          <a className="dfc-cta" href="/register-college" onClick={goToRegister}>
            {COPY.cta}
          </a>
          <span className="dfc-scrollcue" aria-hidden="true">
            <ExpandIcon size="lg" />
          </span>
        </section>

        <section className="dfc-section dfc-col dfc-col--wide" aria-labelledby="dfc-features-h">
          <h2 className="dfc-section__heading" id="dfc-features-h">
            {COPY.featuresHeading}
          </h2>
          <div className="dfc-features">
            {FEATURES.map(({ id, Icon, title, body }) => (
              <article className="dfc-feature" key={id}>
                <span className="dfc-feature__icon">
                  <Icon size="lg" />
                </span>
                <h3 className="dfc-feature__title">{title}</h3>
                <p className="dfc-feature__body">{body}</p>
              </article>
            ))}
          </div>
        </section>

        {stats.length > 0 ? (
          <section className="dfc-section dfc-col dfc-col--wide" aria-labelledby="dfc-stats-h">
            <h2 className="dfc-section__heading" id="dfc-stats-h">
              {COPY.statsHeading}
            </h2>
            <div className="dfc-stats">
              {stats.map((stat) => (
                <StatFigure key={stat.key} value={stat.value} label={stat.label} />
              ))}
            </div>
          </section>
        ) : null}

        {/*
          NO TESTIMONIALS SECTION. There are no real quotes from real colleges
          anywhere in this codebase, and an invented one on the page where a
          stranger is deciding whether to trust the platform is the single worst
          place to put words nobody said. It goes in when somebody says one.
        */}

        <section className="dfc-band" aria-labelledby="dfc-band-h">
          <div className="dfc-col">
            <h2 className="dfc-band__heading" id="dfc-band-h">
              {COPY.bandHeading}
            </h2>
            <a className="dfc-cta dfc-cta--onband" href="/register-college" onClick={goToRegister}>
              {COPY.cta}
            </a>
          </div>
        </section>
      </main>

      <footer className="dfc-foot">{BRAND_IDENTITY.footerText}</footer>
    </div>
  );
}

export default ForCollegesScreen;

// DrawnCheck.jsx
// The confirmation mark for the college-application success screen.
//
// WHY THIS FILE EXISTS AT ALL, stated plainly. This is the SAME mark, the same
// geometry and the same gsap timeline as the one in
// screens/registration-success/RegistrationSuccessScreen.jsx. The right home
// for it is a shared component both screens import — but that component does
// not exist yet, and creating it means editing the participant registration
// success screen, which this change does not own. So it is lifted here
// unchanged rather than reinvented: same 56px box, same radius, same 400ms
// circle and 280ms tick offset by 200ms, same class-per-subpath so the CSS in
// college-onboarding.css can colour it. If somebody promotes it to
// components/, both call sites should collapse onto it and this file goes.
//
// Hand-built as an inline <svg> rather than taken from DetailIcons, because a
// lucide component renders a finished glyph: there is no way to reach its two
// subpaths and give the circle and the tick separate lengths, and the whole
// point here is that the mark DRAWS. Nothing loops — a success page that keeps
// moving reads as a page still working.
//
// The mark is rendered COMPLETE in the markup and the animation, if it runs at
// all, rewinds it to zero and plays it forward inside a layout effect. That
// ordering is deliberate: under prefers-reduced-motion, and equally if gsap
// fails or JS throws before the effect, what is on screen is a finished
// checkmark rather than an empty circle. The mark is information — it is the
// sentence "this worked" — so it may be unanimated but must never be absent.

import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';

function DrawnCheck({ label }) {
  const rootRef = useRef(null);

  useLayoutEffect(() => {
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      return undefined;
    }
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }
    const circle = root.querySelector('.dco-check__circle');
    const tick = root.querySelector('.dco-check__tick');

    // Measured, not guessed: getTotalLength is exact for the rendered geometry,
    // so the dash covers the path exactly however the SVG is scaled.
    const circleLength = circle.getTotalLength();
    const tickLength = tick.getTotalLength();

    const timeline = gsap.timeline();
    timeline
      .fromTo(
        circle,
        { strokeDasharray: circleLength, strokeDashoffset: circleLength },
        { strokeDashoffset: 0, duration: 0.4, ease: 'power2.out' },
      )
      .fromTo(
        tick,
        { strokeDasharray: tickLength, strokeDashoffset: tickLength },
        { strokeDashoffset: 0, duration: 0.28, ease: 'power2.out' },
        // 200ms after the circle STARTS, so the tick lands while the ring is
        // still closing and the two read as one gesture rather than two.
        0.2,
      );

    /*
     * progress(1) BEFORE kill(). gsap.kill() stops a tween exactly where it is
     * and leaves the inline styles at that frozen value — which under React
     * StrictMode's mount / clean up / mount again leaves a permanently
     * half-drawn ring and no tick. Jumping to the end first means every
     * teardown path leaves a COMPLETE mark, which is what this component
     * promises above.
     */
    return () => {
      timeline.progress(1);
      timeline.kill();
    };
  }, []);

  return (
    <svg
      ref={rootRef}
      viewBox="0 0 56 56"
      width="56"
      height="56"
      fill="none"
      role="img"
      aria-label={label}
    >
      <circle className="dco-check__circle" cx="28" cy="28" r="25" />
      <path className="dco-check__tick" d="M17 28.5 L24.5 36 L39 21.5" />
    </svg>
  );
}

export default DrawnCheck;

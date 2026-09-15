// DrawnCheck.jsx
// The celebration mark: a circle and a tick that DRAW once, then sit still.
//
// Shared by every "this worked" moment — registration success, codes ready,
// joined with a code — so success looks and moves the same way everywhere.
//
// Hand-built as an inline <svg> rather than taken from DetailIcons, because a
// lucide component renders a finished glyph: there is no way to reach its two
// subpaths and give the circle and the tick separate lengths, and the whole
// point here is that the mark DRAWS. Circle over 400ms, tick starting 200ms
// later, once, then static forever. Nothing loops — a success page that keeps
// moving reads as a page still working.
//
// The mark is rendered COMPLETE in the markup, and the animation, if it runs at
// all, rewinds it to zero and plays it forward inside a layout effect. Under
// prefers-reduced-motion, and equally if gsap fails or JS throws before the
// effect, what is on screen is a finished checkmark rather than an empty circle.

import { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import './drawn-check.css';

function DrawnCheck({ label, className = '' }) {
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
    const circle = root.querySelector('.dxc-check__circle');
    const tick = root.querySelector('.dxc-check__tick');

    // Measured, not guessed: getTotalLength is exact for the rendered geometry.
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
        // 200ms after the circle STARTS, so the two read as one gesture.
        0.2,
      );

    /*
     * progress(1) BEFORE kill(): kill() freezes a tween mid-draw, and StrictMode
     * tears this down mid-tween in development. Jumping to the end first means
     * every teardown leaves a COMPLETE mark.
     */
    return () => {
      timeline.progress(1);
      timeline.kill();
    };
  }, []);

  return (
    <svg
      ref={rootRef}
      className={['dxc-check', className].filter(Boolean).join(' ')}
      viewBox="0 0 56 56"
      width="56"
      height="56"
      fill="none"
      role="img"
      aria-label={label}
    >
      <circle className="dxc-check__circle" cx="28" cy="28" r="25" />
      <path className="dxc-check__tick" d="M17 28.5 L24.5 36 L39 21.5" />
    </svg>
  );
}

export default DrawnCheck;

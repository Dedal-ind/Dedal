// DedalWordmark.jsx
// The wordmark: "dedal", lowercase, Plus Jakarta Sans 700, with a single 2px
// --primary line that enters at the left edge, threads through both d counters,
// and leaves the right edge unterminated.
//
// HOW THE THREADING WORKS. The line is one straight rule drawn across the whole
// box, masked by the letterforms themselves: the mask is white everywhere and
// black where the glyphs are, so the rule is hidden wherever it would cross
// ink and visible wherever it would not — which is the two d counters and the
// spaces between letters. Drawing the text over an opaque line would have done
// the same thing only on a known background; the mask makes the wordmark
// correct on the canvas, on a card, and on the dark pass.
//
// The stroke is `non-scaling-stroke`, so it is 2 device-independent pixels at
// 14px and at 64px rather than 2 units of a scaled viewBox.
//
// BELOW 20px THE LINE DROPS. At that size the counters are under two pixels
// across and the rule reads as a smudge through the middle of the word rather
// than as a line behind it. Small sizes get plain text, which is also what a
// screen reader and a copy-paste get at every size.

import { useEffect, useId, useRef, useState } from 'react';

/*
 * Geometry in em-hundredths: the SVG is authored at font-size 100 and scaled by
 * the caller's `size`. These three numbers are the whole design.
 *   BASELINE  — where the glyphs sit inside the box.
 *   BOX_H     — ascender top to baseline. "dedal" has no descender, so nothing
 *               below the baseline is ever drawn and the box does not pad for it.
 *   THREAD_Y  — the vertical centre of a lowercase d's counter.
 */
const BASELINE = 78;
const BOX_H = 82;
const THREAD_Y = 43.5;

/* Plus Jakarta Sans 700 "dedal" at font-size 100. Replaced by a real
   measurement once the font has loaded; this only has to be close enough that
   the header does not shift when it is. */
const FALLBACK_ADVANCE = 279;

/*
 * How far the rule runs past the first and last glyph, in the same
 * em-hundredths. Without it the line began at the d's left sidebearing and
 * stopped at the l's right one, which read as a strikethrough with a stub on
 * the end rather than as a line passing behind a word. A sixth of an em on
 * each side is enough to be read as "entering" and "leaving" and not enough to
 * become a rule with a word sitting on it.
 */
const THREAD_RUN = 16;

/* Under this rendered font size the line is dropped — see the file header. */
const THREAD_MIN_SIZE = 20;

function DedalWordmark({ size = 28, title = 'dedal', className }) {
  const maskId = useId();
  const textRef = useRef(null);
  const [advance, setAdvance] = useState(FALLBACK_ADVANCE);

  /*
   * The real advance width, measured once the variable font is actually in
   * use. Without this the rule would either stop short of the final "l" or
   * overshoot it, and "exits the right edge" would be a lie at one size and
   * true at another. document.fonts.ready settles before the first paint that
   * uses the font, so the correction is a single state write, not a loop.
   */
  useEffect(() => {
    let isActive = true;

    function measure() {
      const node = textRef.current;
      if (!isActive || !node || typeof node.getComputedTextLength !== 'function') {
        return;
      }
      const measured = node.getComputedTextLength();
      if (measured > 0) {
        setAdvance(Math.ceil(measured));
      }
    }

    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(measure);
    } else {
      measure();
    }
    return () => {
      isActive = false;
    };
  }, []);

  const showThread = size >= THREAD_MIN_SIZE;
  /* The box is the glyphs plus the rule's run-in and run-out, so the SVG's own
     edges ARE the edges the line enters and leaves by, and no parent has to
     allow for something poking out of it. */
  const run = showThread ? THREAD_RUN : 0;
  const boxWidth = advance + run * 2;
  const width = (boxWidth / 100) * size;
  const height = (BOX_H / 100) * size;

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${boxWidth} ${BOX_H}`}
      role="img"
      aria-label={title}
      focusable="false"
      style={{ display: 'block' }}
    >
      {showThread ? (
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={boxWidth} height={BOX_H}>
            <rect x="0" y="0" width={boxWidth} height={BOX_H} fill="#fff" />
            {/*
              The same string, same metrics, painted black: this is the cut-out,
              not a second visible wordmark. Widened by a hairline stroke so the
              rule clears the glyph edges instead of leaving a red fringe where
              antialiasing has thinned them.
            */}
            <text
              x={run}
              y={BASELINE}
              fontFamily="var(--font)"
              fontWeight="700"
              fontSize="100"
              fill="#000"
              stroke="#000"
              strokeWidth="3"
            >
              dedal
            </text>
          </mask>
        </defs>
      ) : null}

      {showThread ? (
        <line
          x1="0"
          y1={THREAD_Y}
          x2={boxWidth}
          y2={THREAD_Y}
          stroke="var(--primary)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          mask={`url(#${maskId})`}
        />
      ) : null}

      <text
        ref={textRef}
        x={run}
        y={BASELINE}
        fontFamily="var(--font)"
        fontWeight="700"
        fontSize="100"
        fill="var(--ink)"
      >
        dedal
      </text>
    </svg>
  );
}

export default DedalWordmark;

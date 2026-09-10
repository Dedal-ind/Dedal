// RotatingPlaceholder.jsx
// The suggestion inside a search field, animated the way search boxes on the
// web actually do it.
//
// WHY THIS IS NOT THE `placeholder` ATTRIBUTE. A placeholder cannot be
// animated. `::placeholder` accepts a colour and an opacity, but the text is
// not an element, so it cannot be transformed, cannot be masked, and cannot
// move. The first version tried to fade it with an opacity transition on the
// pseudo-element and the result was exactly what was reported: one hard cut
// every three seconds that reads as a glitch rather than a rotation. This is a
// real element sitting over a real input, which is what every site that does
// this well is also doing.
//
// THE MOTION. The WHOLE phrase moves as one line, travelling vertically
// through a one-line mask:
//
//   out   the current phrase rises and fades    -60% / opacity 0   over 180ms
//   in    the next phrase rises into place      +60% → 0 / 0 → 1   over 240ms
//
// Vertical, not a cross-fade, because upward movement reads as "next" — the
// same reason a slot machine and an odometer both roll rather than dissolve.
// The two halves are sequenced on one timeline, so the outgoing phrase is fully
// gone before the incoming one starts and the two never overlap into a smear.
//
// AN EARLIER VERSION HELD THE STEM STILL and moved only the noun, which is what
// Google and Airbnb do. On paper it is the better idea — the words "Search for"
// carry no new information, so animating them is movement for nothing. In this
// field it read as broken: two thirds of one line of text sitting perfectly
// still while the last third slides away underneath it draws the eye to the
// seam between them rather than to either part. One line that moves as one line
// is calmer than two pieces that disagree, so the stem travels with the noun.
//
// It is transform and opacity only, so it composites, and it is one element on
// one screen — not per frame of a scroll.
//
// The ghost is aria-hidden and pointer-events:none. The real accessible name
// lives on the input's own aria-label, which is the FULL sentence and does not
// rotate: a screen reader should not hear a field rename itself every three
// seconds while somebody is deciding what to type into it.

import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { seconds } from '../../design/motion.js';

function RotatingPlaceholder({ prefix, term }) {
  const phraseRef = useRef(null);
  const phrase = `${prefix}${term}`;
  const previousPhraseRef = useRef(phrase);
  /*
   * The phrase as it was on the FIRST render, frozen. State with a lazy
   * initialiser rather than a ref: this value is READ DURING RENDER, and a ref
   * read in the render body is exactly what the purity rule forbids. The setter
   * is never called, so it is a constant that happens to be safe to read.
   */
  const [initialPhrase] = useState(phrase);

  useEffect(() => {
    const node = phraseRef.current;
    if (!node || previousPhraseRef.current === phrase) {
      previousPhraseRef.current = phrase;
      return undefined;
    }
    previousPhraseRef.current = phrase;

    /*
     * The text is swapped at the midpoint of the timeline, while the element is
     * off its mark and transparent. Doing it in React state instead would swap
     * on the render that starts the tween — visibly, before the old word had
     * left.
     */
    const timeline = gsap.timeline();
    timeline
      .to(node, {
        yPercent: -60,
        opacity: 0,
        duration: seconds('exit'),
        ease: 'power2.in',
      })
      .set(node, { textContent: phrase, yPercent: 60 })
      .to(node, {
        yPercent: 0,
        opacity: 1,
        duration: seconds('move'),
        ease: 'power2.out',
      });

    /*
     * Settle before killing. A bare kill() freezes the tween wherever it is, so
     * an unmount or a fast rotation mid-flight leaves the word stranded at
     * opacity 0 or 60% off its mark, and nothing ever puts it back. progress(1)
     * runs the timeline to its end state first — the new phrase, in place, fully
     * opaque — which is the correct resting state however the animation ends.
     */
    return () => {
      timeline.progress(1);
      timeline.kill();
    };
  }, [phrase]);

  return (
    <span className="dsr-ghost" aria-hidden="true">
      <span className="dsr-ghost__mask">
        {/*
          THE FROZEN FIRST PHRASE, AND IT HAS TO BE FROZEN.
          
          This rendered `{phrase}` and the comment claimed the node "never
          re-renders" — but it does. `term` is a prop, so every rotation
          re-renders this component and React updates the text node to the new
          phrase SYNCHRONOUSLY, before the effect that animates it has run.
          
          The visible result was the rotation happening in the wrong order: the
          word changed on the spot, THEN the already-new word rose out of view,
          then it came back up from below. The exit was animating the incoming
          text.
          
          Rendering the frozen initial phrase hands ownership of the text to the
          timeline, which swaps it at the midpoint while the element is off its
          mark and transparent. React writes it once; GSAP writes it thereafter.
          
          Still not keyed on the phrase: a key would remount the node on every
          rotation and the tween would be animating an element that no longer
          exists.
        */}
        <span className="dsr-ghost__term" ref={phraseRef}>
          {initialPhrase}
        </span>
      </span>
    </span>
  );
}

export default RotatingPlaceholder;

// BottomSheet.jsx
// The one sheet. Both the pass shortcut and the account menu are this
// component with different children, so there is exactly one implementation of
// the scrim, the drag, the focus trap and the keyboard handling.
//
// WHAT MAKES IT A REAL SHEET RATHER THAN A DIV THAT SLIDES:
//
//   · SWIPE TO DISMISS, on pointer events, so it works for touch, mouse and
//     pen without three code paths. The drag only tracks DOWNWARD movement —
//     pulling up on a sheet that is already at its stop is the gesture people
//     make when they are trying to scroll its contents, and treating it as a
//     drag would fight them for the scroll.
//   · A THRESHOLD, not a hair trigger: past 96px or faster than 0.5px/ms and it
//     closes; short of that it springs back. Distance OR velocity, because a
//     quick flick is a dismissal even when it only travelled 40px.
//   · THE SCRIM CLOSES IT and Escape closes it. Both are what people already
//     expect, and neither costs a control on screen.
//   · FOCUS MOVES IN on open and RETURNS to whatever opened it on close.
//     Without the return, dismissing a sheet drops keyboard focus back to the
//     document body and the next Tab starts from the top of the page.
//   · BODY SCROLL IS LOCKED while it is up, so the page behind does not scroll
//     under the scrim when the sheet's own contents reach their end.
//
// KEYBOARD. The sheet is positioned against the VISUAL viewport, not the
// layout viewport. When a keyboard opens over it — the search field in the
// header, or an input inside the sheet — the layout viewport does not change
// on iOS, so a sheet pinned to `bottom: 0` ends up behind the keyboard. Reading
// visualViewport and offsetting by the difference keeps the sheet sitting on
// top of the keyboard instead of under it. Browsers without visualViewport get
// the plain bottom-anchored behaviour, which is what they had anyway.
//
// Transform and opacity only, per the motion rules: 240ms in, 180ms out.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DURATION, prefersReducedMotion } from '../../design/motion.js';

/* Past this, or faster than this, the release dismisses. */
const DISMISS_DISTANCE_PX = 96;
const DISMISS_VELOCITY_PX_PER_MS = 0.5;

function BottomSheet({ isOpen, onClose, title, children, labelledBy }) {
  const sheetRef = useRef(null);
  const scrimRef = useRef(null);
  const openerRef = useRef(null);
  const dragRef = useRef(null);
  const generatedTitleId = useId();
  const titleId = labelledBy ?? generatedTitleId;

  /* Kept mounted through the exit animation so the slide-down is visible; the
     component unmounts itself when the transition ends. */
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isSettled, setIsSettled] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    if (isOpen) {
      openerRef.current = document.activeElement;
      /* eslint-disable-next-line react-hooks/set-state-in-effect --
         Mounting cannot be derived from `isOpen` alone: the sheet has to stay
         in the tree AFTER isOpen goes false, for exactly as long as the exit
         animation runs, or it vanishes instead of sliding away. The external
         system this effect synchronises with is the timer that owns that
         window. */
      setIsMounted(true);
      return undefined;
    }
    setIsSettled(false);
    const timer = setTimeout(
      () => setIsMounted(false),
      prefersReducedMotion() ? 0 : DURATION.exit,
    );
    return () => clearTimeout(timer);
  }, [isOpen]);

  /*
   * THE OPEN TRANSITION, without requestAnimationFrame.
   *
   * The sheet has to render once at its closed transform and only then get the
   * open class, or the browser has no start value to animate from and it simply
   * appears. The obvious way to buy that frame is a double rAF. It is also
   * wrong: rAF DOES NOT FIRE IN A BACKGROUNDED TAB. Open the sheet, switch
   * apps, come back, and the callback that was going to add the open class
   * never ran — the sheet is mounted, the scrim is at opacity 0, Escape does
   * nothing, and the page behind is scroll-locked by a dialog you cannot see.
   * That was reproduced here, not theorised: scrim opacity stayed "0" and the
   * transform stayed translateY(242px) indefinitely.
   *
   * useLayoutEffect runs synchronously after the DOM is mutated and before the
   * browser paints, and reading offsetHeight forces the style to be computed at
   * that instant. So the closed state is committed, then the open class goes
   * on, and the transition has both ends — with no dependency on a frame ever
   * being scheduled.
   */
  useLayoutEffect(() => {
    if (!isMounted || !isOpen) return;
    const sheet = sheetRef.current;
    if (sheet) {
      /* The reflow IS the point; the value is discarded. */
      void sheet.offsetHeight;
    }
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       The external system here is the browser's own style engine. The whole
       point of this effect is to commit one paint at the closed transform and
       then flip to the open one; that second state cannot be derived, because
       it is defined as "after the first has been rendered". */
    setIsSettled(true);
  }, [isMounted, isOpen]);

  /*
   * Focus in on open, back to the opener on close.
   *
   * THE SHEET ITSELF, not the first focusable inside it. Two reasons, and the
   * second one is a bug this actually had:
   *
   *   1. Focusing the container is what makes a screen reader announce the
   *      dialog and its title. Jumping straight to the first button skips the
   *      announcement, so you hear "Find a fest" with no idea what opened.
   *
   *   2. The first focusable often does not exist yet. Both sheets fetch when
   *      they open, so at the moment the slide finishes their body is a line of
   *      loading text with no button in it — the query returned null, focus
   *      stayed on the header icon behind the scrim, and Tab walked the page
   *      underneath instead of the dialog. Measured in the browser:
   *      `sheet.contains(document.activeElement)` was false. The container is
   *      there from the first frame, so focusing it cannot miss.
   *
   * Tab from here moves into the sheet's own contents as they arrive.
   */
  useEffect(() => {
    if (!isSettled) return;
    sheetRef.current?.focus({ preventScroll: true });
  }, [isSettled]);

  useEffect(() => {
    if (isMounted) return undefined;
    const opener = openerRef.current;
    return () => {
      if (opener && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true });
      }
    };
  }, [isMounted]);

  /* Escape, and the page behind held still. */
  useEffect(() => {
    if (!isMounted) return undefined;
    function handleKeyDown(keyEvent) {
      if (keyEvent.key === 'Escape') {
        keyEvent.stopPropagation();
        onClose();
      }
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMounted, onClose]);

  /*
   * The keyboard. `visualViewport.height + offsetTop` is the bottom of what the
   * person can actually see; the difference from the window height is how much
   * the keyboard has taken. The sheet is lifted by exactly that.
   */
  useEffect(() => {
    if (!isMounted || typeof window === 'undefined' || !window.visualViewport) {
      return undefined;
    }
    const viewport = window.visualViewport;
    function measure() {
      const covered = window.innerHeight - (viewport.height + viewport.offsetTop);
      setKeyboardInset(Math.max(0, Math.round(covered)));
    }
    measure();
    viewport.addEventListener('resize', measure);
    viewport.addEventListener('scroll', measure);
    return () => {
      viewport.removeEventListener('resize', measure);
      viewport.removeEventListener('scroll', measure);
    };
  }, [isMounted]);

  // ── Drag to dismiss ─────────────────────────────────────────────────────

  const endDrag = useCallback(
    (clientY) => {
      const drag = dragRef.current;
      const sheet = sheetRef.current;
      dragRef.current = null;
      if (!drag || !sheet) return;

      const distance = Math.max(0, clientY - drag.startY);
      const elapsed = Math.max(1, performance.now() - drag.startTime);
      const velocity = distance / elapsed;

      sheet.style.transition = '';
      sheet.style.transform = '';

      if (distance > DISMISS_DISTANCE_PX || velocity > DISMISS_VELOCITY_PX_PER_MS) {
        onClose();
      }
    },
    [onClose],
  );

  function handlePointerDown(pointerEvent) {
    /* Only from the grabber and the header strip. Starting a drag anywhere on
       the sheet would swallow taps meant for the rows inside it. */
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.setPointerCapture?.(pointerEvent.pointerId);
    dragRef.current = { startY: pointerEvent.clientY, startTime: performance.now() };
    sheet.style.transition = 'none';
  }

  function handlePointerMove(pointerEvent) {
    const drag = dragRef.current;
    const sheet = sheetRef.current;
    if (!drag || !sheet) return;
    /* Downward only — see the file header. */
    const distance = Math.max(0, pointerEvent.clientY - drag.startY);
    sheet.style.transform = `translate3d(0, ${distance}px, 0)`;
  }

  function handlePointerUp(pointerEvent) {
    endDrag(pointerEvent.clientY);
  }

  if (!isMounted) return null;

  return createPortal(
    <div className="dsh-root" role="presentation">
      <div
        ref={scrimRef}
        className={isSettled ? 'dsh-scrim dsh-scrim--open' : 'dsh-scrim'}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className={isSettled ? 'dsh-sheet dsh-sheet--open' : 'dsh-sheet'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ paddingBottom: keyboardInset ? `${keyboardInset}px` : undefined }}
      >
        <div
          className="dsh-grip"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <span className="dsh-grip__bar" aria-hidden="true" />
        </div>
        <h2 className="dsh-title" id={titleId}>
          {title}
        </h2>
        <div className="dsh-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export default BottomSheet;

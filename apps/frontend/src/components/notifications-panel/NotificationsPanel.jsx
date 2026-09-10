// NotificationsPanel.jsx
// Notifications on a desktop, as a panel under the header bell rather than a
// route change.
//
// WHY NOT JUST THE PAGE.
//
// On a phone, notifications ARE the screen: there is nowhere else for them and
// leaving the page you were on costs nothing, because you could only see one
// page anyway. On a desktop that same navigation throws away everything on
// screen to show a list of five short rows — and then you press Back. Checking
// notifications is a glance, and a glance should not cost you your place. The
// header already treats search and the pass this way; this is the third of the
// same thing, not a new pattern.
//
// The route stays. /notifications is still real, still linked from the account
// menu, and still the whole experience on a phone — this panel is an additional
// desktop affordance, not a replacement. The list inside is literally the same
// component, so nothing can drift between the two.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NotificationsFeed } from '../../screens/notifications/NotificationsScreen.jsx';
import { DURATION, prefersReducedMotion } from '../../design/motion.js';

function NotificationsPanel({ isOpen, onClose }) {
  const panelRef = useRef(null);

  /*
   * MOUNTED THROUGH THE EXIT. This component used to be `if (!isOpen) return
   * null`, which meant it could not animate out at all: React pulled the node
   * out of the DOM on the same tick the bell was pressed, so a panel that
   * faded and rose into place vanished as a hard cut. The enter was designed
   * and the exit was an accident.
   *
   * `isMounted` outlives `isOpen` by exactly the exit duration, and `isSettled`
   * is the open class — it goes on one committed paint AFTER the closed state,
   * so the browser has both ends of the transition to interpolate between.
   * Same two-flag shape as BottomSheet; deliberately, so there is one mental
   * model for every layer in the app.
   */
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isSettled, setIsSettled] = useState(false);

  useEffect(() => {
    if (isOpen) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect --
         The external system is the exit timer. Mounting cannot be derived from
         `isOpen`, because the panel must remain in the tree after `isOpen` has
         already gone false, for as long as the closing transition runs. */
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
   * useLayoutEffect and a forced reflow, not a double requestAnimationFrame:
   * rAF does not fire in a backgrounded tab, so a panel opened just before a
   * tab switch would come back mounted, at opacity 0, with the page behind it
   * scrim-locked and no way to see what to press. Reading offsetHeight commits
   * the closed style synchronously before paint instead.
   */
  useLayoutEffect(() => {
    if (!isMounted || !isOpen) return;
    if (panelRef.current) {
      /* The reflow IS the point; the value is discarded. */
      void panelRef.current.offsetHeight;
    }
    /* eslint-disable-next-line react-hooks/set-state-in-effect --
       The external system is the browser's style engine: this second state is
       defined as "after the first has been painted", which is not derivable. */
    setIsSettled(true);
  }, [isMounted, isOpen]);

  /*
   * Escape closes, and a click on the scrim closes. Both are what a person
   * already expects from the search modal beside it; a panel that can only be
   * dismissed by finding a small × is the reason people navigate away instead.
   */
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  /*
   * Focus moves into the panel on open so a keyboard user is not left behind on
   * the bell, and the panel is a labelled dialog so a screen reader says what
   * just appeared rather than reading the page from the top again.
   */
  useEffect(() => {
    if (!isSettled) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [isSettled]);

  if (!isMounted) {
    return null;
  }

  return (
    <div
      className={isSettled ? 'dnp-scrim dnp-scrim--open' : 'dnp-scrim'}
      role="presentation"
      onClick={onClose}
      /* Closed-but-still-leaving is not a set of links a keyboard can reach.
         React 19 wants a real boolean; an empty string reads as false. */
      inert={isOpen ? undefined : true}
    >
      <div
        ref={panelRef}
        className={isSettled ? 'dnp-panel dnp-panel--open' : 'dnp-panel'}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        tabIndex={-1}
        /* The scrim's handler is the dismiss; without this a click on a row —
           or on the panel's own padding — would bubble up and close it. */
        onClick={(event) => event.stopPropagation()}
      >
        <NotificationsFeed onNavigated={onClose} />
      </div>
    </div>
  );
}

export default NotificationsPanel;

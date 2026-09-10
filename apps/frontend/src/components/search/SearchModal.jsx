// SearchModal.jsx
// Desktop search: a centred overlay, not an inline expand.
//
// The inline-expanding field it replaces had one problem that could not be
// fixed by styling it better — there was nowhere to put results. A field in a
// 56px header can show a query and nothing else, so the moment search had to
// answer with trending items and live results it needed its own surface. This
// is that surface.
//
// GSAP drives both, per the motion spec:
//   scrim   150ms opacity
//   dialog  240ms opacity and scale 0.97 → 1, reversed on close
// Transform and opacity only. Reduced motion collapses the durations through
// `seconds()` rather than skipping the tweens, so onComplete still fires and
// the unmount that waits on it cannot stall.
//
// Dismiss: the scrim, Escape, or the X inside the field (SearchPanel owns the
// X; it clears, and an empty field on a second press closes — see onQueryChange).

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import gsap from 'gsap';
import apiClient from '../../api-client/api-client.js';
import SearchPanel from './SearchPanel.jsx';
import { seconds } from '../../design/motion.js';
import { useRotatingPlaceholder } from '../../hooks/use-rotating-placeholder/use-rotating-placeholder.js';

function SearchModal({ isOpen, onClose, city = null }) {
  const scrimRef = useRef(null);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const openerRef = useRef(null);
  const [isMounted, setIsMounted] = useState(false);
  const [query, setQuery] = useState('');
  const [promotions, setPromotions] = useState([]);
  const { prefix, term, full } = useRotatingPlaceholder();

  /*
   * Sponsored recommendations for the trending grid, fetched when the modal
   * opens rather than on mount: this component is rendered on every participant
   * screen, and a promotions request per navigation is one nobody asked for.
   * Failure is silent — search works perfectly well with no sponsored rows,
   * and an error banner over a search box would be absurd.
   */
  useEffect(() => {
    if (!isOpen) return undefined;
    let isActive = true;
    apiClient
      .get('/public/promotions')
      .then((payload) => {
        if (!isActive) return;
        const commercial = Array.isArray(payload?.commercial) ? payload.commercial : [];
        const collegeEvent = Array.isArray(payload?.collegeEvent) ? payload.collegeEvent : [];
        setPromotions([...commercial, ...collegeEvent]);
      })
      .catch(() => {
        if (isActive) setPromotions([]);
      });
    return () => {
      isActive = false;
    };
  }, [isOpen]);

  /* Mount on open; stay mounted through the close tween and unmount when it
     finishes, so the exit is actually visible. */
  useEffect(() => {
    if (isOpen) {
      openerRef.current = document.activeElement;
      /* eslint-disable-next-line react-hooks/set-state-in-effect --
         The external system is the tween timeline: the component must be in
         the tree before GSAP can animate it, and must stay there until the
         close tween reports completion. Neither is derivable from `isOpen`. */
      setIsMounted(true);
    }
  }, [isOpen]);

  /*
   * The open tween. Runs once the nodes exist.
   *
   * `.fromTo()` AND NOT `.to()`, which was tried and reverted. Starting from
   * the current value looks like the better answer for interruptibility — a
   * reopen mid-close would pick up from wherever the fade had reached instead
   * of snapping to zero first. It breaks this component. Effects are
   * double-invoked under StrictMode, so the timeline is built, killed and
   * rebuilt on an ordinary first open; `fromTo` re-plants its start values on
   * the rebuild and heals itself, while `to` inherits whatever the killed
   * tween left behind and the modal opens at opacity 0 — reproduced here, a
   * blank scrim over a dialog that never faded in.
   *
   * The cost is a small snap if you reopen while the close is still running,
   * which is a rare gesture and a self-correcting one. A modal that sometimes
   * does not appear at all is not a trade worth making.
   */
  useEffect(() => {
    if (!isOpen || !isMounted) return undefined;
    const scrim = scrimRef.current;
    const dialog = dialogRef.current;
    if (!scrim || !dialog) return undefined;

    const tween = gsap.timeline();
    tween
      .fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: seconds('quick'), ease: 'power2.out' })
      .fromTo(
        dialog,
        { opacity: 0, scale: 0.97 },
        { opacity: 1, scale: 1, duration: seconds('move'), ease: 'power2.out' },
        0,
      );
    return () => tween.kill();
  }, [isOpen, isMounted]);

  /* The close tween, then unmount. */
  useEffect(() => {
    if (isOpen || !isMounted) return undefined;
    const scrim = scrimRef.current;
    const dialog = dialogRef.current;
    if (!scrim || !dialog) {
      setIsMounted(false);
      return undefined;
    }
    const tween = gsap.timeline({
      onComplete: () => {
        setIsMounted(false);
        setQuery('');
      },
    });
    tween
      .to(dialog, {
        opacity: 0,
        scale: 0.97,
        duration: seconds('exit'),
        ease: 'power2.in',
      })
      .to(scrim, { opacity: 0, duration: seconds('quick'), ease: 'power2.in' }, 0);
    /* A reopen interrupting this close is healed by the open tween's fromTo,
       which re-plants both ends; nothing needs settling here. */
    return () => tween.kill();
  }, [isOpen, isMounted]);

  /* Focus in, focus back, Escape, and the page behind held still. */
  useEffect(() => {
    if (!isMounted) return undefined;
    const opener = openerRef.current;

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
      if (opener && typeof opener.focus === 'function') {
        opener.focus({ preventScroll: true });
      }
    };
  }, [isMounted, onClose]);

  /*
   * The X clears the field; pressing it again on an already-empty field closes
   * the modal. One control, and it always does the less destructive thing
   * first — clearing a long query by accident is the more annoying mistake.
   */
  const handleQueryChange = useCallback(
    (next) => {
      if (next === '' && query === '') {
        onClose();
        return;
      }
      setQuery(next);
    },
    [query, onClose],
  );

  if (!isMounted) return null;

  return createPortal(
    <div className="dsm-root" role="presentation">
      <div ref={scrimRef} className="dsm-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        className="dsm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        tabIndex={-1}
      >
        <SearchPanel
          query={query}
          onQueryChange={handleQueryChange}
          onDismiss={onClose}
          placeholder={full}
          placeholderPrefix={prefix}
          placeholderTerm={term}
          city={city}
          promotions={promotions}
          inputRef={inputRef}
        />
      </div>
    </div>,
    document.body,
  );
}

export default SearchModal;

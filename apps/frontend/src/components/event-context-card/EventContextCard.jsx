// EventContextCard.jsx
// The strip at the top of every screen in the registration flow.
//
// WHAT IT IS FOR. A student arrives here from a grid of forty near-identical
// cards, and the single most expensive mistake this flow can produce is filling
// a form in for the wrong event — expensive because it ends in a payment. The
// poster and the name staying on screen for the whole form is the cheapest
// possible guard against that, so this is sticky and never scrolls away.
//
// WHY IT COLLAPSES. Sticky chrome on a phone is rented space: at 48px of
// thumbnail plus two lines of text it costs about a fifth of a 667px viewport,
// which is a lot to spend permanently on something a person reads once. Past a
// short scroll it drops to the two facts that still matter mid-form — what this
// is, and what it costs — on a single line. Everything else is recoverable by
// scrolling back up.
//
// It is deliberately NOT a link. It sits above a form somebody is part-way
// through; a tap that navigated away from a half-filled registration would lose
// their answers, and it would be the easiest thing on the screen to hit.

import { useEffect, useRef, useState } from 'react';

/* Past this many pixels of scroll the card collapses. Roughly the height of the
   card itself, so it compacts once it has been scrolled past rather than
   twitching on the first few pixels of a rubber-band scroll. */
const COLLAPSE_AFTER_PX = 72;

function readInitial(eventName) {
  const letter = (eventName ?? '').match(/\p{L}/u);
  return letter ? letter[0].toUpperCase() : '?';
}

function EventContextCard({ event, festName, priceLabel, typeLabel }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  // The scroll position is read in a listener rather than held in state per
  // frame: setting state on every scroll event re-renders the whole form
  // underneath this card, and the card only has two visual states.
  const collapsedRef = useRef(false);

  useEffect(() => {
    function onScroll() {
      const next = window.scrollY > COLLAPSE_AFTER_PX;
      if (next !== collapsedRef.current) {
        collapsedRef.current = next;
        setIsCollapsed(next);
      }
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!event) {
    return null;
  }

  return (
    <div className={isCollapsed ? 'drg-context drg-context--collapsed' : 'drg-context'}>
      <div className="drg-context__inner">
        <span className="drg-context__thumb" aria-hidden="true">
          {event.posterImageUrl ? (
            <img src={event.posterImageUrl} alt="" />
          ) : (
            <span className="drg-context__thumb-fallback">{readInitial(event.eventName)}</span>
          )}
        </span>

        <span className="drg-context__text">
          <p className="drg-context__name">{event.eventName}</p>
          {/* Dropped when collapsed by CSS, not unmounted — remounting the row
              mid-scroll would make the card flicker as it compacts. */}
          <p className="drg-context__meta">
            {festName ? <span>{festName}</span> : null}
            {typeLabel ? <span>{typeLabel}</span> : null}
          </p>
        </span>

        {priceLabel ? <span className="drg-context__price">{priceLabel}</span> : null}
      </div>
    </div>
  );
}

export default EventContextCard;

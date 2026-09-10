// ScrollToTop.jsx
// Every push navigation starts at the top of the new page.
//
// WHY THIS DID NOT EXIST AND WHY IT HAD TO.
//
// The browser keeps the window's scroll offset across a client-side route
// change, because as far as it is concerned nothing navigated. Open a fest from
// halfway down the feed and the fest page opens halfway down too: the poster,
// the name and the dates are all above the fold you land on, and the first
// thing you see is a slab of event cards with no idea what you are looking at.
//
// It was worst on exactly the screens people arrive at from a long scroll — the
// feed to a fest, a fest to an event — which is why it read as "the fest page is
// broken" rather than as a missing global behaviour.
//
// BACK IS DELIBERATELY EXEMPT.
//
// Only PUSH and REPLACE reset. On POP the browser is restoring a position you
// were already at, and overriding that is the other half of this bug: you scroll
// two thirds down a feed, open something, come back, and are returned to the
// top of a list you have already read. `useNavigationType()` is what tells the
// difference; there is no way to infer it from the pathname.
//
// WHY `instant` AND NOT SMOOTH.
//
// A smooth scroll here would animate the OUTGOING page down to zero while the
// route is changing, which is a second animation fighting the view transition
// for the same 200ms. The jump is invisible anyway: it happens before paint, on
// a page that has not been shown yet.

import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === 'POP') {
      return;
    }
    /*
     * The window AND the document element. Some screens scroll the window and
     * some put the scroll on a full-height wrapper; setting both costs nothing
     * and means a new screen does not have to remember which kind it is.
     */
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (document.scrollingElement) {
      document.scrollingElement.scrollTop = 0;
    }
  }, [pathname, navigationType]);

  return null;
}

export default ScrollToTop;

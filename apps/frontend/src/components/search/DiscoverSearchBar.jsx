// DiscoverSearchBar.jsx
// The search entry point on MOBILE. Desktop uses the magnifier in the header,
// which opens the modal — see AppHeader.
//
// The two do not overlap: search.css hides this bar at ≥1024px and the header
// icon is hidden below it, so at any given width there is exactly one way in.
//
// IT IS A BUTTON THAT LOOKS LIKE A FIELD, and that is deliberate rather than
// lazy. Making it a real input would open a keyboard against a screen with
// nowhere to put results, and then have to hand focus to a second field on the
// next surface — the transition people notice as a stutter.
//
// It goes to /search, a real page with a real keyboard, rather than opening a
// modal: on a phone a modal is a full-screen page wearing a scrim, with a
// browser back button that dismisses the whole app instead of the search.

import { useNavigate } from 'react-router-dom';
import RotatingPlaceholder from './RotatingPlaceholder.jsx';
import { useRotatingPlaceholder } from '../../hooks/use-rotating-placeholder/use-rotating-placeholder.js';
import './search.css';

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DiscoverSearchBar() {
  const navigate = useNavigate();
  const { prefix, term } = useRotatingPlaceholder();
  return (
    <button
      type="button"
      className="dsb-bar"
      onClick={() => navigate('/search')}
      /* The label is stable while the visible text rotates: a screen reader
         should not hear the control rename itself every three seconds. */
      aria-label="Search fests and events"
    >
      <SearchGlyph />
      <span className="dsb-bar__text">
        <RotatingPlaceholder prefix={prefix} term={term} />
      </span>
    </button>
  );
}

export default DiscoverSearchBar;

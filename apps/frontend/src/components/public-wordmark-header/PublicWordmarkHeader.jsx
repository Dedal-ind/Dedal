// PublicWordmarkHeader.jsx
// The header shared by the public college-onboarding pages — /for-colleges,
// /register-college, its success screen and the application-status screen.
//
// No back arrow and no account control, because a visitor here may have arrived
// cold from a search or a flyer and has nowhere to go back to and no session to
// show. The wordmark is the only thing in it, and it is a link to
// /for-colleges, so every page in the flow has a way home.
//
// WHAT CHANGED, AND WHAT DELIBERATELY DID NOT. The header now draws the real
// DedalWordmark component — the SVG with the --primary thread through the two d
// counters — instead of setting the string "dedal" in a display face, and it
// takes its surface, divider and height from the design tokens. Its PUBLIC API
// is untouched: it still takes no props, still renders one <header>, still
// links to the same route. The three screens this file does not own can adopt
// the rest of the design system on their own schedule without this changing
// under them again.
//
// The 22px size is deliberate and is the one number here that is not a token:
// DedalWordmark drops its thread below 20px (the counters stop being counters
// at that size), so a header mark has to sit above that line. 22px clears it by
// enough that the mark survives a user zoom of the root font size.
//
// Styles: design/for-colleges.css, `.dfc-hdr`, loaded at the root from main.jsx.

import { Link } from 'react-router-dom';
import DedalWordmark from '../dedal-wordmark/DedalWordmark.jsx';

function PublicWordmarkHeader() {
  return (
    <header className="dfc-hdr">
      <Link to="/for-colleges" className="dfc-hdr__home" aria-label="dedal — home">
        {/* The SVG carries its own aria-label; the link's own label wins, so the
            mark is hidden from the name rather than doubling it. */}
        <DedalWordmark size={22} title="dedal" />
      </Link>
    </header>
  );
}

export default PublicWordmarkHeader;

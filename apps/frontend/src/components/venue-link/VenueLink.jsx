// VenueLink.jsx
// The venue, as a link to Google Maps.
//
// One component rather than the same anchor pasted into six screens, because
// the fallback is the part that is easy to get wrong: an event with no venue
// text must render as PLAIN TEXT, never as an anchor pointing at an empty Maps
// search. Centralising it means that decision is made once.
//
// Two shapes:
//
//   inline (default)  a underlined run of text for use mid-sentence or inside a
//                     dense row, which is what most screens want.
//   button            a full-width control for a screen where the venue is a
//                     thing you ACT on rather than a fact you read.
//
// The button shape exists because the inline one was being asked to do a job it
// could not. On the event page the pin sat inside the link text with its own
// font-size, so the glyph rode above the label's baseline and the underline ran
// beneath both — the icon never lined up with anything, at any size. Putting the
// mark in its own fixed box, vertically centred against the label, is what
// actually fixes the alignment; nudging the font-size never would have.

import { buildMapsUrl } from '../../helpers/venue-map-link.js';

function VenueLink({
  venue,
  className = '',
  iconSize = 14,
  fallbackText = '',
  variant = 'inline',
}) {
  const mapsUrl = buildMapsUrl(venue);

  if (!mapsUrl) {
    return <span className={className}>{venue || fallbackText}</span>;
  }

  const sharedProps = {
    href: mapsUrl,
    target: '_blank',
    rel: 'noopener noreferrer',
    // Stops the link from triggering an enclosing card's onClick — several of
    // these sit inside tappable rows that navigate elsewhere.
    onClick: (clickEvent) => clickEvent.stopPropagation(),
  };

  if (variant === 'button') {
    return (
      <a
        {...sharedProps}
        className={[
          'press-card group flex w-full items-center gap-3 rounded-2xl border border-outline-variant',
          'bg-surface-container-lowest p-3 text-left no-underline',
          'hover:border-olive-accent/60 hover:bg-surface-container',
          className,
        ].join(' ')}
      >
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-olive-accent/12"
          aria-hidden="true"
        >
          <span className="material-symbols-outlined text-[20px] text-olive-accent">
            location_on
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block font-body text-[11px] leading-4 text-on-surface-variant">
            Venue
          </span>
          <span className="block truncate font-body text-[15px] font-medium leading-5 text-on-surface">
            {venue}
          </span>
        </span>

        <span
          className="material-symbols-outlined shrink-0 text-[18px] text-outline transition-transform duration-200 group-hover:translate-x-0.5"
          aria-hidden="true"
        >
          arrow_outward
        </span>
      </a>
    );
  }

  return (
    <a
      {...sharedProps}
      className={[
        'inline-flex items-center gap-1 underline underline-offset-2',
        'text-secondary active:opacity-70',
        className,
      ].join(' ')}
    >
      <span
        className="material-symbols-outlined shrink-0"
        style={{ fontSize: `${iconSize + 2}px` }}
        aria-hidden="true"
      >
        location_on
      </span>
      <span>{venue}</span>
    </a>
  );
}

export default VenueLink;

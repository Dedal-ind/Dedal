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

import { ExternalLink, MapPin } from 'lucide-react';
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
          'press-card group flex w-full items-center gap-3 rounded-2xl border border-[var(--divider)]',
          'bg-[var(--surface-card)] p-3 text-left no-underline',
          'hover:border-[var(--ink-dim-2)] hover:bg-[var(--ink-dim-4)]',
          className,
        ].join(' ')}
      >
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ink-dim-4)]"
          aria-hidden="true"
        >
          <MapPin size={20} className="text-[var(--primary)]" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block font-[family-name:var(--font)] text-[11px] leading-4 text-[var(--muted)]">
            Venue
          </span>
          <span className="block truncate font-[family-name:var(--font)] text-[15px] font-medium leading-5 text-[var(--ink)]">
            {venue}
          </span>
        </span>

        <ExternalLink
          size={18}
          className="shrink-0 text-[var(--muted)] transition-transform duration-200 group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </a>
    );
  }

  return (
    <a
      {...sharedProps}
      className={[
        'inline-flex items-center gap-1 underline underline-offset-2',
        'text-[var(--ink)] active:opacity-70',
        className,
      ].join(' ')}
    >
      <MapPin size={iconSize + 2} className="shrink-0" aria-hidden="true" />
      <span>{venue}</span>
    </a>
  );
}

export default VenueLink;

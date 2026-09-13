// promotion-destination.js
// Where a tap on a sponsor card goes.
//
//   1. The promotion's own destination URL (linkUrl), in a new tab.
//   2. Otherwise, for a YouTube or Vimeo video promotion, that video on its own
//      site, in a new tab.
//   3. Otherwise the fest the sponsor is attached to, inside the app.
//   4. Otherwise nowhere — the card is a billboard, not a control.
//
// The video is promotional content, not the destination: when the promotion
// names a destination, the tap goes there, not to YouTube. Only a promotion with
// no destination sends the viewer to watch the video. Nothing plays inline — no
// player, no modal, no lightbox.
//
// ONE RULE FOR EVERY SPONSOR SURFACE (feed card, hero, fest-page slot), so a
// promotion does not go somewhere different depending on where it was placed.
//
// TODO(click-redirect): when the server-side click redirect exists, the external
// cases should open that redirect URL (which records the click and forwards)
// instead of the target directly. Clicks are still reported today through the
// delivery reporter before navigating.

import { describeVideoSource, isLinkedVideoSource } from '@dedal/shared';

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function resolvePromotionDestination(promotion) {
  const linkUrl = typeof promotion?.linkUrl === 'string' ? promotion.linkUrl.trim() : '';
  /* A value that is not a real http(s) URL is not a destination — opening it
     would be a javascript: link or a relative path into the app. */
  if (linkUrl && isHttpUrl(linkUrl)) {
    return { kind: 'external', url: linkUrl };
  }

  if (promotion?.mediaType === 'video' && promotion?.videoUrl) {
    const videoSource = describeVideoSource(promotion.videoUrl);
    if (isLinkedVideoSource(videoSource)) {
      return { kind: 'external', url: videoSource.watchUrl };
    }
  }

  const festSlug = promotion?.festSlug ?? promotion?.fest?.festSlug ?? null;
  if (festSlug) {
    return { kind: 'fest', festSlug };
  }
  return null;
}

export function openPromotionDestination(destination, onOpenFest) {
  if (!destination) {
    return;
  }
  if (destination.kind === 'external') {
    window.open(destination.url, '_blank', 'noopener,noreferrer');
    return;
  }
  onOpenFest?.(destination.festSlug);
}

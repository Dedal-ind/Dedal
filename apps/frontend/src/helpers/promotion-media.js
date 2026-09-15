// promotion-media.js
// What a promotion's creative shows, and which viewability standard measures it.
//
// A promotion has exactly two kinds of media:
//   · image — its image.
//   · video — an uploaded video file, played natively (autoplay, muted), with
//             the image as its poster frame.
//
// A video creative whose videoUrl is anything other than an uploaded file (a
// link to a video site, a page, a typo) has NO media: the surface shows its
// fallback wash with the promotion's title, and nothing is loaded from the link.
//
// Only a video that actually plays gets the two-second video dwell; measuring a
// still against the video standard would tell the sponsor a video was watched.

import { isPlayableVideoUrl } from './playable-video.js';

/* The 11-character id from any common YouTube link shape, or null. Embeds are
   gone; the id is only used to build a still thumbnail. */
export function readYouTubeVideoId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/)?.[1];
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export function resolvePromotionMedia(creative) {
  if (creative?.mediaType === 'video') {
    if (isPlayableVideoUrl(creative.videoUrl)) {
      return { imageUrl: creative.imageUrl || null, videoUrl: creative.videoUrl, hasMedia: true };
    }
    /* Not a playable file. A YouTube link becomes its thumbnail; anything else
       falls back to the creative's own image, and only then to the wash. */
    const youTubeId = readYouTubeVideoId(creative.videoUrl);
    const imageUrl = youTubeId
      ? `https://img.youtube.com/vi/${youTubeId}/maxresdefault.jpg`
      : creative.imageUrl || null;
    return { imageUrl, videoUrl: null, hasMedia: Boolean(imageUrl) };
  }
  const imageUrl = creative?.imageUrl || null;
  return { imageUrl, videoUrl: null, hasMedia: Boolean(imageUrl) };
}

export function viewabilityMediaTypeFor(creative) {
  return resolvePromotionMedia(creative).videoUrl ? 'video' : 'image';
}

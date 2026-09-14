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

export function resolvePromotionMedia(creative) {
  if (creative?.mediaType === 'video') {
    if (isPlayableVideoUrl(creative.videoUrl)) {
      return { imageUrl: creative.imageUrl || null, videoUrl: creative.videoUrl, hasMedia: true };
    }
    return { imageUrl: null, videoUrl: null, hasMedia: false };
  }
  const imageUrl = creative?.imageUrl || null;
  return { imageUrl, videoUrl: null, hasMedia: Boolean(imageUrl) };
}

export function viewabilityMediaTypeFor(creative) {
  return resolvePromotionMedia(creative).videoUrl ? 'video' : 'image';
}

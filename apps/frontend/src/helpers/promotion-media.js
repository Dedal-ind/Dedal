// promotion-media.js
// Which viewability standard a promotion's creative is measured against.
//
// Only a DIRECT video file actually plays in the card, so only it gets the
// two-second video dwell. A YouTube or Vimeo link is shown as its thumbnail — an
// image — and is measured as one, as is a video link that names nothing
// playable. Measuring a still thumbnail against the video standard would make
// the sponsor's report claim a video was watched when it was never played.

import { VIDEO_SOURCE_KINDS, describeVideoSource } from '@dedal/shared';

export function viewabilityMediaTypeFor(creative) {
  if (creative?.mediaType !== 'video' || !creative?.videoUrl) {
    return 'image';
  }
  return describeVideoSource(creative.videoUrl)?.kind === VIDEO_SOURCE_KINDS.DIRECT ? 'video' : 'image';
}

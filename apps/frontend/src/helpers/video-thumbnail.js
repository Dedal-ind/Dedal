// video-thumbnail.js
// Which image to show for a linked (YouTube / Vimeo) video, and how to tell
// when YouTube has quietly handed back nothing.
//
// THE MISSING-MAXRES TRAP. Not every YouTube video has a maxresdefault.jpg.
// When it is missing, YouTube does not fail the request in a way an <img> can
// see: it answers with a 120×90 grey placeholder and an HTTP 404, but the body
// is a perfectly valid JPEG, so the browser fires `load`, not `error`. An
// onError fallback alone would therefore never fall back, and every such card
// would show a tiny grey rectangle stretched across the frame. So a loaded
// YouTube thumbnail no wider than that placeholder is treated as missing.

const YOUTUBE_THUMBNAIL_HOST = 'img.youtube.com';
const YOUTUBE_PLACEHOLDER_MAX_WIDTH = 120;

/* The images to try, best first, with duplicates and empties removed. */
export function listThumbnailCandidates(source, posterUrl) {
  const candidates = [source?.thumbnailUrl, source?.fallbackThumbnailUrl, posterUrl];
  return candidates.filter(
    (candidate, index) => Boolean(candidate) && candidates.indexOf(candidate) === index,
  );
}

export function isMissingYouTubeThumbnail(imageUrl, naturalWidth) {
  if (typeof imageUrl !== 'string' || !imageUrl.includes(`//${YOUTUBE_THUMBNAIL_HOST}/`)) {
    return false;
  }
  return Number.isFinite(naturalWidth) && naturalWidth > 0 && naturalWidth <= YOUTUBE_PLACEHOLDER_MAX_WIDTH;
}

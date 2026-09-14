// playable-video.js
// Whether a video URL is something the app can play: an uploaded video file.
//
// Video plays in a native <video> element and nowhere else. Uploads come back
// from POST /uploads as absolute URLs whose object name ends in the file's own
// extension (.mp4, .webm, .mov — see buildFileName on the server), so that is
// the whole test. A link to a page on a video site is not a file: it is never
// embedded, never thumbnailed, and never loaded. It is simply not a video.

const PLAYABLE_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov'];

export function isPlayableVideoUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return false;
  }
  const path = url.pathname.toLowerCase();
  return PLAYABLE_VIDEO_EXTENSIONS.some((extension) => path.endsWith(extension));
}

// google-photo-url.js
// Google serves profile photos from googleusercontent.com with a size directive
// baked into the path — the `=s96-c` style suffix the ID token's `picture` claim
// arrives with. Asking for the size we actually render beats downloading a 96px
// image for a 72px slot, or worse, stretching one across a retina screen.
// Pure string work; anything that is not a Google photo URL passes through
// untouched, so callers can hand it any avatar URL.

const GOOGLE_PHOTO_HOST = 'googleusercontent.com';

/*
 * Ask Google for a square photo at `targetSize` CSS pixels.
 *
 * The suffix is doubled for retina: a 32px avatar requests s64 so the image is
 * still sharp at 2x. `-c` crops to a centred square, which is what UserAvatar's
 * circular frame wants — without it a non-square original is letterboxed and
 * then clipped by the circle. (The crop originally served the retired brutalist
 * system's hard-bordered square frame; it is just as necessary now.)
 *
 * The existing directive is replaced rather than appended: Google's URLs already
 * carry one, and two `=s...` segments make the URL invalid.
 */
export function normalizeGooglePhotoUrl(url, targetSize) {
  if (typeof url !== 'string' || !url.includes(GOOGLE_PHOTO_HOST)) {
    return url;
  }
  const requestedSize = targetSize * 2;
  const baseUrl = url.split('=')[0];
  return `${baseUrl}=s${requestedSize}-c`;
}

export default normalizeGooglePhotoUrl;

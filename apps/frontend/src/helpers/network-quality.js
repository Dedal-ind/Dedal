// network-quality.js
// Whether the connection is too slow to spend on in-feed video.
//
// On 2G or slow-2G a looping video preview is not a preview — it is a stall that
// eats the participant's data for something they never asked to watch. So an
// in-feed video file shows its poster instead of attaching a source.
//
// navigator.connection is Chromium-only. Where it is missing the answer is
// "not constrained", because an unknown connection is far more often a fast one
// (Safari on wifi) than a slow one, and refusing video everywhere the API is
// absent would switch it off for every iPhone.

const CONSTRAINED_EFFECTIVE_TYPES = new Set(['slow-2g', '2g']);

export function isConstrainedConnection() {
  const connection = typeof navigator !== 'undefined' ? navigator.connection : undefined;
  return Boolean(connection && CONSTRAINED_EFFECTIVE_TYPES.has(connection.effectiveType));
}

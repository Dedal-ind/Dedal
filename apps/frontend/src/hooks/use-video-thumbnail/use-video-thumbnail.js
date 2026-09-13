// use-video-thumbnail.js
// Steps through a linked video's images — maxres, then hq, then the creative's
// poster — until one loads, and reports when none did.
//
// Shared by the participant card and the admin preview, so both show the same
// image for the same video. The decisions live in helpers/video-thumbnail.js;
// this only holds the position in the list.
//
// The position resets when the list changes (a different video in the same
// slot), adjusted during render rather than in an effect so the stale image is
// never painted for a frame first.

import { useCallback, useState } from 'react';
import { listThumbnailCandidates } from '../../helpers/video-thumbnail.js';

export function useVideoThumbnail(source, posterUrl) {
  const candidates = listThumbnailCandidates(source, posterUrl);
  const candidatesKey = candidates.join('|');
  const [position, setPosition] = useState({ key: candidatesKey, index: 0 });

  let index = position.index;
  if (position.key !== candidatesKey) {
    setPosition({ key: candidatesKey, index: 0 });
    index = 0;
  }

  /* Move to the next candidate: called on error, and on a load that turned out
     to be YouTube's placeholder. */
  const advance = useCallback(() => {
    setPosition((previous) => ({ key: previous.key, index: previous.index + 1 }));
  }, []);

  return {
    src: candidates[index] ?? null,
    hasFailed: index >= candidates.length,
    advance,
  };
}

export default useVideoThumbnail;

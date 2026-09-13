// VideoLinkPreview.jsx
// A YouTube or Vimeo video in a card: its thumbnail and a small play mark.
// Nothing plays here. A tap on the card goes somewhere — the promotion's
// destination, or the video on its own site (helpers/promotion-destination.js).
//
// WHY NOT AN EMBED. YouTube's iframe player cannot be made to look like part of
// the card. The logo, the title, captions and the "Watch on YouTube" link all
// survive every URL parameter (modestbranding went in 2023, showinfo in 2018),
// and CSS cropping falls apart when the tab regains focus and YouTube redraws
// its chrome. Every workaround added weight — an observer, a click shield, a
// single-player slot, a crop — to chase something with no solution. An image
// has none of those problems: no third-party page, no chrome to re-render when
// the tab comes back, and about 50KB on the slowest connection.
//
// The play mark is ours, not YouTube's red button: a 48px white disc at 80% with
// a 20px triangle, so a video card reads as a card with a play indicator rather
// than a borrowed player. It is decoration — the card around it is the control.
//
// An unplayable link (a channel page, a malformed id) shows a plain "Invalid
// video URL" placeholder and no play mark: there is nothing to play, and a play
// mark would promise otherwise.

import { Play } from 'lucide-react';
import { VIDEO_SOURCE_KINDS, describeVideoSource, isLinkedVideoSource } from '@dedal/shared';
import { useVideoThumbnail } from '../../hooks/use-video-thumbnail/use-video-thumbnail.js';
import { isMissingYouTubeThumbnail } from '../../helpers/video-thumbnail.js';
import './video-link-preview.css';

function VideoLinkPreview({ videoUrl, posterUrl = null, alt = '', shouldLoad = true, onRendered }) {
  const source = describeVideoSource(videoUrl);
  const isLinked = isLinkedVideoSource(source);
  const thumbnail = useVideoThumbnail(isLinked ? source : null, posterUrl);

  if (source?.kind === VIDEO_SOURCE_KINDS.INVALID) {
    return (
      <div className="dvp dvp--invalid">
        <span className="dvp__invalid">Invalid video URL</span>
      </div>
    );
  }

  if (!isLinked) {
    return null;
  }

  function handleLoad(loadEvent) {
    if (isMissingYouTubeThumbnail(thumbnail.src, loadEvent.currentTarget.naturalWidth)) {
      thumbnail.advance();
      return;
    }
    /* Only a real image counts as the rendered creative. */
    onRendered?.();
  }

  return (
    <div className="dvp">
      {thumbnail.hasFailed ? (
        <span className="dvp__blank" aria-hidden="true" />
      ) : (
        <img
          className="dvp__image"
          /* No src until the card is near, the same loading rule as every image
             in the feed. */
          src={shouldLoad ? (thumbnail.src ?? undefined) : undefined}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={handleLoad}
          onError={thumbnail.advance}
        />
      )}
      <span className="dvp__play" aria-hidden="true">
        <Play size={20} fill="currentColor" strokeWidth={0} />
      </span>
    </div>
  );
}

export default VideoLinkPreview;

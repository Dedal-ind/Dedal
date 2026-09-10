// PromotionSlot.jsx
// A single promotion from the decision engine, for non-carousel placements.
// Fetches one decision, renders the creative, and reports measurable/viewable/click
// exactly as the carousel does — same hook, same reporter.
//
// Renders NOTHING on no-fill, on error, on offline, and while loading.
// No spinner, no placeholder, no gap. A promotion is never content the
// participant is waiting for.

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDecision, toPromotionSlide } from '../../helpers/decision-session.js';
import { useViewability } from '../../hooks/use-viewability/use-viewability.js';
import { reportDeliveryEvent, DELIVERY_EVENT_KINDS } from '../../helpers/delivery-reporter.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';

function PromotionSlot({ placementKey }) {
  const { isAuthenticated } = useAuthentication();
  const [slide, setSlide] = useState(null);
  const [hasImageFailed, setHasImageFailed] = useState(false);
  const frameRef = useRef(null);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || requestedRef.current) return;
    requestedRef.current = true;
    let active = true;
    fetchDecision(placementKey).then((result) => {
      if (active && result.fill && result.decision) {
        setSlide(toPromotionSlide(result.decision));
      }
    });
    return () => { active = false; };
  }, [isAuthenticated, placementKey]);

  const decisionToken = slide?.decisionToken ?? null;

  useViewability({
    elementRef: frameRef,
    decisionKey: decisionToken,
    mediaType: slide?.mediaType === 'video' ? 'video' : 'image',
    onViewable: useCallback((token) => reportDeliveryEvent(token, DELIVERY_EVENT_KINDS.VIEWABLE), []),
  });

  function handleMediaRendered() {
    if (decisionToken) {
      reportDeliveryEvent(decisionToken, DELIVERY_EVENT_KINDS.MEASURABLE);
    }
  }

  function handleClick() {
    if (decisionToken) {
      reportDeliveryEvent(decisionToken, DELIVERY_EVENT_KINDS.CLICK);
    }
  }

  if (!slide) return null;

  const isVideo = slide.mediaType === 'video' && Boolean(slide.videoUrl);

  const artwork = isVideo ? (
    <video
      src={slide.videoUrl}
      poster={slide.imageUrl || undefined}
      controls
      playsInline
      muted
      preload="metadata"
      onLoadedData={handleMediaRendered}
      className="h-full w-full object-cover"
    >
      {slide.title}
    </video>
  ) : slide.imageUrl && !hasImageFailed ? (
    <img
      src={slide.imageUrl}
      alt={slide.title}
      loading="lazy"
      onLoad={handleMediaRendered}
      onError={() => setHasImageFailed(true)}
      className="h-full w-full object-cover"
    />
  ) : null;

  if (!artwork) return null;

  const hasLink = Boolean(slide.linkUrl) && !isVideo;

  return (
    <div ref={frameRef} className="overflow-hidden rounded-heritage bg-surface-container">
      <div className="h-[200px] w-full">
        {hasLink ? (
          <a
            href={slide.linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClick}
            className="block h-full w-full"
          >
            {artwork}
          </a>
        ) : (
          artwork
        )}
      </div>
      {isVideo && slide.linkUrl ? (
        <a
          href={slide.linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClick}
          className="block px-3 py-2 font-body text-[12px] font-semibold text-olive-accent underline"
        >
          Learn more
        </a>
      ) : null}
    </div>
  );
}

export default PromotionSlot;

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
import { useNearViewport } from '../../hooks/use-feed-observer/use-feed-observer.js';
import { reportDeliveryEvent, DELIVERY_EVENT_KINDS } from '../../helpers/delivery-reporter.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { resolvePromotionDestination } from '../../helpers/promotion-destination.js';
import { resolvePromotionMedia, viewabilityMediaTypeFor } from '../../helpers/promotion-media.js';

function PromotionSlot({ placementKey }) {
  const { isAuthenticated } = useAuthentication();
  const [slide, setSlide] = useState(null);
  const [hasImageFailed, setHasImageFailed] = useState(false);
  const frameRef = useRef(null);
  const requestedRef = useRef(false);
  /* Nothing loads until the slot is near the viewport: preload none, no src. */
  const [isNear, setIsNear] = useState(false);
  const markNear = useCallback(() => setIsNear(true), []);

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
  useNearViewport(frameRef, markNear, Boolean(slide) && !isNear);

  useViewability({
    elementRef: frameRef,
    decisionKey: decisionToken,
    /* Only an uploaded video file plays, so only it is measured as video. */
    mediaType: viewabilityMediaTypeFor(slide),
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

  /* An image, an uploaded video file, or — for anything else — the fallback
     wash with the title. See helpers/promotion-media.js. */
  const media = resolvePromotionMedia(slide);
  const isVideo = Boolean(media.videoUrl);

  const artwork = isVideo ? (
    <video
      src={isNear ? media.videoUrl : undefined}
      poster={media.imageUrl || undefined}
      autoPlay
      muted
      loop
      playsInline
      controls
      preload={isNear ? 'metadata' : 'none'}
      onLoadedData={handleMediaRendered}
      className="h-full w-full object-cover"
    >
      {slide.title}
    </video>
  ) : media.imageUrl && !hasImageFailed ? (
    <img
      src={media.imageUrl}
      alt={slide.title}
      loading="lazy"
      onLoad={handleMediaRendered}
      onError={() => setHasImageFailed(true)}
      className="h-full w-full object-cover"
    />
  ) : (
    /* Not the sponsor's artwork, so it reports no measurable impression. */
    <div className="flex h-full w-full items-end bg-[var(--ink)] p-4">
      <span className="font-[family-name:var(--font)] text-[16px] font-semibold leading-snug text-white">{slide.title}</span>
    </div>
  );

  /*
   * A video keeps its own controls, so its link moves to the Learn more line
   * below. Everything else is itself the link, to the same destination the feed
   * card uses.
   */
  const destination = isVideo ? null : resolvePromotionDestination(slide);
  const destinationUrl = destination?.kind === 'external' ? destination.url : null;

  return (
    <div ref={frameRef} className="overflow-hidden rounded-[var(--r-card)] bg-[var(--ink-dim-4)]">
      <div className="h-[200px] w-full">
        {destinationUrl ? (
          <a
            href={destinationUrl}
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
          className="block px-3 py-2 font-[family-name:var(--font)] text-[12px] font-semibold text-[var(--primary)] underline"
        >
          Learn more
        </a>
      ) : null}
    </div>
  );
}

export default PromotionSlot;

// FeedMedia.jsx
// The 16:9 block at the top of every card in the feed — a poster, a video, or
// the fallback when a card has neither.
//
// VIDEO BEHAVIOUR, all of it:
//   · Muted autoplay when at least half the card is on screen, pause when it
//     falls below half. This is the only condition; nothing plays because it
//     was tapped and nothing keeps playing because it once was.
//   · No custom controls, and the native ones are off. A control strip over a
//     feed card is four targets competing with the card's own tap, and the
//     only control anyone actually wants here is the sound.
//   · Tap toggles mute. A glyph fades in for a moment to say which way it
//     went, because a muted tap on a silent passage is otherwise indistinguish-
//     able from a tap that did nothing.
//   · SOUND IS NEVER ON BY DEFAULT, at any point, for any reason.
//   · The progress bar is a 2px --primary rule along the bottom of the media.
//     Under reduced motion it is rendered at its current position and left
//     there rather than tracking, which is the one thing on this screen that
//     would otherwise animate continuously the whole time you read.
//
// LOADING. Nothing is fetched until the card is within 200px of the viewport,
// via the feed's shared observer. Until then a video is a poster frame and an
// image has no src at all — so a forty-card feed costs one screenful of media,
// not forty.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useHalfVisible, useNearViewport } from '../../hooks/use-feed-observer/use-feed-observer.js';
import { flashGlyph, prefersReducedMotion, stopMotion } from '../../design/motion.js';

function SpeakerIcon({ muted }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none">
      <path
        d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z"
        fill="currentColor"
      />
      {muted ? (
        <path
          d="m16 9.5 4 5m0-5-4 5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M15.6 8.8a4.2 4.2 0 0 1 0 6.4M18.2 6.4a7.6 7.6 0 0 1 0 11.2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function FeedMedia({ imageUrl, videoUrl, alt, overlay, onMediaRendered }) {
  const frameRef = useRef(null);
  const videoRef = useRef(null);
  const progressRef = useRef(null);
  const glyphRef = useRef(null);

  const [isNear, setIsNear] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [hasMediaFailed, setHasMediaFailed] = useState(false);

  const isVideo = Boolean(videoUrl) && !hasMediaFailed;
  const hasImage = Boolean(imageUrl) && !hasMediaFailed;

  const markNear = useCallback(() => setIsNear(true), []);
  useNearViewport(frameRef, markNear, !isNear);

  /*
   * Play and pause. `play()` returns a promise that REJECTS when the browser
   * declines the autoplay — a normal outcome on a page the user has not
   * interacted with — and an unhandled rejection there is a console error on
   * every card in the feed. It is caught and dropped: a video that will not
   * autoplay simply sits on its poster frame, which is a fine outcome.
   */
  const handleActiveChange = useCallback((isActive) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (isActive) {
      const played = video.play();
      if (played && typeof played.catch === 'function') {
        played.catch(() => {});
      }
    } else {
      video.pause();
    }
  }, []);

  useHalfVisible(frameRef, handleActiveChange, isVideo && isNear);

  /*
   * The progress rule. Driven by timeupdate rather than a rAF loop: timeupdate
   * fires a few times a second, which is every bit as smooth as this 2px bar
   * needs and costs nothing while the card is off screen and paused.
   *
   * Under reduced motion the bar is still positioned — you can see how far in
   * the video is — it just is not transitioned between positions.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideo) {
      return undefined;
    }
    const isReduced = prefersReducedMotion();

    function paint() {
      const bar = progressRef.current;
      if (!bar || !video.duration || Number.isNaN(video.duration)) {
        return;
      }
      const ratio = Math.min(1, Math.max(0, video.currentTime / video.duration));
      bar.style.transform = `scaleX(${ratio})`;
      bar.style.transition = isReduced ? 'none' : 'transform 240ms linear';
    }

    video.addEventListener('timeupdate', paint);
    return () => video.removeEventListener('timeupdate', paint);
  }, [isVideo]);

  /* Nothing may outlive the card: a tween writing opacity to a detached node
     is a leak that only shows up as jank after a few dozen route changes. */
  useEffect(() => {
    const glyph = glyphRef.current;
    return () => {
      if (glyph) {
        stopMotion(glyph);
      }
    };
  }, []);

  function toggleMute(clickEvent) {
    /* The card underneath is a link. A tap meant for the sound must not also
       open the fest. */
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
    if (glyphRef.current) {
      flashGlyph(glyphRef.current);
    }
  }

  let content;
  if (isVideo) {
    content = (
      <video
        ref={videoRef}
        /* No src until the card is near: a <video> with a src begins its
           network work the moment it is parsed, whatever preload says. */
        src={isNear ? videoUrl : undefined}
        poster={imageUrl || undefined}
        muted
        playsInline
        loop
        preload={isNear ? 'metadata' : 'none'}
        onLoadedData={onMediaRendered}
        onError={() => setHasMediaFailed(true)}
        className="dsc-media__el"
        tabIndex={-1}
        aria-label={alt}
      />
    );
  } else if (hasImage) {
    content = (
      <img
        src={isNear ? imageUrl : undefined}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={onMediaRendered}
        onError={() => setHasMediaFailed(true)}
        className="dsc-media__el"
      />
    );
  } else {
    /*
     * No poster, no video, or a URL that 404s. A card still has to be a card,
     * so the frame becomes the one place --accent is used at any size: a quiet
     * violet-to-ink wash carrying nothing. The name is already directly below
     * it, so repeating the title here would say it twice.
     */
    content = <div className="dsc-media__fallback" aria-hidden="true" />;
  }

  return (
    <div className="dsc-media" ref={frameRef}>
      {content}
      {overlay}
      {isVideo ? (
        <>
          <button
            type="button"
            className="dsc-media__sound"
            onClick={toggleMute}
            aria-label={isMuted ? 'Unmute video' : 'Mute video'}
            aria-pressed={!isMuted}
          />
          <span className="dsc-media__glyph" ref={glyphRef} aria-hidden="true">
            <SpeakerIcon muted={isMuted} />
          </span>
          <span className="dsc-media__progress" aria-hidden="true">
            <span className="dsc-media__progress-fill" ref={progressRef} />
          </span>
        </>
      ) : null}
    </div>
  );
}

export default FeedMedia;

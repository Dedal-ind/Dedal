// FeedHero.jsx
// The single item at the top of Discover. Not a carousel.
//
// WHAT IT SHOWS, in strict order:
//   1. a fest that is running RIGHT NOW — always, and with a pulsing Live mark
//   2. otherwise the next fest to start
//   3. otherwise a promotion, if one is available
//   4. otherwise nothing at all
//
// The order is a claim about what matters. Something happening today beats
// something happening in March however good the poster is, and a promotion
// only gets the largest element on the screen when there is genuinely no fest
// to put there — which is also the only circumstance in which a person opening
// this app would rather see an advertisement than an empty space.
//
// The hero reuses FeedMedia, so a hero video autoplays, pauses and mutes by
// exactly the same rules as a video in a card. There is no second
// implementation of any of that here.
//
// A hero promotion reports measurable, viewable and click through the same
// hook and the same reporter as a promotion card. It is a bigger box; it is
// not a different kind of thing.

import { openPromotionDestination, resolvePromotionDestination } from '../../helpers/promotion-destination.js';
import { resolvePromotionMedia, viewabilityMediaTypeFor } from '../../helpers/promotion-media.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../../design/motion.js';
import { useViewability } from '../../hooks/use-viewability/use-viewability.js';
import { DELIVERY_EVENT_KINDS, reportDeliveryEvent } from '../../helpers/delivery-reporter.js';
import FeedMedia from '../feed-media/FeedMedia.jsx';
import {
  formatFeedDateRange,
  formatHostLine,
  readHostCollege,
} from '../../helpers/feed-format.js';

function LiveMark({ onScrim = false }) {
  return (
    <span className={onScrim ? 'dsc-live dsc-live--onscrim' : 'dsc-live'}>
      <span className="dsc-live__dot" aria-hidden="true" />
      Live now
    </span>
  );
}

function FestHero({ fest, isLive, nowTs, onOpen }) {
  const { name: collegeName, city } = readHostCollege(fest);
  const host = formatHostLine(collegeName, city);
  const dates = formatFeedDateRange(fest.startsOn, fest.endsOn, nowTs);

  return (
    <section className="dsc-hero">
      <button type="button" className="dsc-hero__hit" onClick={onOpen}>
        <FeedMedia
          imageUrl={fest.bannerImageUrl}
          videoUrl={fest.bannerVideoUrl ?? fest.videoUrl}
          alt=""
          overlay={
            <div className="dsc-hero__scrim">
              {/*
                * LIVE SITS TOP LEFT, out of the text block at the foot.
                *
                * It used to be the first line of the scrim stack, directly
                * above the fest name — so the largest type on the home page
                * was introduced by a small pill, and the badge moved down the
                * poster as the title wrapped to two lines. It is state, not a
                * heading's kicker: it belongs at the entry corner of the image
                * where it is fixed and readable at a glance, matching the grid
                * cards below it.
                */}
              {isLive ? <LiveMark onScrim /> : null}
              <h2 className="dsc-hero__title">{fest.festName}</h2>
              {host ? <p className="dsc-hero__host">{host}</p> : null}
              {dates ? <p className="dsc-hero__meta">{dates}</p> : null}
              {/*
                A span, not a button. The whole hero is already one tappable
                surface going to one place; a real <button> inside it would be
                a second tab stop and a second announced control for the same
                single destination. It is styled as the call to action and it
                lets the tap fall through to the surface underneath.
              */}
              <span className="dsc-hero__cta" aria-hidden="true">
                {isLive ? 'See what is on' : 'View fest'}
              </span>
            </div>
          }
        />
      </button>
    </section>
  );
}

/*
 * THE HERO SPONSOR. The highest-value placement in the app, and showcase rather
 * than advertising.
 *
 * It used to be an <a target="_blank"> with a "Learn more" pill that sent
 * students to the sponsor's website. That is an ad network's hero. A college
 * fest platform does not push students off to the open web from its home feed —
 * a sponsor is paying to be seen NEXT TO the fests, so the only destination
 * worth offering is a fest.
 *
 * TODAY IT HAS NOWHERE TO GO. A promotion carries no fest reference, and that
 * is deliberate rather than missing: promotion-model.js says so in as many
 * words — "There is deliberately no festId: a promotion may LINK to a fest, but
 * it does not belong to one" — and neither toPublicPromotion nor the decision
 * payload contains a festId or slug. So this renders as a plain <div>: a
 * billboard. `festSlug` is read defensively so the hero starts routing the day
 * the field exists, with no second pass through this file.
 *
 * TODO(backend): to make it tappable, add one nullable field —
 *   sponsoredFestId: { type: ObjectId, ref: "Fest", default: null }
 * on creative-model.js (and promotion-model.js for the legacy path), and
 * surface it as a resolved `festSlug` in the decide() creative block and in
 * toPublicPromotion, so the client can route without a second request.
 *
 * A tap goes to the promotion's destination URL, otherwise its fest, otherwise
 * nowhere — the same rule as the sponsor feed card (helpers/promotion-destination.js).
 * Media is an image or an uploaded video file; anything else is the fallback
 * wash, with the title already carried by the scrim.
 */
function PromotionHero({ promotion, onOpenFest }) {
  const frameRef = useRef(null);
  const decisionToken = promotion.decisionToken ?? null;

  useViewability({
    elementRef: frameRef,
    decisionKey: decisionToken,
    /* Only an uploaded video file plays, so only it is measured as video. */
    mediaType: viewabilityMediaTypeFor(promotion),
    onViewable: useCallback(
      (token) => reportDeliveryEvent(token, DELIVERY_EVENT_KINDS.VIEWABLE),
      [],
    ),
  });

  const handleMediaRendered = useCallback(() => {
    if (decisionToken) {
      reportDeliveryEvent(decisionToken, DELIVERY_EVENT_KINDS.MEASURABLE);
    }
  }, [decisionToken]);

  const media = resolvePromotionMedia(promotion);
  const sponsorName = promotion.promoterName ?? promotion.collegeName ?? null;
  const destination = resolvePromotionDestination(promotion);

  function handleActivate() {
    if (decisionToken) {
      reportDeliveryEvent(decisionToken, DELIVERY_EVENT_KINDS.CLICK);
    }
    openPromotionDestination(destination, onOpenFest);
  }

  /*
   * TODO(backend): the promoter has no LOGO. promoter-model.js carries
   * displayName, displayNameKey, kind, contact fields, status and collegeId —
   * nothing image-shaped — and the decision payload's promoter is
   * { id, displayName, kind }. So the sponsor is set in type here rather than
   * shown as a mark. The field it needs is
   *   logoUrl: { type: String, trim: true, default: null }
   * on promoter-model.js, surfaced through the decision's promoter object and
   * through toPromotionSlide. Once it exists the <p> below becomes an <img>
   * capped at ~28px tall, exactly as the fest card's sponsor strip does it.
   */
  const body = (
    <FeedMedia
      imageUrl={media.imageUrl}
      videoUrl={media.videoUrl}
      alt=""
      allowSoundToggle={false}
      onMediaRendered={handleMediaRendered}
      overlay={
        <>
          <span className="dsc-pill dsc-pill--onmedia">Sponsor</span>
          <div className="dsc-hero__scrim">
            <h2 className="dsc-hero__title">{promotion.title}</h2>
            {sponsorName ? <p className="dsc-hero__host">{sponsorName}</p> : null}
            {promotion.description ? (
              <p className="dsc-hero__meta">{promotion.description}</p>
            ) : null}
          </div>
        </>
      }
    />
  );

  return (
    <section className="dsc-hero" ref={frameRef}>
      {destination ? (
        <button type="button" className="dsc-hero__hit" onClick={handleActivate}>
          {body}
        </button>
      ) : (
        <div className="dsc-hero__hit dsc-card__hit--inert">{body}</div>
      )}
    </section>
  );
}

function HeroSlide({ selection, nowTs, onOpenFest }) {
  if (selection.kind === 'promotion') {
    return <PromotionHero promotion={selection.promotion} onOpenFest={onOpenFest} />;
  }
  return (
    <FestHero
      fest={selection.fest}
      isLive={selection.isLive}
      nowTs={nowTs}
      onOpen={() => onOpenFest(selection.fest)}
    />
  );
}

const ROTATE_EVERY_MS = 6000;
/* Matches --herocarousel-fade in discover.css. */
const CROSSFADE_MS = 700;
const SWIPE_THRESHOLD_PX = 40;

/*
 * THE CURATED BANNER: up to five slides the platform admin chose, rotating.
 *
 * Built to the WAI-ARIA carousel pattern, because an auto-advancing banner is
 * moving content (WCAG 2.2.2) and must be stoppable:
 *   · a Pause / Play button, first in the control order, whose LABEL says what
 *     it will do rather than toggling aria-pressed;
 *   · rotation pauses while the pointer is over the banner or focus is inside
 *     it, so nothing slides away mid-read or mid-tap;
 *   · with reduced motion requested it starts paused;
 *   · a dot per slide, and a swipe on touch screens.
 * Only the visible slide is mounted, so a video slide plays only while shown.
 * One slide is just that slide: no controls, nothing to rotate.
 */
function HeroCarousel({ slides, nowTs, onOpenFest }) {
  const [activeIndex, setActiveIndex] = useState(0);
  /* The slide being faded OUT. Kept mounted only for the crossfade, then
     released, so at most two slides (and two videos) exist at once. */
  const [leavingIndex, setLeavingIndex] = useState(null);
  const [isPaused, setIsPaused] = useState(() => prefersReducedMotion());
  const [isHeld, setIsHeld] = useState(false);
  const touchStartRef = useRef(null);
  const count = slides.length;
  const safeIndex = activeIndex % count;

  useEffect(() => {
    if (count < 2 || isPaused || isHeld) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setLeavingIndex(safeIndex);
      setActiveIndex((index) => (index + 1) % count);
    }, ROTATE_EVERY_MS);
    return () => window.clearTimeout(timer);
  }, [count, isPaused, isHeld, safeIndex]);

  useEffect(() => {
    if (leavingIndex === null) {
      return undefined;
    }
    const timer = window.setTimeout(() => setLeavingIndex(null), CROSSFADE_MS);
    return () => window.clearTimeout(timer);
  }, [leavingIndex, safeIndex]);

  if (count === 1) {
    return <HeroSlide selection={slides[0]} nowTs={nowTs} onOpenFest={onOpenFest} />;
  }

  const goTo = (index) => {
    const next = ((index % count) + count) % count;
    if (next === safeIndex) {
      return;
    }
    setLeavingIndex(prefersReducedMotion() ? null : safeIndex);
    setActiveIndex(next);
  };
  const slideKey = (slide) => `${slide.kind}-${slide.kind === 'fest' ? slide.fest.id : slide.promotion.id}`;

  return (
    <div
      className="dsc-herocarousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="Featured"
      onMouseEnter={() => setIsHeld(true)}
      onMouseLeave={() => setIsHeld(false)}
      onFocus={() => setIsHeld(true)}
      onBlur={(blurEvent) => {
        if (!blurEvent.currentTarget.contains(blurEvent.relatedTarget)) {
          setIsHeld(false);
        }
      }}
      onTouchStart={(touchEvent) => {
        touchStartRef.current = touchEvent.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(touchEvent) => {
        const startX = touchStartRef.current;
        const endX = touchEvent.changedTouches[0]?.clientX;
        touchStartRef.current = null;
        if (startX == null || endX == null || Math.abs(endX - startX) < SWIPE_THRESHOLD_PX) {
          return;
        }
        goTo(safeIndex + (endX < startX ? 1 : -1));
      }}
    >
      {/*
        A CROSSFADE, NOT A REMOUNT. The slides share one grid cell, so the
        outgoing slide fades out while the incoming one fades in over it (with
        a slight settle from 1.03 scale) — never a flash of empty card between
        them. Keyed by the slide, not the position, so a slide keeps its loaded
        poster or video while it is on screen.
      */}
      <div className="dsc-herocarousel__stage">
        {slides.map((slide, index) => {
          const isActive = index === safeIndex;
          const isLeaving = index === leavingIndex && !isActive;
          if (!isActive && !isLeaving) {
            return null;
          }
          return (
            <div
              key={slideKey(slide)}
              className={
                isActive
                  ? 'dsc-herocarousel__slide dsc-herocarousel__slide--active'
                  : 'dsc-herocarousel__slide dsc-herocarousel__slide--leaving'
              }
              role="group"
              aria-roledescription="slide"
              aria-label={`${index + 1} of ${count}`}
              aria-hidden={isActive ? undefined : 'true'}
              inert={isActive ? undefined : true}
            >
              <HeroSlide selection={slide} nowTs={nowTs} onOpenFest={onOpenFest} />
            </div>
          );
        })}
      </div>

      <div className="dsc-herocarousel__controls">
        <button
          type="button"
          className="dsc-herocarousel__pause"
          onClick={() => setIsPaused((paused) => !paused)}
          aria-label={isPaused ? 'Start banner rotation' : 'Pause banner rotation'}
        >
          {isPaused ? (
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div className="dsc-herocarousel__dots">
          {slides.map((slide, index) => (
            <button
              type="button"
              key={slideKey(slide)}
              className={index === safeIndex ? 'dsc-herocarousel__dot dsc-herocarousel__dot--on' : 'dsc-herocarousel__dot'}
              aria-label={`Show slide ${index + 1} of ${count}`}
              aria-current={index === safeIndex ? 'true' : undefined}
              onClick={() => goTo(index)}
            >
              {/* The active dot fills over the rotation interval — a quiet
                  countdown that freezes while the banner is paused or held. */}
              {index === safeIndex ? (
                <span
                  key={`fill-${safeIndex}`}
                  className="dsc-herocarousel__fill"
                  style={{
                    animationDuration: `${ROTATE_EVERY_MS}ms`,
                    animationPlayState: isPaused || isHeld ? 'paused' : 'running',
                  }}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/*
 * `slides` (curated by the platform admin) wins when present; otherwise the
 * single automatic `selection`.
 */
function FeedHero({ selection, slides = null, nowTs, onOpenFest }) {
  if (slides && slides.length > 0) {
    return <HeroCarousel slides={slides} nowTs={nowTs} onOpenFest={onOpenFest} />;
  }
  if (!selection) {
    return null;
  }
  return <HeroSlide selection={selection} nowTs={nowTs} onOpenFest={onOpenFest} />;
}

export default FeedHero;

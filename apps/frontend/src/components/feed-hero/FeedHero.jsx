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

import { useCallback, useRef } from 'react';
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
 * `promotion.linkUrl` still arrives in the payload and is deliberately ignored.
 */
function PromotionHero({ promotion, onOpenFest }) {
  const frameRef = useRef(null);
  const decisionToken = promotion.decisionToken ?? null;

  useViewability({
    elementRef: frameRef,
    decisionKey: decisionToken,
    mediaType: promotion.mediaType === 'video' ? 'video' : 'image',
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

  const isVideo = promotion.mediaType === 'video' && Boolean(promotion.videoUrl);
  const sponsorName = promotion.promoterName ?? promotion.collegeName ?? null;
  const festSlug = promotion.festSlug ?? promotion.fest?.festSlug ?? null;

  function handleActivate() {
    if (decisionToken) {
      reportDeliveryEvent(decisionToken, DELIVERY_EVENT_KINDS.CLICK);
    }
    if (festSlug) {
      onOpenFest?.(festSlug);
    }
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
      imageUrl={promotion.imageUrl}
      videoUrl={isVideo ? promotion.videoUrl : null}
      alt=""
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
      {festSlug ? (
        <button type="button" className="dsc-hero__hit" onClick={handleActivate}>
          {body}
        </button>
      ) : (
        <div className="dsc-hero__hit dsc-card__hit--inert">{body}</div>
      )}
    </section>
  );
}

function FeedHero({ selection, nowTs, onOpenFest }) {
  if (!selection) {
    return null;
  }
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

export default FeedHero;

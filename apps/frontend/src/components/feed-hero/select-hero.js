// select-hero.js
// Which single item leads the Discover screen.
//
// Split out of FeedHero.jsx rather than exported alongside it because a module
// that exports both a component and a plain function opts out of React Fast
// Refresh — every edit to the picking logic would do a full reload instead of
// a hot swap. It is also the piece worth testing on its own: it is pure, total,
// and the whole of the screen's editorial judgement.

import { isFestLive } from '../../helpers/feed-format.js';

/*
 * In strict order:
 *   1. a fest running RIGHT NOW
 *   2. otherwise the next fest to start
 *   3. otherwise a promotion, if there is one
 *   4. otherwise nothing
 *
 * A LIVE FEST ALWAYS WINS. A promotion can only reach the hero when nothing is
 * running — which is also the only moment the slot is worth selling, because a
 * hero showing a fest happening today is the single most useful thing the
 * screen can say and no sponsor is served by displacing it.
 *
 * The promotions handed in here are already placement-scoped: DiscoverScreen
 * asks the decision engine for the `homeCarousel` placement, so a campaign that
 * has not been assigned that placement never reaches this function. There is no
 * second placement check here, and there should not be — placement is the
 * engine's decision and duplicating it client-side is how the two drift.
 *
 * The order is a claim about what matters. Something happening today beats
 * something happening in March however good the poster is, and a promotion
 * only gets the largest element on the screen when there is genuinely no fest
 * to put there — which is also the only situation in which someone opening
 * this app would rather see an advertisement than an empty space.
 */
import { resolvePromotionMedia } from '../../helpers/promotion-media.js';

export function selectHero(fests, promotions, nowTs) {
  const live = fests.filter((fest) => isFestLive(fest.startsOn, fest.endsOn, nowTs));
  if (live.length > 0) {
    /* Several live at once: the one that started most recently, because that
       is the one whose opening day it probably is. */
    const mostRecentlyStarted = [...live].sort(
      (a, b) => new Date(b.startsOn).getTime() - new Date(a.startsOn).getTime(),
    )[0];
    return { kind: 'fest', fest: mostRecentlyStarted, isLive: true };
  }

  /* A promotion that can actually show something — a playable video first,
     then any image (including a YouTube thumbnail). */
  const withMedia = promotions.filter((promotion) => resolvePromotionMedia(promotion).hasMedia);
  const bestPromotion =
    withMedia.find((promotion) => resolvePromotionMedia(promotion).videoUrl) ??
    withMedia[0] ??
    null;

  const upcoming = fests
    .filter((fest) => new Date(fest.startsOn).getTime() > nowTs)
    .sort((a, b) => new Date(a.startsOn).getTime() - new Date(b.startsOn).getTime());
  if (upcoming.length > 0) {
    /* An upcoming fest with no poster and no video would fill the largest
       element on the screen with a blank wash. A sponsor with real media is the
       better use of it; the fest still leads the feed below. */
    const nextFest = upcoming[0];
    const festHasMedia = Boolean(nextFest.bannerImageUrl || nextFest.bannerVideoUrl || nextFest.videoUrl);
    if (!festHasMedia && bestPromotion) {
      return { kind: 'promotion', promotion: bestPromotion };
    }
    return { kind: 'fest', fest: nextFest, isLive: false };
  }

  if (promotions.length > 0) {
    return { kind: 'promotion', promotion: bestPromotion ?? promotions[0] };
  }
  return null;
}

export default selectHero;

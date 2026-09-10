// FeedCard.jsx
// ONE card for the whole feed. A fest and a promotion are the same object on
// screen — media on top, a name, who is behind it, a line of meta — and the
// only difference is a small "Promoted" pill and where the tap goes.
//
// That is a deliberate product decision, not a shortcut. A promotion that
// looks like an advertisement gets scrolled past and is worth nothing to the
// college that bought it; a promotion that looks like content and is labelled
// as promoted is worth something to everyone and lies to no one. The pill is
// the entire distinction, and it is always present.
//
// MEASUREMENT. A promotion card carries the same three reports the carousel it
// replaces carried, against the same decision token, through the same hook and
// the same reporter:
//   measurable — the creative actually rendered
//   viewable   — half on screen for a continuous second (two for video)
//   click      — on activation, alongside the navigation
// A card with no decisionToken (the public promotion list, and every fest)
// reports nothing at all. None of that logic changed; only its container did.

import { useCallback, useRef, useState } from 'react';
import { useViewability } from '../../hooks/use-viewability/use-viewability.js';
import { DELIVERY_EVENT_KINDS, reportDeliveryEvent } from '../../helpers/delivery-reporter.js';
import FeedMedia from '../feed-media/FeedMedia.jsx';
import {
  formatFeedDateRange,
  formatHostLine,
  formatRegistrationDeadline,
  isFestLive,
  readHostCollege,
} from '../../helpers/feed-format.js';

/*
 * "Sponsor", not "Promoted". The word is the product decision: this is a
 * college fest platform showing the brands that pay for the fests, not an ad
 * network placing inventory. "Promoted" is the vocabulary of the second thing,
 * and it is the word that tells a student to scroll past.
 */
function SponsorPill({ onMedia = false }) {
  return (
    <span className={onMedia ? 'dsc-pill dsc-pill--onmedia' : 'dsc-pill dsc-pill--promoted'}>
      Sponsor
    </span>
  );
}

/*
 * The sponsor strip at the foot of a fest card.
 *
 * THIS IS THE PLACEMENT THAT MAKES SPONSORS PAY COLLEGES: a brand's mark seen
 * by every student browsing fests, not only by the few who open the fest page.
 * It is showcase, not advertising — there is no link on it, nothing opens, and
 * a tap anywhere on the card goes to the fest, which is the whole point. A
 * sponsor logo that stole a tap meant for the fest would be worth less to the
 * sponsor, not more.
 *
 * THE DATA ALREADY EXISTS — no backend change was needed and none was made.
 * fest-model.js carries `sponsors: [{ imageUrl (required), sponsorName, linkUrl }]`
 * and fest-service.js `buildPublicFestResponse` already returns it, so the
 * public fest list has been shipping this array all along with nothing reading
 * it. `linkUrl` is deliberately ignored here; see above.
 *
 * THREE, THEN A COUNT. A card is not a sponsor wall. Three logos is what fits
 * on one line of a half-width mobile card without any of them shrinking to
 * illegibility; the rest become "+2", which is honest about there being more
 * and costs one short string instead of a second row. The fest page's
 * SponsorStrip shows the full set.
 *
 * Renders null with no sponsors, so a card without one keeps exactly the height
 * it had before this existed — no empty line, no reserved space.
 */
const MAX_VISIBLE_SPONSORS = 3;

function SponsorLogo({ sponsor }) {
  const [hasFailed, setHasFailed] = useState(false);
  if (!sponsor?.imageUrl || hasFailed) {
    return null;
  }
  return (
    <img
      className="dsc-sponsor__logo"
      src={sponsor.imageUrl}
      /* The brand name when there is one, empty otherwise: a logo whose alt
         text is "sponsor logo" tells a screen reader nothing it wanted. */
      alt={sponsor.sponsorName ?? ''}
      /* NOT lazy. A 24px logo is a few kilobytes, and lazy-loading one whose box
         is auto-width deadlocks — see .dsc-sponsor__logo in discover.css. */
      decoding="async"
      onError={() => setHasFailed(true)}
    />
  );
}

function SponsorStripline({ sponsors }) {
  const list = Array.isArray(sponsors) ? sponsors.filter((s) => s?.imageUrl) : [];
  if (list.length === 0) {
    return null;
  }
  const visible = list.slice(0, MAX_VISIBLE_SPONSORS);
  const overflow = list.length - visible.length;

  return (
    <p className="dsc-sponsor">
      {/* Micro, --muted, sentence case. It labels the row without competing
          with the marks in it. */}
      <span className="dsc-sponsor__label">Sponsors</span>
      {visible.map((sponsor, index) => (
        <SponsorLogo key={sponsor._id ?? sponsor.imageUrl ?? index} sponsor={sponsor} />
      ))}
      {overflow > 0 ? <span className="dsc-sponsor__more">+{overflow}</span> : null}
    </p>
  );
}

function LiveMark({ onMedia = false }) {
  return (
    <span className={onMedia ? 'dsc-live dsc-live--onmedia' : 'dsc-live'}>
      <span className="dsc-live__dot" aria-hidden="true" />
      Live
    </span>
  );
}

/*
 * The shared body. Both card kinds render exactly this; they differ only in
 * the element that wraps it (a button that routes, or an anchor that leaves)
 * and in whether the pill is there.
 */
function CardBody({ title, host, meta, isLive, deadline, media, footer }) {
  return (
    <>
      {/*
        * LIVE SITS ON THE POSTER, TOP LEFT, NOT IN THE TEXT.
        *
        * It used to lead the meta line, so the row read "Live · 7 to 12 Sept"
        * and the one piece of STATE on the card was formatted like another
        * piece of data, competing with the dates for the same line and pushing
        * them along. State belongs on the image, where every ticketing and
        * streaming app puts it, and where it is visible while the eye is still
        * on the poster rather than after it has moved to the copy.
        *
        * Top left because that is where a left-to-right reader enters the
        * image, and because the sponsor strip and the bookmark already use the
        * other corners.
        */}
      <span className="dsc-card__stage">
        {media}
        {isLive ? <LiveMark onMedia /> : null}
      </span>
      <div className="dsc-card__body">
        <h3 className="dsc-card__title">{title}</h3>
        {host ? <p className="dsc-card__host">{host}</p> : null}
        <p className="dsc-card__meta">
          {meta ? <span className="dsc-card__dates">{meta}</span> : null}
          {deadline ? <span className="dsc-card__deadline">{deadline}</span> : null}
        </p>
        {footer}
      </div>
    </>
  );
}

/*
 * A fest. The whole card is one button — there is no "View" or "Register"
 * inside it, because a second target inside a tappable card is a coin toss
 * about which one the thumb lands on and both go to the same place anyway.
 *
 * Video and poster are both read from the fest payload. `bannerVideoUrl` is
 * not in the public projection today; reading it here means the card is
 * already correct on the day it is, with no second pass over this file.
 */
export function FestFeedCard({ fest, nowTs, onOpen }) {
  const { name: collegeName, city } = readHostCollege(fest);
  const live = isFestLive(fest.startsOn, fest.endsOn, nowTs);

  return (
    <article className="dsc-card">
      {/*
        onOpen is handed the tapped card's own DOM node. That is the whole
        mechanism behind the poster-to-hero morph: the shared
        `view-transition-name` has to be written to exactly ONE element in a
        feed of dozens, and the only thing that knows which one is the click
        itself. currentTarget is this button, which contains the media element
        the transition helper looks for. Callers that ignore the argument are
        unaffected.
      */}
      <button type="button" className="dsc-card__hit" onClick={(clickEvent) => onOpen?.(clickEvent.currentTarget)}>
        <CardBody
          title={fest.festName}
          host={formatHostLine(collegeName, city)}
          meta={formatFeedDateRange(fest.startsOn, fest.endsOn, nowTs)}
          isLive={live}
          deadline={formatRegistrationDeadline(fest.registrationClosesAt, nowTs)}
          footer={<SponsorStripline sponsors={fest.sponsors} />}
          media={
            <FeedMedia
              imageUrl={fest.bannerImageUrl}
              videoUrl={fest.bannerVideoUrl ?? fest.videoUrl}
              alt=""
            />
          }
        />
      </button>
    </article>
  );
}

/*
 * A standalone event — one that exists outside any browsable fest, wrapped in a
 * hidden solo-container fest that /public/fests deliberately omits. It gets a
 * card in the same feed rather than a rail of its own: the old screen's
 * "Standalone Events" section was the only place these were reachable from,
 * and dropping the rails without putting them somewhere would have made an
 * event that is published, registerable and linkable appear nowhere anyone
 * could find it.
 *
 * It opens the event, not a fest, which is the entire reason it cannot simply
 * be fed through FestFeedCard.
 */
export function StandaloneEventFeedCard({ event, nowTs, onOpen }) {
  return (
    <article className="dsc-card">
      <button type="button" className="dsc-card__hit" onClick={onOpen}>
        <CardBody
          title={event.eventName}
          /*
           * `hostCollegeName` — that is the field listPublicIndependentEvents
           * actually annotates each event with. An earlier pass read
           * `event.collegeName`, which this endpoint has never sent, so every
           * standalone event card rendered with a blank host line and no error
           * anywhere to say why. `collegeName` is kept as a fallback for the
           * decision-shaped payloads that do use that name.
           */
          host={formatHostLine(event.hostCollegeName ?? event.collegeName, event.city)}
          meta={formatFeedDateRange(event.startsAt, event.endsAt, nowTs)}
          isLive={isFestLive(event.startsAt, event.endsAt, nowTs)}
          deadline={formatRegistrationDeadline(event.registrationClosesAt, nowTs)}
          media={
            <FeedMedia imageUrl={event.posterImageUrl} videoUrl={event.videoUrl} alt="" />
          }
        />
      </button>
    </article>
  );
}

/*
 * A SPONSOR CARD. Showcase, not advertising.
 *
 * WHAT CHANGED AND WHY. This used to be an <a target="_blank" rel="sponsored">
 * that sent students to the promoter's website, with a "Learn more" call to
 * action under it. That is an ad network's card. Dedal is a college fest app:
 * a sponsor pays a college to be seen alongside its fest, and the useful
 * destination is the fest — never the open web. Nothing here opens a new tab
 * any more.
 *
 * WHERE A TAP GOES:
 *   · associated with a fest -> that fest's page
 *   · not associated         -> NOWHERE. The card is the content, like a
 *                               billboard. It renders as a plain <div>, not a
 *                               disabled button: a control that announces
 *                               itself and then refuses is worse than
 *                               something that was never a control.
 *
 * `promotion.linkUrl` still arrives in the payload and is DELIBERATELY IGNORED
 * here. It is not removed from the backend — the admin console still reads it —
 * it simply is not a destination on the participant side.
 *
 * MEASUREMENT IS UNCHANGED. measurable / viewable / click still fire against
 * the same decision token through the same hook and the same reporter. A click
 * is still a click when it navigates inward rather than outward, and not
 * reporting it would under-count what the sponsor bought.
 */
export function PromotionFeedCard({ promotion, onOpenFest }) {
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

  /* The creative rendered. A creative that 404s reports nothing — the fallback
     wash is not the sponsor's artwork and must not be counted as delivered. */
  const handleMediaRendered = useCallback(() => {
    if (decisionToken) {
      reportDeliveryEvent(decisionToken, DELIVERY_EVENT_KINDS.MEASURABLE);
    }
  }, [decisionToken]);

  const isVideo = promotion.mediaType === 'video' && Boolean(promotion.videoUrl);
  const sponsorName = promotion.promoterName ?? promotion.collegeName ?? null;
  /*
   * The fest this sponsor is attached to, if the payload carries one. Read
   * defensively across the shapes it could arrive in, so the card starts
   * working the day that association exists with no second pass over this file.
   */
  const festSlug = promotion.festSlug ?? promotion.fest?.festSlug ?? null;
  const festName = promotion.festName ?? promotion.fest?.festName ?? null;
  const isTappable = Boolean(festSlug);

  function handleActivate() {
    if (decisionToken) {
      reportDeliveryEvent(decisionToken, DELIVERY_EVENT_KINDS.CLICK);
    }
    if (festSlug) {
      onOpenFest?.(festSlug);
    }
  }

  const body = (
    <>
      <FeedMedia
        imageUrl={promotion.imageUrl}
        videoUrl={isVideo ? promotion.videoUrl : null}
        alt=""
        onMediaRendered={handleMediaRendered}
        overlay={
          <>
            <SponsorPill onMedia />
            {/*
              The gradient foot, rendered only when there is a name to carry — a
              scrim over the bottom of a creative with nothing written on it is
              just dimming the artwork the sponsor paid to show.
            */}
            {sponsorName ? (
              <span className="dsc-promo__foot">
                <span className="dsc-promo__promoter">{sponsorName}</span>
              </span>
            ) : null}
          </>
        }
      />
      <div className="dsc-card__body">
        <h3 className="dsc-card__title">{promotion.title}</h3>
        {sponsorName ? <p className="dsc-card__host">{sponsorName}</p> : null}
        <p className="dsc-card__meta">
          {/* The fest the sponsor is behind — the one piece of context that
              makes this a sponsorship rather than a banner. */}
          {festName ? <span className="dsc-card__dates">{festName}</span> : null}
          {!festName && promotion.description ? (
            <span className="dsc-card__dates">{promotion.description}</span>
          ) : null}
        </p>
      </div>
    </>
  );

  return (
    <article className="dsc-card" ref={frameRef}>
      {isTappable ? (
        <button type="button" className="dsc-card__hit" onClick={handleActivate}>
          {body}
        </button>
      ) : (
        <div className="dsc-card__hit dsc-card__hit--inert">{body}</div>
      )}
    </article>
  );
}

/* The loading shape. The SAME box model as a real card — 16:9 media, a title
   line, a host line, a meta line — so nothing moves when the data lands. A
   skeleton that is merely a grey rectangle is a layout shift with extra steps. */
export function FeedCardSkeleton() {
  return (
    <article className="dsc-card dsc-card--skeleton" aria-hidden="true">
      <div className="dsc-skel dsc-skel--media" />
      <div className="dsc-card__body">
        <div className="dsc-skel dsc-skel--title" />
        <div className="dsc-skel dsc-skel--host" />
        <div className="dsc-skel dsc-skel--meta" />
      </div>
    </article>
  );
}

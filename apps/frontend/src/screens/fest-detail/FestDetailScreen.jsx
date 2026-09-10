// FestDetailScreen.jsx
// Route: /fests/:festSlug
//
// A fest is a CATALOGUE, not an article. Up to fifty events across five or six
// verticals, and the one job this page has is to get somebody from "which fest
// is this" to "this is the event I want" without reading past forty things they
// do not care about. So: a hero that answers what/when/where in one screenful,
// a tight block of facts, derived category tabs, and a poster grid.
//
// It replaces a build that rendered the whole event tree as one flat expandable
// list styled with the old Tailwind palette. Two data bugs came with it and are
// fixed here — see `useContingentPackages` and `groupsForFest` below.
//
// Everything visual comes from design/detail-page.css (shared with the event
// page) and ./fest-detail.css (the parts only a fest has). No utility classes,
// no icon fonts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import { useSharedFestPosterStyle } from '../../components/route-transition/shared-fest-poster.js';

import apiClient from '../../api-client/api-client.js';
import { DURATION, prefersReducedMotion } from '../../design/motion.js';
import PromotionSlot from '../../components/promotion-slot/PromotionSlot.jsx';
import {
  BackIcon,
  MailIcon,
  OfflineIcon,
  ShareIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { formatCategoryLabel } from '../../helpers/category-format.js';
import {
  formatClockTime,
  formatEventTypeShort,
  formatFeeLabel,
  formatFestDateRange,
  formatPaiseAmount,
  formatShortDate,
} from '../../helpers/event-format.js';
import { isFestLive, readHostCollege } from '../../helpers/feed-format.js';
import { saveIntendedRoute } from '../../helpers/post-sign-in-redirect.js';
import {
  buildChildrenByParent,
  isRegisterableEvent,
  registerableDescendants,
  rootNodes,
  roundsOf,
} from '../../helpers/event-tree.js';
import {
  cardSponsor,
  categoryBadgeSponsor,
  festTitleSponsor,
  sortedByTier,
} from '../../helpers/sponsor-hierarchy.js';

import '../../design/detail-page.css';
import './fest-detail.css';

const ALL_TAB = 'all';
const DAY_MS = 24 * 60 * 60 * 1000;
// Beyond a week out a closing date is not news; inside a week it is the reason
// somebody should act today. Same horizon the feed uses.
const DEADLINE_HORIZON_MS = 7 * DAY_MS;

/*
 * THE TAB DERIVATION — the central decision on this screen.
 *
 * `category` is free text on the event model: no enum, no canonical order, no
 * display label. One fest returns cultural/technical/sports, the next returns
 * "Robotics" and "Culinary Arts". So the tabs cannot be a fixed list; they are
 * read out of whatever this particular fest published.
 *
 * There are two shapes in the wild and they need different treatment:
 *
 *  1. The fest was built with VERTICALS — root nodes carrying no category, each
 *     holding its events (and sometimes nested sub-verticals). Then the vertical
 *     names ARE the fest's own vocabulary and they beat any category string:
 *     "Cultural Night" is what the organiser called it, "cultural" is a tag.
 *  2. The fest is flat — every root node is already a registerable event. Then
 *     the only grouping available is the category field itself.
 *
 * Both shapes can coexist: a fest with three verticals may still hang one
 * categorised event straight off the root, so the flat branch runs over the
 * leftovers and appends its groups after the verticals.
 *
 * BUG FIX: the old code decided "this is an event" by "this node has no
 * children". That counted ROUNDS as events — a heat of a swimming final became
 * a card in the grid while the final itself was filtered out of its own
 * category. isRegisterableEvent reads `category` instead, which is the rule the
 * event page has always used to decide whether to show a register button.
 */
function groupsForFest(events, childrenByParent) {
  const roots = rootNodes(childrenByParent);
  const containers = roots.filter((node) => !isRegisterableEvent(node));

  /*
   * `node` is carried on the group, not just its id and label. Sponsorship is
   * inherited from the VERTICAL (see sponsor-hierarchy.js), so the tab, the
   * group heading and every card underneath need the actual category node to
   * resolve a badge sponsor. Re-finding it downstream from `key` would mean a
   * second lookup in three places and a silent miss the day a key format
   * changes.
   */
  const groups = containers.map((node) => ({
    key: node.id,
    label: node.eventName,
    node,
    events: registerableDescendants(node.id, childrenByParent),
  }));

  // Anything registerable that no vertical claimed — root-level events on a
  // flat fest, and stragglers on a mixed one.
  const claimed = new Set(groups.flatMap((group) => group.events.map((event) => event.id)));
  const orphans = events.filter((event) => isRegisterableEvent(event) && !claimed.has(event.id));

  const byCategory = new Map();
  orphans.forEach((event) => {
    const key = event.category ?? '';
    if (!byCategory.has(key)) {
      byCategory.set(key, []);
    }
    byCategory.get(key).push(event);
  });
  byCategory.forEach((groupEvents, category) => {
    groups.push({
      key: `category:${category}`,
      label: formatCategoryLabel(category) ?? category,
      // A category string is not a node, so there is nothing that could hold
      // sponsors. Explicitly null rather than absent, so the sponsor helpers
      // are called with the same shape from both branches.
      node: null,
      events: groupEvents,
    });
  });

  // A vertical with nothing registerable under it is a tab that opens onto
  // nothing.
  return groups.filter((group) => group.events.length > 0);
}

// The soonest registration close across the whole fest, but only when it is
// close enough to matter.
function nearestDeadline(registerable, nowTs) {
  let soonest = null;
  registerable.forEach((event) => {
    if (!event.registrationClosesAt) {
      return;
    }
    const closesAt = new Date(event.registrationClosesAt).getTime();
    if (Number.isNaN(closesAt) || closesAt < nowTs || closesAt - nowTs > DEADLINE_HORIZON_MS) {
      return;
    }
    if (soonest === null || closesAt < soonest) {
      soonest = closesAt;
    }
  });
  return soonest;
}

// Registerable events that carry a start time, bucketed by IST calendar day.
// formatShortDate reads the date IN Asia/Kolkata, so it doubles as the bucket
// key — a viewer on a non-IST laptop still gets the fest's own days.
function scheduleDays(registerable) {
  const byDay = new Map();
  registerable
    .filter((event) => Boolean(event.startsAt))
    .slice()
    .sort((first, second) => new Date(first.startsAt) - new Date(second.startsAt))
    .forEach((event) => {
      const label = formatShortDate(event.startsAt);
      if (!byDay.has(label)) {
        byDay.set(label, []);
      }
      byDay.get(label).push(event);
    });
  return [...byDay.entries()].map(([label, dayEvents]) => ({ label, events: dayEvents }));
}

/*
 * THE CONTINGENT FAN-OUT CACHE.
 *
 * There is no public fest-level contingents endpoint — only an admin-
 * authenticated /fests/:festId/contingents — so the only way a visitor can see
 * squad bundles is to ask each container event for its own. On this fest that
 * is eight requests, on top of the fest, the event tree and the viewer's
 * registrations: roughly eleven per page load against a public limit of 100 per
 * fifteen minutes per IP. Nine loads and a real person is rate-limited, and the
 * core flow here — fest, into an event, back to the fest — pays the whole
 * fan-out again every single time they come back.
 *
 * So: a module-level Map keyed by fest id, written on success and read DURING
 * RENDER rather than in an effect. Reading it synchronously matters — an effect
 * would paint one frame with no packages before filling them in, which is a
 * section appearing out of nowhere under somebody's thumb.
 *
 * Module-level, deliberately NOT localStorage. This is a browse cache with a
 * lifetime of one page load; a price or a remaining-slot count carried across
 * sessions is worse than the request it saves, because the number would be
 * wrong and would look authoritative.
 *
 * The real fix is a public /fests/:festId/contingents. When that exists, delete
 * this and the fan-out with it.
 *
 * Entries store `eventId`, not the event object: the cache outlives the render
 * that filled it, and holding whole event records from a previous load would
 * pin stale copies of the tree in memory for the sake of one id.
 */
const contingentPackagesByFestId = new Map();

/*
 * ONE REQUEST FOR THE WHOLE FEST.
 *
 * This used to fan out: /public/events/:eventId/contingents once per top-level
 * container — eight requests on Alliance ONE 2026, on top of the fest and its
 * event tree. Against the public limiter's real ceiling of 100 requests per 15
 * minutes that made a fest page cost ten public requests, so roughly nine page
 * loads exhausted a browsing session and the screen started rendering its error
 * state instead of its content.
 *
 * GET /public/fests/:festId/contingents returns every published bundle in the
 * fest already grouped by the container it hangs under, so the same data now
 * costs one round trip and the grouping arrives done rather than being
 * reassembled here.
 *
 * IT ALSO FIXES A BLIND SPOT. A contingent's parentEventId is NULLABLE, and
 * null means a FEST-LEVEL bundle covering the fest's top-level events. The
 * fan-out could never ask for those — there was no event id to ask under — so
 * they were invisible to participants however many requests the client made.
 * They arrive in their own bucket and are shown alongside the rest.
 *
 * The failure path is unchanged in spirit: one swallowed error, and a fest with
 * no bundles caches [] so a return visit does not re-ask.
 */
function useContingentPackages(festId) {
  const cached = festId ? (contingentPackagesByFestId.get(festId) ?? null) : null;
  const [fetched, setFetched] = useState([]);

  useEffect(() => {
    if (!festId || cached) {
      return undefined;
    }
    let isActive = true;
    apiClient
      .get(`/public/fests/${festId}/contingents`)
      .then((result) => {
        const grouped = result?.contingentsByParentEventId ?? {};
        const festLevel = Array.isArray(result?.festLevelContingents)
          ? result.festLevelContingents
          : [];
        /*
         * Flattened back to the shape the packages section already renders:
         * { eventId, contingent }. eventId is null for a fest-level bundle,
         * which openPackage passes straight through as parentEventId — the
         * purchase flow's own field is nullable for exactly this case.
         */
        const flat = [
          ...Object.entries(grouped).flatMap(([eventId, contingents]) =>
            (Array.isArray(contingents) ? contingents : []).map((contingent) => ({
              eventId,
              contingent,
            })),
          ),
          ...festLevel.map((contingent) => ({ eventId: null, contingent })),
        ];
        contingentPackagesByFestId.set(festId, flat);
        if (isActive) {
          setFetched(flat);
        }
      })
      .catch(() => {
        contingentPackagesByFestId.set(festId, []);
        if (isActive) {
          setFetched([]);
        }
      });
    return () => {
      isActive = false;
    };
  }, [festId, cached]);

  // `cached` is the same array instance every render, so returning it directly
  // keeps the packages list referentially stable across a re-render too.
  return cached ?? fetched;
}

/*
 * THE POSTER PLACEHOLDER.
 *
 * Every seeded event has posterImageUrl: null, so the fallback is what this
 * grid actually looks like today — and a flat --accent→--ink gradient repeated
 * forty times gives a person nothing to aim at. The placeholder should carry
 * two signals: which event this is (its initial) and which category it belongs
 * to (its field).
 *
 * WHY NOT A COLOUR PER CATEGORY. `category` is free text — no enum, no map,
 * and the next fest returns "Culinary Arts" where this one returns "sports". A
 * per-category palette therefore has to be generated, which means new hex
 * values invented at runtime, which is precisely the thing the six-token system
 * was just enforced across these screens to stop. A generated rainbow also
 * fails on its own terms: hues picked by a hash land wherever they land, so two
 * neighbouring categories can differ by nothing perceptible while a third
 * arrives at a colour the brand does not own.
 *
 * WHAT THIS DOES INSTEAD. The category string is hashed to one of six
 * TREATMENTS that are all built from --accent and --ink: the pair stays the
 * same, what varies is the color-mix ratio between them and the gradient's
 * angle and stop positions. Six is deliberate — enough that adjacent categories
 * in a grid read as different fields, few enough that each one is visibly
 * distinct rather than a shade of its neighbour. Everything stays inside the
 * palette, and nothing here is a colour the design system does not already own.
 *
 * FNV-1a over the trimmed, lower-cased category: pure, no state, no ordering
 * input. "Cultural" and "cultural " land on the same treatment, and the same
 * category resolves identically on every card, in every group, on every reload
 * and on the server if this is ever rendered there.
 */
const PLACEHOLDER_TREATMENTS = 6;

function categoryTreatment(category) {
  const key = (category ?? '').trim().toLowerCase();
  if (!key) {
    return 0;
  }
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  // >>> 0 before the modulo: Math.imul returns a SIGNED 32-bit int, and a
  // negative remainder would index nothing.
  return (hash >>> 0) % PLACEHOLDER_TREATMENTS;
}

// The first LETTER, not the first character — "5th Perspective" marks as "P"
// and "…and Then There Were None" as "A". \p{L} covers Devanagari and the rest
// of the scripts a fest name can plausibly arrive in.
function markLetter(name) {
  const match = /\p{L}/u.exec(name ?? '');
  return match ? match[0].toUpperCase() : '';
}

function EventGrid({ events, childrenByParent, categoryNode, onOpenEvent }) {
  return (
    <ul className="dfd-grid">
      {events.map((event) => {
        const rounds = roundsOf(event.id, childrenByParent).length;
        const isFree = formatFeeLabel(event) === 'Free';
        // The event's own sponsor outranks the category's on its own card;
        // that precedence lives in sponsor-hierarchy.js, not here.
        const sponsor = cardSponsor(event, categoryNode);
        const letter = markLetter(event.eventName);
        return (
          <li className="dfd-card" key={event.id}>
            <button type="button" className="dfd-card__hit" onClick={() => onOpenEvent(event)}>
              <span className="dfd-card__media">
                {event.posterImageUrl ? (
                  <img src={event.posterImageUrl} alt="" loading="lazy" />
                ) : (
                  <span
                    className={`dfd-card__fallback dfd-card__fallback--t${categoryTreatment(event.category)}`}
                    aria-hidden="true"
                  >
                    {letter ? <span className="dfd-card__mark">{letter}</span> : null}
                  </span>
                )}
                {/*
                 * Non-interactive by construction. The card is one <button>,
                 * and an <a> nested inside a button is invalid HTML that
                 * browsers resolve by stealing the tap — the sponsor would win
                 * a press meant for the event. Only the standalone strip below
                 * the facts links out.
                 */}
                {sponsor ? (
                  <span className="dfd-card__sponsor">
                    <img src={sponsor.imageUrl} alt={sponsor.sponsorName || ''} loading="lazy" />
                  </span>
                ) : null}
              </span>
              <span className="dfd-card__body">
                <span className="dfd-card__name">{event.eventName}</span>
                {/*
                 * Two facts of different KINDS, so they stop looking like two
                 * chips. "Solo"/"Team" is a format — a quiet label. The fee is
                 * money, the thing somebody is actually deciding about, so it
                 * takes the weight and sits at the far end of the row where a
                 * price is read. Two matching pills said they were equivalent
                 * and crammed them into 157px of card besides.
                 */}
                <span className="dfd-card__meta">
                  <span className="dfd-card__type">{formatEventTypeShort(event)}</span>
                  <span className={isFree ? 'dfd-card__fee dfd-card__fee--free' : 'dfd-card__fee'}>
                    {formatFeeLabel(event)}
                  </span>
                </span>
                {/* The count only. The rounds themselves belong on the event
                    page; listing them here is how nine events become thirty. */}
                {rounds > 0 ? (
                  <span className="dfd-card__rounds">
                    {rounds} {rounds === 1 ? 'round' : 'rounds'}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FestDetailScreen() {
  const navigate = useTransitionNavigate();
  const location = useLocation();
  const { festSlug } = useParams();
  /*
   * THE RECEIVING HALF OF THE POSTER MORPH.
   *
   * Two things have to be true at the instant the browser snapshots this page,
   * and both are arranged here.
   *
   * FIRST, the name. useSharedFestPosterStyle returns a viewTransitionName for
   * the one render that follows a tap on this fest's card, and nothing on any
   * other render — a permanently named hero would be captured as its own
   * detached snapshot on every later navigation away from this page, which is
   * how sticky and fixed chrome starts jumping.
   *
   * SECOND, and less obvious: an <img> has to EXIST. The snapshot is taken
   * immediately after React commits, which is long before /public/fests
   * answers, so the "real" hero further down this file has not rendered yet and
   * a morph into an element that does not exist is just the card fading out.
   * So the tapped card sends its poster URL along in navigation state and the
   * loading skeleton below renders that image as the hero. This is worth doing
   * on its own merits — you tapped a picture and the picture is there instead
   * of a grey box — and it is what makes the morph land.
   */
  const posterPreviewUrl = location.state?.posterPreviewUrl ?? null;
  const sharedPosterStyle = useSharedFestPosterStyle(festSlug);
  const { isAuthenticated } = useAuthentication();
  const isOnline = useOnlineStatus();

  const [fest, setFest] = useState(null);
  const [events, setEvents] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [hasCrewAccess, setHasCrewAccess] = useState(false);
  const [myRegistrationId, setMyRegistrationId] = useState(null);

  const [activeTab, setActiveTab] = useState(ALL_TAB);
  /*
   * THE OLD GRID LEAVES BEFORE THE NEW ONE ARRIVES.
   *
   * The swap used to be a `key={activeTab}` remount with an enter-only
   * keyframe: React destroyed the outgoing grid on the same tick, so the
   * content you were looking at was deleted instantly and its replacement
   * faded in over the gap. Half a transition, and the half that was missing is
   * the one that tells you the thing you were reading has gone.
   *
   * `isSwapping` fades and lifts the CURRENT grid out, and only when that has
   * finished does the filter actually change and the new grid come back down.
   * Out then in, on the same 4px and the same shape, exit faster than enter.
   */
  const [isSwapping, setIsSwapping] = useState(false);
  const swapTimerRef = useRef(null);

  /* A pending swap must not outlive the screen, or the timeout calls setState
     on an unmounted tree. */
  useEffect(() => () => clearTimeout(swapTimerRef.current), []);

  const selectTab = useCallback(
    (nextTab) => {
      if (nextTab === activeTab) return;
      if (prefersReducedMotion()) {
        setActiveTab(nextTab);
        return;
      }
      clearTimeout(swapTimerRef.current);
      setIsSwapping(true);
      swapTimerRef.current = setTimeout(() => {
        setActiveTab(nextTab);
        setIsSwapping(false);
      }, DURATION.exit);
    },
    [activeTab],
  );
  const [activeDay, setActiveDay] = useState(0);
  const [isAboutExpanded, setIsAboutExpanded] = useState(false);
  const [isAboutClamped, setIsAboutClamped] = useState(false);
  const [hasTabsBeyondEdge, setHasTabsBeyondEdge] = useState(false);

  const eventsSectionRef = useRef(null);
  const aboutRef = useRef(null);
  const tabsRef = useRef(null);

  const loadFest = useCallback(async () => {
    setLoadState('loading');
    try {
      const festDetail = await apiClient.get(`/public/fests/${festSlug}`);
      // includeChildren returns the whole tree flat — verticals, events and
      // rounds together. event-tree.js is what puts each node back at its level.
      const festEvents = await apiClient.get(
        `/public/fests/${festDetail.id}/events?includeChildren=true`,
      );
      setFest(festDetail);
      setEvents(Array.isArray(festEvents) ? festEvents : []);
      setLoadState('ready');

      if (!isAuthenticated) {
        return;
      }

      // Crew directory: only for someone who actually staffs this fest.
      try {
        const assignments = await apiClient.get('/staff-assignments/mine');
        setHasCrewAccess(
          (Array.isArray(assignments) ? assignments : []).some((assignment) => {
            const assignmentFestId = assignment.festId?.id ?? assignment.festId;
            return assignmentFestId === festDetail.id;
          }),
        );
      } catch {
        setHasCrewAccess(false);
      }

      /*
       * Does this person already hold a pass to something in this fest? It
       * decides whether the bar says "Explore events" or "View my pass", so a
       * failure here must be silent and must fall back to the explore CTA —
       * never to a dead "view pass" pointing at nothing.
       *
       * The fest reference arrives populated on most rows and as a bare id on
       * some, depending on which service wrote the registration; both are read.
       */
      try {
        const mine = await apiClient.get('/registrations/mine');
        const match = (Array.isArray(mine) ? mine : []).find((row) => {
          const rowFestId = row.eventId?.festId?.id ?? row.eventId?.festId;
          return rowFestId === festDetail.id;
        });
        setMyRegistrationId(match?.id ?? null);
      } catch {
        setMyRegistrationId(null);
      }
    } catch {
      setLoadState('error');
    }
  }, [festSlug, isAuthenticated]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFest();
  }, [loadFest]);

  const childrenByParent = useMemo(() => buildChildrenByParent(events), [events]);
  const groups = useMemo(
    () => groupsForFest(events, childrenByParent),
    [events, childrenByParent],
  );
  const registerableEvents = useMemo(() => events.filter(isRegisterableEvent), [events]);

  /*
   * No containerEvents list any more. It existed only to decide which event ids
   * to fan the contingent requests out over; the fest-scoped endpoint answers
   * for the whole fest in one call, so the client no longer has to work out
   * where bundles might live before it can ask.
   */
  const packages = useContingentPackages(fest?.id ?? null);

  // Read once, at mount. A bare Date.now() in the render body is impure — two
  // renders a millisecond apart would disagree about whether a deadline is
  // still inside the seven-day horizon.
  const [nowTs] = useState(() => Date.now());
  const deadlineTs = useMemo(
    () => nearestDeadline(registerableEvents, nowTs),
    [registerableEvents, nowTs],
  );
  const days = useMemo(() => scheduleDays(registerableEvents), [registerableEvents]);

  /*
   * The toggle only appears when the text is genuinely cut off. Measured, not
   * guessed from a character count — the clamp is four LINES, and how many
   * characters fit on a line depends on the viewport and the font.
   *
   * It has to be RE-measured, which the first version did not do: a description
   * that overflows four lines at 360px fits in three at 900px, and a browser
   * that is resized (or a phone that is rotated, or a desktop sidebar that
   * appears at 1024px and takes 320px off the prose column) was left with a
   * "Read more" that expanded nothing, or none where the text was still cut.
   * An observer on the paragraph itself catches all of those, including the
   * container-query reflow that no window resize accompanies.
   *
   * Skipped while expanded, and this is the whole reason the guard exists: an
   * expanded paragraph has scrollHeight === clientHeight by definition, so
   * measuring then would decide the text is short and delete the "Show less"
   * button out from under the person who just pressed it.
   */
  useEffect(() => {
    const node = aboutRef.current;
    if (!node || isAboutExpanded) {
      return undefined;
    }
    const measure = () => setIsAboutClamped(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [fest, isAboutExpanded]);

  /*
   * A rail that scrolls should say so. Nine tabs do not fit in 360px and the
   * ninth was sliced mid-word at the column edge with nothing to distinguish
   * that from a label that simply ends there — so the fade at the trailing edge
   * is drawn only when there is genuinely something past it, and removed once
   * the rail is scrolled to its end. A permanent gradient would be decoration
   * lying about the state of the list.
   *
   * Both the scroll position and the rail's own width matter: the same nine
   * tabs fit without scrolling on a wide desktop column.
   */
  useEffect(() => {
    const node = tabsRef.current;
    if (!node) {
      return undefined;
    }
    const measure = () => {
      setHasTabsBeyondEdge(node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
    };
    measure();
    node.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [groups]);

  const openEvent = useCallback(
    (event) => {
      navigate(`/events/${event.eventSlug}`, { state: { festSlug } });
    },
    [navigate, festSlug],
  );

  const openPackage = useCallback(
    (contingent, parentEventId) => {
      if (!isAuthenticated) {
        // state.returnTo is dead across this app; the intended route is stashed
        // and replayed after sign-in.
        saveIntendedRoute(location.pathname);
        navigate('/');
        return;
      }
      navigate(`/contingents/${contingent.id}/purchase`, {
        state: { contingent, festId: fest?.id, parentEventId },
      });
    },
    [isAuthenticated, location.pathname, navigate, fest],
  );

  function handleShareFest() {
    const festUrl = `${window.location.origin}/fests/${festSlug}`;
    if (navigator.share) {
      navigator.share({ title: fest?.festName, url: festUrl }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(festUrl).catch(() => {});
    }
  }

  function scrollToEvents() {
    eventsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (loadState === 'loading') {
    return (
      <div className="ddp-screen">
        {/* Skeletons in the shape of the real page — hero, then the facts
            lines, then the grid — so nothing jumps when the data lands. The
            hero slot is the real poster when we arrived from a card that was
            already showing it; see the note by posterPreviewUrl above. */}
        {posterPreviewUrl ? (
          <div className="ddp-hero">
            <img
              className="ddp-hero__media"
              style={sharedPosterStyle}
              src={posterPreviewUrl}
              alt=""
            />
          </div>
        ) : (
          <div className="ddp-skel ddp-skel--hero" />
        )}
        <div className="ddp-col">
          <div className="ddp-facts">
            <div className="ddp-skel ddp-skel--line" style={{ width: '60%' }} />
            <div className="ddp-skel ddp-skel--line" style={{ width: '45%' }} />
            <div className="ddp-skel ddp-skel--line" style={{ width: '30%' }} />
          </div>
          <div className="dfd-grid">
            <div className="ddp-skel ddp-skel--block" />
            <div className="ddp-skel ddp-skel--block" />
            <div className="ddp-skel ddp-skel--block" />
            <div className="ddp-skel ddp-skel--block" />
          </div>
        </div>
      </div>
    );
  }

  if (loadState === 'error' || !fest) {
    return (
      <div className="ddp-screen">
        <div className="ddp-col">
          <div className="ddp-state ddp-state--error">
            <p className="ddp-state__text">
              {isOnline
                ? 'This fest could not be loaded.'
                : 'You are offline, so this fest could not be loaded.'}
            </p>
            <button type="button" className="ddp-button" onClick={loadFest}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const host = readHostCollege(fest);
  const isLive = isFestLive(fest.startsOn, fest.endsOn, nowTs);
  const visibleGroups = activeTab === ALL_TAB ? groups : groups.filter((g) => g.key === activeTab);
  const organiserName = host.name || fest.festName || '';
  const organiserInitial = organiserName.trim().charAt(0).toUpperCase();
  const titleSponsor = festTitleSponsor(fest);
  // Ordered by what each sponsor bought, not by the order the array happened to
  // arrive in. sortedByTier also drops any row with no imageUrl, so the strip
  // can never render a broken box.
  const festSponsors = sortedByTier(fest.sponsors);

  return (
    <div className="ddp-screen">
      {/* Cached data is still on screen — the bar says why it may be stale
          rather than replacing the page with an error. */}
      {!isOnline ? (
        <div className="ddp-col">
          <p className="ddp-offline">
            <OfflineIcon size="sm" className="ddp-icon ddp-icon--sm" />
            You are offline. This may not be up to date.
          </p>
        </div>
      ) : null}

      <header className="ddp-hero">
        {fest.bannerImageUrl ? (
          /* The receiving half of the poster morph. The style object is
             present only on the first render after a fest card was tapped —
             see shared-fest-poster.js for why it is claimed here and released
             immediately afterwards. On a direct visit or a Back into this page
             it is undefined and the hero is an ordinary image. */
          <img
            className="ddp-hero__media"
            style={sharedPosterStyle}
            src={fest.bannerImageUrl}
            alt=""
          />
        ) : (
          <div className="ddp-hero__fallback" aria-hidden="true" />
        )}
        {/*
         * THE TITLE SPONSOR, AND THE COLLISION IT WOULD OTHERWISE CAUSE.
         *
         * The brief asks for the logo bottom-left. So is the fest name: the
         * shared .ddp-hero__scrim is a flex column with justify-content:
         * flex-end, and .ddp-hero__title is its only child. Absolutely
         * positioning a logo into that same corner puts it either on top of the
         * name or in a fight with it the moment the name wraps to two lines.
         *
         * So the sponsor is a sibling INSIDE the scrim, ordered above the
         * title. Same corner, stacked, no overlap possible at any name length
         * because flex-end grows the stack upward off a fixed bottom edge.
         *
         * The arithmetic at 360px, which is where this has to hold: the hero is
         * 16/9, so 202px tall. The scrim's --s4 padding takes 32, leaving 170.
         * A two-line title at --display-l is 68, the sponsor block is a 14px
         * micro line plus a 24px logo box plus an --s1 gap = 42. 110 of 170 —
         * and it grows UP from the bottom, so the 60px the controls occupy at
         * the top are never reached. The controls are also a separate absolutely
         * positioned layer pinned to the top edge, so they cannot be pushed.
         *
         * The scrim gradient is transparent above 62% of the hero; the top of
         * the sponsor block lands around 54%, still inside the wash, and the
         * micro label carries the same text-shadow the title does for the case
         * where a banner is white right there.
         */}
        <div className="ddp-hero__scrim">
          {titleSponsor ? (
            <span className="dfd-hero-sponsor">
              <span className="dfd-hero-sponsor__label">Presented by</span>
              <img
                className="dfd-hero-sponsor__logo"
                src={titleSponsor.imageUrl}
                alt={titleSponsor.sponsorName || ''}
              />
            </span>
          ) : null}
          <h1 className="ddp-hero__title">{fest.festName}</h1>
        </div>
        <div className="ddp-hero__controls">
          <button
            type="button"
            className="ddp-hero__control"
            onClick={() => navigate(-1)}
            aria-label="Go back"
          >
            <BackIcon size="lg" />
          </button>
          <button
            type="button"
            className="ddp-hero__control"
            onClick={handleShareFest}
            aria-label="Share this fest"
          >
            <ShareIcon size="lg" />
          </button>
        </div>
      </header>

      <div className="ddp-col">
        <div className="ddp-split">
          {/*
           * The sidebar is FIRST in the source so that on a phone — where
           * .ddp-split is a plain block — the facts land directly under the
           * hero, which is where they are read. At 1024px the container query
           * in fest-detail.css orders it back to the right-hand column.
           */}
          <aside className="ddp-aside">
            {/*
             * THE CORE INFO. Three facts, three different jobs, and the first
             * build gave all three the same 14px grey line — so the block read
             * as a paragraph of metadata rather than as an answer to "whose
             * fest, when, how big".
             *
             * The host college is the identity and takes the most weight; the
             * city trails it quietly because nobody scans for it first. The
             * dates are the fact that decides whether this is relevant at all,
             * so they stay in ink. The scale of the fest is a number and reads
             * as one — the numeral carries the weight and the noun does not.
             */}
            <section className="ddp-facts dfd-facts">
              <p className="dfd-facts__host">
                {host.name}
                {host.city ? <span className="dfd-facts__city">{`, ${host.city}`}</span> : null}
              </p>
              <p className="dfd-facts__dates">
                {formatFestDateRange(fest.startsOn, fest.endsOn)}
                {isLive ? (
                  <span className="ddp-live">
                    <span className="ddp-live__dot" aria-hidden="true" />
                    Happening now
                  </span>
                ) : null}
              </p>
              <p className="dfd-facts__scale">
                <span className="dfd-facts__count">{registerableEvents.length}</span>
                {registerableEvents.length === 1 ? ' event' : ' events'}
                {groups.length > 1 ? ` across ${groups.length} categories` : ''}
              </p>
              {deadlineTs ? (
                <p className="ddp-facts__deadline">
                  Registration closes {formatShortDate(new Date(deadlineTs).toISOString())}
                </p>
              ) : null}
            </section>

            {/*
             * Whole section or nothing — the heading is inside the guard, so a
             * fest with no sponsors gets no "Sponsors" label over an empty
             * strip. That is the common case today (no fest or event in the
             * seed carries any), and it has to read as a fest that has not sold
             * sponsorship rather than as a section that failed to load. Because
             * .ddp-section draws the hairline that separates it from the block
             * above, dropping the section drops the rule with it and the facts
             * simply run on into the packages.
             *
             * Only this strip links out: a card's badge sits inside a <button>
             * and cannot.
             */}
            {festSponsors.length > 0 ? (
              <section className="ddp-section">
                <h2 className="ddp-section__title">Sponsors</h2>
                <div className="dfd-sponsors">
                  {festSponsors.map((sponsor, index) =>
                    sponsor.linkUrl ? (
                      <a
                        key={sponsor.linkUrl ?? index}
                        href={sponsor.linkUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        <img src={sponsor.imageUrl} alt={sponsor.sponsorName || ''} />
                      </a>
                    ) : (
                      <img
                        key={sponsor.imageUrl ?? index}
                        src={sponsor.imageUrl}
                        alt={sponsor.sponsorName || ''}
                      />
                    ),
                  )}
                </div>
              </section>
            ) : null}

            {packages.length > 0 ? (
              <section className="ddp-section dfd-aside-packages">
                <h2 className="ddp-section__title">Squad packages</h2>
                <div className="dfd-packages">
                  {packages.map(({ eventId, contingent }) => {
                    const left =
                      contingent.maximumBundleClaims === null ||
                      contingent.maximumBundleClaims === undefined
                        ? null
                        : contingent.maximumBundleClaims - (contingent.soldBundleCount ?? 0);
                    return (
                      <button
                        type="button"
                        className="dfd-package"
                        key={contingent.id}
                        onClick={() => openPackage(contingent, eventId)}
                      >
                        <span className="dfd-package__name">{contingent.contingentName}</span>
                        <span className="dfd-package__price">
                          {formatPaiseAmount(contingent.pricePaise)}
                        </span>
                        {left === null ? null : (
                          <span className="dfd-package__slots">
                            {Math.max(0, left)} of {contingent.maximumBundleClaims} left
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {/*
             * Rendered once, here. On a phone .ddp-cta is fixed to the bottom
             * edge and its position in the source is irrelevant; at 1024px the
             * shared stylesheet makes it static so it simply becomes the last
             * block of the sidebar. One element, two behaviours, no duplicate
             * markup to keep in sync.
             */}
            <div className="ddp-cta">
              <div className="ddp-cta__inner">
                <div className="ddp-cta__meta">
                  <span className="ddp-cta__label">Entry</span>
                  {/* Fest entry is free platform-wide. Fees are per event and
                      live on the cards and the event page. */}
                  <span className="ddp-cta__value">Free</span>
                </div>
                {myRegistrationId ? (
                  <button
                    type="button"
                    className="ddp-button"
                    onClick={() => navigate(`/my-registrations/${myRegistrationId}`)}
                  >
                    View my pass
                  </button>
                ) : (
                  <button type="button" className="ddp-button" onClick={scrollToEvents}>
                    Explore events
                  </button>
                )}
              </div>
            </div>
          </aside>

          <main>
            <section ref={eventsSectionRef}>
              {/*
               * A wrapper, because the fade has to sit STILL while the rail
               * scrolls underneath it. A pseudo-element on the scroller itself
               * is positioned inside the scrolled content and slides away with
               * the tabs; a pseudo-element on the sticky wrapper stays pinned
               * to the column edge, which is where the cut actually happens.
               *
               * These are filter buttons, not a tab widget: role="tablist"
               * promises arrow-key navigation, a roving tabindex and a
               * tabpanel, none of which exist here and none of which this
               * control needs. aria-pressed on a toggle button describes what
               * it is honestly and leaves Tab working the way it already did.
               */}
              {groups.length > 0 ? (
                <div
                  className={
                    hasTabsBeyondEdge ? 'dfd-tabrail dfd-tabrail--more' : 'dfd-tabrail'
                  }
                >
                  <div className="dfd-tabs" ref={tabsRef} role="group" aria-label="Filter events by category">
                    {/*
                     * NO SPONSOR ON A TAB.
                     *
                     * These used to carry a "Powered by X" line under the
                     * label. A tab is a control: its whole job is to say what
                     * it filters to and whether it is selected, and it has to
                     * be the same shape as every tab beside it to be scannable
                     * as a row. A sponsored tab was taller than its unsponsored
                     * neighbours, which raised the entire rail, and it put a
                     * credit inside a hit target where it could not be read
                     * without also being pressed.
                     *
                     * The credit still appears, on the category HEADING below,
                     * where it is text next to text and costs nothing.
                     */}
                    <button
                      type="button"
                      className="dfd-tab"
                      aria-pressed={activeTab === ALL_TAB}
                      onClick={() => setActiveTab(ALL_TAB)}
                    >
                      <span className="dfd-tab__row">
                        All
                        <span className="dfd-tab__count">{registerableEvents.length}</span>
                      </span>
                    </button>
                    {groups.map((group) => (
                      <button
                        type="button"
                        key={group.key}
                        className="dfd-tab"
                        aria-pressed={activeTab === group.key}
                        onClick={() => selectTab(group.key)}
                      >
                        <span className="dfd-tab__row">
                          {group.label}
                          <span className="dfd-tab__count">{group.events.length}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {groups.length === 0 ? (
                <p className="ddp-empty">No events announced yet</p>
              ) : (
                /*
                 * NOT KEYED any more. The key was what made the outgoing grid
                 * impossible to animate — see `isSwapping` above. The subtree
                 * is now reused across a filter change and a class carries it
                 * out and back in, which also means the scroll position and any
                 * loaded poster inside it survive the swap.
                 */
                <div className={`dfd-groups${isSwapping ? ' dfd-groups--out' : ''}`}>
                {visibleGroups.map((group) => {
                  const badge = categoryBadgeSponsor(group.node);
                  return (
                    <div className="dfd-group" key={group.key}>
                      {/* The heading is only useful in the All view — with a
                          single tab selected the tab itself already says it. */}
                      {activeTab === ALL_TAB ? (
                        <h2 className="dfd-group__title">
                          {group.label}
                          <span className="dfd-group__count">{group.events.length}</span>
                          {/* Beside the label, at the far end of the row: the
                              category is the heading, its sponsor is a credit
                              against it, not a second heading. */}
                          {badge ? (
                            <span className="dfd-group__powered">
                              Powered by {badge.sponsorName}
                            </span>
                          ) : null}
                        </h2>
                      ) : null}
                      <EventGrid
                        events={group.events}
                        childrenByParent={childrenByParent}
                        categoryNode={group.node}
                        onOpenEvent={openEvent}
                      />
                    </div>
                  );
                })}
                </div>
              )}
            </section>

            {/* Omitted entirely when no event carries a start time — a day
                strip over an empty list reads as a broken feature. */}
            {days.length > 0 ? (
              <section className="ddp-section">
                <h2 className="ddp-section__title">Schedule</h2>
                {/* Same reasoning as the category rail: a row of toggle
                    buttons, not an ARIA tab widget. */}
                <div className="dfd-days" role="group" aria-label="Choose a fest day">
                  {days.map((day, index) => (
                    <button
                      type="button"
                      key={day.label}
                      className="dfd-tab"
                      aria-pressed={activeDay === index}
                      onClick={() => setActiveDay(index)}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
                {/*
                 * `days[activeDay] ?? days[0]` is not defensive noise: the day
                 * list is derived from the fetched events, so a reload that
                 * returns a shorter fest while day four is selected would
                 * otherwise read `.events` off undefined and blank the screen.
                 */}
                {(days[activeDay] ?? days[0]).events.map((event) => (
                  <div className="dfd-slot" key={event.id}>
                    <span className="dfd-slot__time">{formatClockTime(event.startsAt)}</span>
                    <span className="dfd-slot__name">{event.eventName}</span>
                  </div>
                ))}
                <button
                  type="button"
                  className="ddp-more"
                  onClick={() => navigate(`/schedule/${fest.id}`)}
                >
                  View full schedule
                </button>
              </section>
            ) : null}

            {fest.description ? (
              <section className="ddp-section">
                <h2 className="ddp-section__title">About</h2>
                <p
                  ref={aboutRef}
                  className={isAboutExpanded ? 'ddp-prose' : 'ddp-prose ddp-prose--clamped'}
                >
                  {fest.description}
                </p>
                {isAboutClamped ? (
                  <button
                    type="button"
                    className="ddp-more"
                    onClick={() => setIsAboutExpanded((expanded) => !expanded)}
                  >
                    {isAboutExpanded ? 'Show less' : 'Read more'}
                  </button>
                ) : null}
              </section>
            ) : null}

            <section className="ddp-section">
              <h2 className="ddp-section__title">Organiser</h2>
              <div className="dfd-organiser">
                {/* Only when there is a letter to put in it. A fest with no
                    host college and no name would otherwise get an empty grey
                    disc, which reads as an image that failed to load. */}
                {organiserInitial ? (
                  <span className="dfd-organiser__mark" aria-hidden="true">
                    {organiserInitial}
                  </span>
                ) : null}
                <span className="dfd-organiser__text">
                  <span className="dfd-organiser__name">{organiserName}</span>
                  {fest.contactEmail ? (
                    <a className="dfd-organiser__contact" href={`mailto:${fest.contactEmail}`}>
                      <MailIcon size="sm" className="ddp-icon ddp-icon--sm" />
                      {fest.contactEmail}
                    </a>
                  ) : null}
                </span>
              </div>
              {/* Crew directory is a staff tool, not a visitor action — it sits
                  quietly beside the organiser rather than in the hero. */}
              {hasCrewAccess ? (
                <button
                  type="button"
                  className="ddp-button ddp-button--quiet"
                  onClick={() => navigate(`/fests/${festSlug}/crew-directory`)}
                >
                  Crew directory
                </button>
              ) : null}
            </section>

            <PromotionSlot placementKey="festDetail" />
          </main>
        </div>
      </div>
    </div>
  );
}

export default FestDetailScreen;

// EventDetailScreen.jsx
// Route: /events/:eventSlug — the event page, rebuilt on the dedal design
// system (design/dedal-tokens.css → design/detail-page.css → event-detail.css).
//
// This screen renders OUTSIDE ParticipantLayout: there is no app header above
// it at all, so the back control in this page's own header is the only way out
// and is always rendered, even before the fest slug resolves.
//
// One component covers both shapes the hierarchy produces. An event WITH a
// category is registerable and its children are its ROUNDS; an event WITHOUT
// one is a container (a vertical) and its children are the events you can
// actually enter. The only differences between the two are which sections
// render, not which page renders.
//
// THE HIERARCHY THIS PAGE IMPOSES, top to bottom:
//   1. Hero — poster, name, category, fest. The identity.
//   2. Info block — four 44px rows (when, where, format+fee, capacity). The
//      facts, as rows with hairlines, never as cards.
//   3. Registration card — THE one raised, bordered object on the page.
//   4. Everything else — about, rounds/events, related, good-to-know, FAQs,
//      contact. Rows and dividers only.
// A second card anywhere in (4) would cost (3) its meaning.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import gsap from 'gsap';
import apiClient from '../../api-client/api-client.js';
import { fetchPublicCatalogTree } from '../../helpers/public-catalog.js';
import { saveIntendedRoute } from '../../helpers/post-sign-in-redirect.js';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { useSavedEvents } from '../../hooks/use-saved-events/use-saved-events.js';
import {
  formatScheduleRange,
  formatShortDate,
  formatClockTime,
  formatFeeLabel,
  formatEventTypeFull,
  formatScoringFormat,
  formatPaiseAmount,
  computeCapacityState,
  isRegistrationClosed,
} from '../../helpers/event-format.js';
import { formatCategoryLabel } from '../../helpers/category-format.js';
import { buildMapsUrl } from '../../helpers/venue-map-link.js';
import { buildGoogleCalendarUrl, buildIcsUrl } from '../../helpers/calendar-links.js';
import { buildChildrenByParent, childrenOf, isRegisterableEvent } from '../../helpers/event-tree.js';
import { formatTeamErrorMessage } from '../../helpers/team-error-messages.js';
import { eventPageSponsor } from '../../helpers/sponsor-hierarchy.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import TeamCodeEntry from '../../components/team-code-entry/TeamCodeEntry.jsx';
import {
  BackIcon,
  BookmarkIcon,
  CapacityIcon,
  VenueIcon,
  DateIcon,
  TeamIcon,
  ChevronIcon,
  ExpandIcon,
  PhoneIcon,
  RetryIcon,
  OfflineIcon,
  PassIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { TEAMS_COPY, CONNECTION_COPY, CALENDAR_COPY } from '../../brand/brand-copy.js';
import '../../design/detail-page.css';
import './event-detail.css';

// The one place this file asks whether motion is welcome. Read at the moment of
// the interaction rather than cached, so toggling the OS setting takes effect
// without a reload — and every CSS animation in event-detail.css is wrapped in
// the same query, so the two can never disagree.
function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// `scoringFormat` is optional on the model and formatScoringFormat falls back to
// the "Standard" label for a missing one. Printing that is worse than printing
// nothing: it invents a format the organiser never chose.
function readScoringLabel(event) {
  if (!event?.scoringFormat || event.scoringFormat === 'none') {
    return null;
  }
  return formatScoringFormat(event);
}

// upcoming / live / done, from the clock. Used for the rounds list, where the
// only thing anyone wants to know is whether a heat has already run.
function readRunState(node, now) {
  const start = node?.startsAt ? new Date(node.startsAt).getTime() : null;
  const end = node?.endsAt ? new Date(node.endsAt).getTime() : null;
  if (start && end && now >= start && now <= end) {
    return 'live';
  }
  if (end && now > end) {
    return 'done';
  }
  return 'upcoming';
}

function formatRoundWhen(node) {
  const date = formatShortDate(node.startsAt);
  const time = formatClockTime(node.startsAt);
  return [date, time].filter(Boolean).join(', ');
}

/*
 * The posterless hero's monogram.
 *
 * Most events in this data have no poster. A monogram is the one mark that can
 * be DERIVED from what the API already returns rather than invented: the
 * initials of the event's own name. Two letters maximum — three-letter
 * monograms stop reading as a mark and start reading as an acronym the
 * organiser never chose. Leading digits and punctuation are skipped, so
 * "5th Perspective" marks as "P" rather than "5P".
 */
function readMonogram(eventName) {
  const letters = String(eventName ?? '')
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}]/gu, '').charAt(0))
    .filter(Boolean);
  return letters.slice(0, 2).join('').toUpperCase();
}

/*
 * WHAT THE CAPACITY LINE SAYS, and why it leads with what is LEFT.
 *
 * "0 of 30 places taken" — the common case in this data — is a sentence whose
 * subject is the number zero. Nobody deciding whether to enter needs to know
 * how many people have not entered; they need to know whether there is room,
 * and how much pressure there is to decide now. So the line is written from the
 * remaining seats and changes register three times: an untouched event states
 * the size of the field, an ordinary one counts down quietly, and one at or past
 * four-fifths full says "only". Full is its own sentence, because "0 places
 * left" makes somebody do the arithmetic to reach "I cannot enter".
 */
function readCapacityCopy(event, capacityState) {
  const total = event.capacity;
  const taken = event.registeredCount ?? 0;
  const remaining = Math.max(0, total - taken);
  if (capacityState.isFull) {
    return { text: 'All places taken', isUrgent: true };
  }
  if (taken === 0) {
    return { text: `${total} places, all still open`, isUrgent: false };
  }
  if (capacityState.isFillingFast) {
    return { text: `Only ${remaining} of ${total} places left`, isUrgent: true };
  }
  return { text: `${remaining} of ${total} places left`, isUrgent: false };
}

// The weight/gender/age arrays are free-text on the model. They are rendered as
// quiet chips only when an organiser actually filled one in; an empty array is
// the overwhelmingly common case and renders nothing at all.
function readCategoryChips(event) {
  const groups = [
    { label: 'Weight', values: event?.weightCategories },
    { label: 'Gender', values: event?.genderCategories },
    { label: 'Age', values: event?.ageCategories },
  ];
  return groups.filter((group) => Array.isArray(group.values) && group.values.length > 0);
}

function EventDetailScreen() {
  const navigate = useTransitionNavigate();
  const location = useLocation();
  const { eventSlug } = useParams();
  const { isAuthenticated } = useAuthentication();
  const { isSaved, toggleSaved } = useSavedEvents();
  const isOnline = useOnlineStatus();

  const [event, setEvent] = useState(null);
  const [festSlug, setFestSlug] = useState(null);
  /*
   * THE FEST, not just its sponsors.
   *
   * `festName` is not in the public EVENT allowlist, so the hero could not
   * overlay it from the event payload — the previous build dropped the line
   * rather than render `undefined`. GET /public/fests/:festId does carry it,
   * and it is the same request useFestSponsors was already making for the
   * sponsor fallback, so this replaces that hook rather than adding a second
   * fetch of the same document: one fire-and-forget call now yields both the
   * fest's name and its sponsor array. It resolves to null on any failure and
   * never blocks first paint.
   */
  const [fest, setFest] = useState(null);
  const [staffContacts, setStaffContacts] = useState([]);
  // The whole fest tree, flat. Needed for THREE things now — a container's
  // child events, a registerable event's rounds, and the sibling events under
  // the same parent that feed "More in …". All from one array.
  const [festEvents, setFestEvents] = useState([]);
  const [contingents, setContingents] = useState([]);
  const [existingRegistrationId, setExistingRegistrationId] = useState(null);
  const [loadState, setLoadState] = useState('loading');

  const [showRules, setShowRules] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isDescriptionClamped, setIsDescriptionClamped] = useState(false);
  // One FAQ open at a time — an accordion, not a set of independent toggles.
  const [openFaqIndex, setOpenFaqIndex] = useState(null);
  const [isJoinPanelOpen, setIsJoinPanelOpen] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const descriptionRef = useRef(null);
  const aboutBodyRef = useRef(null);
  const aboutTweenRef = useRef(null);
  const aboutHeightRef = useRef(null);
  const headerRef = useRef(null);
  const heroRef = useRef(null);
  const bookmarkRef = useRef(null);

  /*
   * The clock, in state rather than a Date.now() read during render — reading it
   * mid-render makes "live now" depend on when React happened to re-render.
   * Ticking it every half minute is what makes a round flip from "upcoming" to
   * "live now" while the page is open.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const loadEvent = useCallback(async () => {
    setLoadState('loading');
    setFestEvents([]);
    setContingents([]);
    setFest(null);
    try {
      /*
       * Three-step resolution, in order — UNCHANGED, and load-bearing:
       *   1. festSlug from navigation state (in-app taps).
       *   2. The public catalog tree (ordinary fest events deep-linked).
       *   3. The FLAT GET /public/events/:eventSlug lookup — the only path
       *      that reaches INDEPENDENT events on a shared URL / QR / refresh:
       *      their wrapper fests are hidden from the catalog, so steps 1-2
       *      cannot resolve them. Its payload IS the event (plus festSlug),
       *      so no second fetch is needed.
       * Only when all three fail does the error state show.
       */
      let resolvedFestSlug = location.state?.festSlug;
      if (!resolvedFestSlug) {
        // Full tree so a container (vertical) slug deep-linked without nav state
        // still resolves — leaf-only would miss it.
        const { events } = await fetchPublicCatalogTree().catch(() => ({ events: [] }));
        resolvedFestSlug = events.find((candidate) => candidate.eventSlug === eventSlug)?.festSlug;
      }

      let eventDetail;
      if (resolvedFestSlug) {
        setFestSlug(resolvedFestSlug);
        eventDetail = await apiClient.get(`/public/fests/${resolvedFestSlug}/events/${eventSlug}`);
      } else {
        const flatEvent = await apiClient.get(`/public/events/${eventSlug}`).catch(() => null);
        if (!flatEvent?.festSlug) {
          setLoadState('error');
          return;
        }
        setFestSlug(flatEvent.festSlug);
        eventDetail = flatEvent;
      }
      setEvent(eventDetail);
      setLoadState('ready');

      // Everything below is secondary and NONE of it may fail the page: a dead
      // contacts endpoint must not cost somebody the register button.
      apiClient
        .get(`/public/events/${eventDetail.id}/staff-contacts`)
        .then((payload) =>
          setStaffContacts(Array.isArray(payload?.contacts) ? payload.contacts : []),
        )
        .catch(() => setStaffContacts([]));

      apiClient
        .get(`/public/fests/${eventDetail.festId}/events?includeChildren=true`)
        .then((tree) => setFestEvents(Array.isArray(tree) ? tree : []))
        .catch(() => setFestEvents([]));

      // The fest itself: its name for the hero, its sponsors for the credit.
      apiClient
        .get(`/public/fests/${eventDetail.festId}`)
        .then((payload) => setFest(payload ?? null))
        .catch(() => setFest(null));

      // Bundles hang off a container (vertical) only.
      if (!isRegisterableEvent(eventDetail)) {
        apiClient
          .get(`/public/events/${eventDetail.id}/contingents`)
          .then((payload) =>
            setContingents(Array.isArray(payload?.contingents) ? payload.contingents : []),
          )
          .catch(() => setContingents([]));
      }
    } catch {
      setLoadState('error');
    }
  }, [eventSlug, location.state]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEvent();
  }, [loadEvent]);

  /*
   * "Registered" is a different button from "Register", so the page has to know
   * before it can render the CTA honestly. Signed-out users skip it entirely —
   * /registrations/mine is authenticated — and a failure is swallowed: the
   * fallback is the ordinary Register button, which the backend rejects with a
   * real message if a duplicate slips through.
   */
  useEffect(() => {
    if (!isAuthenticated || !event?.id) {
      return undefined;
    }
    let isCurrent = true;
    apiClient
      .get('/registrations/mine')
      .then((payload) => {
        const rows = Array.isArray(payload) ? payload : (payload?.registrations ?? []);
        // eventId arrives populated on some responses and as a bare id string on
        // others; both mean the same thing.
        const mine = rows.find((row) => (row?.eventId?.id ?? row?.eventId) === event.id);
        if (isCurrent) {
          setExistingRegistrationId(mine?.id ?? null);
        }
      })
      .catch(() => {
        if (isCurrent) {
          setExistingRegistrationId(null);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [isAuthenticated, event?.id]);

  /*
   * The "read more" toggle appears only when the text is ACTUALLY cut off.
   * Measured, not guessed from a character count: the clamp is three rendered
   * lines, and how many characters fit in three lines depends on the viewport,
   * the font and the words. Re-measured on resize for the same reason.
   */
  useEffect(() => {
    const node = descriptionRef.current;
    if (!node) {
      return undefined;
    }
    const measure = () => {
      setIsDescriptionClamped(node.scrollHeight > node.clientHeight + 1);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [event?.description, loadState, isDescriptionExpanded]);

  /*
   * THE ABOUT EXPAND, in GSAP, and why it is a layout effect rather than a
   * handler.
   *
   * Height cannot be tweened from a click handler without measuring twice
   * around a state change that has not happened yet. Here the collapsed height
   * is captured on the previous commit, React has already laid out the expanded
   * text by the time this runs, and the tween simply plays the gap — so the
   * animation is always between two real measured heights and never a guess.
   *
   * `clearProps` hands the height back to the stylesheet at the end, so a resize
   * after expanding does not leave the paragraph frozen at a stale pixel value.
   * Skipped entirely under reduced motion: the content still changes, instantly.
   */
  useLayoutEffect(() => {
    const node = aboutBodyRef.current;
    if (!node) {
      aboutHeightRef.current = null;
      return;
    }
    const from = aboutHeightRef.current;
    const to = node.getBoundingClientRect().height;
    aboutHeightRef.current = to;
    if (from === null || Math.abs(from - to) < 1 || prefersReducedMotion()) {
      return;
    }
    aboutTweenRef.current?.kill();
    aboutTweenRef.current = gsap.fromTo(
      node,
      { height: from },
      { height: to, duration: 0.24, ease: 'power2.out', clearProps: 'height' },
    );
    /*
     * `showRules` is deliberately NOT a dependency any more. The rules body
     * collapses itself now (see .ded-rules__reveal), so running this tween on
     * the same toggle would have two animations fighting for the same height —
     * and this one measures synchronously, before the grid row has moved, so
     * its target would be wrong every time.
     */
  }, [isDescriptionExpanded]);

  /*
   * Re-read the About box once the rules row has settled, so the cached height
   * the tween animates FROM matches what is actually on screen. Without it the
   * next "Read more" would start from a value measured before the rules opened
   * and the paragraph would jump.
   */
  const refreshAboutHeight = useCallback(() => {
    const node = aboutBodyRef.current;
    if (node) {
      aboutHeightRef.current = node.getBoundingClientRect().height;
    }
  }, []);

  /*
   * A tween outliving its element is the one way GSAP leaks on a route change.
   * `kill()` freezes the inline height wherever it stopped and never fires
   * clearProps, so the height is settled here too — the element is usually
   * going away, but this effect also re-runs under StrictMode, where it is not.
   */
  useEffect(
    () => () => {
      aboutTweenRef.current?.kill();
      const node = aboutBodyRef.current;
      if (node) {
        node.style.height = '';
      }
    },
    [],
  );

  /*
   * THE SCROLL-LINKED HEADER.
   *
   * Past the hero the header stops being two white glyphs floating on a poster
   * and becomes a contextual bar: the background crossfades in and the event's
   * name fades up beside the back arrow, so somebody four screens down still
   * knows what they are reading and still has a way out.
   *
   * A CLASS TOGGLE ON A REF, NOT setState. Putting the scroll position in state
   * re-renders this entire screen — hero, rounds, FAQs, contacts — on every
   * scroll frame. The listener is passive, rAF-throttled, and writes one class
   * name only when the boolean actually flips, so a full scroll of the page
   * costs a handful of classList calls rather than hundreds of renders.
   */
  useEffect(() => {
    if (loadState !== 'ready') {
      return undefined;
    }
    const headerNode = headerRef.current;
    if (!headerNode) {
      return undefined;
    }
    let isStuck = false;
    let isFramePending = false;
    const apply = () => {
      isFramePending = false;
      const heroHeight = heroRef.current?.offsetHeight ?? 0;
      // The switch happens as the header would start to overlap the sheet's
      // rounded top edge, not at the very bottom of the hero: a bar that
      // appears only once the poster is completely gone arrives late.
      const shouldStick = window.scrollY > Math.max(0, heroHeight - 96);
      if (shouldStick !== isStuck) {
        isStuck = shouldStick;
        headerNode.classList.toggle('ded-header--stuck', shouldStick);
      }
    };
    const onScroll = () => {
      if (!isFramePending) {
        isFramePending = true;
        window.requestAnimationFrame(apply);
      }
    };
    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [loadState, event?.id]);

  function handleBack() {
    /*
     * navigate(-1) when this page was reached from inside the app, and the fest
     * page otherwise. A deep link (QR code, shared URL, refresh) has no previous
     * entry of ours, so navigate(-1) would walk the user out of the app to
     * whatever they were browsing before — and this screen has no app header to
     * offer them a second way back.
     */
    if (location.key && location.key !== 'default') {
      navigate(-1);
      return;
    }
    navigate(festSlug ? `/fests/${festSlug}` : '/');
  }

  /*
   * The bookmark's 150ms bounce. Restarting a CSS animation needs the class off,
   * a forced reflow, then the class on — doing it through state would re-render
   * the page to play a 150ms scale on one glyph.
   */
  function handleToggleSaved() {
    toggleSaved(event.id);
    const node = bookmarkRef.current;
    if (node && !prefersReducedMotion()) {
      node.classList.remove('ded-header__control--pop');
      void node.offsetWidth;
      node.classList.add('ded-header__control--pop');
    }
  }

  function handleRegister() {
    if (!isAuthenticated) {
      /*
       * Router state is lost across the sign-in round-trip (the OTP screen and
       * the Google flow both remount/renavigate), and nothing ever read
       * `state.returnTo` — the sessionStorage stash is what
       * resolvePostSignInRoute actually honours, so the user lands straight
       * back on this event's registration form.
       */
      saveIntendedRoute(`/register/${event.id}`);
      navigate('/');
      return;
    }
    navigate(`/register/${event.id}`);
  }

  function handleOpenJoinPanel() {
    if (!isAuthenticated) {
      // Same stash as handleRegister. Joining needs this screen's panel, so
      // return here, not to the register form.
      saveIntendedRoute(location.pathname);
      navigate('/');
      return;
    }
    setIsJoinPanelOpen((wasOpen) => !wasOpen);
  }

  async function handleJoinWithCode(inviteCode, hasAcceptedMedicalDeclaration) {
    if (isJoining) {
      return;
    }
    setJoinError('');
    setIsJoining(true);
    try {
      const result = await apiClient.post('/registrations/mine/join-team', {
        inviteCode,
        ...(hasAcceptedMedicalDeclaration !== undefined ? { hasAcceptedMedicalDeclaration } : {}),
      });
      const registrationId = result?.registration?.id;
      if (result?.payment?.paymentGroupId) {
        // A paid event: the joiner pays their own share before the seat confirms.
        navigate(`/checkout/${result.payment.paymentGroupId}`, {
          state: { registrationId: registrationId ?? null, event, team: result.team ?? null },
        });
      } else if (typeof registrationId === 'string' && registrationId !== '') {
        // A joined member lands on their registration and pass, not on a list.
        navigate(`/my-registrations/${registrationId}`, { replace: true });
      } else {
        // Never navigate to a half-built path — the team screen shows an
        // explicit success state instead.
        navigate('/my-teams', { state: { justJoined: true } });
      }
    } catch (error) {
      setJoinError(formatTeamErrorMessage(error, TEAMS_COPY.joinFailed));
    } finally {
      setIsJoining(false);
    }
  }

  function handleOpenBundle(bundle) {
    if (!isAuthenticated) {
      saveIntendedRoute(location.pathname);
      navigate('/');
      return;
    }
    navigate(`/contingents/${bundle.id}/purchase`, {
      state: { contingent: bundle, festId: event.festId },
    });
  }

  // ── Derived state ───────────────────────────────────────────────────────
  const childrenByParent = useMemo(() => buildChildrenByParent(festEvents), [festEvents]);
  const children = useMemo(
    () => (event ? childrenOf(event.id, childrenByParent) : []),
    [event, childrenByParent],
  );

  const nodesById = useMemo(
    () => new Map(festEvents.map((node) => [node.id, node])),
    [festEvents],
  );

  /*
   * RELATED EVENTS — the siblings under the same parent, minus this one.
   *
   * Free: the whole fest tree is already in memory for the rounds list, so this
   * costs one filter and no request. Registerable siblings only — a sibling
   * that is itself a container is a vertical, and offering "Sports" beside a
   * 100m heat is a level change, not a related event.
   */
  const relatedEvents = useMemo(() => {
    if (!event || festEvents.length === 0) {
      return [];
    }
    return childrenOf(event.parentEventId ?? 'root', childrenByParent)
      .filter((node) => node.id !== event.id && isRegisterableEvent(node))
      .slice(0, 8);
  }, [event, festEvents, childrenByParent]);

  // What to call that group. The parent's own name when this event hangs under
  // a vertical, the fest's name when it sits at the root, and nothing at all
  // until one of the two has loaded — "More in undefined" is worse than a plain
  // heading, so the fallback is a heading with no proper noun in it.
  const relatedHeading = (() => {
    const parentName = event?.parentEventId ? nodesById.get(event.parentEventId)?.eventName : null;
    const groupName = parentName ?? fest?.festName ?? null;
    return groupName ? `More in ${groupName}` : 'More in this fest';
  })();

  /*
   * THE CATEGORY ANCESTOR — the top-level vertical this event hangs under.
   *
   * sponsor-hierarchy.js owns which of event/category/fest wins; all this page
   * has to do is hand it the right category node. That node is NOT the event's
   * parent: the tree is up to four levels deep (fest → vertical → sub-vertical
   * → event), so "Sports → Athletics → 100m" would resolve to Athletics and
   * miss the brand that actually bought Sports. So this walks parentEventId all
   * the way to the node whose parent is null.
   *
   * `seen` guards a parentEventId cycle in the data. A malformed tree must cost
   * a missing sponsor line, never a hung render loop.
   *
   * Returns null when the walk ends on the event itself — a root-level container
   * IS its own top level, and its own sponsors were already the first thing
   * eventPageSponsor looked at.
   */
  const categoryAncestor = useMemo(() => {
    if (!event || festEvents.length === 0) {
      return null;
    }
    let node = nodesById.get(event.id) ?? event;
    const seen = new Set();
    while (node?.parentEventId && !seen.has(node.id)) {
      seen.add(node.id);
      const parent = nodesById.get(node.parentEventId);
      if (!parent) {
        break;
      }
      node = parent;
    }
    return node && node.id !== event.id ? node : null;
  }, [event, festEvents, nodesById]);

  /*
   * Who gets named. The tier maths, the "most specific wins" order and the
   * "always name someone if anyone exists" rule all live in sponsor-hierarchy;
   * this is only the call. null when the entire chain is empty, which is the
   * single condition the line renders on.
   */
  const sponsorCredit = useMemo(
    () => eventPageSponsor(event, categoryAncestor, { sponsors: fest?.sponsors ?? [] }),
    [event, categoryAncestor, fest],
  );

  // The one rule that decides the page: a category means you can enter this,
  // and anything under it is a round. No category means it groups other events.
  const isContainer = Boolean(event) && !isRegisterableEvent(event);

  const isLiveNow = event ? readRunState(event, now) === 'live' && Boolean(event.startsAt) : false;

  const capacity = event ? computeCapacityState(event) : null;
  const showCapacity = Boolean(capacity && !capacity.isUnlimited);
  const capacityCopy = showCapacity ? readCapacityCopy(event, capacity) : null;

  /*
   * The closing date and whether it is close enough to matter. Seven days is
   * the same horizon the feed and the fest page use, so a deadline does not
   * become urgent on one screen and ordinary on the next.
   */
  const closesLabel = event?.registrationClosesAt
    ? formatShortDate(event.registrationClosesAt)
    : null;
  const isDeadlineNear = (() => {
    if (!event?.registrationClosesAt) {
      return false;
    }
    const closesAt = new Date(event.registrationClosesAt).getTime();
    if (Number.isNaN(closesAt)) {
      return false;
    }
    return closesAt >= now && closesAt - now <= 7 * 24 * 60 * 60 * 1000;
  })();

  /*
   * CANCELLED IS ITS OWN STATE, checked before "closed".
   *
   * Both disable the button, but they are not the same news: "registration
   * closed" means the event is happening and you are too late, "cancelled"
   * means it is not happening at all. Collapsing the second into the first is
   * how someone travels to a fest for an event that was called off.
   *
   * THE PRECEDENCE BELOW IS LOAD-BEARING AND MUST NOT BE REORDERED:
   *   cancelled → already registered → closed → full without a waitlist →
   *   waitlist → register.
   */
  const isCancelled = event?.status === 'cancelled';
  const registrationClosed = event ? isRegistrationClosed(event) : false;
  const isFullNoWaitlist = Boolean(capacity?.isFull && !event?.waitlistEnabled);
  const isWaitlistCta = Boolean(capacity?.isFull && event?.waitlistEnabled) && !registrationClosed;

  let ctaLabel = 'Register';
  let ctaReason = null;
  let ctaDisabled = false;
  let ctaAction = handleRegister;

  if (isCancelled) {
    ctaLabel = 'Event cancelled';
    ctaReason = 'The organiser called this event off.';
    ctaDisabled = true;
  } else if (existingRegistrationId) {
    // Ahead of "closed" deliberately: somebody who already holds a seat still
    // needs the way to their pass after registration shuts.
    /*
     * "View pass" GOES TO THE PASS. It used to open the registration detail,
     * which is a different screen answering a different question: the
     * registration is the record of having signed up, the pass is the thing you
     * hold at the gate. A button that names one and opens the other is the kind
     * of mismatch you only notice at the door.
     *
     * The pass is per FEST, not per event — one pass covers everything you are
     * registered for at that fest — so it is keyed on the event's festId.
     * Falling back to the registration only if the event somehow has no fest,
     * which would otherwise leave the button dead.
     */
    ctaLabel = 'View pass';
    ctaAction = () =>
      navigate(
        event.festId ? `/my-passes/${event.festId}` : `/my-registrations/${existingRegistrationId}`,
      );
  } else if (registrationClosed) {
    ctaLabel = 'Registration closed';
    ctaReason = 'Registrations are no longer being taken.';
    ctaDisabled = true;
  } else if (isFullNoWaitlist) {
    ctaLabel = 'Event full';
    // The count, not just the word: "Event full — 60/60" is the difference
    // between a state and a fact somebody can check against what they read
    // higher up the page.
    ctaReason = `Event full — ${event?.registeredCount ?? 0}/${event?.capacity ?? 0}`;
    ctaDisabled = true;
  } else if (isWaitlistCta) {
    // Full, but the organiser opened a queue — the button stays live and says
    // what it will do. The backend still decides seat-or-queue; the last place
    // can go between this render and the tap.
    ctaLabel = 'Join waitlist';
  }

  // A paid event says so on the button itself. "Register" and "Pay ₹1,000" are
  // different promises, and the second one should not be a surprise on the
  // checkout screen.
  const isFree = event ? formatFeeLabel(event) === 'Free' : false;
  /*
   * `event &&` IS LOAD-BEARING, not defensive noise.
   *
   * While the event is still loading `isFree` is false — because there is no
   * fee to read, not because there is a price. Without the null check that
   * absence reads as "this event is paid", isPayCta turns true, and the line
   * below calls formatFeeLabel(null), which throws and takes the whole screen
   * to the error boundary before it has had a chance to render anything.
   */
  const isPayCta =
    Boolean(event) && !ctaDisabled && !existingRegistrationId && !isFree && !isWaitlistCta;
  if (isPayCta) {
    ctaLabel = `Pay ${formatFeeLabel(event)}`;
  }

  // The create/join pair only makes sense while a team can still be formed.
  const showTeamPair =
    !isContainer && event?.eventType === 'team' && !ctaDisabled && !existingRegistrationId;

  const mapsUrl = event?.venue ? buildMapsUrl(event.venue) : null;
  const categoryLabel = event ? formatCategoryLabel(event.category) : null;
  const scoringLabel = readScoringLabel(event);
  const faqs = event?.faqs ?? [];
  const offers = Array.isArray(event?.offers) ? event.offers : [];
  const categoryChips = readCategoryChips(event);
  const googleCalendarUrl = event ? buildGoogleCalendarUrl(event) : null;
  const icsUrl = event ? buildIcsUrl(event.id) : null;

  const hasGoodToKnow = Boolean(
    event &&
      (event.prizePoolDescription ||
        event.certificateTemplateUrl ||
        event.isLeaderboardVisible ||
        scoringLabel ||
        offers.length > 0 ||
        categoryChips.length > 0 ||
        (event.customQuestions?.length ?? 0) > 0 ||
        event.requiresMedicalDeclaration),
  );

  /*
   * The action pair, rendered in TWO places and written once.
   *
   * On a phone it lives in the bar pinned to the foot of the screen. On a
   * desktop there is no bar at all — a full-width strip welded across a 1440px
   * window to hold one button is a phone pattern wearing a desktop layout — and
   * the same controls sit in the sticky sidebar instead, where they are always
   * on screen anyway. Only one of the two is ever displayed (the other is
   * `display: none`, so it is out of the accessibility tree too).
   */
  function renderActions() {
    if (showTeamPair) {
      return (
        <div className="ded-cta__pair">
          <button
            type="button"
            className="ddp-button ddp-button--quiet"
            onClick={handleOpenJoinPanel}
            aria-expanded={isJoinPanelOpen}
          >
            Join with code
          </button>
          <button type="button" className="ddp-button" onClick={handleRegister}>
            Create team
          </button>
        </div>
      );
    }
    return (
      <button type="button" className="ddp-button" onClick={ctaAction} disabled={ctaDisabled}>
        {existingRegistrationId && !isCancelled ? (
          <PassIcon size="sm" className="ddp-icon ddp-icon--sm" />
        ) : null}
        {ctaLabel}
      </button>
    );
  }

  return (
    <div className="ddp-screen ded-screen">
      {/* Cached content is still worth reading offline; the bar says why it may
          be stale rather than replacing the page. */}
      {!isOnline && loadState === 'ready' ? (
        <div className="ddp-offline ded-offline">
          <div className="ded-offline__inner">
            <OfflineIcon size="sm" className="ddp-icon ddp-icon--sm" />
            <span>{CONNECTION_COPY.offlineTitle}</span>
          </div>
        </div>
      ) : null}

      {/*
        THE WAY OUT, BEFORE THERE IS A HERO TO PUT IT ON.

        This screen has no app header above it, so the arrow is the only route
        off the page — and in the loading and error states there is no hero to
        carry it. A failed load was therefore a dead end: one sentence, a retry
        button, and nothing else to press.
      */}
      {loadState === 'ready' && event ? null : (
        <div className="ddp-backbar">
          <button
            type="button"
            className="ddp-hero__control"
            onClick={handleBack}
            aria-label="Go back"
          >
            <BackIcon size="lg" className="ddp-icon ddp-icon--lg" />
          </button>
        </div>
      )}

      {loadState === 'loading' ? (
        // Shaped like the real page — hero, fact lines, a block — so the layout
        // does not jump when the data lands.
        <>
          <div className="ddp-skel ded-skel--hero" />
          <div className="ded-sheet ded-skel-stack">
            <div className="ddp-skel ddp-skel--line ded-skel-line--wide" />
            <div className="ddp-skel ddp-skel--line" />
            <div className="ddp-skel ddp-skel--line ded-skel-line--short" />
            <div className="ddp-skel ddp-skel--block" />
          </div>
        </>
      ) : null}

      {loadState === 'error' ? (
        <div className="ded-sheet">
          <div className="ddp-state ddp-state--error">
            <p className="ddp-state__text">
              {isOnline ? 'This event could not be loaded.' : CONNECTION_COPY.offlineMessage}
            </p>
            <button type="button" className="ddp-button" onClick={loadEvent}>
              <RetryIcon size="sm" className="ddp-icon ddp-icon--sm ded-button__icon" />
              {CONNECTION_COPY.errorRetry}
            </button>
          </div>
        </div>
      ) : null}

      {loadState === 'ready' && event ? (
        <>
          {/*
            ONE HEADER, TWO STATES — floating over the poster at the top of the
            page, and a solid contextual bar once the hero has scrolled away.
            The class is toggled by the scroll listener above; nothing here
            re-renders when it flips.
          */}
          <header ref={headerRef} className="ded-header">
            <button
              type="button"
              className="ded-header__control"
              onClick={handleBack}
              aria-label="Go back"
            >
              <BackIcon size="lg" className="ddp-icon ddp-icon--lg" />
            </button>
            {/* aria-hidden: the same name is already the page's h1 in the hero,
                and announcing it twice on the way down the page is noise. */}
            <span className="ded-header__title" aria-hidden="true">
              {event.eventName}
            </span>
            <button
              ref={bookmarkRef}
              type="button"
              className="ded-header__control"
              onClick={handleToggleSaved}
              aria-pressed={isSaved(event.id)}
              aria-label={isSaved(event.id) ? 'Remove from saved' : 'Save this event'}
            >
              <BookmarkIcon size="lg" className="ddp-icon ddp-icon--lg" filled={isSaved(event.id)} />
            </button>
          </header>

          {/* ── Hero ─────────────────────────────────────────────────────── */}
          <div ref={heroRef} className="ded-hero">
            {event.posterImageUrl ? (
              <img className="ded-hero__media" src={event.posterImageUrl} alt="" />
            ) : (
              /*
               * The posterless hero. --primary → --accent, the system's one
               * featured-media pairing, with the event's own initials in it at
               * poster scale and cropped by the frame the way a real poster's
               * artwork would be. Derived, not invented, so two posterless
               * events look like two events rather than two copies of one slab.
               */
              <div className="ded-hero__fallback" aria-hidden="true">
                <span className="ded-hero__mark">{readMonogram(event.eventName)}</span>
              </div>
            )}
            {/*
              The scrim. A literal black/ink rgba rather than a token, and the
              precedent is .ddp-hero__scrim in detail-page.css: this sits over an
              arbitrary photograph, where a canvas colour would tint the image
              underneath it. See the note at .ded-hero__scrim.
            */}
            <div className="ded-hero__scrim">
              <div className="ded-hero__meta">
                {categoryLabel ? <span className="ded-hero__badge">{categoryLabel}</span> : null}
                {isLiveNow ? (
                  <span className="ded-hero__live">
                    <span className="ddp-live__dot" />
                    Live now
                  </span>
                ) : null}
              </div>
              <h1 className="ded-hero__title">{event.eventName}</h1>
              {/* The fest name, from GET /public/fests/:festId — it is not in
                  the event allowlist. Nothing renders until it arrives. */}
              {fest?.festName ? <p className="ded-hero__fest">{fest.festName}</p> : null}
            </div>
          </div>

          {/*
            THE SHEET. It overlaps the hero by 16px with a rounded top edge, so
            the content sits ON the image rather than beginning after a hard
            horizontal seam. There is no gap between the two by construction.
          */}
          <div className="ded-sheet">
            {/* ── The info block: four rows, hairlines, no cards ─────────── */}
            <section className="ded-info" aria-label="Event details">
              {event.startsAt ? (
                <div className="ded-info__row">
                  <DateIcon className="ddp-icon ded-info__icon" />
                  <span className="ded-info__value">
                    {formatScheduleRange(event.startsAt, event.endsAt)}
                  </span>
                </div>
              ) : null}

              {/*
                Venue is the only fact on this page you can act on. No link when
                buildMapsUrl declines the venue string — a dead anchor into an
                empty Maps search is worse than plain text.
              */}
              {event.venue ? (
                <div className="ded-info__row">
                  <VenueIcon className="ddp-icon ded-info__icon" />
                  {mapsUrl ? (
                    <a
                      className="ded-info__value ded-info__link"
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {event.venue}
                    </a>
                  ) : (
                    <span className="ded-info__value ded-info__value--quiet">{event.venue}</span>
                  )}
                </div>
              ) : null}

              {!isContainer ? (
                <div className="ded-info__row">
                  <TeamIcon className="ddp-icon ded-info__icon" />
                  <span className="ded-info__value">{formatEventTypeFull(event)}</span>
                  <span
                    className={isFree ? 'ded-info__end ded-info__end--free' : 'ded-info__end'}
                  >
                    {formatFeeLabel(event)}
                  </span>
                </div>
              ) : null}

              {/*
                Capacity is a ROW with an inline 4px bar, not a section of its
                own. It is one fact — is there room — and the bar is the glance
                version of the sentence beside it, so they belong on one line.

                THE METER BAR IS GONE. It restated the sentence beside it: "42 of
                60 seats taken" already says how full the event is, in exact
                numbers, and a progress bar in a list of plain facts reads as a
                loading indicator rather than as data. The urgency it carried is
                carried better by --primary on the text itself.
              */}
              {showCapacity && capacityCopy ? (
                <div className="ded-info__row">
                  {/* A real icon, not the 6px dot this used to be. Every other
                      row in this block carries a glyph that says what the fact
                      IS; a bare dot said nothing and read as a bullet that had
                      lost its list. */}
                  <CapacityIcon className="ddp-icon ded-info__icon" />
                  <span
                    className={
                      capacityCopy.isUrgent
                        ? 'ded-info__value ded-info__value--urgent'
                        : 'ded-info__value'
                    }
                  >
                    {capacityCopy.text}
                  </span>
                </div>
              ) : null}
            </section>

            <div className="ded-layout">
              {/*
                The sidebar on desktop, and simply the next thing on the page on
                a phone. It holds what somebody refers back to while reading:
                whether they can enter, who paid for the event, and the action.
              */}
              <div className="ded-side">
                {/* ── The registration card: the ONE card on this page ───── */}
                {!isContainer ? (
                  <div
                    className={
                      registrationClosed || isCancelled
                        ? 'ded-reg ded-reg--static'
                        : 'ded-reg ded-reg--open'
                    }
                  >
                    <div className="ded-reg__inner">
                      <p
                        className={
                          isDeadlineNear || registrationClosed || isCancelled
                            ? 'ded-reg__status ded-reg__status--urgent'
                            : 'ded-reg__status'
                        }
                      >
                        {/*
                          THE CLOSING DATE ONLY, NEVER A RANGE.
                          formatRegistrationWindow returns "JUL 20 – JUL 29",
                          which is the right shape for a chip describing a window
                          and nonsense after the word "until". And --primary only
                          inside the seven-day horizon or once shut: a deadline
                          five weeks out painted in the signature colour is the
                          page shouting at somebody with a month to decide.
                        */}
                        {isCancelled
                          ? 'This event was cancelled'
                          : registrationClosed
                            ? 'Registration closed'
                            : closesLabel
                              ? `Registration open until ${closesLabel}`
                              : 'Registration open'}
                      </p>

                      <p className="ded-reg__note">
                        {event.eventType === 'team'
                          ? 'One of you creates the team; the rest join with its code.'
                          : 'You enter on your own.'}
                      </p>

                      {/* The desktop action lives here. On a phone this is
                          hidden and the pinned bar carries it instead. */}
                      <div className="ded-reg__actions">{renderActions()}</div>

                      {ctaReason ? <p className="ded-reg__reason">{ctaReason}</p> : null}
                    </div>
                  </div>
                ) : null}

                {isContainer ? (
                  <p className="ded-notice">This is a group. Choose an event below to register.</p>
                ) : null}

                {/*
                  THE SPONSOR CREDIT — one line, and BELOW the registration card.
                  It renders ONLY when eventPageSponsor found somebody; an empty
                  chain returns null and this whole node is never mounted. The
                  credit is a real <a> only when the sponsor bought a link.
                */}
                {sponsorCredit ? (
                  <p className="ded-sponsor">
                    {sponsorCredit.sponsor.linkUrl ? (
                      <a
                        className="ded-sponsor__body"
                        href={sponsorCredit.sponsor.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          className="ded-sponsor__logo"
                          src={sponsorCredit.sponsor.imageUrl}
                          alt={sponsorCredit.sponsor.sponsorName}
                          loading="lazy"
                        />
                        <span className="ded-sponsor__text">
                          Sponsored by{' '}
                          <span className="ded-sponsor__name">
                            {sponsorCredit.sponsor.sponsorName}
                          </span>
                        </span>
                      </a>
                    ) : (
                      <span className="ded-sponsor__body">
                        <img
                          className="ded-sponsor__logo"
                          src={sponsorCredit.sponsor.imageUrl}
                          alt={sponsorCredit.sponsor.sponsorName}
                          loading="lazy"
                        />
                        <span className="ded-sponsor__text">
                          Sponsored by{' '}
                          <span className="ded-sponsor__name">
                            {sponsorCredit.sponsor.sponsorName}
                          </span>
                        </span>
                      </span>
                    )}
                  </p>
                ) : null}

                {/*
                  The join-code panel. Pinned above the bar on a phone (the
                  control that opens it is at the foot of the screen, so a panel
                  three screens up is a panel nobody sees respond); plain flow
                  content inside the sidebar on desktop, where the control that
                  opens it is right above.
                */}
                {showTeamPair && isJoinPanelOpen ? (
                  <div className="ded-joinsheet">
                    <div className="ded-joinsheet__inner">
                      <p className="ded-joinsheet__title">Enter your team code</p>
                      <TeamCodeEntry
                        onSubmit={handleJoinWithCode}
                        isJoining={isJoining}
                        errorMessage={joinError}
                        showMedicalDeclaration={Boolean(event.requiresMedicalDeclaration)}
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="ded-main">
                {/* ── About ──────────────────────────────────────────────── */}
                {event.description ? (
                  <section className="ddp-section">
                    <h2 className="ddp-section__title">About this event</h2>
                    <div ref={aboutBodyRef} className="ded-about">
                      <p
                        ref={descriptionRef}
                        className={
                          isDescriptionExpanded ? 'ddp-prose' : 'ddp-prose ded-prose--clamped'
                        }
                      >
                        {event.description}
                      </p>
                      {isDescriptionClamped || isDescriptionExpanded ? (
                        <button
                          type="button"
                          className="ddp-more"
                          onClick={() => setIsDescriptionExpanded((wasOpen) => !wasOpen)}
                          aria-expanded={isDescriptionExpanded}
                        >
                          {isDescriptionExpanded ? 'Show less' : 'Read more'}
                        </button>
                      ) : null}

                      {event.rules ? (
                        <div className="ded-rules">
                          <button
                            type="button"
                            className="ddp-more"
                            onClick={() => setShowRules((wasOpen) => !wasOpen)}
                            aria-expanded={showRules}
                          >
                            {showRules ? 'Hide rules' : 'Read the rules'}
                          </button>
                          {/*
                            * ALWAYS MOUNTED, collapsed by the grid. It used to
                            * be `{showRules ? <p/> : null}`, which meant the
                            * text was deleted on the same frame the box began
                            * shrinking — you watched an empty gap close, and on
                            * the way in the fully-painted paragraph sat there
                            * while the box grew around it. Keeping it in the
                            * tree and animating a 0fr → 1fr grid row collapses
                            * the text WITH its container, in both directions.
                            *
                            * A grid row rather than transform, because this one
                            * genuinely has to take the space away from the
                            * content below it; the compositor-only rule cannot
                            * apply to a collapse that must reflow by
                            * definition. It is the narrowest possible exception
                            * and it is confined to this block.
                            */}
                          <div
                            className={`ded-rules__reveal${
                              showRules ? ' ded-rules__reveal--open' : ''
                            }`}
                            /* The About box tweens between two measured
                               heights and caches the last one. That cache goes
                               stale when this row finishes growing or
                               shrinking on its own, so it is refreshed here. */
                            onTransitionEnd={refreshAboutHeight}
                            inert={showRules ? undefined : true}
                          >
                            {/* The clipping wrapper; it must own no spacing of
                                its own — see .ded-rules__reveal__inner. */}
                            <div className="ded-rules__reveal__inner">
                              <p className="ddp-prose ded-rules__body">{event.rules}</p>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {/* ── Bundles (containers only) ──────────────────────────── */}
                {isContainer && contingents.length > 0 ? (
                  <section className="ddp-section">
                    <h2 className="ddp-section__title">Bundles</h2>
                    <ul className="ded-bundles">
                      {contingents.map((bundle) => (
                        <li key={bundle.id}>
                          <button
                            type="button"
                            className="ded-bundle"
                            onClick={() => handleOpenBundle(bundle)}
                          >
                            <span className="ded-bundle__name">{bundle.contingentName}</span>
                            <span className="ded-bundle__meta">
                              {bundle.includedEvents?.length ?? 0} events included
                            </span>
                            <span className="ded-bundle__price">
                              {formatPaiseAmount(bundle.pricePaise)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/*
                  ── Rounds, or a container's child events ─────────────────
                  Two lists, two shapes, because they mean different things.
                  Rounds are ONE event in time order — heat, semi, final — the
                  only sequential content on the page, and they get the rail: a
                  hairline with a node per round, filled once run, live in
                  --primary. A container's children are ALTERNATIVES you pick
                  between, so they are a two-column grid of mini cards matching
                  the fest page, each one a real destination.
                */}
                {children.length > 0 && isContainer ? (
                  <section className="ddp-section">
                    <h2 className="ddp-section__title">Events</h2>
                    <ul className="ded-grid">
                      {children.map((child) => (
                        <li key={child.id}>
                          <button
                            type="button"
                            className="ded-mini"
                            onClick={() =>
                              navigate(`/events/${child.eventSlug}`, { state: { festSlug } })
                            }
                          >
                            <span className="ded-mini__name">{child.eventName}</span>
                            {formatRoundWhen(child) ? (
                              <span className="ded-mini__meta">{formatRoundWhen(child)}</span>
                            ) : null}
                            <span className="ded-mini__foot">
                              <span className="ded-mini__fee">{formatFeeLabel(child)}</span>
                              <ChevronIcon size="sm" className="ddp-icon ded-mini__chev" />
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {children.length > 0 && !isContainer ? (
                  <section className="ddp-section">
                    <h2 className="ddp-section__title">Rounds</h2>
                    <ul className="ded-rounds">
                      {children.map((child) => {
                        const runState = readRunState(child, now);
                        const when = formatRoundWhen(child);
                        const statusLabel =
                          runState === 'live'
                            ? 'Live now'
                            : runState === 'done'
                              ? 'Completed'
                              : 'Upcoming';
                        /*
                         * A round is not a destination: its "page" would repeat
                         * this one with a different time, so it is a row of text
                         * rather than a control that promises a screen saying
                         * nothing new.
                         */
                        return (
                          <li
                            key={child.id}
                            className={`ded-round ded-round--step ded-round--${runState}`}
                          >
                            <div className="ded-round__hit">
                              <span className="ded-round__name">{child.eventName}</span>
                              {when ? <span className="ded-round__meta">{when}</span> : null}
                              <span className={`ded-round__status ded-round__status--${runState}`}>
                                {statusLabel}
                              </span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null}

                {/*
                  ── Related events ────────────────────────────────────────
                  The siblings under the same parent. A horizontal scroller on a
                  phone so eight of them cost one screen rather than eight, and
                  a grid once there is room. Free — the tree is already loaded.
                */}
                {relatedEvents.length > 0 ? (
                  <section className="ddp-section">
                    <h2 className="ddp-section__title">{relatedHeading}</h2>
                    <ul className="ded-rail">
                      {relatedEvents.map((sibling) => (
                        <li key={sibling.id}>
                          <button
                            type="button"
                            className="ded-mini ded-mini--rail"
                            onClick={() =>
                              navigate(`/events/${sibling.eventSlug}`, { state: { festSlug } })
                            }
                          >
                            <span className="ded-mini__name">{sibling.eventName}</span>
                            {formatRoundWhen(sibling) ? (
                              <span className="ded-mini__meta">{formatRoundWhen(sibling)}</span>
                            ) : null}
                            <span className="ded-mini__foot">
                              <span className="ded-mini__fee">{formatFeeLabel(sibling)}</span>
                              <ChevronIcon size="sm" className="ddp-icon ded-mini__chev" />
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* ── Good to know: the quiet rows ───────────────────────── */}
                {hasGoodToKnow ? (
                  <section className="ddp-section">
                    <h2 className="ddp-section__title">Good to know</h2>
                    <dl className="ded-rows">
                      {event.prizePoolDescription ? (
                        <div className="ded-row">
                          <dt className="ded-row__label">Prizes</dt>
                          <dd className="ded-row__value">{event.prizePoolDescription}</dd>
                        </div>
                      ) : null}
                      {scoringLabel ? (
                        <div className="ded-row">
                          <dt className="ded-row__label">Judged by</dt>
                          <dd className="ded-row__value">{scoringLabel}</dd>
                        </div>
                      ) : null}
                      {event.certificateTemplateUrl ? (
                        <div className="ded-row">
                          <dt className="ded-row__label">Certificate</dt>
                          <dd className="ded-row__value">
                            {/* The organiser uploaded a template, so a
                                certificate exists for everyone who finishes.
                                The template itself is an organiser artefact and
                                is deliberately not linked to a participant. */}
                            Certificate on completion
                          </dd>
                        </div>
                      ) : null}
                      {event.isLeaderboardVisible ? (
                        <div className="ded-row">
                          <dt className="ded-row__label">Scores</dt>
                          <dd className="ded-row__value">
                            Live leaderboard published during the event
                          </dd>
                        </div>
                      ) : null}
                      {categoryChips.map((group) => (
                        <div className="ded-row" key={group.label}>
                          <dt className="ded-row__label">{group.label}</dt>
                          <dd className="ded-row__value">
                            <span className="ded-chips">
                              {group.values.map((value) => (
                                <span className="ddp-badge" key={value}>
                                  {value}
                                </span>
                              ))}
                            </span>
                          </dd>
                        </div>
                      ))}
                      {offers.length > 0 ? (
                        <div className="ded-row">
                          <dt className="ded-row__label">Add-ons</dt>
                          <dd className="ded-row__value">
                            {offers.length === 1
                              ? '1 add-on available at registration'
                              : `${offers.length} add-ons available at registration`}
                          </dd>
                        </div>
                      ) : null}
                      {(event.customQuestions?.length ?? 0) > 0 ? (
                        <div className="ded-row">
                          <dt className="ded-row__label">Registration</dt>
                          <dd className="ded-row__value">
                            {event.customQuestions.length === 1
                              ? '1 question during registration'
                              : `${event.customQuestions.length} questions during registration`}
                          </dd>
                        </div>
                      ) : null}
                      {event.requiresMedicalDeclaration ? (
                        <div className="ded-row">
                          <dt className="ded-row__label">Medical</dt>
                          <dd className="ded-row__value">Medical declaration required</dd>
                        </div>
                      ) : null}
                    </dl>
                  </section>
                ) : null}

                {/* ── FAQs ───────────────────────────────────────────────── */}
                {faqs.length > 0 ? (
                  <section className="ddp-section">
                    <h2 className="ddp-section__title">FAQs</h2>
                    <ul className="ded-faqs">
                      {faqs.map((faq, index) => {
                        const isOpen = openFaqIndex === index;
                        return (
                          <li className="ded-faq" key={faq.question ?? index}>
                            <button
                              type="button"
                              className="ded-faq__q"
                              aria-expanded={isOpen}
                              onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                            >
                              <span>{faq.question}</span>
                              <ExpandIcon
                                className={
                                  isOpen
                                    ? 'ddp-icon ded-faq__chev ded-faq__chev--open'
                                    : 'ddp-icon ded-faq__chev'
                                }
                              />
                            </button>
                            {isOpen ? <p className="ded-faq__a">{faq.answer}</p> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null}

                {/* ── Contact ────────────────────────────────────────────── */}
                <section className="ddp-section">
                  <h2 className="ddp-section__title">Contact</h2>
                  {staffContacts.length === 0 ? (
                    <p className="ddp-empty">
                      No contact listed yet. Check back closer to the event.
                    </p>
                  ) : (
                    <ul className="ded-contacts">
                      {staffContacts.map((contact, index) => {
                        const roleLabel =
                          contact.role === 'coordinator' ? 'coordinator' : 'volunteer';
                        /*
                         * THE NUMBER IS NEVER IN THE DOM AS TEXT — not as a
                         * label, not in a title, not in the accessible name.
                         * These are student volunteers, and a rendered phone
                         * number is harvestable from a screenshot or a scrape.
                         * The tel: href is the ONLY place it appears.
                         */
                        return (
                          <li className="ded-contact" key={`${contact.fullName}-${index}`}>
                            <span className="ded-contact__who">
                              <span className="ded-contact__name">{contact.fullName}</span>
                              <span className="ded-contact__role">{roleLabel}</span>
                            </span>
                            <a
                              className="ded-contact__call"
                              href={`tel:${contact.contactPhone}`}
                              aria-label={`Call ${contact.fullName}, ${roleLabel}`}
                            >
                              <PhoneIcon size="sm" className="ddp-icon ddp-icon--sm" />
                              Call
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                {/*
                  Add to calendar. The shared AddToCalendar component carries
                  retired-palette Tailwind and a material-symbols ligature
                  internally and is used by another screen, so it is NOT edited
                  and NOT rendered — only its two URL helpers are reused, and the
                  pills are drawn here in this system's tokens. Same approach the
                  registration-success screen already takes.
                  A container has no schedule of its own, so leaves only.
                */}
                {!isContainer && googleCalendarUrl && icsUrl ? (
                  <section className="ddp-section">
                    <h2 className="ddp-section__title">{CALENDAR_COPY.sectionLabel}</h2>
                    <div className="ded-calendar">
                      <a
                        className="ded-calendar__pill"
                        href={googleCalendarUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <DateIcon size="sm" className="ddp-icon ddp-icon--sm" />
                        {CALENDAR_COPY.googleCalendar}
                      </a>
                      {/* `download` is only a hint cross-origin — the endpoint's
                          Content-Disposition is what forces the save. */}
                      <a className="ded-calendar__pill" href={icsUrl} download>
                        <DateIcon size="sm" className="ddp-icon ddp-icon--sm" />
                        {CALENDAR_COPY.downloadIcs}
                      </a>
                    </div>
                  </section>
                ) : null}
              </div>
            </div>
          </div>

          {/*
            THE BAR IS PINNED — on a phone. .ddp-screen reserves its height as
            bottom padding, so nothing is ever underneath it, and the one thing
            this page exists to do is never something you have to scroll to find.
            A container has nothing to register for, so it gets no bar; on
            desktop the bar is hidden entirely and the sidebar carries the action.
          */}
          {!isContainer ? (
            <div className="ddp-cta ddp-cta--narrow ded-cta">
              <div className="ddp-cta__inner">
                <div className="ddp-cta__meta">
                  {ctaReason ? (
                    <span className="ddp-cta__reason">{ctaReason}</span>
                  ) : (
                    <>
                      <span className="ddp-cta__label">
                        {event.eventType === 'team' ? formatEventTypeFull(event) : 'Entry'}
                      </span>
                      <span className="ddp-cta__value">{formatFeeLabel(event)}</span>
                    </>
                  )}
                </div>
                {renderActions()}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default EventDetailScreen;

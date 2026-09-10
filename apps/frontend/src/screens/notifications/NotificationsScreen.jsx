// NotificationsScreen.jsx
// Route: /notifications — the participant's feed, on the dedal design system.
//
// JAKOB'S LAW RUNS THIS SCREEN. Everyone arriving here has used a notifications
// list before, on their phone's lock screen and in every app on it, and they
// arrive with three expectations already formed: newest first, unread looks
// different, and there is one control at the top that clears the lot. All three
// are met literally. Nothing here is a better idea than the thing people
// already know.
//
// AND THERE ARE STILL NO CATEGORY FILTERS. The previous version of this file
// argued it and the argument has not changed: the feed is short and
// time-ordered, and a row of pills that mostly shows you the same rows costs a
// band of height, a decision before you have read anything, and — Hick's Law —
// a choice among seven types that the icons already make for free.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import {
  NotificationBroadcastIcon,
  NotificationCertificateIcon,
  NotificationDeleteIcon,
  NotificationOutcomeIcon,
  NotificationRemovedIcon,
  NotificationResultIcon,
  NotificationScheduleIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { apiClient } from '../../api-client/api-client.js';

/*
 * THE SEVEN SERVER TYPES, MAPPED DIRECTLY.
 *
 * The version this replaced went server type → a "style" name → an icon, and
 * three of the styles at the end of that chain (registration, venue, waitlist)
 * were unreachable: no notificationType the server can write ever selected
 * them. They are gone. This is the whole vocabulary, and it is the model's
 * enum with nothing between.
 *
 * `tone` is the circle treatment and it is binary on purpose — see the note on
 * .dnt-mark in notifications.css. Achievement is the --accent wash; everything
 * else is the quiet --surface-card lift.
 */
const NOTIFICATION_TYPES = {
  resultsPublished: { Icon: NotificationResultIcon, tone: 'achievement' },
  roundAdvanced: { Icon: NotificationResultIcon, tone: 'achievement' },
  certificateReady: { Icon: NotificationCertificateIcon, tone: 'achievement' },
  roundStarted: { Icon: NotificationScheduleIcon, tone: 'informational' },
  broadcast: { Icon: NotificationBroadcastIcon, tone: 'informational' },
  roundEliminated: { Icon: NotificationOutcomeIcon, tone: 'informational' },
  eventRemoved: { Icon: NotificationRemovedIcon, tone: 'informational' },
};

/* A type the client has not been taught yet must still render as a row rather
   than as a hole in the list, so an unknown falls back to the quietest of the
   two treatments and the most general glyph. */
const UNKNOWN_TYPE = { Icon: NotificationBroadcastIcon, tone: 'informational' };

const COPY = {
  title: 'Notifications',
  markAllRead: 'Mark all read',
  offline: 'You are offline',
  offlineReason: 'Offline',
  emptyLine: 'You have no notifications.',
  delete: 'Delete',
};

/* The choreography, in one place because three of these numbers have to agree
   with the three hardcoded durations in notifications.css. */
const DOT_FADE_MS = 200;
const DOT_STAGGER_MS = 50;
const LABEL_FADE_MS = 150;
const COLLAPSE_MS = 200;
/* Past this much drag, releasing commits. Under half the 80px action, because
   the finger has already travelled far enough to have meant it and a threshold
   at the full width makes the gesture feel like it did not take. */

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// "Just now" / "5m ago" / "3h ago" / "2d ago" / a short date beyond a week.
// Stamped at fetch time, not in render — render must stay pure (no Date.now()).
function formatRelativeTime(isoDate) {
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(isoDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/*
 * One row.
 *
 * The band and the delete action are SIBLINGS inside the row frame, not nested
 * — a button inside a button is invalid HTML and browsers resolve it by
 * dropping one of them, which is exactly the control you cannot afford to lose.
 */
function NotificationRow({ notification, dotDelayMs, isCascading, isCollapsing, onOpen, onDelete }) {
  const { Icon, tone } = NOTIFICATION_TYPES[notification.notificationType] ?? UNKNOWN_TYPE;

  /*
   * WHAT MAKES A ROW A CONTROL.
   *
   * A row with a linkPath opens something. A row without one is informational
   * with nowhere to go — but while it is unread there is still a real thing a
   * tap does, which is mark it read, so it stays a button. Once it is read AND
   * has no linkPath there is nothing left, and it renders as a plain band: no
   * press state, no pointer cursor, no button in the accessibility tree. A
   * control that depresses under a tap and then does nothing is the one thing
   * worse than no control.
   */
  const isInteractive = Boolean(notification.linkPath) || !notification.isRead;

  const bandClasses = [
    'dnt-band',
    isInteractive ? 'dnt-band--interactive' : 'dnt-band--inert',
  ]
    .filter(Boolean)
    .join(' ');

  const contents = (
    <>
      <span className={`dnt-mark dnt-mark--${tone}`}>
        <Icon size="md" />
      </span>
      <span className="dnt-text">
        {/* Title and time share the first line. The time used to be a third
            line of its own, which gave a two-line message a three-line row and
            put the least important thing on the page in the most deliberate
            position — the end, where the eye stops. Beside the title it is
            read in the same glance as the title, which is how every mail and
            messaging client places it. */}
        <span className="dnt-text__head">
          <span className="dnt-text__title">{notification.title}</span>
          <span className="dnt-text__time">{notification.relativeTime}</span>
        </span>
        {notification.body ? <span className="dnt-text__body">{notification.body}</span> : null}
      </span>
      {!notification.isRead ? (
        <span
          className={`dnt-dot${isCascading ? ' dnt-dot--leaving' : ''}`}
          style={{ '--dnt-dot-delay': `${dotDelayMs}ms` }}
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  const bandProps = { className: bandClasses };

  return (
    <li
      className={[
        'dnt-row',
        notification.isRead ? 'dnt-row--read' : '',
        isCollapsing ? 'dnt-row--collapsing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {isInteractive ? (
        <button type="button" onClick={onOpen} {...bandProps}>
          {contents}
        </button>
      ) : (
        <div {...bandProps}>{contents}</div>
      )}

      {/*
        * THE ONLY WAY TO DELETE, AND IT IS VISIBLE ON EVERY DEVICE.
        *
        * There used to be a swipe as well, backed by a red panel behind the
        * band. Two things were wrong with it. It was undiscoverable — you
        * cannot see a gesture, and nothing on the row suggested one existed.
        * And the panel was painted at rest under an opaque band that covered it
        * to the pixel, so wherever the two edges rounded differently a hairline
        * of --primary bled out and drew red lines down the list.
        *
        * A visible control has neither problem. It is rendered outside the band
        * so it is never a button inside a button, and it sits at the trailing
        * edge where space is already reserved for it.
        */}
      <button
        type="button"
        className="dnt-remove"
        onClick={onDelete}
        aria-label={`${COPY.delete}: ${notification.title}`}
      >
        <NotificationDeleteIcon size="sm" />
      </button>
    </li>
  );
}

function SkeletonRows() {
  /* Three, at the real 72px. A skeleton whose height does not match the content
     it is standing in for makes the whole page jump when the data lands. */
  return (
    <div aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <div className="dnt-skeleton" key={index}>
          <div className="dnt-skeleton__mark" />
          <div className="dnt-skeleton__lines">
            <div className="dnt-skeleton__bar dnt-skeleton__bar--title" />
            <div className="dnt-skeleton__bar dnt-skeleton__bar--body" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The feed itself, split from the screen so the SAME list can be a full page on
 * a phone and a panel under the header bell on a desktop. There is exactly one
 * implementation of marking read, the stagger, the swipe and the delete; a
 * second copy for the panel would be a second place for those to drift.
 *
 * @param {object} props
 * @param {() => void} [props.onNavigated] called after a row navigates, so the
 *   desktop panel can close itself. Undefined on the full page, where there is
 *   nothing to close.
 */
export function NotificationsFeed({ onNavigated }) {
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();

  const [notifications, setNotifications] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  /* Ids whose height is currently animating to zero. They stay in the array
     while they collapse so the rows below can slide up rather than jump. */
  const [collapsingIds, setCollapsingIds] = useState([]);
  /* 'idle' → 'dots' (the staggered fade) → 'label' (the action fading out). */
  const [markAllPhase, setMarkAllPhase] = useState('idle');

  /* Every timer started here is cleared on unmount: navigating away mid-cascade
     otherwise sets state on a screen that is gone. */
  const timersRef = useRef([]);
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  const later = useCallback((callback, delay) => {
    timersRef.current.push(setTimeout(callback, delay));
  }, []);

  const loadNotifications = useCallback(async () => {
    setLoadState('loading');
    try {
      const result = await apiClient.get('/notifications/mine');
      const rows = Array.isArray(result?.notifications) ? result.notifications : [];
      /* The serializer sends `isRead`, derived from the model's `readAt` — the
         client never sees readAt and does not need to. */
      setNotifications(rows.map((row) => ({ ...row, relativeTime: formatRelativeTime(row.createdAt) })));
      setLoadState('ready');
    } catch {
      /* An empty feed is the honest fallback: this screen should not error out
         of the way of somebody who simply has nothing waiting. Offline is said
         by the strip, which is the true reason when it is the reason. */
      setNotifications([]);
      setLoadState('ready');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNotifications();
  }, [loadNotifications]);

  const unreadIds = useMemo(
    () => notifications.filter((row) => !row.isRead).map((row) => row.id),
    [notifications],
  );

  /*
   * Optimistic, and deliberately simultaneous: the dot starts fading and the
   * navigation starts in the same tick. Waiting for the round trip to dim a row
   * you have already read makes the list feel broken, and the cost of being
   * wrong is that one row looks read when it is not.
   */
  function openNotification(notification) {
    if (!notification.isRead) {
      setNotifications((previous) =>
        previous.map((row) => (row.id === notification.id ? { ...row, isRead: true } : row)),
      );
      apiClient.post(`/notifications/mine/${notification.id}/read`).catch(() => {});
    }
    if (notification.linkPath) {
      navigate(notification.linkPath);
      /* Only on an actual navigation. A row with no linkPath still marks read,
         and closing the panel out from under somebody who is working down a
         list would lose their place for nothing. */
      onNavigated?.();
    }
  }

  /*
   * THE CASCADE. The dots fade 50ms apart down the list, and only once the last
   * one has gone does the label itself fade. The order matters: the label is
   * the thing you pressed, and taking it away first leaves the dots
   * disappearing under a control that is no longer there.
   *
   * The state change to isRead is applied AFTER the dots have finished, because
   * flipping it immediately unmounts the dots mid-transition and the cascade
   * never renders at all.
   */
  function markAllRead() {
    if (markAllPhase !== 'idle' || unreadIds.length === 0 || !isOnline) {
      return;
    }
    const previous = notifications;
    const reduced = prefersReducedMotion();
    const dotsMs = reduced ? 0 : (unreadIds.length - 1) * DOT_STAGGER_MS + DOT_FADE_MS;

    setMarkAllPhase('dots');
    later(() => {
      setNotifications((rows) => rows.map((row) => ({ ...row, isRead: true })));
      setMarkAllPhase('label');
      later(() => setMarkAllPhase('idle'), reduced ? 0 : LABEL_FADE_MS);
    }, dotsMs);

    apiClient.post('/notifications/mine/mark-all-read').catch(() => {
      setNotifications(previous);
      setMarkAllPhase('idle');
    });
  }

  /*
   * Optimistic delete with a real rollback. The row collapses first and is
   * spliced out when the collapse finishes; if the request fails the row is put
   * back where it was — which is why `previous` is the whole array and not just
   * the deleted row, since restoring one row means restoring its POSITION.
   */
  function deleteNotification(notification) {
    if (collapsingIds.includes(notification.id)) {
      return;
    }
    const previous = notifications;
    setCollapsingIds((ids) => [...ids, notification.id]);

    later(() => {
      setNotifications((rows) => rows.filter((row) => row.id !== notification.id));
      setCollapsingIds((ids) => ids.filter((id) => id !== notification.id));
    }, prefersReducedMotion() ? 0 : COLLAPSE_MS);

    apiClient.delete(`/notifications/mine/${notification.id}`).catch(() => {
      setNotifications(previous);
      setCollapsingIds((ids) => ids.filter((id) => id !== notification.id));
    });
  }

  const hasUnread = unreadIds.length > 0;
  /* The action is rendered while there is something to clear, and stays through
     the fade-out phases so it can animate away instead of vanishing. */
  const showMarkAll = hasUnread || markAllPhase !== 'idle';

  return (
    <>
      {!isOnline ? (
        <div className="dnt-offline" role="status">
          {COPY.offline}
        </div>
      ) : null}

      <main className="dnt-col">
        <div className="dnt-head">
          {showMarkAll ? (
            <span>
              <button
                type="button"
                className={`dnt-markall${markAllPhase === 'label' ? ' dnt-markall--fading' : ''}`}
                onClick={markAllRead}
                disabled={!isOnline}
              >
                {COPY.markAllRead}
              </button>
              {/* Stated, not merely greyed: marking everything read is a write,
                  and a write cannot be made honestly while the device has no
                  connection — an optimistic version would silently disagree
                  with the server the moment the connection returned. */}
              {!isOnline ? <span className="dnt-markall__reason">{COPY.offlineReason}</span> : null}
            </span>
          ) : null}
        </div>

        {loadState === 'loading' ? (
          <SkeletonRows />
        ) : notifications.length === 0 ? (
          /* No action. Nothing a person can do produces a notification, so a
             button here would be a button to nowhere. */
          <EmptyState line={COPY.emptyLine} className="dnt-empty-state" />
        ) : (
          /* A list, semantically, because that is what it is: a screen reader
             announces how many are waiting before reading the first one. */
          <ul className="dnt-list">
            {notifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                dotDelayMs={Math.max(0, unreadIds.indexOf(notification.id)) * DOT_STAGGER_MS}
                isCascading={markAllPhase === 'dots'}
                isCollapsing={collapsingIds.includes(notification.id)}
                onOpen={() => openNotification(notification)}
                onDelete={() => deleteNotification(notification)}
              />
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

/*
 * The route. Nothing but the page chrome around the feed — on a phone the
 * notifications ARE the screen, which is why this route still exists and is
 * still where the account menu points.
 */
function NotificationsScreen() {
  return (
    <div className="dnt-screen">
      <ScreenHeader title={COPY.title} />
      <NotificationsFeed />
    </div>
  );
}

export default NotificationsScreen;

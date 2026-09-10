// BroadcastScreen.jsx
// Route: /backstage/coordinator/events/:eventId/broadcast
//
// The coordinator messages their event's people. Deliberately shaped like a
// thread rather than a form: a broadcast is a short, frequent, conversational
// act ("round starts in 10 minutes"), and a titled form with a Send button at
// the bottom of a scroll makes that feel heavier than it is.
//
// In-app only. The audience here is a handful of people already inside the app
// on the day; an email for "assemble at the stage" would arrive after it
// mattered. The admin's email broadcast is a separate, fest-wide tool.
//
// ON THE DEDAL DESIGN SYSTEM (`dop-`). Every endpoint, the directTarget
// navigation-state path, the audience payload shape, the tone derivation and
// the optimistic append of the sent message are unchanged and moved verbatim.
//
// WHAT CHANGED, and why:
//
//   · THE AUDIENCE IS NO LONGER A COLOUR. The retired version tinted each
//     bubble by who received it — three tints, no legend, and the palette here
//     has exactly two signal colours anyway. Each bubble now carries the words
//     ("Participants", "Volunteers", "Participants and volunteers"), which is
//     the thing a coordinator is actually checking when they scroll back.
//   · window.alert on a failed send is gone. The failure is stated in the
//     composer, next to the message that is still sitting in the box, instead
//     of in a modal that discards the context.
//   · The audience picker is the app's own BottomSheet, so it has a scrim, a
//     focus trap and an exit animation. The old fixed overlay was rendered
//     conditionally and could therefore only ever vanish.
//   · Sending is disabled while offline, and the strip says that is the reason.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Check, Send, User, Users } from 'lucide-react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import BottomSheet from '../../components/bottom-sheet/BottomSheet.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';

import { apiClient } from '../../api-client/api-client.js';

/* Who a sent message reached, in words. This replaces the tint. */
const TONE_LABEL = {
  both: 'Participants and volunteers',
  participants: 'Participants',
  volunteers: 'Volunteers',
};

/*
 * IST, sentence case. Deliberately a local formatter rather than
 * helpers/event-format.js — formatClockTime there returns "09:00 PM" padded and
 * stamped, which belongs to the retired uppercase voice.
 */
const TIME_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return TIME_FORMATTER.format(date).toLowerCase();
}

function BroadcastScreen() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const festId = searchParams.get('festId') ?? '';
  /*
   * Directory mode: arriving from a Directory card carries the target in
   * navigation state. The audience sheet is skipped entirely — the choice was
   * made by which card was tapped, and asking again would be redundant. A
   * "To:" line states the target instead.
   */
  const location = useLocation();
  const directTarget = location.state?.directTarget ?? null;
  const isOnline = useOnlineStatus();

  const [eventName, setEventName] = useState('');
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState([]);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [audiences, setAudiences] = useState({ participants: false, volunteers: false });
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [counts, setCounts] = useState({ participants: null, volunteers: null });

  const textareaRef = useRef(null);
  const feedRef = useRef(null);

  const loadEvent = useCallback(async () => {
    if (!festId || !eventId) return;
    try {
      const event = await apiClient.get(`/fests/${festId}/events/${eventId}`);
      setEventName(event?.eventName ?? '');
    } catch {
      /* The page still works without the name — it only labels the send sheet. */
      setEventName('');
    }
    try {
      const stats = await apiClient.get(`/fests/${festId}/events/${eventId}/overview-stats`);
      setCounts((prev) => ({ ...prev, participants: stats?.registeredCount ?? null }));
    } catch {
      /* Counts are a courtesy; sending does not depend on them. */
    }
  }, [eventId, festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEvent();
  }, [loadEvent]);

  /* Keep the newest message in view without yanking the whole page. */
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [sent.length]);

  function handleDraftChange(nextValue) {
    setDraft(nextValue);
    const node = textareaRef.current;
    if (node) {
      node.style.height = 'auto';
      node.style.height = `${Math.min(node.scrollHeight, 132)}px`;
    }
  }

  function openSheet() {
    if (!draft.trim()) return;
    if (directTarget) {
      handleSend();
      return;
    }
    setAudiences({ participants: false, volunteers: false });
    setIsSheetOpen(true);
  }

  function toggleAudience(key) {
    setAudiences((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const selected = Object.keys(audiences).filter((key) => audiences[key]);

  async function handleSend() {
    if (isSending || (!directTarget && selected.length === 0)) return;
    const message = draft.trim();
    if (!message) return;

    setIsSending(true);
    setSendError('');
    try {
      const result = await apiClient.post(
        `/fests/${festId}/events/${eventId}/broadcast-in-app`,
        directTarget
          ? { message, recipientUserIds: directTarget.recipientUserIds }
          : { message, audiences: selected },
      );

      const tone = directTarget
        ? 'both'
        : audiences.participants && audiences.volunteers
          ? 'both'
          : audiences.participants
            ? 'participants'
            : 'volunteers';

      setSent((prev) => [
        ...prev,
        {
          id: `${Date.now()}`,
          message,
          tone,
          sentAt: new Date().toISOString(),
          notifiedCount: result?.notifiedCount ?? 0,
        },
      ]);

      setDraft('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      setIsSheetOpen(false);
    } catch (error) {
      setSendError(error?.message ?? 'Could not send the broadcast. Please try again.');
      setIsSheetOpen(false);
    } finally {
      setIsSending(false);
    }
  }

  const totalReach =
    (audiences.participants ? (counts.participants ?? 0) : 0) +
    (audiences.volunteers ? (counts.volunteers ?? 0) : 0);

  const audienceOptions = useMemo(
    () => [
      {
        key: 'participants',
        Icon: Users,
        label: 'Participants',
        sub:
          counts.participants != null
            ? `${counts.participants} registered for this event`
            : 'Everyone registered for this event',
      },
      {
        key: 'volunteers',
        Icon: User,
        label: 'Volunteers',
        sub: 'Volunteers assigned to this event',
      },
    ],
    [counts.participants],
  );

  const canSend = Boolean(draft.trim()) && isOnline && !isSending;

  return (
    <div className="dop-screen dop-screen--fixed">
      <ScreenHeader title="Broadcast" />

      <div ref={feedRef} className="dop-thread">
        {directTarget ? (
          <p className="dop-note dop-note--ink" style={{ alignSelf: 'center' }}>
            Only {directTarget.label}
            {directTarget.kind === 'team' ? `, ${directTarget.memberCount} members` : ''}
          </p>
        ) : null}

        {sent.length === 0 ? (
          <p className="dop-note" style={{ alignSelf: 'center' }}>
            Messages you send appear here, newest last.
          </p>
        ) : null}

        {sent.map((item) => (
          <div key={item.id} className="dop-bubble">
            <span className="dop-bubble__text">{item.message}</span>
            <span className="dop-bubble__meta">
              {TONE_LABEL[item.tone]} · {item.notifiedCount} notified · {formatTime(item.sentAt)}
            </span>
          </div>
        ))}
      </div>

      <div className="dop-composer">
        <div className="dop-composer__inner">
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={(event) => handleDraftChange(event.target.value)}
            placeholder="Message my crew and participants"
            className="dop-composer__input"
          />
          <button
            type="button"
            onClick={openSheet}
            disabled={!canSend}
            aria-label="Choose who receives this"
            className="dop-btn dop-btn--accent"
          >
            <Send size={18} aria-hidden="true" />
          </button>
        </div>
        {!isOnline ? (
          <p className="dop-offline" role="status" style={{ marginTop: 'var(--s2)' }}>
            You are offline, so sending is turned off until the connection is back.
          </p>
        ) : null}
        {sendError ? (
          <p className="dop-alert" role="alert" style={{ marginTop: 'var(--s2)' }}>
            {sendError}
          </p>
        ) : null}
      </div>

      <BottomSheet
        isOpen={isSheetOpen}
        onClose={() => (isSending ? undefined : setIsSheetOpen(false))}
        title="Send to"
      >
        <div className="dop-sheet">
          <p className="dop-note">{eventName || 'This event'}</p>

          {audienceOptions.map((option) => {
            const isSelected = audiences[option.key];
            const { Icon } = option;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={isSelected}
                onClick={() => toggleAudience(option.key)}
                className={['dop-pick', isSelected ? 'dop-pick--on' : ''].join(' ')}
              >
                <Icon size={20} aria-hidden="true" />
                <span className="dop-pick__main">
                  <span className="dop-row__name">{option.label}</span>
                  <span className="dop-row__meta">{option.sub}</span>
                </span>
                <span className="dop-pick__box" aria-hidden="true">
                  {isSelected ? <Check size={14} strokeWidth={3} /> : null}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={handleSend}
            disabled={selected.length === 0 || isSending || !isOnline}
            className="dop-btn dop-btn--block dop-btn--accent"
          >
            <Send size={16} aria-hidden="true" />
            {isSending
              ? 'Sending…'
              : selected.length === 0
                ? 'Pick at least one group'
                : totalReach > 0
                  ? `Send to ${totalReach} people`
                  : 'Send'}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}

export default BroadcastScreen;

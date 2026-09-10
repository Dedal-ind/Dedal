// NotifyParticipants.jsx
// The coordinator's bulk message to everyone confirmed for one event.
//
// TWO STEPS, DELIBERATELY. Composing and sending are separate screens inside
// the sheet, because this is the one control on the panel that reaches a few
// hundred real inboxes and cannot be undone. A single "send" button next to a
// textarea is one mis-tap away from mailing a draft.
//
// The daily budget is shown BEFORE anything is typed, not discovered as a 429
// after composing. A coordinator who has one send left should know that while
// deciding what to say.
//
// ON THE DEDAL DESIGN SYSTEM (`dop-`). Both steps now live in the app's own
// BottomSheet rather than a hand-rolled fixed overlay, which is what gives this
// the scrim, the swipe-to-dismiss, the focus trap and — the reason it matters
// here — an exit animation, since the previous version was conditionally
// rendered and therefore could only ever vanish. The endpoints, the two-step
// gate, the validation, the 429 budget read and the partial-failure banner are
// unchanged and moved verbatim.

import { useCallback, useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import BottomSheet from '../bottom-sheet/BottomSheet.jsx';
import { NOTIFY_PARTICIPANTS_COPY as COPY } from '../../brand/brand-copy.js';

const SUBJECT_MAX_LENGTH = 120;
const MESSAGE_MAX_LENGTH = 2000;

function NotifyParticipants({ festId, eventId, eventName, className = '' }) {
  const [preview, setPreview] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  // compose | review
  const [step, setStep] = useState('compose');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [formError, setFormError] = useState('');
  const [banner, setBanner] = useState('');

  const loadPreview = useCallback(async () => {
    if (!festId || !eventId) {
      return;
    }
    try {
      setPreview(await apiClient.get(`/fests/${festId}/events/${eventId}/notify-participants`));
    } catch {
      // No permission or no reach: the button simply does not appear.
      setPreview(null);
    }
  }, [festId, eventId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPreview();
  }, [loadPreview]);

  if (!preview) {
    return null;
  }

  const hasBudgetLeft = (preview.sendsRemainingToday ?? 0) > 0;
  const recipientCount = preview.recipientCount ?? 0;

  function openComposer() {
    // The event name is a sensible default subject and the one most messages
    // want; it stays editable.
    setSubject(eventName ? `${eventName}: update` : '');
    setMessage('');
    setFormError('');
    setStep('compose');
    setIsOpen(true);
  }

  function goToReview() {
    if (!subject.trim()) {
      setFormError(COPY.subjectRequired);
      return;
    }
    if (!message.trim()) {
      setFormError(COPY.messageRequired);
      return;
    }
    setFormError('');
    setStep('review');
  }

  async function handleSend() {
    setIsSending(true);
    setFormError('');
    try {
      const result = await apiClient.post(
        `/fests/${festId}/events/${eventId}/notify-participants`,
        { subject: subject.trim(), message: message.trim() },
      );
      setBanner(
        result.failedCount > 0
          ? COPY.partialBanner(result.sentCount, result.failedCount)
          : COPY.sentBanner(result.sentCount),
      );
      setIsOpen(false);
      await loadPreview(); // the budget just moved
    } catch (error) {
      setFormError(error?.message || COPY.sendFailed);
      setStep('compose');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className={className ? `dop-notify ${className}` : 'dop-notify'}>
      {banner ? (
        <p role="status" className="dop-receipt">
          {banner}
        </p>
      ) : null}

      <button
        type="button"
        onClick={openComposer}
        disabled={!hasBudgetLeft || recipientCount === 0}
        className="dop-btn"
      >
        <Megaphone size={16} aria-hidden="true" />
        {COPY.openButton}
      </button>
      {/* The remaining budget, always visible — not a surprise at send time. */}
      <p className="dop-note">
        {hasBudgetLeft
          ? COPY.budgetRemaining(preview.sendsUsedToday ?? 0, preview.dailyLimit ?? 3)
          : COPY.budgetExhausted}
      </p>

      <BottomSheet
        isOpen={isOpen}
        onClose={() => (isSending ? undefined : setIsOpen(false))}
        title={step === 'compose' ? COPY.modalTitle : COPY.reviewTitle}
      >
        {step === 'compose' ? (
          <div className="dop-sheet">
            <p className="dop-note">
              {recipientCount === 0 ? COPY.noRecipients : COPY.recipientCount(recipientCount)}
            </p>

            <label className="dop-field">
              <span className="dop-field__label">{COPY.subjectLabel}</span>
              <input
                type="text"
                className="dop-input"
                maxLength={SUBJECT_MAX_LENGTH}
                value={subject}
                disabled={isSending}
                onChange={(changeEvent) => setSubject(changeEvent.target.value)}
              />
            </label>

            <label className="dop-field">
              <span className="dop-field__label">{COPY.messageLabel}</span>
              <textarea
                rows={5}
                className="dop-textarea"
                maxLength={MESSAGE_MAX_LENGTH}
                value={message}
                disabled={isSending}
                placeholder={COPY.messagePlaceholder}
                onChange={(changeEvent) => setMessage(changeEvent.target.value)}
              />
              <span className="dop-count">
                {message.length}/{MESSAGE_MAX_LENGTH}
              </span>
            </label>

            {formError ? (
              <p role="alert" className="dop-alert">
                {formError}
              </p>
            ) : null}

            <button
              type="button"
              onClick={goToReview}
              disabled={recipientCount === 0}
              className="dop-btn dop-btn--block dop-btn--accent"
            >
              {COPY.send}
            </button>
          </div>
        ) : (
          <div className="dop-sheet">
            {/* The irreversibility, stated plainly, with the message shown back
                so nobody confirms a draft they cannot see. */}
            <p className="dop-sheet__body">{COPY.reviewBody(recipientCount)}</p>
            <div className="dop-sheet__quote">
              <strong>{subject}</strong>
              {message}
            </div>

            {formError ? (
              <p role="alert" className="dop-alert">
                {formError}
              </p>
            ) : null}

            <div className="dop-actions">
              <button
                type="button"
                onClick={() => setStep('compose')}
                disabled={isSending}
                className="dop-btn"
              >
                {COPY.cancel}
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={isSending}
                className="dop-btn dop-btn--primary"
              >
                {isSending ? COPY.sending : COPY.confirmSend}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

export default NotifyParticipants;

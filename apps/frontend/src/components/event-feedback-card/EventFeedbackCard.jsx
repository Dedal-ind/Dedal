// EventFeedbackCard.jsx
// The "rate this event" prompt on a past registration, and the read-only record
// it becomes once rated.
//
// WHO SEES IT is decided by the server, not here: GET /events/:id/feedback/me
// answers "did this person attend" from their accepted scans. The card renders
// NOTHING unless that says yes — someone who registered and never turned up has
// no basis to review, and showing them a greyed-out prompt would just advertise
// a thing they cannot do.
//
// ONE SHOT. After submitting there is no edit affordance, because there is no
// edit endpoint: the rating a coordinator has already read must not move under
// them. The card says so in as many words rather than letting someone discover
// it by trying.
//
// ON THE DEDAL DESIGN SYSTEM (`dop-`). The eligibility gate, the 409
// ALREADY_SUBMITTED reconciliation, the NOT_ATTENDED branch and the POST body
// are unchanged and moved verbatim. The rating sheet is now the app's own
// BottomSheet instead of a hand-rolled overlay, so it can animate out; the
// stars are --ink rather than a second accent colour, because a star already
// means "rating" and colouring it adds nothing a person has to decode.

import { useCallback, useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import BottomSheet from '../bottom-sheet/BottomSheet.jsx';
import { EVENT_FEEDBACK_COPY as COPY } from '../../brand/brand-copy.js';

const STAR_VALUES = [1, 2, 3, 4, 5];
const COMMENT_MAX_LENGTH = 500;

/*
 * The five stars, as real radio inputs under the hood. A row of <button>s would
 * announce as five unrelated controls; a radiogroup announces as one question
 * with five answers and moves under the arrow keys for free.
 */
function StarRatingInput({ value, onChange, disabled }) {
  return (
    <div role="radiogroup" aria-label={COPY.ratingLegend} className="dop-starpick">
      {STAR_VALUES.map((starValue) => {
        const isFilled = starValue <= value;
        return (
          <button
            key={starValue}
            type="button"
            role="radio"
            aria-checked={value === starValue}
            aria-label={COPY.starLabel(starValue)}
            disabled={disabled}
            onClick={() => onChange(starValue)}
            className={[
              'dop-starpick__btn',
              isFilled ? 'dop-starpick__btn--on' : '',
            ].join(' ')}
          >
            <Star
              size={22}
              aria-hidden="true"
              fill={isFilled ? 'currentColor' : 'none'}
            />
          </button>
        );
      })}
    </div>
  );
}

/* The submitted state — a record, not a form. */
function SubmittedCard({ rating }) {
  return (
    <div className="dop-prompt">
      <p className="dop-prompt__title">
        {COPY.submittedTitle(rating)}{' '}
        <span className="dop-stars" aria-hidden="true">
          {STAR_VALUES.slice(0, rating).map((starValue) => (
            <Star key={starValue} size={14} fill="currentColor" />
          ))}
        </span>
      </p>
      <p className="dop-note">{COPY.submittedNote}</p>
    </div>
  );
}

function EventFeedbackCard({ eventId }) {
  // idle | eligible | submitted | hidden — "hidden" covers both "did not attend"
  // and "we could not tell", which render identically: nothing.
  const [cardState, setCardState] = useState('idle');
  const [submittedRating, setSubmittedRating] = useState(null);

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const loadEligibility = useCallback(async () => {
    if (!eventId) {
      setCardState('hidden');
      return;
    }
    try {
      const eligibility = await apiClient.get(`/events/${eventId}/feedback/me`);
      if (eligibility?.hasSubmitted) {
        setSubmittedRating(eligibility.rating);
        setCardState('submitted');
      } else if (eligibility?.hasAttended) {
        setCardState('eligible');
      } else {
        setCardState('hidden');
      }
    } catch {
      // A feedback prompt is never worth an error state on a list of
      // registrations: if we cannot tell, we do not ask.
      setCardState('hidden');
    }
  }, [eventId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEligibility();
  }, [loadEligibility]);

  async function handleSubmit() {
    if (rating < 1) {
      setFormError(COPY.ratingRequired);
      return;
    }
    setIsSaving(true);
    setFormError('');
    try {
      await apiClient.post(`/events/${eventId}/feedback`, {
        rating,
        comment: comment.trim() || null,
      });
      setSubmittedRating(rating);
      setCardState('submitted');
      setIsSheetOpen(false);
    } catch (error) {
      /*
       * A 409 means someone rated this on another device between the card
       * loading and this tap. That is not a failure to show as one — reload and
       * let the card settle into its submitted state.
       */
      if (error?.code === 'FEEDBACK_ALREADY_SUBMITTED') {
        await loadEligibility();
        setIsSheetOpen(false);
        return;
      }
      if (error?.code === 'FEEDBACK_NOT_ATTENDED') {
        setFormError(COPY.notAttended);
        return;
      }
      setFormError(error?.message || COPY.submitFailed);
    } finally {
      setIsSaving(false);
    }
  }

  if (cardState === 'idle' || cardState === 'hidden') {
    return null;
  }
  if (cardState === 'submitted') {
    return <SubmittedCard rating={submittedRating} />;
  }

  return (
    <>
      <div className="dop-prompt">
        <p className="dop-prompt__title">{COPY.promptTitle}</p>
        <p className="dop-note">{COPY.promptSubtext}</p>
        <button
          type="button"
          onClick={() => {
            setRating(0);
            setComment('');
            setFormError('');
            setIsSheetOpen(true);
          }}
          className="dop-btn dop-btn--accent"
        >
          {COPY.rateAction}
        </button>
      </div>

      <BottomSheet
        isOpen={isSheetOpen}
        onClose={() => (isSaving ? undefined : setIsSheetOpen(false))}
        title={COPY.sheetTitle}
      >
        <div className="dop-sheet">
          <StarRatingInput value={rating} onChange={setRating} disabled={isSaving} />

          <label className="dop-field">
            <span className="dop-field__label">{COPY.commentLabel}</span>
            <textarea
              rows={3}
              className="dop-textarea"
              maxLength={COMMENT_MAX_LENGTH}
              value={comment}
              disabled={isSaving}
              placeholder={COPY.commentPlaceholder}
              onChange={(changeEvent) => setComment(changeEvent.target.value)}
            />
            <span className="dop-count">
              {COPY.commentCounter(comment.length, COMMENT_MAX_LENGTH)}
            </span>
          </label>

          {formError ? (
            <p role="alert" className="dop-alert">
              {formError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="dop-btn dop-btn--block dop-btn--accent"
          >
            {isSaving ? COPY.submitting : COPY.submit}
          </button>
        </div>
      </BottomSheet>
    </>
  );
}

export default EventFeedbackCard;

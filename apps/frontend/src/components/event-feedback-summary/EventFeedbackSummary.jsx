// EventFeedbackSummary.jsx
// What participants said about an event, for the people who ran it.
//
// Renders NOTHING until at least one person has rated. An event that has just
// finished, or one nobody rated, would otherwise show "0 responses, — average",
// which reads as a broken widget rather than as an honest empty state. The
// section appears when there is something to say.
//
// Comments arrive WITHOUT authors — the API does not send them. A coordinator
// reading a complaint next to the name of the person who wrote it changes what
// people are willing to write, so the anonymity is enforced server-side and
// this component could not attribute a comment even if it wanted to.
//
// ON THE DEDAL DESIGN SYSTEM (`dop-`). The fetch, the endpoint, the silent
// failure and the "hide until there is data" rule are unchanged, moved
// verbatim. What changed is presentation: the average is a NUMBER FOLLOWED BY
// THE WORDS "out of 5" rather than a coloured star glyph doing the talking, and
// the distribution bars are --ink on --ink-dim-4 rather than olive, because the
// row already says which rating it counts.

import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import { COORDINATOR_COPY as COPY } from '../../brand/brand-copy.js';

const RATING_BUCKETS = [5, 4, 3, 2, 1];

function EventFeedbackSummary({ eventId }) {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let isActive = true;
    if (!eventId) {
      return undefined;
    }
    apiClient
      .get(`/events/${eventId}/feedback/summary`)
      .then((result) => isActive && setSummary(result))
      // A coordinator without permission, or a transport failure: no section.
      // Feedback is never worth an error state on the panel they run the event from.
      .catch(() => isActive && setSummary(null));
    return () => {
      isActive = false;
    };
  }, [eventId]);

  if (!summary || (summary.totalResponses ?? 0) === 0) {
    return null;
  }

  const totalResponses = summary.totalResponses;

  return (
    <section className="dop-section">
      <div className="dop-section__head">
        <h2 className="dop-section__title">{COPY.sectionFeedback}</h2>
        <span className="dop-section__meta">
          {totalResponses} {COPY.feedbackResponsesLabel.toLowerCase()}
        </span>
      </div>

      <div className="dop-stats">
        <div className="dop-stat">
          <span className="dop-stat__value">
            <Star size={18} strokeWidth={2} fill="currentColor" aria-hidden="true" />{' '}
            {summary.averageRating}
          </span>
          <span className="dop-stat__label">
            {COPY.feedbackAverageLabel}, {COPY.feedbackOutOfFive}
          </span>
        </div>
        <div className="dop-stat">
          <span className="dop-stat__value">{totalResponses}</span>
          <span className="dop-stat__label">{COPY.feedbackResponsesLabel}</span>
        </div>
      </div>

      {/* The distribution. Every bucket is rendered even at zero — an omitted
          "1 star" row reads as missing data rather than as nobody hating it. */}
      <div className="dop-dist">
        {RATING_BUCKETS.map((starValue) => {
          const count = summary.ratingDistribution?.[starValue] ?? 0;
          const widthPercent =
            totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0;
          return (
            <div key={starValue} className="dop-dist__row">
              <span className="dop-dist__label">
                {starValue} star{starValue === 1 ? '' : 's'}
              </span>
              <span className="dop-dist__track">
                <span className="dop-dist__fill" style={{ width: `${widthPercent}%` }} />
              </span>
              <span className="dop-dist__count">{count}</span>
            </div>
          );
        })}
      </div>

      {summary.recentComments?.length > 0 ? (
        <>
          <p className="dop-detail__label">{COPY.feedbackCommentsLabel}</p>
          {summary.recentComments.map((entry) => (
            <blockquote key={`${entry.submittedAt}-${entry.rating}`} className="dop-quote">
              <span className="dop-quote__rating">
                Rated {entry.rating} {COPY.feedbackOutOfFive}
              </span>
              <p className="dop-quote__text">{entry.comment}</p>
            </blockquote>
          ))}
        </>
      ) : null}
    </section>
  );
}

export default EventFeedbackSummary;

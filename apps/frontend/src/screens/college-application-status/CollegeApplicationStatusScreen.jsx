// CollegeApplicationStatusScreen.jsx
// Route: /register-college/status/:applicationId — the public status page for a
// college application, on the dedal design system. No authentication: the
// applicant checks in with the id from their confirmation.
//
// Fetches GET /college-applications/status/:id and renders one of four states,
// plus an honest not-found when the id matches nothing. Endpoint, error codes
// and the four-state config map are unchanged; this is a look-and-feel change.
//
// WHAT THE PAGE IS. One answer, one mark, one thing to do next, and the four
// facts that let somebody confirm they are looking at the right application.
// The Heritage version also carried a three-step timeline and a support card;
// both are gone. The timeline was derived entirely from the same status enum
// the headline already states — it repeated the answer three times in a
// different shape — and a support desk row above the fold on a page whose
// entire message is "we are working on it" invites a support email that has
// nothing to ask.

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import PublicWordmarkHeader from '../../components/public-wordmark-header/PublicWordmarkHeader.jsx';
import InlineError from '../../components/inline-error/InlineError.jsx';
import {
  CheckIcon,
  ClockIcon,
  CloseIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { BRAND_IDENTITY } from '../../brand/brand-identity.js';
import { COLLEGE_ONBOARDING_COPY } from '../../brand/brand-copy.js';

/*
 * The four states. Same shape as before — a config map keyed by the server's
 * status enum driving title, body and mark — restated in dedal terms.
 *
 * The distinction is carried by the MARK, not by a tinted card: a --muted
 * circle for the two waiting states, --primary for the decision that went well,
 * --muted with an X for the one that did not.
 *
 * rejected is deliberately NOT --primary. Red here would be the product
 * shouting at somebody for something they did not do wrong, and --primary is
 * also the colour of the "Apply again" button directly beneath it — the same
 * red for the bad news and for the way out of it flattens both.
 *
 * `pulse` on underReview only: it is the one state of the four that describes
 * work happening right now, and a mark that breathes says that in a way a
 * static circle cannot. Opacity, CSS-only, and stopped under reduced motion.
 */
const STATUS_META = {
  pending: {
    Icon: ClockIcon,
    title: COLLEGE_ONBOARDING_COPY.dcoStatusPendingTitle,
    body: COLLEGE_ONBOARDING_COPY.dcoStatusPendingBody,
    markModifier: '',
  },
  underReview: {
    Icon: ClockIcon,
    title: COLLEGE_ONBOARDING_COPY.dcoStatusUnderReviewTitle,
    body: COLLEGE_ONBOARDING_COPY.dcoStatusUnderReviewBody,
    markModifier: 'dco-status__mark--pulse',
  },
  approved: {
    Icon: CheckIcon,
    title: COLLEGE_ONBOARDING_COPY.dcoStatusApprovedTitle,
    body: COLLEGE_ONBOARDING_COPY.dcoStatusApprovedBody,
    markModifier: 'dco-status__mark--primary',
    ctaLabel: COLLEGE_ONBOARDING_COPY.dcoStatusApprovedCta,
    // The canonical universal sign-in, shared by participants and admins.
    ctaTo: '/auth/email',
  },
  rejected: {
    Icon: CloseIcon,
    title: COLLEGE_ONBOARDING_COPY.dcoStatusRejectedTitle,
    body: COLLEGE_ONBOARDING_COPY.dcoStatusRejectedBody,
    markModifier: '',
    ctaLabel: COLLEGE_ONBOARDING_COPY.dcoStatusRejectedCta,
    ctaTo: '/register-college',
  },
};

function formatDate(isoDate) {
  if (!isoDate) {
    return '—';
  }
  return new Date(isoDate).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function CollegeApplicationStatusScreen() {
  const { applicationId } = useParams();
  const [loadState, setLoadState] = useState('loading'); // loading | ready | notFound | error
  const [application, setApplication] = useState(null);

  const loadStatus = useCallback(async () => {
    setLoadState('loading');
    try {
      const payload = await apiClient.get(
        `/college-applications/status/${encodeURIComponent(applicationId)}`,
      );
      setApplication(payload?.application ?? null);
      setLoadState(payload?.application ? 'ready' : 'notFound');
    } catch (loadException) {
      setLoadState(loadException.code === 'APPLICATION_NOT_FOUND' ? 'notFound' : 'error');
    }
  }, [applicationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatus();
  }, [loadStatus]);

  const statusMeta = application ? (STATUS_META[application.status] ?? STATUS_META.pending) : null;

  return (
    <div className="dco-screen dco-screen--narrow">
      <PublicWordmarkHeader />

      <main className="dco-col">
        {loadState === 'loading' ? (
          <div className="dco-status">
            <div className="dco-skel" />
          </div>
        ) : null}

        {loadState === 'error' ? (
          <div className="dco-empty">
            <InlineError message={COLLEGE_ONBOARDING_COPY.statusErrorMessage} onRetry={loadStatus} />
          </div>
        ) : null}

        {loadState === 'notFound' ? (
          <div className="dco-empty">
            <span className="dco-status__mark" aria-hidden="true">
              <CloseIcon size="lg" />
            </span>
            <h1 className="dco-status__title">{COLLEGE_ONBOARDING_COPY.dcoNotFoundTitle}</h1>
            <p className="dco-status__body">{COLLEGE_ONBOARDING_COPY.dcoNotFoundBody}</p>
            <Link className="dco-cta dco-cta--ghost" to="/register-college">
              {COLLEGE_ONBOARDING_COPY.dcoStartApplication}
            </Link>
          </div>
        ) : null}

        {loadState === 'ready' && application && statusMeta ? (
          <div className="dco-status">
            {/*
              The mark is decorative — the headline beneath it says the same
              thing in words, and a screen reader reading "clock, application
              received" is one redundant noun.
            */}
            <span
              className={['dco-status__mark', statusMeta.markModifier].filter(Boolean).join(' ')}
              aria-hidden="true"
            >
              <statusMeta.Icon size="lg" />
            </span>
            <h1 className="dco-status__title">{statusMeta.title}</h1>
            <p className="dco-status__body">{statusMeta.body}</p>

            {/* The reviewer's own words, when there are any. --muted body 14:
                it is an explanation, not a second headline. */}
            {application.status === 'rejected' && application.rejectionReason ? (
              <p className="dco-status__reason">{application.rejectionReason}</p>
            ) : null}

            {statusMeta.ctaTo ? (
              <div className="dco-stack">
                <Link className="dco-cta" to={statusMeta.ctaTo}>
                  {statusMeta.ctaLabel}
                </Link>
              </div>
            ) : null}

            {/* The facts, read-only. There is no edit affordance anywhere here
                because a submitted application is not something the applicant
                can change — offering one would be a lie the first tap exposes. */}
            <section className="dco-details">
              <h2 className="dco-details__heading">
                {COLLEGE_ONBOARDING_COPY.dcoDetailsHeading}
              </h2>
              <dl className="dco-details__rows">
                <dt className="dco-details__key">
                  {COLLEGE_ONBOARDING_COPY.dcoApplicationIdLabel}
                </dt>
                <dd className="dco-details__value">{application.id}</dd>

                <dt className="dco-details__key">{COLLEGE_ONBOARDING_COPY.dcoCollegeLabel}</dt>
                <dd className="dco-details__value">{application.collegeName || '—'}</dd>

                <dt className="dco-details__key">{COLLEGE_ONBOARDING_COPY.dcoSubmittedLabel}</dt>
                <dd className="dco-details__value">{formatDate(application.createdAt)}</dd>

                <dt className="dco-details__key">{COLLEGE_ONBOARDING_COPY.dcoStatusLabel}</dt>
                <dd className="dco-details__value">
                  {COLLEGE_ONBOARDING_COPY.dcoStatusValues[application.status] ??
                    statusMeta.title}
                </dd>
              </dl>
            </section>
          </div>
        ) : null}
      </main>

      <footer className="dco-footer">
        {BRAND_IDENTITY.footerText}
        {' · '}
        <a href={`mailto:${BRAND_IDENTITY.contactEmailAddress}`}>
          {BRAND_IDENTITY.contactEmailAddress}
        </a>
      </footer>
    </div>
  );
}

export default CollegeApplicationStatusScreen;

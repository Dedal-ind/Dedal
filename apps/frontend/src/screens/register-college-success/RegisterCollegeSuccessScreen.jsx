// RegisterCollegeSuccessScreen.jsx
// Route: /register-college/success — the moment the application flow exists to
// produce, on the dedal design system.
//
// The application id arrives both in route state (pushed by the form) and as
// the ?applicationId= query param, so a refresh keeps the id on screen.
//
// WHAT THIS SCREEN IS FOR. Somebody who has just submitted a form wants three
// things, in this order: proof it landed, the thing they now hold, and the way
// onward. So it is a drawn checkmark, one sentence, the id with a copy control,
// and two links. The instructional paragraph the Heritage version carried is
// gone — nobody reads advice at the moment they are checking whether their
// twenty minutes of typing worked, and every extra line pushes the two things
// that DO matter further down the page.

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import PublicWordmarkHeader from '../../components/public-wordmark-header/PublicWordmarkHeader.jsx';
import { CheckIcon, CopyIcon } from '../../components/detail-icons/DetailIcons.jsx';
import { BRAND_IDENTITY } from '../../brand/brand-identity.js';
import { COLLEGE_ONBOARDING_COPY } from '../../brand/brand-copy.js';
import DrawnCheck from './DrawnCheck.jsx';

// How long the copy control shows a check before reverting.
const COPY_FEEDBACK_MS = 1500;

function RegisterCollegeSuccessScreen() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const applicationId = location.state?.application?.id ?? searchParams.get('applicationId') ?? '';
  const [hasCopiedId, setHasCopiedId] = useState(false);
  const copyResetTimerRef = useRef(null);

  // The revert timer outlives the component if somebody navigates away inside
  // the 1.5s window, and a setState on an unmounted tree is a warning nobody
  // needs to go looking for.
  useEffect(() => () => clearTimeout(copyResetTimerRef.current), []);

  function handleCopyId() {
    navigator.clipboard?.writeText(applicationId).then(
      () => {
        setHasCopiedId(true);
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = setTimeout(() => setHasCopiedId(false), COPY_FEEDBACK_MS);
      },
      // A rejected clipboard write means the browser refused, and pretending it
      // worked would be worse than saying nothing: the id is on screen and can
      // still be selected by hand.
      () => {},
    );
  }

  return (
    <div className="dco-screen dco-screen--narrow">
      <PublicWordmarkHeader />

      {applicationId ? (
        <main className="dco-col">
          <div className="dco-celebrate">
            <DrawnCheck label={COLLEGE_ONBOARDING_COPY.dcoSuccessHeadline} />
            <h1 className="dco-headline">{COLLEGE_ONBOARDING_COPY.dcoSuccessHeadline}</h1>
            {/* Exactly one sentence. */}
            <p className="dco-prose">{COLLEGE_ONBOARDING_COPY.dcoSuccessProse}</p>
            {/* The expected timeline, and only because one already exists in
                the copy block — this screen invents no new promise about how
                long a review takes. */}
            <p className="dco-timeline">{COLLEGE_ONBOARDING_COPY.successSubtext}</p>

            {/*
              The id, and the ONLY thing on this screen the applicant has to
              keep. The copy glyph morphs to a check for 1.5s rather than firing
              a toast: the confirmation belongs on the control that was pressed,
              where the eye already is.
            */}
            <div className="dco-idrow">
              <span className="dco-idrow__text">
                <span className="dco-idrow__label">
                  {COLLEGE_ONBOARDING_COPY.dcoApplicationIdLabel}
                </span>
                <span className="dco-idrow__value">{applicationId}</span>
              </span>
              <button
                type="button"
                className="dco-copy"
                onClick={handleCopyId}
                aria-label={COLLEGE_ONBOARDING_COPY.dcoCopyId}
              >
                {hasCopiedId ? <CheckIcon size="sm" /> : <CopyIcon size="sm" />}
              </button>
            </div>
            {/* The morph is silent to a screen reader, so the same fact is
                announced once, politely, here. */}
            <span className="dco-sr" role="status">
              {hasCopiedId ? COLLEGE_ONBOARDING_COPY.dcoCopiedId : ''}
            </span>

            <div className="dco-stack">
              {/*
                The status page, with the id already in the path — the whole
                point of the link. Asking somebody to copy an id and then paste
                it into a lookup they have not seen yet is two steps where none
                are needed.
              */}
              <Link
                className="dco-cta"
                to={`/register-college/status/${encodeURIComponent(applicationId)}`}
              >
                {COLLEGE_ONBOARDING_COPY.dcoTrackStatus}
              </Link>
              <Link className="dco-cta dco-cta--ghost" to="/for-colleges">
                {COLLEGE_ONBOARDING_COPY.dcoReturnHome}
              </Link>
            </div>
          </div>
        </main>
      ) : (
        /* Honest fallback: no id in state or query — say so and offer a fresh
           start, rather than rendering a celebration around an empty string. */
        <main className="dco-col">
          <div className="dco-empty">
            <h1 className="dco-headline">{COLLEGE_ONBOARDING_COPY.dcoMissingIdTitle}</h1>
            <p className="dco-prose">{COLLEGE_ONBOARDING_COPY.dcoMissingIdBody}</p>
            <Link className="dco-cta" to="/register-college">
              {COLLEGE_ONBOARDING_COPY.dcoStartApplication}
            </Link>
          </div>
        </main>
      )}

      <footer className="dco-footer">{BRAND_IDENTITY.footerText}</footer>
    </div>
  );
}

export default RegisterCollegeSuccessScreen;

// VerifyCertificateScreen.jsx
// Routes: /verify-certificate and /verify-certificate/:verificationCode
//
// THE ONE PUBLIC SCREEN. No authentication, and the reader is usually not a
// student — it is a recruiter or an admissions officer who has been handed a
// code and wants one answer: is this real. So the whole page is that answer,
// and everything else on it is small.
//
// Two routes, one component: arriving with a code verifies immediately, and
// arriving bare gets the search field. Without the bare route there was no way
// to reach the field except by typing a wrong code first.
//
// ON "NOT FOUND". The endpoint returns the SAME 404 body for an unknown code
// and for a real but unreleased certificate — deliberately, so it cannot be
// used to discover that somebody's certificate exists before they have been
// given it. This screen therefore may never say a certificate does not exist.
// It says no certificate matches this code, which is the only true statement
// available, and it says it quietly: the overwhelmingly likely cause is a
// mistyped character.

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import CertificateCard from '../../components/certificate-card/CertificateCard.jsx';
import DedalWordmark from '../../components/dedal-wordmark/DedalWordmark.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import { CheckCircleIcon, SearchIcon } from '../../components/detail-icons/DetailIcons.jsx';
import '../../design/certificate-page.css';

function VerifyCertificateScreen() {
  const { verificationCode } = useParams();
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();

  /* idle is the bare route's state: nothing has been asked yet, so neither a
     result nor a failure should be on screen. */
  const [status, setStatus] = useState(verificationCode ? 'loading' : 'idle');
  const [certificate, setCertificate] = useState(null);
  const [draftCode, setDraftCode] = useState(verificationCode ?? '');

  const verifyCode = useCallback(async (code) => {
    const trimmed = (code ?? '').trim().toUpperCase();
    if (!trimmed) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    try {
      const verified = await apiClient.get(`/certificates/verify/${trimmed}`);
      setCertificate(verified);
      setStatus('valid');
    } catch {
      /* Any failure is treated as "no match": the endpoint gives a 404 for both
         unknown and unreleased, and a network error here is indistinguishable
         to the reader anyway — the offline line below carries that case. */
      setStatus('notfound');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftCode(verificationCode ?? '');
    verifyCode(verificationCode);
  }, [verificationCode, verifyCode]);

  /* Submitting navigates rather than fetching in place, so the verified code is
     always in the URL — the result of this page is a thing people paste. */
  function handleSubmit(submitEvent) {
    submitEvent.preventDefault();
    const trimmed = draftCode.trim().toUpperCase();
    if (!trimmed) {
      return;
    }
    navigate(`/verify-certificate/${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="dcd-screen">
      <div className="dcd-col" style={{ '--dcd-col': '480px' }}>
        <div className="dcd-head">
          <DedalWordmark size={24} />
        </div>

        <div className="dcd-verify__head">
          <h1 className="dcd-verify__title">Verify a certificate</h1>
          <p className="dcd-verify__sub">
            Enter the code printed on the certificate to confirm who it was issued
            to, and for what.
          </p>
        </div>

        <form className="dcd-search" onSubmit={handleSubmit}>
          <label className="dcd-sr" htmlFor="dcd-code-input">
            Verification code
          </label>
          <input
            id="dcd-code-input"
            className="dcd-search__field"
            type="text"
            value={draftCode}
            onChange={(changeEvent) => setDraftCode(changeEvent.target.value.toUpperCase())}
            placeholder="Enter verification code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck="false"
          />
          <button
            type="submit"
            className="dcd-search__submit"
            disabled={status === 'loading' || draftCode.trim().length === 0}
          >
            <SearchIcon size="sm" />
            Verify
          </button>
        </form>

        {status === 'loading' ? (
          <div aria-busy="true" aria-label="Verifying certificate" style={{ marginTop: 'var(--s5)' }}>
            <div className="dcd-skel dcd-skel--card" />
          </div>
        ) : null}

        {status === 'valid' && certificate ? (
          <div style={{ marginTop: 'var(--s5)' }}>
            <div className="dcd-verified__wrap">
              <span className="dcd-verified" role="status">
                <CheckCircleIcon size="sm" />
                Verified
              </span>
            </div>
            <CertificateCard certificate={certificate} />
            <p className="dcd-foot">Issued and recorded by dedal</p>
          </div>
        ) : null}

        {status === 'notfound' ? (
          <div className="dcd-notfound" role="status">
            <p className="dcd-notfound__title">Certificate not found</p>
            <p className="dcd-notfound__body">
              Check the code and try again.
              {!isOnline ? ' You are offline, so we could not reach the register.' : ''}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default VerifyCertificateScreen;

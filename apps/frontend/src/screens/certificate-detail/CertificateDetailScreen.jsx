// CertificateDetailScreen.jsx
// Route: /my-certificates/:certificateId — the owner's view of one certificate.
//
// THERE IS NO BY-ID ENDPOINT. The server exposes GET /certificates/mine (the
// whole list) and GET /certificates/mine/:id/pdf, and nothing between them. So
// this screen fetches the list and finds its record in it. That is a real cost
// — the list grows with every fest a student enters — but it is the shape the
// API has, and inventing a route for one screen is a backend change this work
// is not allowed to make. If a by-id route ever lands, only loadCertificate()
// changes.
//
// What a student wants here, in order: to see it, to keep it, and to show it to
// somebody who is hiring. So: the card, then three actions, then the facts.
// "Add to LinkedIn" is the one that matters most and is the only action given
// a row of its own.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import CertificateCard, {
  normaliseCertificate,
} from '../../components/certificate-card/CertificateCard.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import {
  certificateTitle,
  certificateVerifyUrl,
  linkedInAddToProfileUrl,
} from '../../helpers/certificate-presentation.js';
import {
  BackIcon,
  DownloadIcon,
  ShareIcon,
  LinkedInIcon,
  RetryIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import '../../design/certificate-page.css';

/*
 * NOT formatShortDate(). That helper is the retired stamped-uppercase voice and
 * renders "SEP 9" — no year, and shouting — directly beneath a Dates row
 * reading "7 Dec 2026 – 10 Dec 2026". On a document whose whole purpose is to
 * be checked by somebody else, two different date formats one line apart
 * invites the reader to wonder which one to trust, and a year missing from an
 * issue date is the single most useful thing about it.
 *
 * IST, like every other date in the app: a certificate issued late on the 9th
 * must not read as the 8th because the reader's laptop is set to UTC.
 */
const ISSUED_DATE = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatIssuedDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : ISSUED_DATE.format(date);
}

/* One row of the <dl>. Absent values are dropped rather than rendered as a
   dash: a missing USN is not a fact about the certificate. */
function Fact({ label, value }) {
  if (!value) {
    return null;
  }
  return (
    <div className="dcd-facts__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function CertificateDetailScreen() {
  const { certificateId } = useParams();
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();

  const [certificate, setCertificate] = useState(null);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [isDownloading, setIsDownloading] = useState(false);
  const [notice, setNotice] = useState('');
  const noticeTimerRef = useRef(null);

  const loadCertificate = useCallback(async () => {
    setLoadState('loading');
    try {
      const list = await apiClient.get('/certificates/mine');
      const found = (Array.isArray(list) ? list : []).find((item) => item.id === certificateId);
      if (!found) {
        setLoadState('error');
        return;
      }
      setCertificate(normaliseCertificate(found));
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [certificateId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCertificate();
  }, [loadCertificate]);

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), []);

  /* The notice is a receipt, not a dialog — it says what happened and leaves.
     Keyed by its own text so re-announcing the same message restarts the fade. */
  function showNotice(message) {
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 1600);
  }

  async function handleDownloadPdf() {
    if (isDownloading || !certificate) {
      return;
    }
    setIsDownloading(true);
    try {
      // responseType: 'blob' bypasses the JSON envelope unwrap — the interceptor
      // returns the Blob untouched because a Blob has no `data` property.
      const pdfBlob = await apiClient.get(`/certificates/mine/${certificate.id}/pdf`, {
        responseType: 'blob',
      });
      const objectUrl = URL.createObjectURL(pdfBlob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `dedal-certificate-${certificate.verificationCode ?? certificate.id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      showNotice('Could not download the PDF. Try again.');
    } finally {
      setIsDownloading(false);
    }
  }

  function handleShare() {
    const verifyUrl = certificateVerifyUrl(certificate.verificationCode);
    /* navigator.share resolves on success and REJECTS on cancel, which is not
       an error worth reporting — so the catch is deliberately silent. */
    if (navigator.share) {
      navigator.share({ title: 'dedal certificate', url: verifyUrl }).catch(() => {});
      return;
    }
    navigator.clipboard
      ?.writeText(verifyUrl)
      .then(() => showNotice('Link copied'))
      .catch(() => showNotice('Could not copy the link.'));
  }

  const verifyUrl = certificate ? certificateVerifyUrl(certificate.verificationCode) : '';

  return (
    <div className="dcd-screen">
      <div className="dcd-col">
        <div className="dcd-head">
          <button
            type="button"
            className="dcd-back"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            <BackIcon />
          </button>
        </div>

        {loadState === 'loading' ? (
          /* The skeleton is the page's own geometry — card, action row, four
             fact rows — so nothing jumps when the data lands. */
          <div aria-busy="true" aria-label="Loading certificate">
            <div className="dcd-skel dcd-skel--card" />
            <div className="dcd-skel dcd-skel--actions" />
            <div className="dcd-skel dcd-skel--row" />
            <div className="dcd-skel dcd-skel--row" />
            <div className="dcd-skel dcd-skel--row" />
            <div className="dcd-skel dcd-skel--row" />
          </div>
        ) : null}

        {loadState === 'error' ? (
          <div className="dcd-error">
            <p className="dcd-error__body">
              {isOnline
                ? 'We could not load this certificate.'
                : 'You are offline, so this certificate could not be loaded.'}
            </p>
            <button type="button" className="dcd-action" onClick={loadCertificate}>
              <RetryIcon size="sm" />
              Try again
            </button>
          </div>
        ) : null}

        {loadState === 'ready' && certificate ? (
          <>
            <CertificateCard certificate={certificate} />

            <div className="dcd-actions">
              <button
                type="button"
                className="dcd-action"
                data-variant="primary"
                onClick={handleDownloadPdf}
                disabled={isDownloading || !isOnline}
                aria-label="Download this certificate as a PDF"
              >
                {isDownloading ? (
                  <span className="dcd-spinner" aria-hidden="true" />
                ) : (
                  <DownloadIcon size="sm" />
                )}
                {isDownloading ? 'Preparing…' : 'Download PDF'}
              </button>

              <button
                type="button"
                className="dcd-action"
                onClick={handleShare}
                disabled={!isOnline}
                aria-label="Share this certificate"
              >
                <ShareIcon size="sm" />
                Share
              </button>

              {/*
                The link is an <a>, not a button calling window.open — a popup
                blocker eats the second one and a student is left tapping the
                most valuable control on the screen with nothing happening.
              */}
              <a
                className="dcd-action"
                data-variant="linkedin"
                href={linkedInAddToProfileUrl({ certificate, verifyUrl })}
                target="_blank"
                rel="noopener noreferrer"
              >
                <LinkedInIcon size="sm" />
                Add to LinkedIn
              </a>
            </div>

            {/* Offline: the reason, stated. A greyed control with no
                explanation is a dead end, and both of these need the network —
                the PDF is rendered server-side and the share link points at a
                page nobody can reach yet either. */}
            {!isOnline ? (
              <p className="dcd-note">
                Download and share need a connection. Everything above is from your
                last visit.
              </p>
            ) : null}

            {notice ? (
              <p className="dcd-toast" key={notice} role="status">
                {notice}
              </p>
            ) : null}

            <section className="dcd-facts">
              <h2 className="dcd-facts__head">Details</h2>
              <dl className="dcd-facts__list">
                <Fact label="Holder" value={certificate.holderName} />
                <Fact label="USN" value={certificate.usn} />
                <Fact label="College" value={certificate.collegeName} />
                <Fact label="Event" value={certificate.eventName} />
                <Fact label="Fest" value={certificate.festName} />
                <Fact label="Dates" value={certificate.festDates} />
                <Fact
                  label="Certificate"
                  value={certificateTitle(certificate.certificateType, certificate)}
                />
                <Fact
                  label="Issued"
                  value={formatIssuedDate(certificate.issuedAt)}
                />
              </dl>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default CertificateDetailScreen;

// CertificateCard.jsx
// The certificate itself, rendered by the app. One component, three readers:
// the owner on /my-certificates/:id, a stranger on the public verify page, and
// whoever they forward the screenshot to.
//
// IT TAKES BOTH SHAPES, AND NORMALISES AT THE EDGE.
//
// GET /certificates/mine returns the owner's record with the frozen snapshot
// nested under `metadata` and the fest/event populated as objects. GET
// /certificates/verify/:code returns a FLAT object built from the same snapshot
// — no `metadata`, no populate — because the public endpoint deliberately
// exposes nothing but the snapshot. Rather than make each caller reshape, the
// normalisation lives here: there is exactly one place that knows both shapes,
// and it is the thing that renders them.
//
// Everything drawn here is the snapshot, never the live profile. A certificate
// records who somebody WAS when they earned it; a student who later corrects
// their name has not retroactively won a different competition.
//
// The normaliser is exported alongside the component because the detail screen
// needs the same reshape before it can build a LinkedIn URL or a facts list,
// and a second copy of it is exactly the drift this file exists to prevent.
/* eslint-disable react-refresh/only-export-components */

import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import DedalWordmark from '../dedal-wordmark/DedalWordmark.jsx';
import {
  certificateBadgeLabel,
  certificatePredicate,
  certificateTitle,
  certificateTone,
  certificateVerifyUrl,
  CERTIFICATE_TONES,
} from '../../helpers/certificate-presentation.js';
import {
  WinnerToneIcon,
  ParticipationToneIcon,
  StaffToneIcon,
  CopyIcon,
  CheckIcon,
} from '../detail-icons/DetailIcons.jsx';
import '../../design/certificate-page.css';

const TONE_ICON = {
  [CERTIFICATE_TONES.WINNER]: WinnerToneIcon,
  [CERTIFICATE_TONES.PARTICIPATION]: ParticipationToneIcon,
  [CERTIFICATE_TONES.STAFF]: StaffToneIcon,
};

/**
 * Either backend shape → the fields this card draws.
 *
 * The `??` chains are ordered snapshot-first: `metadata` is what the server
 * froze at generation time and is therefore the truth about the award, while
 * the populated `festId` / `eventId` are the LIVE documents and may have been
 * renamed since. The populate is a fallback for old records whose snapshot
 * predates a field, not a preference.
 */
export function normaliseCertificate(source) {
  const metadata = source?.metadata ?? source ?? {};
  return {
    id: source?.id ?? null,
    certificateType: source?.certificateType,
    verificationCode: source?.verificationCode,
    holderName: metadata.fullName ?? source?.fullName ?? '',
    collegeName: metadata.collegeName ?? source?.collegeName ?? '',
    usn: metadata.usn ?? source?.usn ?? '',
    eventName: metadata.eventName ?? source?.eventId?.eventName ?? '',
    festName: metadata.festName ?? source?.festId?.festName ?? '',
    festDates: metadata.festDates ?? '',
    position: metadata.position ?? null,
    role: metadata.role ?? null,
    /* releasedAt is when the student could first see it, generatedAt is when
       the server drew it. The former is the issue date if it exists. */
    issuedAt: source?.releasedAt ?? source?.generatedAt ?? null,
    /* Sponsors are never on a certificate today — the snapshot does not capture
       them and the fest populate excludes them. Read anyway so that the day one
       appears the card already knows what to do with it. */
    sponsor: source?.sponsor ?? null,
  };
}

/*
 * The copy control's glyph. Two icons in one 16px box, swapped rather than
 * cross-faded, matching the registration-success stub exactly — a verification
 * code and a booking reference are the same interaction and should not feel
 * like two.
 */
function CopyGlyph({ copied }) {
  return copied ? <CheckIcon size="sm" /> : <CopyIcon size="sm" />;
}

function CertificateCard({ certificate, className = '' }) {
  const record = normaliseCertificate(certificate);
  const tone = certificateTone(record.certificateType);
  const ToneIcon = TONE_ICON[tone] ?? ParticipationToneIcon;
  const verifyUrl = certificateVerifyUrl(record.verificationCode);

  const [hasCopied, setHasCopied] = useState(false);
  const resetTimerRef = useRef(null);

  /* The 1.5s reset is a timer, so it has to be cancelled on unmount — a
     setState after the card has gone is a warning at best and, in the verify
     screen where the card unmounts on a new search, a real leak. */
  useEffect(() => () => window.clearTimeout(resetTimerRef.current), []);

  function handleCopyCode() {
    navigator.clipboard?.writeText(record.verificationCode ?? '').catch(() => {});
    setHasCopied(true);
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setHasCopied(false), 1500);
  }

  const festLine = [record.festName, record.festDates].filter(Boolean).join(' · ');

  return (
    <article
      className={`dcd-card ${className}`.trim()}
      data-tone={tone}
      aria-label={`${certificateTitle(record.certificateType, record)} for ${record.holderName}`}
    >
      <div className="dcd-card__band" aria-hidden="true" />

      <div className="dcd-card__body">
        <div className="dcd-card__mark">
          <DedalWordmark size={16} />
        </div>

        <span className="dcd-card__badge">
          <ToneIcon size="sm" />
          {certificateBadgeLabel(record.certificateType, record)}
        </span>

        <h2 className="dcd-card__title">
          {certificateTitle(record.certificateType, record)}
        </h2>

        <div className="dcd-card__group">
          <p className="dcd-card__name">{record.holderName}</p>
          <p className="dcd-card__line">{certificatePredicate(record.certificateType)}</p>
        </div>

        {/* Fest-level staff certificates have no event at all, and an empty
            "For" heading over nothing reads as missing data rather than as a
            certificate that was never about one event. */}
        {record.eventName ? (
          <p className="dcd-card__event">{record.eventName}</p>
        ) : null}

        <div className="dcd-card__group">
          {festLine ? <p className="dcd-card__line">{festLine}</p> : null}
          {record.collegeName ? (
            <p className="dcd-card__line">{record.collegeName}</p>
          ) : null}
        </div>

        {record.sponsor ? (
          <div className="dcd-card__sponsor">
            <span className="dcd-card__sponsor-label">Supported by</span>
            <span className="dcd-card__sponsor-name">
              {record.sponsor.name ?? record.sponsor}
            </span>
          </div>
        ) : null}

        <hr className="dcd-card__rule" />

        <div className="dcd-card__foot">
          <div className="dcd-card__codeblock">
            <span className="dcd-card__codelabel">
              Verification code
            </span>
            <span className="dcd-code">
              <span className="dcd-code__value">{record.verificationCode}</span>
              <button
                type="button"
                className="dcd-code__copy"
                data-copied={hasCopied}
                onClick={handleCopyCode}
                aria-label={hasCopied ? 'Verification code copied' : 'Copy verification code'}
              >
                <CopyGlyph copied={hasCopied} />
              </button>
            </span>
          </div>

          {/* The QR carries the PUBLIC verify URL, never the owner's route — the
              person pointing a phone at it is not signed in. */}
          {record.verificationCode ? (
            <span className="dcd-card__qr">
              <QRCodeSVG value={verifyUrl} size={80} level="M" />
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default CertificateCard;

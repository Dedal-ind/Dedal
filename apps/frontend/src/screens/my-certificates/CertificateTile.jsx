// CertificateTile.jsx
// One certificate in the /my-certificates grid.
//
// The visual anchor is the TYPE, not the artwork. The previous tile led with a
// 224px render of the PDF, which meant every tile on the screen was the same
// cream rectangle with unreadable 6px type on it — the one question the grid
// has to answer at a glance ("which of these did I win?") was the one thing the
// preview could not say. The tone does it instead, in three treatments rather
// than eight, straight from certificateTone().
//
// The whole tile is a single <button>. There is exactly one destination per
// certificate — the detail screen, which owns download, share and the QR — so
// anything smaller than the tile is a smaller target for nothing.

import {
  CERTIFICATE_TONES,
  certificateBadgeLabel,
  certificateTone,
} from '../../helpers/certificate-presentation.js';
import {
  ParticipationToneIcon,
  StaffToneIcon,
  VerifiableIcon,
  WinnerToneIcon,
} from '../../components/detail-icons/DetailIcons.jsx';

const TONE_ICON = {
  [CERTIFICATE_TONES.WINNER]: WinnerToneIcon,
  [CERTIFICATE_TONES.PARTICIPATION]: ParticipationToneIcon,
  [CERTIFICATE_TONES.STAFF]: StaffToneIcon,
};

const TONE_CLASS = {
  [CERTIFICATE_TONES.WINNER]: 'dcl-tile dcl-tile--winner',
  [CERTIFICATE_TONES.PARTICIPATION]: 'dcl-tile',
  [CERTIFICATE_TONES.STAFF]: 'dcl-tile dcl-tile--staff',
};

/* "Mar 2025". Asia/Kolkata explicitly, because a certificate issued at 01:00
   IST is issued the previous evening in UTC and would show the wrong month to
   anybody whose device is set elsewhere. */
function issuedMonth(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    year: 'numeric',
  });
}

function CertificateTile({ certificate, onOpen }) {
  const tone = certificateTone(certificate.certificateType);
  const ToneIcon = TONE_ICON[tone] ?? ParticipationToneIcon;
  const badge = certificateBadgeLabel(certificate.certificateType, certificate.metadata);

  /*
   * eventId is null for fest-level staff certificates, and metadata.eventName
   * is absent on those too. The headline then becomes the fest — a tile whose
   * largest line is blank looks like a failed load of a certificate somebody is
   * about to show an employer.
   */
  const festName = certificate.festId?.festName ?? certificate.metadata?.festName ?? '';
  const eventName = certificate.eventId?.eventName ?? certificate.metadata?.eventName ?? '';
  const headline = eventName || festName || 'Certificate';
  /* Never repeat the headline on the line underneath it. */
  const secondary = headline === festName ? '' : festName;

  const issued = issuedMonth(certificate.releasedAt ?? certificate.generatedAt);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={TONE_CLASS[tone] ?? TONE_CLASS[CERTIFICATE_TONES.PARTICIPATION]}
      /* Reads as one sentence, in the order somebody would say it. The
         individual lines are left unlabelled inside so a screen reader is not
         given the same words twice. */
      aria-label={[badge, headline, secondary, issued && `issued ${issued}`]
        .filter(Boolean)
        .join(', ')}
    >
      <span className="dcl-tile__badge">
        <ToneIcon size="sm" />
        {badge}
      </span>

      <h3 className="dcl-tile__name">{headline}</h3>
      {secondary ? <p className="dcl-tile__fest">{secondary}</p> : null}

      <span className="dcl-tile__foot">
        <span>{issued ? `Issued ${issued}` : 'Issued'}</span>
        {/* The QR glyph is the promise that this is checkable by somebody who
            is not signed in. It is decoration here — the aria-label above
            already carries everything, and the real code lives on the detail
            screen. */}
        <span className="dcl-tile__verifiable">
          <VerifiableIcon size="sm" />
        </span>
      </span>
    </button>
  );
}

export default CertificateTile;

// certificate-presentation.js
// One answer to "what does this certificate type look like, and what does it
// say", shared by the list grid, the certificate card, and the public verify
// page. Pure — no React, no DOM, no fetching.
//
// WHY THIS IS A HELPER AND NOT THREE COPIES.
//
// A certificate is rendered in three places that must agree exactly: the grid
// tile on /my-certificates, the premium card on the detail screen, and the same
// card again on the PUBLIC verify page, where the reader is a stranger deciding
// whether to believe it. If a winner reads as gold in one place and violet in
// another, the reader's conclusion is "this is inconsistent", which is the
// opposite of what a verification page is for.
//
// THE TYPE VOCABULARY IS THE BACKEND'S, NOT OURS.
//
// certificate-constants.js on the server defines exactly eight values, and the
// RANK IS BAKED INTO THE TYPE — `winner1st`, `winner2nd`, `winner3rd`. There is
// no separate rank field. The server also derives a human string into
// `metadata.position` ("1st" / "2nd" / "3rd", null for everything else) and a
// staff string into `metadata.role`. We read those when they are there and fall
// back to the type when they are not, because `metadata` is a frozen snapshot
// taken at generation time and an old certificate may predate a field.
//
// `specialMention` is in the server enum but no generation path currently
// assigns it. It is handled here anyway: an unhandled type would fall through
// to a blank badge on a document somebody is showing an employer.

/* The three visual families. Not eight — eight treatments is a legend, not a
   design, and the distinction a reader actually needs is won / took part /
   ran it. */
export const CERTIFICATE_TONES = {
  WINNER: 'winner',
  PARTICIPATION: 'participation',
  STAFF: 'staff',
};

const TONE_BY_TYPE = {
  winner1st: CERTIFICATE_TONES.WINNER,
  winner2nd: CERTIFICATE_TONES.WINNER,
  winner3rd: CERTIFICATE_TONES.WINNER,
  specialMention: CERTIFICATE_TONES.WINNER,
  participation: CERTIFICATE_TONES.PARTICIPATION,
  coordinator: CERTIFICATE_TONES.STAFF,
  volunteer: CERTIFICATE_TONES.STAFF,
  administrator: CERTIFICATE_TONES.STAFF,
};

/*
 * The badge. Sentence case, not the retired stamped caps — this is the line a
 * student reads on their own achievement, and shouting it does not make it
 * bigger.
 */
const BADGE_BY_TYPE = {
  winner1st: 'Winner — 1st',
  winner2nd: 'Winner — 2nd',
  winner3rd: 'Winner — 3rd',
  specialMention: 'Special mention',
  participation: 'Participant',
  coordinator: 'Coordinator',
  volunteer: 'Volunteer',
  administrator: 'Administrator',
};

/*
 * The full title, centred on the certificate itself. Longer and more formal
 * than the badge, because on the card it is the single largest line and it is
 * what somebody photographs.
 */
const TITLE_BY_TYPE = {
  winner1st: 'Winner — 1st Place',
  winner2nd: 'Winner — 2nd Place',
  winner3rd: 'Winner — 3rd Place',
  specialMention: 'Special Mention',
  participation: 'Certificate of Participation',
  coordinator: 'Certificate of Coordination',
  volunteer: 'Certificate of Volunteer Service',
  administrator: 'Certificate of Administration',
};

/*
 * The verb between the holder's name and the event. "has won" is a claim about
 * a result and must only appear where a result was actually recorded; a
 * coordinator did not win anything and a participant did not either.
 */
const PREDICATE_BY_TONE = {
  [CERTIFICATE_TONES.WINNER]: 'has won',
  [CERTIFICATE_TONES.PARTICIPATION]: 'has participated in',
  [CERTIFICATE_TONES.STAFF]: 'has served at',
};

export function certificateTone(certificateType) {
  return TONE_BY_TYPE[certificateType] ?? CERTIFICATE_TONES.PARTICIPATION;
}

export function isWinnerCertificate(certificateType) {
  return certificateTone(certificateType) === CERTIFICATE_TONES.WINNER;
}

/**
 * The short badge label. `metadata.position` wins when present because it is
 * what the server actually recorded at generation time; the type table is the
 * fallback for older snapshots.
 */
export function certificateBadgeLabel(certificateType, metadata) {
  const position = metadata?.position;
  if (position && isWinnerCertificate(certificateType)) {
    return `Winner — ${position}`;
  }
  return BADGE_BY_TYPE[certificateType] ?? 'Certificate';
}

export function certificateTitle(certificateType, metadata) {
  const position = metadata?.position;
  if (position && isWinnerCertificate(certificateType) && certificateType !== 'specialMention') {
    return `Winner — ${position} Place`;
  }
  return TITLE_BY_TYPE[certificateType] ?? 'Certificate';
}

export function certificatePredicate(certificateType) {
  return PREDICATE_BY_TONE[certificateTone(certificateType)];
}

/*
 * ── LINKEDIN ────────────────────────────────────────────────────────────────
 *
 * The "Add to profile" deep link. LinkedIn reads these as query parameters on
 * /profile/add and pre-fills its Add Certification dialog; there is no API key
 * and no OAuth involved, which is why this can be a plain link.
 *
 * `startTask=CERTIFICATION_NAME` is required — without it LinkedIn opens the
 * generic add-to-profile chooser instead of the certification form.
 *
 * Dates are sent as separate year and month integers, not an ISO string, and
 * LinkedIn silently drops the whole date if either is malformed. There is no
 * expiry: a fest certificate does not expire, and sending an expiry date would
 * make LinkedIn show one.
 *
 * `certUrl` is the PUBLIC verify page, never the owner's /my-certificates
 * route — a recruiter clicking it is not signed in, and a link that demands a
 * login is worse than no link.
 */
export function linkedInAddToProfileUrl({ certificate, verifyUrl }) {
  const metadata = certificate?.metadata ?? certificate ?? {};
  const eventName = metadata.eventName || metadata.festName || 'Fest';
  const badge = certificateBadgeLabel(certificate?.certificateType, metadata);

  const issued = certificate?.issuedAt ?? certificate?.releasedAt ?? certificate?.generatedAt ?? null;
  const issuedDate = issued ? new Date(issued) : null;
  const hasDate = issuedDate && !Number.isNaN(issuedDate.getTime());

  const parameters = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: `${eventName} — ${badge}`,
    /* The issuing college, not "Dedal". Dedal is the platform that recorded
       it; the organisation that awarded it is the host college, and that is
       the name a recruiter is checking against. */
    organizationName: metadata.collegeName || metadata.festName || 'Dedal',
  });

  if (hasDate) {
    parameters.set('issueYear', String(issuedDate.getFullYear()));
    parameters.set('issueMonth', String(issuedDate.getMonth() + 1));
  }
  if (certificate?.verificationCode) {
    parameters.set('certId', certificate.verificationCode);
  }
  if (verifyUrl) {
    parameters.set('certUrl', verifyUrl);
  }

  return `https://www.linkedin.com/profile/add?${parameters.toString()}`;
}

/**
 * The public verification URL for a code. One definition, because it is
 * written into the QR, the share sheet, the copy-link fallback and the
 * LinkedIn credential URL, and those four must be the same string.
 */
export function certificateVerifyUrl(verificationCode, origin) {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/verify-certificate/${verificationCode ?? ''}`;
}

// MyCertificatesScreen.jsx
// Route: /my-certificates — every certificate this student has been released,
// grouped by the fest that issued it.
//
// WHY GROUPED, WHEN THE ENDPOINT ALREADY SORTS BY DATE.
//
// The flat reverse-chronological list this replaces is the right shape for a
// feed and the wrong one for an archive. Certificates arrive in clusters: a
// three-day fest releases a participation, two event winners and a volunteer
// certificate within an hour of each other, and a flat list interleaves those
// with a different college's fest from the same week. "Which fest was that
// from" is the question people actually arrive with, so the fest is the
// heading, matching how /my-fests presents the same student's things.
//
// WHY THE PDF PREVIEW IS GONE. It rendered every tile as the same cream
// rectangle — see the note at the top of CertificateTile.jsx.
//
// The old named export `CertificateTypeChip` was deleted with the Heritage
// chip styling it carried; certificateBadgeLabel() in
// helpers/certificate-presentation.js is the one source of that string now, and
// all three certificate surfaces read it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import apiClient from '../../api-client/api-client.js';
import { OfflineIcon } from '../../components/detail-icons/DetailIcons.jsx';
import {
  CERTIFICATE_TONES,
  certificateTone,
} from '../../helpers/certificate-presentation.js';
import CertificateTile from './CertificateTile.jsx';

/* Winners, then participation, then the staff roles. This is the order of
   interest, not the order of importance — a coordinator certificate is no
   lesser, it is simply not the one anybody scrolls looking for. */
const TONE_ORDER = {
  [CERTIFICATE_TONES.WINNER]: 0,
  [CERTIFICATE_TONES.PARTICIPATION]: 1,
  [CERTIFICATE_TONES.STAFF]: 2,
};

function timeOf(isoString) {
  const time = isoString ? new Date(isoString).getTime() : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}

function dayMonth(date, withYear) {
  return date.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

/*
 * The fest's dates for the section heading. `metadata.festDates` is the
 * server's own pre-formatted string, frozen into the certificate at generation
 * time; it is the fallback rather than the primary because a fest whose dates
 * moved after a certificate was issued should show the fest's real dates, and
 * festId is live.
 */
function festDateRange(fest, fallback) {
  const startsOn = fest?.startsOn ? new Date(fest.startsOn) : null;
  if (!startsOn || Number.isNaN(startsOn.getTime())) {
    return fallback ?? '';
  }
  const endsOn = fest?.endsOn ? new Date(fest.endsOn) : null;
  if (!endsOn || Number.isNaN(endsOn.getTime()) || endsOn.getTime() === startsOn.getTime()) {
    return dayMonth(startsOn, true);
  }
  /* "12–14 Mar 2025" when the year is shared, which it almost always is; the
     year is dropped from the left half only then, never guessed at. */
  const sameYear = startsOn.getFullYear() === endsOn.getFullYear();
  return `${dayMonth(startsOn, !sameYear)} – ${dayMonth(endsOn, true)}`;
}

/**
 * Certificates → one section per fest, most recent fest first.
 *
 * Keyed by fest id where there is one and by name where there is not: festId is
 * null on a certificate whose fest was deleted, and those still have to land
 * somewhere rather than each becoming its own section of one.
 */
function groupByFest(certificates) {
  const groups = new Map();

  certificates.forEach((certificate) => {
    const fest = certificate.festId;
    const festName = fest?.festName ?? certificate.metadata?.festName ?? '';
    const key = fest?.id ?? fest?._id ?? festName ?? 'unknown';

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        /* An unnamed fest is a data fault, not a blank heading — the
           certificates under it are still real and still openable. */
        festName: festName || 'Other certificates',
        dates: festDateRange(fest, certificate.metadata?.festDates),
        /* Sorts the sections. Falls back to the newest certificate in the
           group when the fest has no startsOn, which keeps a fest-less group
           in roughly the right place instead of pinning it to the bottom. */
        sortKey: timeOf(fest?.startsOn) || timeOf(certificate.generatedAt),
        certificates: [],
      });
    }
    groups.get(key).certificates.push(certificate);
  });

  const sections = [...groups.values()];
  sections.sort((a, b) => b.sortKey - a.sortKey);
  sections.forEach((section) => {
    section.certificates.sort((a, b) => {
      const byTone =
        TONE_ORDER[certificateTone(a.certificateType)] -
        TONE_ORDER[certificateTone(b.certificateType)];
      if (byTone !== 0) return byTone;
      return timeOf(b.generatedAt) - timeOf(a.generatedAt);
    });
  });
  return sections;
}

/* The loading shape, not a loading animation: one wide cell and four narrow
   ones, which is the commonest first screen — a fest with one win and a
   handful of participations. */
const SKELETON_SHAPE = [true, false, false, false, false];

function SkeletonGrid() {
  return (
    <ul className="dcl-grid" role="list" aria-hidden="true">
      {SKELETON_SHAPE.map((isWide, index) => (
        <li
          key={index}
          className={isWide ? 'dcl-grid__cell dcl-grid__cell--wide' : 'dcl-grid__cell'}
        >
          <div className="dcl-skeleton" style={{ width: '100%' }} />
        </li>
      ))}
    </ul>
  );
}

function MyCertificatesScreen() {
  const navigate = useTransitionNavigate();
  const [certificates, setCertificates] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const isOnline = useOnlineStatus();

  const loadCertificates = useCallback(async () => {
    setLoadState('loading');
    try {
      const list = await apiClient.get('/certificates/mine');
      setCertificates(Array.isArray(list) ? list : []);
      setLoadState('ready');
    } catch {
      /*
       * The list is deliberately NOT cleared. Going through a tunnel with the
       * screen open would otherwise replace certificates already on screen with
       * an error panel, and the ones already fetched are still perfectly
       * readable — only the actions behind them need the network.
       */
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCertificates();
  }, [loadCertificates]);

  const sections = useMemo(() => groupByFest(certificates), [certificates]);

  const hasCached = certificates.length > 0;
  /* An error with nothing to show is a full-screen state; an error with a
     cached list behind it is a note above that list. */
  const showErrorState = loadState === 'error' && !hasCached;

  return (
    <div className="dcl-screen">
      <ScreenHeader title="Certificates" />

      <div className="dcl-col">
        {/* The loading state. It was lost in an earlier edit to this file and
            the screen simply rendered nothing while fetching — restored here,
            matching the grid's real shape so nothing jumps when data lands. */}
        {loadState === 'loading' ? <SkeletonGrid /> : null}

        {showErrorState ? (
          <div className="dcl-state">
            {isOnline ? null : (
              <span className="dcl-state__icon">
                <OfflineIcon />
              </span>
            )}
            <h2 className="dcl-state__title">
              {isOnline ? 'Could not load your certificates' : 'You are offline'}
            </h2>
            <p className="dcl-state__body">
              {isOnline
                ? 'Something went wrong on our side. Nothing has been lost — try again.'
                : 'Reconnect and we will fetch your certificates.'}
            </p>
            <button type="button" className="dcl-state__action" onClick={loadCertificates}>
              Try again
            </button>
          </div>
        ) : null}

        {loadState === 'ready' && !hasCached ? (
          <EmptyState
            line="Certificates you earn will show up here."
            actionLabel="Browse fests"
            onAction={() => navigate('/')}
          />
        ) : null}

        {hasCached
          ? sections.map((section) => (
              <section className="dcl-section" key={section.key} aria-label={section.festName}>
                <div className="dcl-section__head">
                  <h2 className="dcl-section__name">{section.festName}</h2>
                  {section.dates ? <span className="dcl-section__dates">{section.dates}</span> : null}
                </div>

                <ul className="dcl-grid" role="list">
                  {section.certificates.map((certificate) => (
                    <li
                      key={certificate.id}
                      className={
                        certificateTone(certificate.certificateType) === CERTIFICATE_TONES.WINNER
                          ? 'dcl-grid__cell dcl-grid__cell--wide'
                          : 'dcl-grid__cell'
                      }
                    >
                      <CertificateTile
                        certificate={certificate}
                        onOpen={() => navigate(`/my-certificates/${certificate.id}`)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          : null}
      </div>
    </div>
  );
}

export default MyCertificatesScreen;

// CoordinatorEventScreen.jsx
// Route: /backstage/coordinator-event — the coordinator's event view after
// tapping their assignment. The check-in numbers, the CSV exports, the scanner,
// and the five places they go from here.
//
// ON THE DEDAL DESIGN SYSTEM (`dop-`). Unchanged and moved verbatim: the two
// parallel fetches and the /summary-does-not-exist note behind them, every
// field mapped out of overview-stats, all four coordinator-gated CSV routes
// (participants / checked-in / checked-out / yet-to-checkin), the hidden-anchor
// blob download with its filename, and every navigation target including the
// scoreboard route's /scorecard spelling.
//
// WHAT CHANGED, and why:
//
//   · THE RING CHART IS GONE. It drew a 96px SVG arc in two hardcoded hex
//     colours to say "70%", with the raw count in the middle. A coordinator
//     working a door needs "84 of 120 checked in, 36 yet to arrive" — the
//     numbers, in a row, with the words. There is a single flat proportion bar
//     under them and no colour carries meaning.
//   · The "yet to check in" figure was --error red. Nobody has done anything
//     wrong: people simply have not arrived yet. It is --ink like the rest.
//   · THE THREE HAND-ROLLED ANIMATIONS ARE DELETED — a 400ms scale-bounce
//     keyframe block injected as an inline <style>, a hover lift and an icon
//     squash. Nothing on this screen animates.
//   · The Exit button is gone. It called navigate(-1) behind a confirmation
//     dialog, which is exactly what the back control beside the title already
//     does; two identical controls on one bar is what ScreenHeader exists to
//     end. The bell is gone for the same reason ScreenHeader dropped it: it
//     lives in the app header now.
//   · window.alert on a failed CSV becomes a line under the stats, next to the
//     buttons that produced it.
//   · The poster image is gone. A coordinator knows which event they opened;
//     160px of photograph is 160px of roster.

import { useCallback, useEffect, useState } from 'react';
import {
  Contact,
  Download,
  ListOrdered,
  Megaphone,
  ScanLine,
  Star,
  Trophy,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import apiClient from '../../api-client/api-client.js';

function CoordinatorEventScreen() {
  const navigate = useTransitionNavigate();
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get('eventId') ?? '';
  const festId = searchParams.get('festId') ?? '';

  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState('loading');
  const [downloadError, setDownloadError] = useState('');

  const loadData = useCallback(async () => {
    setLoadState('loading');
    try {
      /*
       * /backstage/coordinator/events/:id/summary was never built; the numbers
       * this page shows already exist on the event overview endpoint, so read
       * them from there rather than standing up a duplicate route. The event
       * name comes from the public event record.
       */
      const [stats, event] = await Promise.all([
        apiClient.get(`/fests/${festId}/events/${eventId}/overview-stats`),
        apiClient.get(`/fests/${festId}/events/${eventId}`).catch(() => null),
      ]);
      if (!stats) {
        setLoadState('error');
        return;
      }
      setData({
        eventName: event?.eventName ?? '',
        eventType: event?.eventType ?? null,
        posterImageUrl: event?.posterImageUrl ?? event?.bannerImageUrl ?? null,
        eventStartsAt: event?.startsAt ?? null,
        eventEndsAt: event?.endsAt ?? null,
        venue: event?.venue ?? null,
        totalRegistrations: stats.registeredCount ?? 0,
        checkedInCount: stats.venueCheckInCount ?? 0,
        checkedOutCount: stats.checkedOutCount ?? 0,
        yetToArriveCount: stats.yetToArriveCount ?? 0,
      });
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [eventId, festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  function handleOpenScanner() {
    if (eventId) {
      navigate(`/backstage/scanner?eventId=${eventId}`);
    }
  }

  /*
   * Each tile downloads its own list. The routes are coordinator-gated:
   * participants / checked-in / checked-out / yet-to-checkin, all CSV.
   *
   * The blob goes through a hidden anchor rather than window.open so the file
   * downloads with a sensible name instead of opening as a tab of raw text.
   */
  async function handleDownloadKind(kind) {
    setDownloadError('');
    try {
      const csv = await apiClient.get(
        `/backstage/coordinator/events/${eventId}/${kind}.csv`,
        { responseType: 'blob' },
      );
      const blob = csv instanceof Blob ? csv : new Blob([csv], { type: 'text/csv' });
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `${data?.eventName ?? 'event'}_${kind}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      setDownloadError('Could not download that list. Please try again.');
    }
  }

  const total = data?.totalRegistrations ?? 0;
  const checkedIn = data?.checkedInCount ?? 0;
  const checkedOut = data?.checkedOutCount ?? 0;
  const yetToCheckIn = total - checkedIn;
  const percentage = total > 0 ? Math.round((checkedIn / total) * 100) : 0;

  const destinations = [
    {
      key: 'create-round',
      label: 'Create a round',
      meta: 'Seed and start rounds',
      Icon: ListOrdered,
      to: `/backstage/coordinator/events/${eventId}/create-round?festId=${festId}`,
    },
    {
      key: 'scorecard',
      label: 'Scoreboard',
      meta: 'Enter marks and advance',
      Icon: Trophy,
      to: `/backstage/coordinator/events/${eventId}/scorecard?festId=${festId}`,
    },
    {
      key: 'push-certificate',
      label: 'Push a certificate',
      meta: 'Award a winner',
      Icon: Star,
      to: `/backstage/coordinator/events/${eventId}/push-certificate?festId=${festId}`,
    },
    {
      key: 'broadcast',
      label: 'Broadcast',
      meta: 'Message everyone here',
      Icon: Megaphone,
      to: `/backstage/coordinator/events/${eventId}/broadcast?festId=${festId}`,
    },
    {
      key: 'directory',
      label: 'Directory',
      meta: 'Find a person or team',
      Icon: Contact,
      to: `/backstage/coordinator/events/${eventId}/directory?festId=${festId}`,
    },
  ];

  const stats = [
    { key: 'checked-in', label: 'Checked in', value: checkedIn, download: 'checked-in' },
    { key: 'yet', label: 'Yet to arrive', value: yetToCheckIn, download: 'yet-to-checkin' },
    { key: 'total', label: 'Registered', value: total, download: 'participants' },
    { key: 'out', label: 'Checked out', value: checkedOut, download: 'checked-out' },
  ];

  return (
    <div className="dop-screen">
      <ScreenHeader title={data?.eventName || 'Event'} />

      <div className="dop-page">
        {loadState === 'loading' ? (
          <>
            <div className="dop-stats">
              <span className="dop-sk dop-sk--block" />
              <span className="dop-sk dop-sk--block" />
              <span className="dop-sk dop-sk--block" />
              <span className="dop-sk dop-sk--block" />
            </div>
            <span className="dop-sk dop-sk--row" />
            <div className="dop-tiles">
              <span className="dop-sk dop-sk--block" />
              <span className="dop-sk dop-sk--block" />
              <span className="dop-sk dop-sk--block" />
            </div>
          </>
        ) : null}

        {loadState === 'error' ? (
          <div className="dop-retry">
            <p className="dop-retry__text">Could not load this event.</p>
            <button type="button" className="dop-btn" onClick={loadData}>
              Try again
            </button>
          </div>
        ) : null}

        {loadState === 'ready' && data ? (
          <>
            <div className="dop-ident">
              <div className="dop-ident__tags">
                {data.eventType ? (
                  <span className="dop-tag">{data.eventType === 'team' ? 'Team' : 'Solo'}</span>
                ) : null}
                {data.venue ? (
                  <span className="dop-tag">
                    {typeof data.venue === 'string' ? data.venue : (data.venue?.venueName ?? '')}
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={handleOpenScanner}
              className="dop-btn dop-btn--block dop-btn--primary"
              style={{ minHeight: '56px' }}
            >
              <ScanLine size={20} aria-hidden="true" />
              Open the scanner
            </button>

            <section className="dop-section">
              <div className="dop-section__head">
                <h2 className="dop-section__title">Check-in</h2>
                <span className="dop-section__meta">
                  {checkedIn} of {total} checked in, {percentage}%
                </span>
              </div>

              <div className="dop-meter" aria-hidden="true">
                <span className="dop-meter__fill" style={{ width: `${percentage}%` }} />
              </div>

              <div className="dop-stats">
                {stats.map((stat) => (
                  <div key={stat.key} className="dop-stat">
                    <span className="dop-stat__value">{stat.value}</span>
                    <span className="dop-stat__label">{stat.label}</span>
                    <button
                      type="button"
                      className="dop-btn dop-btn--sm dop-stat__action"
                      onClick={() => handleDownloadKind(stat.download)}
                    >
                      <Download size={14} aria-hidden="true" />
                      Download list
                    </button>
                  </div>
                ))}
              </div>

              {downloadError ? (
                <p className="dop-alert" role="alert">
                  {downloadError}
                </p>
              ) : null}
            </section>

            <section className="dop-section">
              <div className="dop-section__head">
                <h2 className="dop-section__title">Run this event</h2>
              </div>
              <div className="dop-tiles">
                {destinations.map(({ key, label, meta, Icon, to }) => (
                  <button
                    key={key}
                    type="button"
                    className="dop-tile"
                    onClick={() => navigate(to)}
                  >
                    <Icon size={20} className="dop-tile__icon" aria-hidden="true" />
                    <span className="dop-tile__label">{label}</span>
                    <span className="dop-tile__meta">{meta}</span>
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default CoordinatorEventScreen;

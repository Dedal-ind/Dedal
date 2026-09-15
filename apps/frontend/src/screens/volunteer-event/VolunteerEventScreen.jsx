// VolunteerEventScreen.jsx
// Route: /backstage/volunteer-event?checkpointId=… — one checkpoint, opened
// from a card on the volunteer hub, on the dedal design system.
//
// UNCHANGED: the single GET /backstage/volunteer/summary, the same checkpoint
// selection (the id in the query string, else the first entry in scope, else
// the error state), the same four CSV paths under
// /backstage/volunteer/checkpoints/:id/*.csv fetched with the bearer token read
// from localStorage then sessionStorage, the same filename shape, the same
// scanner route, and the same ConfirmDialog before leaving.
//
// WHAT THE REDESIGN CHANGED:
//
// · THE SCAN BUTTON. It was an olive block with two stacked gradient overlays
//   painting a gloss on it. Gloss is 2009; it is now a plain --primary block,
//   64px tall, which is the most-tapped control in the product and now looks it.
//
// · THE COUNTS. Four tiles with a 96px SVG ring, hard-coded #d5cba9 and #7c8a4a
//   strokes, a red "yet to check in" figure and a 24px icon-button hanging off
//   each corner. The ring is gone (the number was already printed inside it),
//   the two Heritage hex values are gone with it, and the download that used to
//   be a 24px corner target is now a full-width 56px button under the counts it
//   exports — you press it with a thumb, in a hurry.
//
// · COLOUR SAYS NOTHING ON ITS OWN. "Yet to check in" was red and "checked in"
//   olive; both now read in --ink under their own words. --primary appears once,
//   on the scan button.
//
// · THE EXIT. There were two controls doing one thing: a "logout" icon that
//   opened a confirm and, in the confirm, navigate(-1) — with the back arrow
//   suppressed. The confirm is unchanged and now hangs off the ScreenHeader's
//   own back control, so there is one way out and it is where a way out lives.
//
// · window.alert on a failed download is replaced by an in-page line. An alert
//   is a modal the volunteer has to dismiss before they can scan the next
//   person.

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import apiClient from '../../api-client/api-client.js';
import ConfirmDialog from '../../components/confirm-dialog/ConfirmDialog.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import OperatorStatGrid from '../../components/operator-stat-grid/OperatorStatGrid.jsx';
import { buildCheckInStats } from '../../helpers/check-in-stats.js';
import { downloadCsv } from '../../helpers/download-csv.js';
import {
  BellIcon,
  QrIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import '../../design/volunteer.css';

/*
 * The four check-in numbers and their downloads come from the shared
 * OperatorStatGrid + buildCheckInStats, the same pair the coordinator event
 * screen uses — so both staff screens show the same numbers, with the same
 * words, and the download sits inside the card for the list it produces
 * rather than in a separate Export section.
 */
const COPY = {
  title: 'My checkpoint',
  openScanner: 'Open the scanner',
  scanOffline: 'Scanning needs a network',
  checkedInOf: (checkedIn, expected) => `${checkedIn} of ${expected} checked in`,
  team: 'Team event',
  solo: 'Solo event',
  recentTitle: 'Recent check ins',
  recentCount: (count) => `${count} ${count === 1 ? 'scan' : 'scans'}`,
  noScans: 'No check ins yet.',
  unknownName: 'Name not recorded',
  downloadFailed: 'Could not download that list. Try again.',
  errorMessage: 'Could not load this checkpoint.',
  retry: 'Try again',
  notifications: 'Notifications',
  offline:
    'You are offline, so these counts are the last ones loaded and downloads are unavailable until you are back on a network.',
  leaveTitle: 'Leave this page?',
  leaveMessage: 'You will go back to the previous screen.',
  leaveConfirm: 'Leave',
  leaveCancel: 'Stay',
};

/*
 * IST, sentence case, local. Not helpers/event-format.js — that module's
 * formatters are the retired stamped-uppercase ones.
 */
const CLOCK = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function formatClock(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : CLOCK.format(date);
}

function VolunteerEventScreen() {
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();
  const [searchParams] = useSearchParams();
  const checkpointId = searchParams.get('checkpointId') ?? '';

  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState('loading');
  const [downloadError, setDownloadError] = useState('');

  const loadData = useCallback(async () => {
    setLoadState('loading');
    try {
      const summary = await apiClient.get('/backstage/volunteer/summary');
      const scope = Array.isArray(summary?.scope) ? summary.scope : [];
      const checkpoint = checkpointId
        ? (scope.find((cp) => cp.checkpointId === checkpointId) ?? scope[0])
        : scope[0];
      if (!checkpoint) {
        setLoadState('error');
        return;
      }
      setData(checkpoint);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [checkpointId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData();
  }, [loadData]);

  /* The native confirm() renders the browser's own chrome box — visually
   * foreign to the app. The in-app ConfirmDialog replaces it. */
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  function handleOpenScanner() {
    if (data?.checkpointId) {
      navigate(`/backstage/scanner?checkpointId=${data.checkpointId}`);
    }
  }

  async function handleDownloadKind(kind) {
    if (!data?.checkpointId) return;
    setDownloadError('');
    const name = data.checkpointName ?? 'event';
    const filename = `${name}_${kind}.csv`;
    try {
      await downloadCsv(
        `/backstage/volunteer/checkpoints/${data.checkpointId}/${kind}.csv`,
        filename,
      );
    } catch {
      setDownloadError(COPY.downloadFailed);
    }
  }

  const total = data?.toCheckInCount ?? 0;
  const checkedIn = data?.checkedInCount ?? 0;
  const checkedOut = data?.checkedOutCount ?? 0;
  const yetToCheckIn = total - checkedIn;
  const recentScans = data?.recentScans ?? [];

  return (
    <div className="dvl-screen">
      <ScreenHeader
        title={COPY.title}
        /* The confirm is the same state machine it was; it just hangs off the
           one back control now instead of a second icon beside it. */
        onBack={() => setShowExitConfirm(true)}
        action={
          <button
            type="button"
            className="dvl-iconbtn"
            onClick={() => navigate('/notifications')}
            aria-label={COPY.notifications}
          >
            <BellIcon />
          </button>
        }
      />

      <div className="dvl-col">
        {!isOnline ? <p className="dvl-offline">{COPY.offline}</p> : null}

        {loadState === 'loading' ? (
          <div className="dvl-skel dvl-skel--post" />
        ) : loadState === 'error' ? (
          <div className="dvl-error">
            <p className="dvl-error__message">{COPY.errorMessage}</p>
            <button type="button" className="dvl-error__retry" onClick={loadData}>
              {COPY.retry}
            </button>
          </div>
        ) : data ? (
          <>
            {/* The heading sits above the numbers, not inside a card, and the
                separate "checked in" headline is gone — the grid already says
                it — so the four stats and the scanner fit on one phone screen. */}
            <div className="dvl-post__head">
              {data.eventType ? (
                <span className="dvl-eyebrow">
                  {data.eventType === 'team' ? COPY.team : COPY.solo}
                </span>
              ) : null}
              <h2 className="dvl-post__name">{data.checkpointName ?? 'Checkpoint'}</h2>
              {data.eventName ? (
                <p className="dvl-meta">
                  <span className="dvl-meta__text">{data.eventName}</span>
                </p>
              ) : null}
            </div>

            <section className="dvl-checkin">
              <OperatorStatGrid
                stats={buildCheckInStats({
                  checkedIn,
                  yetToArrive: yetToCheckIn,
                  total,
                  checkedOut,
                })}
                onDownload={handleDownloadKind}
                /* Downloads need a network; the offline strip above says why. */
                isDownloadDisabled={!isOnline}
              />

              {downloadError ? (
                <p className="dvl-alert" role="alert">
                  {downloadError}
                </p>
              ) : null}
            </section>

            <section className="dvl-post">
              <h3 className="dvl-subhead">
                {COPY.recentTitle} · {COPY.recentCount(recentScans.length)}
              </h3>
              {recentScans.length === 0 ? (
                <p className="dvl-note">{COPY.noScans}</p>
              ) : (
                <ul className="dvl-list">
                  {recentScans.map((scan, index) => (
                    <li key={scan.scanId ?? index} className="dvl-list__row">
                      <span className="dvl-list__name">
                        {scan.participantName ?? COPY.unknownName}
                      </span>
                      <span className="dvl-list__time">{formatClock(scan.scannedAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>

      {/*
        THE SCAN BAR. Outside the scrolling column so it stays put: this is the
        control a volunteer taps dozens of times an hour, and where it used to
        sit — between the checkpoint name and the counts — it scrolled out of
        view the moment they looked at the list below it, and sat in the stretch
        zone rather than the thumb zone.

        Rendered only once there is a checkpoint to scan at: a bar on an error
        screen is chrome for an action that does not exist yet.

        Disabled while offline WITH THE REASON SAID OUT LOUD, rather than a grey
        button the volunteer has to work out for themselves.
      */}
      {loadState === 'ready' && data?.checkpointId ? (
        <div className="dvl-bar">
          <div className="dvl-bar__inner">
            <button
              type="button"
              className="dvl-scan"
              onClick={handleOpenScanner}
              disabled={!isOnline}
            >
              <QrIcon size="lg" />
              {isOnline ? COPY.openScanner : COPY.scanOffline}
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={showExitConfirm}
        title={COPY.leaveTitle}
        message={COPY.leaveMessage}
        confirmLabel={COPY.leaveConfirm}
        cancelLabel={COPY.leaveCancel}
        onCancel={() => setShowExitConfirm(false)}
        onConfirm={() => {
          setShowExitConfirm(false);
          navigate(-1);
        }}
      />
    </div>
  );
}

export default VolunteerEventScreen;

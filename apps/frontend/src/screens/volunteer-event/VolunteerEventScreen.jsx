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
import {
  BellIcon,
  DownloadIcon,
  QrIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import '../../design/volunteer.css';

/*
 * THE VOCABULARY, and why it is this short.
 *
 * The four export controls used to read "Download the full list", "Download
 * the checked in list", "Download the not checked in list" and "Download the
 * checked out list". At 166px each that wrapped every one of them onto two
 * lines, and the word "Download" was printed four times beside four download
 * icons — the redundancy UX-writing guidance exists to cut. A label wants two
 * or three words, and articles and prepositions can go if the meaning survives.
 *
 * So the verb is said ONCE, by the section heading and the icons, and each
 * control is named for the list it produces. The full sentence still reaches a
 * screen reader through aria-label, which has no width to run out of.
 *
 * The stat words are the coordinator event screen's words exactly — checked
 * in, yet to arrive, registered, checked out — so the two staff screens
 * describe the same four numbers the same way.
 */
const COPY = {
  title: 'My checkpoint',
  openScanner: 'Open the scanner',
  scanOffline: 'Scanning needs a network',
  checkedInOf: (checkedIn, expected) => `${checkedIn} of ${expected} checked in`,
  statTotal: 'Registered',
  statCheckedIn: 'Checked in',
  statCheckedOut: 'Checked out',
  statYetToCheckIn: 'Yet to arrive',
  team: 'Team event',
  solo: 'Solo event',
  recentTitle: 'Recent check ins',
  recentCount: (count) => `${count} ${count === 1 ? 'scan' : 'scans'}`,
  noScans: 'No check ins yet.',
  unknownName: 'Name not recorded',
  exportTitle: 'Export',
  downloadFull: 'Everyone',
  downloadCheckedIn: 'Checked in',
  downloadCheckedOut: 'Checked out',
  downloadYetToCheckIn: 'Yet to arrive',
  downloadFullAria: 'Download the list of everyone registered',
  downloadCheckedInAria: 'Download the list of people checked in',
  downloadCheckedOutAria: 'Download the list of people checked out',
  downloadYetToCheckInAria: 'Download the list of people yet to arrive',
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

/*
 * The download path, moved verbatim: same token lookup order, same base URL,
 * same Authorization header, same object-URL lifecycle. The only change is that
 * a failure now THROWS instead of calling window.alert, so the caller can put
 * the message in the page rather than in a modal the volunteer has to clear
 * before they can scan the next person.
 */
async function downloadCsv(path, filename) {
  const token =
    localStorage.getItem('festpass.authToken') ??
    sessionStorage.getItem('festpass.authToken') ??
    '';
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error('Download failed');
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(blobUrl);
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
            <section className="dvl-post">
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

              <div className="dvl-headline">
                <span className="dvl-headline__value">{checkedIn}</span>
                <span className="dvl-headline__label">{COPY.checkedInOf(checkedIn, total)}</span>
              </div>

              <div className="dvl-stats">
                <div className="dvl-stat">
                  <span className="dvl-stat__value">{yetToCheckIn}</span>
                  <span className="dvl-stat__label">{COPY.statYetToCheckIn}</span>
                </div>
                <div className="dvl-stat">
                  <span className="dvl-stat__value">{total}</span>
                  <span className="dvl-stat__label">{COPY.statTotal}</span>
                </div>
                <div className="dvl-stat">
                  <span className="dvl-stat__value">{checkedOut}</span>
                  <span className="dvl-stat__label">{COPY.statCheckedOut}</span>
                </div>
              </div>

              {downloadError ? (
                <p className="dvl-alert" role="alert">
                  {downloadError}
                </p>
              ) : null}

              {/*
               * The four exports. Each one is a full-width 56px target with the
               * list it produces named in full — the 24px corner icons they
               * replaced were four unlabelled taps of the same picture.
               */}
              <h3 className="dvl-subhead">{COPY.exportTitle}</h3>
              <div className="dvl-actions">
                <button
                  type="button"
                  className="dvl-button"
                  disabled={!isOnline}
                  onClick={() => handleDownloadKind('participants')}
                  aria-label={COPY.downloadFullAria}
                >
                  <DownloadIcon size="sm" />
                  {COPY.downloadFull}
                </button>
                <button
                  type="button"
                  className="dvl-button"
                  disabled={!isOnline}
                  onClick={() => handleDownloadKind('checked-in')}
                  aria-label={COPY.downloadCheckedInAria}
                >
                  <DownloadIcon size="sm" />
                  {COPY.downloadCheckedIn}
                </button>
                <button
                  type="button"
                  className="dvl-button"
                  disabled={!isOnline}
                  onClick={() => handleDownloadKind('yet-to-checkin')}
                  aria-label={COPY.downloadYetToCheckInAria}
                >
                  <DownloadIcon size="sm" />
                  {COPY.downloadYetToCheckIn}
                </button>
                <button
                  type="button"
                  className="dvl-button"
                  disabled={!isOnline}
                  onClick={() => handleDownloadKind('checked-out')}
                  aria-label={COPY.downloadCheckedOutAria}
                >
                  <DownloadIcon size="sm" />
                  {COPY.downloadCheckedOut}
                </button>
              </div>
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

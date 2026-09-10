// VolunteerDashboardScreen.jsx
// Route: /backstage/volunteer-dashboard — the volunteer's own view of their
// posts, on the dedal design system.
//
// UNCHANGED, and deliberately so, because this screen gates a real door:
// GET /backstage/volunteer/summary is still the only load; a PERMISSION_DENIED
// from it still replaces the route with "/" (this screen is not a coordinator's
// or an admin's, and it never shows them an empty state); the gate-activity
// fetch is still one GET /fests/:festId/gate-activity per fest where this
// volunteer mans a checkpoint of type `gate`, still keyed off a sorted, deduped
// id string, still cancelled by an isActive flag, and still allowed to fail
// without taking the rest of the dashboard with it. Both CSV downloads still go
// through the authenticated client, because a plain <a href> would drop the
// Authorization header.
//
// WHAT THE REDESIGN CHANGED:
//
// · THE PROGRESS RING IS GONE. It was an SVG arc, olive on a tinted track, with
//   the same number printed in the middle of it and "62% Complete" beside it. An
//   arc has to be measured against its own track to be read; the sentence
//   "18 checked in of 40 expected" cannot be misread at arm's length in the sun,
//   and it is what a volunteer is actually being asked.
//
// · NOTHING IS SAID IN COLOUR ALONE. "PENDING" was an amber-ish stat, "MY SCANS"
//   olive, "CHECKED OUT" a secondary tint. There is no amber and no green in
//   this palette, so all four counts read in --ink under a plain-language label,
//   and --primary is spent on exactly one thing per post: the scan button.
//
// · THE GATE BLOCK KEEPS ITS OWN SHAPE. A gate volunteer has no expected roster
//   — everyone with a pass may come through, repeatedly — so it still shows
//   entries today and the recent entries list rather than a check-in ratio.
//
// · The empty state is the shared EmptyState: one sentence, no dashed box.
//
// Offline: cached counts stay on screen and the download buttons are disabled
// with the reason stated, via useOnlineStatus.

import { useCallback, useEffect, useState } from 'react';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import apiClient from '../../api-client/api-client.js';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import {
  DownloadIcon,
  PhoneIcon,
  QrIcon,
  RetryIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import { VOLUNTEER_DASHBOARD_COPY, CAMPUS_ACCESS_COPY } from '../../brand/brand-copy.js';
import VolunteerHoursPanel from '../../components/volunteer-hours-panel/VolunteerHoursPanel.jsx';
import '../../design/volunteer.css';

/* Blob download through the authenticated client (a plain <a href> would drop
   the Authorization header). */
async function downloadCsv(path) {
  const csvBlob = await apiClient.get(path, { responseType: 'blob' });
  const blobUrl = URL.createObjectURL(csvBlob instanceof Blob ? csvBlob : new Blob([csvBlob]));
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = '';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

/*
 * IST, sentence case, local. NOT formatShortDate/formatClockTime from
 * helpers/event-format.js — those are the retired stamped-uppercase helpers.
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
 * THE ORDINARY POST: a checkpoint with an expected roster behind it.
 *
 * Order is deliberate. The state line, then which post this is, then the scan
 * button — the thing that is pressed once per person — and only then the
 * counts, which are read between people rather than during them.
 */
function CheckpointBlock({ checkpoint, isOnline, onDownload, onOpenScanner }) {
  const showCheckedOut = checkpoint.checkedOutCount !== null;
  const whereLine = [checkpoint.festName, checkpoint.eventName].filter(Boolean).join(', ');
  const timeLine = checkpoint.eventStartsAt
    ? `${formatClock(checkpoint.eventStartsAt)} to ${formatClock(checkpoint.eventEndsAt)}`
    : '';

  return (
    <section className="dvl-post">
      <div className="dvl-post__head">
        <span className="dvl-eyebrow">{VOLUNTEER_DASHBOARD_COPY.postLabel}</span>
        <h2 className="dvl-post__name">{checkpoint.checkpointName}</h2>
        {whereLine ? (
          <p className="dvl-meta">
            <span className="dvl-meta__text">{whereLine}</span>
          </p>
        ) : null}
        {timeLine ? (
          <p className="dvl-meta">
            <span className="dvl-meta__text">{timeLine}</span>
          </p>
        ) : null}
      </div>

      <button
        type="button"
        className="dvl-scan"
        onClick={() => onOpenScanner(checkpoint.checkpointId)}
      >
        <QrIcon size="lg" />
        {VOLUNTEER_DASHBOARD_COPY.openScanner}
      </button>

      {/* The headline pair, in words rather than as an arc. */}
      <div className="dvl-headline">
        <span className="dvl-headline__value">{checkpoint.checkedInCount}</span>
        <span className="dvl-headline__label">
          {VOLUNTEER_DASHBOARD_COPY.checkedInOf(
            checkpoint.checkedInCount,
            checkpoint.toCheckInCount,
          )}
        </span>
      </div>

      <div className="dvl-stats">
        <div className="dvl-stat">
          <span className="dvl-stat__value">{checkpoint.pendingCount}</span>
          <span className="dvl-stat__label">{VOLUNTEER_DASHBOARD_COPY.statPending}</span>
        </div>
        <div className="dvl-stat">
          <span className="dvl-stat__value">{checkpoint.myScansToday}</span>
          <span className="dvl-stat__label">{VOLUNTEER_DASHBOARD_COPY.statMyScans}</span>
        </div>
        {showCheckedOut ? (
          <div className="dvl-stat">
            <span className="dvl-stat__value">{checkpoint.checkedOutCount}</span>
            <span className="dvl-stat__label">{VOLUNTEER_DASHBOARD_COPY.statCheckedOut}</span>
          </div>
        ) : null}
      </div>

      <div className="dvl-actions">
        <button
          type="button"
          className="dvl-button"
          disabled={!isOnline}
          onClick={() => onDownload(checkpoint.checkpointId, 'participants')}
        >
          <DownloadIcon size="sm" />
          {VOLUNTEER_DASHBOARD_COPY.downloadFullList}
        </button>
        <button
          type="button"
          className="dvl-button"
          disabled={!isOnline}
          onClick={() => onDownload(checkpoint.checkpointId, 'checked-in')}
        >
          <DownloadIcon size="sm" />
          {VOLUNTEER_DASHBOARD_COPY.downloadCheckedIn}
        </button>
      </div>
    </section>
  );
}

/*
 * THE MAIN GATE BLOCK, for a volunteer whose post is the campus entrance.
 *
 * A gate volunteer's job is not the same job as an event volunteer's, and the
 * default block asks the wrong question of it: "12 of 40 checked in" assumes a
 * known expected roster, and a gate has none — everyone with a pass may come
 * through, all day, repeatedly. So the gate gets the two figures that ARE
 * meaningful at an entrance: how many people have entered campus today, and the
 * last few who did, which is also how the volunteer confirms their scanner is
 * recording rather than silently failing.
 *
 * There are deliberately no event check-in controls here. A gate volunteer is
 * scoped to gate checkpoints (allowedCheckpointTypes: ['gate']) and the server
 * refuses them anywhere else, so offering event actions would be offering
 * something that cannot work.
 */
function MainGateBlock({ checkpoint, activity, onOpenScanner }) {
  const recentEntries = activity?.recentEntries ?? [];

  return (
    <section className="dvl-post">
      <div className="dvl-post__head">
        <span className="dvl-eyebrow">{VOLUNTEER_DASHBOARD_COPY.postLabel}</span>
        <h2 className="dvl-post__name">{checkpoint.checkpointName}</h2>
        {checkpoint.festName ? (
          <p className="dvl-meta">
            <span className="dvl-meta__text">{checkpoint.festName}</span>
          </p>
        ) : null}
      </div>

      <button
        type="button"
        className="dvl-scan"
        onClick={() => onOpenScanner(checkpoint.checkpointId)}
      >
        <QrIcon size="lg" />
        {VOLUNTEER_DASHBOARD_COPY.openScanner}
      </button>

      <div className="dvl-headline">
        <span className="dvl-headline__value">{activity?.entryCount ?? 0}</span>
        <span className="dvl-headline__label">{CAMPUS_ACCESS_COPY.entriesTodayLabel}</span>
      </div>

      <div>
        <h3 className="dvl-subhead">{CAMPUS_ACCESS_COPY.recentEntriesHeading}</h3>
        {recentEntries.length === 0 ? (
          <p className="dvl-note">{CAMPUS_ACCESS_COPY.noEntriesYet}</p>
        ) : (
          <ul className="dvl-list">
            {recentEntries.map((entry, index) => (
              <li
                key={`${entry.usn ?? entry.fullName ?? 'entry'}-${index}`}
                className="dvl-list__row"
              >
                <span className="dvl-list__name">
                  {entry.fullName ?? 'Name not recorded'}
                  {entry.usn ? <span className="dvl-list__id">{entry.usn}</span> : null}
                </span>
                <span className="dvl-list__time">{formatClock(entry.checkedInAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function VolunteerDashboardScreen() {
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();
  const [scope, setScope] = useState([]);
  const [loadState, setLoadState] = useState('loading');
  const [downloadError, setDownloadError] = useState('');

  const loadSummary = useCallback(async () => {
    setLoadState('loading');
    try {
      const summary = await apiClient.get('/backstage/volunteer/summary');
      setScope(Array.isArray(summary?.scope) ? summary.scope : []);
      setLoadState('ready');
    } catch (summaryError) {
      // Not a volunteer → this screen is not theirs; back to the feed.
      if (summaryError?.code === 'PERMISSION_DENIED') {
        navigate('/', { replace: true });
        return;
      }
      setLoadState('error');
    }
  }, [navigate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSummary();
  }, [loadSummary]);

  /*
   * Campus-entry activity, one request per fest this volunteer mans a GATE for
   * (in practice one). Fetched separately rather than folded into the summary
   * because it is a fest-level figure the summary is not shaped to carry, and
   * because a failure here must leave the rest of the dashboard intact — the
   * scanner button is the thing the volunteer actually needs.
   */
  const [gateActivityByFestId, setGateActivityByFestId] = useState({});
  const gateFestIds = scope
    .filter((entry) => entry.checkpointType === 'gate' && entry.festId)
    .map((entry) => entry.festId);
  const gateFestIdKey = [...new Set(gateFestIds)].sort().join(',');
  useEffect(() => {
    if (!gateFestIdKey) {
      return undefined;
    }
    let isActive = true;
    Promise.all(
      gateFestIdKey.split(',').map((festId) =>
        apiClient
          .get(`/fests/${festId}/gate-activity`)
          .then((activity) => [festId, activity])
          .catch(() => null),
      ),
    ).then((entries) => {
      if (isActive) {
        setGateActivityByFestId(Object.fromEntries(entries.filter(Boolean)));
      }
    });
    return () => {
      isActive = false;
    };
  }, [gateFestIdKey]);

  async function handleDownload(checkpointId, kind) {
    setDownloadError('');
    try {
      await downloadCsv(`/backstage/volunteer/checkpoints/${checkpointId}/${kind}.csv`);
    } catch {
      setDownloadError(VOLUNTEER_DASHBOARD_COPY.downloadFailed);
    }
  }

  function handleOpenScanner(checkpointId) {
    navigate(`/backstage/scanner?checkpointId=${checkpointId}`);
  }

  return (
    <div className="dvl-screen">
      <ScreenHeader
        title={VOLUNTEER_DASHBOARD_COPY.title}
        action={
          <button
            type="button"
            className="dvl-iconbtn"
            onClick={loadSummary}
            aria-label={VOLUNTEER_DASHBOARD_COPY.refresh}
          >
            <RetryIcon />
          </button>
        }
      />

      <div className="dvl-col">
        {!isOnline ? <p className="dvl-offline">{VOLUNTEER_DASHBOARD_COPY.offline}</p> : null}

        {loadState === 'loading' ? (
          <div className="dvl-posts">
            <div className="dvl-skel dvl-skel--post" />
            <div className="dvl-skel dvl-skel--post" />
          </div>
        ) : null}

        {loadState === 'error' ? (
          <div className="dvl-error">
            <p className="dvl-error__message">{VOLUNTEER_DASHBOARD_COPY.errorMessage}</p>
            <button type="button" className="dvl-error__retry" onClick={loadSummary}>
              {VOLUNTEER_DASHBOARD_COPY.retry}
            </button>
          </div>
        ) : null}

        {loadState === 'ready' ? (
          <>
            {downloadError ? (
              <p className="dvl-alert" role="alert">
                {downloadError}
              </p>
            ) : null}

            {scope.length === 0 ? (
              <EmptyState line={VOLUNTEER_DASHBOARD_COPY.emptyLine} />
            ) : (
              <div className="dvl-posts">
                {scope.map((checkpoint) =>
                  /* The gate is a different post with different numbers — see
                     MainGateBlock. Everything else keeps the roster-shaped
                     block. */
                  checkpoint.checkpointType === 'gate' ? (
                    <MainGateBlock
                      key={checkpoint.checkpointId}
                      checkpoint={checkpoint}
                      activity={gateActivityByFestId[checkpoint.festId] ?? null}
                      onOpenScanner={handleOpenScanner}
                    />
                  ) : (
                    <CheckpointBlock
                      key={checkpoint.checkpointId}
                      checkpoint={checkpoint}
                      isOnline={isOnline}
                      onDownload={handleDownload}
                      onOpenScanner={handleOpenScanner}
                    />
                  ),
                )}
              </div>
            )}

            {/* Proof of service: after the fest this is the only part of the
                dashboard that still matters. */}
            <VolunteerHoursPanel />

            {/* No coordinator phone exists in any payload this screen loads —
                the crew directory is where staff contact details live. */}
            <button
              type="button"
              className="dvl-button"
              onClick={() => navigate('/crew-select')}
            >
              <PhoneIcon size="sm" />
              {VOLUNTEER_DASHBOARD_COPY.contactCoordinator}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default VolunteerDashboardScreen;

// VolunteerHoursPanel.jsx
// "I volunteered 8 hours at Alliance One" — with something to back it up. On
// the dedal design system, and used only by the volunteer dashboard.
//
// UNCHANGED: the single GET /backstage/volunteer/hours-summary, the same
// swallowed failure (the dashboard around it already handles "not a volunteer"
// by redirecting; a failure here just hides the section), the same client-built
// CSV with the same seven headers, the same trailing total row and the same
// filename slug. The CSV is still built HERE from the payload already fetched —
// a volunteer's service record is a handful of rows, so a streaming endpoint
// would be ceremony for a file that fits in a tweet.
//
// TWO PRESENTATION CHANGES WORTH NAMING:
//
// · The dates in the CSV no longer come from formatShortDate, the retired
//   helper that returns a stamped "SEP 11". They come from a local IST
//   Intl.DateTimeFormat, so the file a college reads says "11 Sep 2025".
//   The TOTAL row keeps its uppercase word: that is a spreadsheet label inside
//   a file, not copy on a screen.
//
// · The header band, the uppercase column labels and the 48px display number in
//   a tinted strip are gone. It is one card: the total, the table, the caveat,
//   and the download.

import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api-client/api-client.js';
import { buildCsv, downloadCsv } from '../../helpers/admin-csv.js';
import { DownloadIcon } from '../detail-icons/DetailIcons.jsx';
import { VOLUNTEER_HOURS_COPY as COPY } from '../../brand/brand-copy.js';
import '../../design/volunteer.css';

const REPORT_HEADERS = [
  'Fest',
  'Event',
  'Checkpoint',
  'Shift start',
  'Shift end',
  'Hours worked',
  'Scans recorded',
];

/* IST, sentence case. Deliberately NOT helpers/event-format.js. */
const DAY = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const CLOCK = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function formatDay(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : DAY.format(date);
}

function formatClock(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : CLOCK.format(date);
}

function VolunteerHoursPanel() {
  const [summary, setSummary] = useState(null);
  const [loadState, setLoadState] = useState('loading');
  const [downloadError, setDownloadError] = useState('');

  const loadHours = useCallback(async () => {
    setLoadState('loading');
    try {
      setSummary(await apiClient.get('/backstage/volunteer/hours-summary'));
      setLoadState('ready');
    } catch {
      // The dashboard around this already handles "not a volunteer" by
      // redirecting; a failure here just hides the section.
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHours();
  }, [loadHours]);

  function handleDownloadReport() {
    setDownloadError('');
    try {
      const rows = (summary?.shifts ?? []).map((shift) => [
        shift.festName ?? '',
        shift.eventName ?? '',
        shift.checkpointName ?? '',
        `${formatDay(shift.startsAt)} ${formatClock(shift.startsAt)}`,
        `${formatDay(shift.endsAt)} ${formatClock(shift.endsAt)}`,
        String(shift.durationHours ?? 0),
        String(shift.scanCount ?? 0),
      ]);
      /*
       * A trailing total row: this file is pasted into a college letter, and
       * the one number anyone reads is the sum. Leaving them to add up the
       * rows themselves is how the figure ends up wrong.
       */
      rows.push([]);
      rows.push(['', '', '', '', 'TOTAL', String(summary?.totalHoursWorked ?? 0), '']);

      const volunteerSlug = (
        summary?.volunteerFullName ||
        summary?.volunteerEmailAddress ||
        'volunteer'
      )
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      downloadCsv(
        `volunteer-hours-${volunteerSlug || 'report'}.csv`,
        buildCsv(REPORT_HEADERS, rows),
      );
    } catch {
      setDownloadError(COPY.downloadFailed);
    }
  }

  if (loadState === 'loading') {
    return <div className="dvl-skel dvl-skel--panel" />;
  }
  if (loadState === 'error' || !summary) {
    return null;
  }

  const hasShifts = (summary.shifts ?? []).length > 0;

  return (
    <section className="dvl-hours">
      <h2 className="dvl-hours__title">{COPY.sectionTitle}</h2>

      {!hasShifts ? (
        <p className="dvl-note">{COPY.emptyLine}</p>
      ) : (
        <>
          {/* The headline number — the only thing most people read. */}
          <div>
            <span className="dvl-hours__total">{summary.totalHoursWorked}</span>{' '}
            <span className="dvl-note">
              {COPY.hoursUnit}, {summary.shiftCount} {COPY.shiftsSuffix}
            </span>
          </div>

          {/* Per-shift breakdown. Scrolls sideways rather than wrapping — a
              table that reflows on a phone becomes unreadable. */}
          <div className="dvl-scroll">
            <table className="dvl-table">
              <thead>
                <tr>
                  {[COPY.columnWhen, COPY.columnWhere, COPY.columnHours, COPY.columnScans].map(
                    (columnLabel) => (
                      <th key={columnLabel} scope="col">
                        {columnLabel}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {summary.shifts.map((shift) => (
                  <tr key={`${shift.checkpointName}-${shift.startsAt}`}>
                    <td>
                      {formatDay(shift.startsAt)}
                      <span className="dvl-table__sub">
                        {formatClock(shift.startsAt)} to {formatClock(shift.endsAt)}
                      </span>
                    </td>
                    <td>
                      {shift.checkpointName}
                      {shift.eventName ? (
                        <span className="dvl-table__sub">{shift.eventName}</span>
                      ) : null}
                    </td>
                    <td>{shift.durationHours}</td>
                    <td>{shift.scanCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="dvl-note">{COPY.inProgressNote}</p>

          {downloadError ? (
            <p className="dvl-alert" role="alert">
              {downloadError}
            </p>
          ) : null}

          <button type="button" className="dvl-button" onClick={handleDownloadReport}>
            <DownloadIcon size="sm" />
            {COPY.downloadReport}
          </button>
        </>
      )}
    </section>
  );
}

export default VolunteerHoursPanel;

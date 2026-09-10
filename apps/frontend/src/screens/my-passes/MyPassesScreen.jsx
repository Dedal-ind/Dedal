// MyPassesScreen.jsx
// Route: /my-passes — every pass this participant holds, across every fest.
//
// THIS SCREEN'S JOB IS TO BE LEFT. It exists to answer one question — which
// pass — and then get out of the way. Two consequences, both deliberate:
//
// 1. THERE IS NO QR HERE. The previous version rendered a full scannable code
//    on every card. At a gate that is a hazard, not a convenience: a volunteer
//    sweeping a scanner over a scrolling list reads whichever code is under the
//    lens, and the holder has no idea which one was taken. The credential
//    belongs on the screen built to present it, once, deliberately.
//
// 2. ONE ACTIVE PASS MEANS NO LIST AT ALL. See the redirect below.
//
// The list endpoint (/passes/mine/all) returns a DELIBERATELY SLIM fest: name,
// start, end, status, id. No host college, no venue, no banner. The old card
// had labelled cells for venue and host and rendered "—" in both on every row
// for every user, forever, because that data was never in the response. Nothing
// here renders a field the endpoint does not send.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTransitionNavigate } from '../../components/route-transition/use-transition-navigate.js';
import apiClient from '../../api-client/api-client.js';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import {
  ChevronIcon,
  OfflineIcon,
  RetryIcon,
} from '../../components/detail-icons/DetailIcons.jsx';
import ScreenHeader from '../../components/screen-header/ScreenHeader.jsx';
import EmptyState from '../../components/empty-state/EmptyState.jsx';
import { formatPassDateRange, isFestLive } from '../qr-pass/pass-format.js';
import './my-passes.css';

const COPY = {
  /*
   * "MY", NOT "YOUR" — AND THE LINE BETWEEN THEM.
   *
   * "My" marks possession: a collection the person owns and navigates to, which
   * is why the labels are My passes, My certificates, My registrations, My
   * details. "Your" is the interface addressing them, which is why the
   * SENTENCES keep it — "Your changes could not be saved", "Your seat is held
   * for", "Your passes are safe". Mixing the two inside one label is what makes
   * an app read as two products; mixing them across a label and a sentence is
   * just correct English.
   *
   * Every other destination the app offers is
     phrased from the holder's side — My Fests, My Certificates, My
     Registrations — and one screen addressing the reader as "you" while its
     neighbours speak as "I" reads as two different products. */
  title: 'My passes',
  tabActive: 'Active',
  tabPast: 'Past',
  liveNow: 'Live now',
  /* One line, not a title and a subtitle. See components/empty-state. */
  emptyLine: 'Passes for fests you join will show up here.',
  emptyAction: 'Browse fests',
  errorTitle: 'We could not load your passes',
  errorText: 'This is a connection problem. Your passes are safe.',
  offlineTitle: 'You are offline',
  offlineText: 'Reconnect and this list will load. A pass already open stays open.',
  retry: 'Try again',
  suspended: 'Suspended',
  revoked: 'Revoked',
  openPass: (festName) => `Open your pass for ${festName}`,
};

const STATUS_FLAGS = { suspended: COPY.suspended, revoked: COPY.revoked };

function PassRow({ entry, nowMs, onOpen }) {
  const { pass, fest } = entry;
  const live = pass.status === 'active' && isFestLive(fest, nowMs);
  const flag = STATUS_FLAGS[pass.status] ?? null;
  const dateRange = formatPassDateRange(fest.startsOn, fest.endsOn);

  return (
    <li>
      <button
        type="button"
        className="dmp-row"
        onClick={onOpen}
        aria-label={COPY.openPass(fest.festName)}
      >
        <span className="dmp-row__body">
          <span className="dmp-row__fest">{fest.festName}</span>
          {dateRange ? <span className="dmp-row__when">{dateRange}</span> : null}
          {live ? (
            <span className="dmp-live">
              <span className="dmp-live__dot" aria-hidden="true" />
              {COPY.liveNow}
            </span>
          ) : null}
          {/* A pass that will not scan says so HERE, in the list, rather than
              letting someone find out at the front of a queue. */}
          {flag ? <span className="dmp-flag">{flag}</span> : null}
        </span>
        <span className="dmp-row__chevron">
          <ChevronIcon size="md" />
        </span>
      </button>
    </li>
  );
}

function MyPassesScreen() {
  const navigate = useTransitionNavigate();
  const isOnline = useOnlineStatus();

  const [entries, setEntries] = useState([]);
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [tab, setTab] = useState('active');
  // Captured once, so the active/past split is a pure computation and does not
  // answer differently on two renders of the same data.
  const [nowMs] = useState(() => Date.now());

  const loadPasses = useCallback(async () => {
    setLoadState('loading');
    try {
      const list = await apiClient.get('/passes/mine/all');
      setEntries(Array.isArray(list) ? list : []);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPasses();
  }, [loadPasses]);

  const { active, past } = useMemo(() => {
    const activeList = [];
    const pastList = [];
    entries.forEach((entry) => {
      if (!entry?.pass || !entry?.fest) {
        return;
      }
      const ended = entry.fest.endsOn && new Date(entry.fest.endsOn).getTime() < nowMs;
      if (ended || entry.pass.status !== 'active') {
        pastList.push(entry);
      } else {
        activeList.push(entry);
      }
    });
    // Soonest first within each group: the pass you need next is at the top.
    const bySoonest = (a, b) =>
      new Date(a.fest.startsOn ?? 0).getTime() - new Date(b.fest.startsOn ?? 0).getTime();
    return { active: activeList.sort(bySoonest), past: pastList.sort(bySoonest).reverse() };
  }, [entries, nowMs]);

  /*
   * ONE ACTIVE PASS → GO STRAIGHT TO IT.
   *
   * A list of one is a decision with no alternatives, and this screen is
   * reached from the profile and from a header shortcut by people who are
   * usually already walking towards a gate. Making them tap a single row is a
   * tap that exists only because the screen exists.
   *
   * REPLACE, NOT PUSH. Without `replace: true` the redirect stays in history:
   * pressing Back on the pass screen returns here, this effect fires again, and
   * the user is bounced forwards into a loop they cannot escape except by
   * closing the tab. That is the whole reason the flag is here.
   *
   * Passes for finished fests are still reachable — the pass screen's back
   * button lands wherever they came from, and /my-passes is only skipped while
   * exactly one pass is live.
   */
  useEffect(() => {
    if (loadState === 'ready' && active.length === 1 && past.length === 0) {
      navigate(`/my-passes/${active[0].fest.id}`, { replace: true });
    }
  }, [loadState, active, past.length, navigate]);

  /* With nothing active there is nothing to switch to, so the tabs are not
     rendered and the past list is simply what the screen shows. Deriving the
     tab rather than pushing it into state keeps "there is only one list" from
     becoming a second source of truth that can disagree. */
  const effectiveTab = active.length === 0 && past.length > 0 ? 'past' : tab;
  const shown = effectiveTab === 'active' ? active : past;

  return (
    <div className="dmp-screen">
      {/* This screen had no back control at all. It is reachable from the
          account menu and from the pass sheet, so arriving here is always a
          detour from somewhere — and with no header there was no way out of it
          but the browser's own Back, which an installed PWA does not show. */}
      <ScreenHeader title={COPY.title} />

      <div className="dmp-page">

        {loadState === 'loading' ? (
          <div className="dmp-list" aria-hidden="true">
            <div className="dmp-skel" />
            <div className="dmp-skel" />
            <div className="dmp-skel" />
          </div>
        ) : null}

        {loadState === 'error' ? (
          <div className="dmp-state">
            <span className="dmp-state__icon">
              {isOnline ? <RetryIcon size="lg" /> : <OfflineIcon size="lg" />}
            </span>
            <p className="dmp-state__title">{isOnline ? COPY.errorTitle : COPY.offlineTitle}</p>
            <p className="dmp-state__text">{isOnline ? COPY.errorText : COPY.offlineText}</p>
            <button type="button" className="dmp-button" onClick={loadPasses}>
              {COPY.retry}
            </button>
          </div>
        ) : null}

        {loadState === 'ready' && entries.length === 0 ? (
          <EmptyState
            line={COPY.emptyLine}
            actionLabel={COPY.emptyAction}
            onAction={() => navigate('/')}
          />
        ) : null}

        {loadState === 'ready' && entries.length > 0 ? (
          <>
            {/* The split is only offered when both sides exist. A tab that is
                permanently empty teaches people to stop reading tabs. */}
            {past.length > 0 && active.length > 0 ? (
              <div className="dmp-tabs">
                <button
                  type="button"
                  className="dmp-tab"
                  aria-pressed={effectiveTab === 'active'}
                  onClick={() => setTab('active')}
                >
                  {COPY.tabActive}
                </button>
                <button
                  type="button"
                  className="dmp-tab"
                  aria-pressed={effectiveTab === 'past'}
                  onClick={() => setTab('past')}
                >
                  {COPY.tabPast}
                </button>
              </div>
            ) : null}

            <ul className="dmp-list">
              {shown.map((entry) => (
                <PassRow
                  key={entry.pass.id}
                  entry={entry}
                  nowMs={nowMs}
                  onOpen={() => navigate(`/my-passes/${entry.fest.id}`)}
                />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default MyPassesScreen;

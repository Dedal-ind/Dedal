// AdminResultsBoardScreen.jsx
// Route: /admin/events/results-board — the results board, as a DRILL-DOWN.
//
// THE BOARD FOLLOWS THE HIERARCHY, and shows a different thing at each depth,
// because "what are the results?" is three different questions depending on
// where it is asked from:
//
//   fest only            → the podium of every event in the fest. Forty rows,
//                          three names each. The question is "who won what".
//   a main event         → the podium of its verticals, and nothing else. The
//                          question is "how did Chaturanga go", and answering it
//                          with all forty events is answering a different one.
//   a leaf event         → every competitor, every round, the arithmetic. The
//                          question is "how did this result happen", which only
//                          the full grid can answer.
//
// THE LEVEL IS NOT A MODE THE ADMIN PICKS. It is derived from the shape of the
// hierarchy at whatever they selected — one dropdown, and the page follows. A
// segmented "winners / scoreboard" control would let them ask for a scoreboard
// of a container that has no competitors, which is a question with no answer.
//
// WHO OWNS WHAT, unchanged. The COORDINATOR enters marks, round by round, on
// their own panel. This screen READS and CORRECTS: the admin can overwrite any
// single cell of a leaf event's grid, that correction outranks both of the
// coordinator's guards (the check-in gate and the finalise lock), and every such
// edit is audited and marked on the cell.
//
// WHY A GRID at level 3, not a per-event leaderboard. A multi-round event's
// result is a matrix: this person, that round, this mark. Collapsing it to one
// number per competitor throws away the column that explains the number, so a
// disputed total ("she was second in both rounds, how is she fourth?") could not
// be settled on the screen where it was raised.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Medal, Pencil, Search } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveInput from '../../components-admin/admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveSelect from '../../components-admin/admin-executive-select/AdminExecutiveSelect.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import {
  ROUND_SCOREBOARD_PATH,
  computeRowTotal,
  rankScoreboardRows,
  scoreboardRowName,
} from '../../helpers/round-scoreboard.js';
import { ADMIN_RESULTS_BOARD_COPY as COPY } from '../../brand-admin/brand-copy.js';
import { compareBySiblingRank } from '../../helpers/sibling-rank-sort.js';

/*
 * Podium treatment for the top three. Gold, silver and bronze are the only three
 * colours on this screen that are not console tokens, deliberately: they are the
 * one place the board is allowed to be literal, and a medal drawn in the brand
 * blue is not a medal. The same three are used by BOTH tables, so a first place
 * looks like a first place whichever level you are reading.
 */
const PODIUM_STYLES = {
  1: { ring: 'bg-[#B8860B]/8', chip: 'bg-[#B8860B] text-white', icon: '#B8860B', label: '1st' },
  2: { ring: 'bg-[#7D8590]/8', chip: 'bg-[#7D8590] text-white', icon: '#7D8590', label: '2nd' },
  3: { ring: 'bg-[#A1673A]/8', chip: 'bg-[#A1673A] text-white', icon: '#A1673A', label: '3rd' },
};

const HEADER_CELL_CLASS =
  'px-4 py-2.5 text-left font-admin-mono text-[11px] font-semibold uppercase tracking-wide text-admin-slate-600';

function formatScore(score) {
  return typeof score === 'number' ? String(score) : '';
}

/*
 * The event dropdown's options, as ONE flat list that reads as a tree.
 *
 * A single control rather than a dropdown per level: the depth of the thing you
 * want is not a decision you should have to make before you can look for it, and
 * three chained selects made picking a top-level event require touching two of
 * them. Depth is carried by an em-dash indent, which survives a native <select>
 * where nesting markup does not.
 */
function buildEventOptions(events) {
  const childrenByParentId = new Map();
  for (const event of events) {
    const parentKey = event.parentEventId ? String(event.parentEventId) : 'root';
    if (!childrenByParentId.has(parentKey)) {
      childrenByParentId.set(parentKey, []);
    }
    childrenByParentId.get(parentKey).push(event);
  }
  // Each level in the admin's own order: sibling rank, then id — the same
  // rule the structure editor and the server apply, so the dropdown lists
  // events in the sequence the structure screen shows them.
  for (const list of childrenByParentId.values()) {
    list.sort(compareBySiblingRank);
  }

  const options = [];
  const walk = (parentKey, depth) => {
    for (const event of childrenByParentId.get(parentKey) ?? []) {
      options.push({
        value: event.id,
        label: `${'— '.repeat(depth)}${event.eventName}`,
      });
      walk(String(event.id), depth + 1);
    }
  };
  walk('root', 0);
  return options;
}

/* One winner cell of the level 1/2 table: who, and where they are from. */
function WinnerCell({ place, placement }) {
  const style = PODIUM_STYLES[placement];
  if (!place || !place.name) {
    return (
      <td className="border-l border-admin-slate-200 px-4 py-2.5 align-middle">
        <span className="font-admin-mono text-[13px] text-admin-slate-600/60">
          {COPY.pendingWinner}
        </span>
      </td>
    );
  }
  return (
    <td className={`border-l border-admin-slate-200 px-4 py-2.5 align-middle ${style.ring}`}>
      <span className="flex items-center gap-2">
        <Medal size={16} style={{ color: style.icon }} className="shrink-0" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate font-admin-body text-[14px] font-medium text-admin-neutral-ink">
            {place.name}
          </span>
          {place.college ? (
            <span className="block truncate font-admin-mono text-[11px] text-admin-slate-600">
              {place.college}
            </span>
          ) : null}
        </span>
      </span>
    </td>
  );
}

/*
 * ONE cell of the level 3 grid, and the only editable thing on the screen.
 *
 * It is a plain input at rest rather than a button that becomes an input: at a
 * grid of this density, a click-to-reveal control means the admin cannot tell
 * which of forty cells are editable without clicking them, and correcting a
 * column of marks turns into forty extra clicks. The affordance is the cell.
 *
 * Commits on Enter and on blur, and reverts on Escape. Blur is included because
 * the natural way to move across a row is Tab, and a Tab that silently discarded
 * the number just typed would be the worst possible failure here.
 */
function ScoreCell({ cell, round, rowName, isSaving, onCommit }) {
  const [draft, setDraft] = useState(() => formatScore(cell.score));
  // The server's value wins whenever it changes underneath us — a coordinator
  // saving the same cell while the admin is looking at it must not be masked by
  // a stale draft.
  const committedReference = useRef(formatScore(cell.score));
  useEffect(() => {
    const next = formatScore(cell.score);
    if (next !== committedReference.current) {
      committedReference.current = next;
      setDraft(next);
    }
  }, [cell.score]);

  if (!cell.wasInRound) {
    return (
      <td
        className="border-l border-admin-slate-200 px-2 py-2 text-center align-middle"
        title={COPY.notInRound}
      >
        <span
          aria-label={COPY.notInRound}
          className="font-admin-mono text-[13px] text-admin-slate-600/40"
        >
          ·
        </span>
      </td>
    );
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed === committedReference.current) {
      return;
    }
    if (trimmed !== '' && !Number.isFinite(Number(trimmed))) {
      setDraft(committedReference.current);
      return;
    }
    committedReference.current = trimmed;
    onCommit(trimmed === '' ? null : Number(trimmed));
  }

  return (
    <td className="relative border-l border-admin-slate-200 p-0 align-middle">
      <input
        type="text"
        inputMode="decimal"
        aria-label={`${COPY.roundLabel(round)} — ${rowName}`}
        value={draft}
        disabled={isSaving}
        onChange={(changeEvent) => setDraft(changeEvent.target.value)}
        onBlur={commit}
        onKeyDown={(keyEvent) => {
          if (keyEvent.key === 'Enter') {
            keyEvent.currentTarget.blur();
          }
          if (keyEvent.key === 'Escape') {
            setDraft(committedReference.current);
            keyEvent.currentTarget.blur();
          }
        }}
        className={[
          'h-10 w-full bg-transparent px-2 text-center font-admin-mono text-[13px] tabular-nums',
          'text-admin-neutral-ink transition-colors',
          'hover:bg-admin-primary-blue/5 focus:bg-admin-surface-white focus:outline-none',
          'focus:ring-2 focus:ring-inset focus:ring-admin-primary-blue',
          'disabled:cursor-wait disabled:opacity-50',
        ].join(' ')}
      />
      {/* A corrected cell carries a corner mark rather than a colour wash: the
          row's colour already means rank, and a second meaning on the same
          channel would make the podium unreadable. */}
      {cell.isAdminEdited ? (
        <Pencil
          size={9}
          aria-label={COPY.adminEdited}
          className="pointer-events-none absolute right-1 top-1 text-admin-primary-blue"
        />
      ) : null}
    </td>
  );
}

/* Levels 1 and 2 — the same table over a different set of events. */
function WinnersTable({ table }) {
  if (table.events.length === 0) {
    return (
      <AdminExecutiveCard>
        <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">
          {COPY.noEventsInScope}
        </p>
      </AdminExecutiveCard>
    );
  }

  const hasProvisional = table.events.some((event) => event.winners.isProvisional);

  return (
    <>
      {hasProvisional ? (
        <p className="font-admin-body text-[13px] text-admin-slate-600">{COPY.provisionalNote}</p>
      ) : null}
      <AdminExecutiveCard bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-admin-slate-200">
                <th scope="col" className={HEADER_CELL_CLASS}>
                  {COPY.eventColumn}
                </th>
                {[1, 2, 3].map((placement) => (
                  <th
                    key={placement}
                    scope="col"
                    className={`min-w-[180px] border-l border-admin-slate-200 ${HEADER_CELL_CLASS}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Medal
                        size={13}
                        style={{ color: PODIUM_STYLES[placement].icon }}
                        aria-hidden="true"
                      />
                      {placement === 1
                        ? COPY.firstPlaceColumn
                        : placement === 2
                          ? COPY.secondPlaceColumn
                          : COPY.thirdPlaceColumn}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.events.map((event) => (
                <tr key={event.eventId} className="border-b border-admin-slate-200">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal">
                    <span className="block truncate font-admin-body text-[14px] font-medium text-admin-neutral-ink">
                      {event.eventName}
                    </span>
                    {event.winners.isProvisional ? (
                      <span className="font-admin-mono text-[10px] uppercase tracking-wide text-admin-slate-600">
                        {COPY.provisionalChipShort}
                      </span>
                    ) : null}
                  </th>
                  <WinnerCell place={event.winners.first} placement={1} />
                  <WinnerCell place={event.winners.second} placement={2} />
                  <WinnerCell place={event.winners.third} placement={3} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminExecutiveCard>
    </>
  );
}

function AdminResultsBoardScreen() {
  const [searchParameters, setSearchParameters] = useSearchParams();
  const [fests, setFests] = useState([]);
  const [festId, setFestId] = useState(searchParameters.get('festId') ?? '');
  const [eventId, setEventId] = useState(searchParameters.get('eventId') ?? '');
  const [events, setEvents] = useState([]);

  /* Level 1/2 payload, or null when the current scope is a scoreboard. */
  const [winnersTable, setWinnersTable] = useState(null);
  /* Level 3 payload — the SAME editable board shape as before. */
  const [board, setBoard] = useState(null);

  const [status, setStatus] = useState('idle');
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [searchText, setSearchText] = useState('');
  // "<roundId>:<participantUserId>" while that one cell is in flight.
  const [savingCellKey, setSavingCellKey] = useState(null);

  useEffect(() => {
    let isActive = true;
    apiClient
      .get('/fests/mine')
      .then((list) => {
        if (!isActive) {
          return;
        }
        const safe = Array.isArray(list) ? list : [];
        setFests(safe);
        // Auto-select only when there is exactly one fest: choosing among
        // several on the admin's behalf puts numbers on screen they did not ask
        // for and cannot attribute.
        if (safe.length === 1) {
          setFestId((previous) => previous || safe[0].id);
        }
      })
      .catch(() => isActive && setFests([]));
    return () => {
      isActive = false;
    };
  }, []);

  /* The scope lives in the URL, so a reload or a shared link lands on the same
     level of the same board rather than back at the top. */
  useEffect(() => {
    const nextParameters = new URLSearchParams(searchParameters);
    for (const [key, value] of Object.entries({ festId, eventId })) {
      if (value) {
        nextParameters.set(key, value);
      } else {
        nextParameters.delete(key);
      }
    }
    if (nextParameters.toString() !== searchParameters.toString()) {
      setSearchParameters(nextParameters, { replace: true });
    }
  }, [festId, eventId, searchParameters, setSearchParameters]);

  /* The fest's whole event tree — it drives the dropdown AND the level decision
     below, so the page never has to ask the server "does this have children?". */
  useEffect(() => {
    let isActive = true;
    /* No fest, nothing to fetch — and nothing to clear either: the list starts
       empty and every fest change replaces it wholesale. */
    if (!festId) {
      return undefined;
    }
    apiClient
      .get(`/fests/${festId}/events/all`)
      .then((list) => isActive && setEvents(Array.isArray(list) ? list : []))
      .catch(() => isActive && setEvents([]));
    return () => {
      isActive = false;
    };
  }, [festId]);

  const eventOptions = useMemo(() => buildEventOptions(events), [events]);

  const selectedEvent = useMemo(
    () => events.find((event) => String(event.id) === String(eventId)) ?? null,
    [events, eventId],
  );

  /*
   * THE LEVEL, decided in one place. A selected event with children is a
   * container, so it is asking about its verticals; one without is a leaf, so it
   * is asking about its own competitors.
   */
  const hasChildren = useMemo(() => {
    if (!eventId) {
      return false;
    }
    return events.some((event) => String(event.parentEventId ?? '') === String(eventId));
  }, [events, eventId]);
  const level = !eventId || hasChildren ? 'winners' : 'scoreboard';

  const loadResults = useCallback(async () => {
    if (!festId) {
      setWinnersTable(null);
      setBoard(null);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    setLoadError('');
    try {
      if (level === 'scoreboard') {
        /*
         * The EXISTING scoreboard endpoint, not the new results one: this board
         * is editable, and the PATCH that corrects a cell returns this exact
         * shape. Reading the level-3 view from a second, read-only endpoint
         * would mean the correction path and the display path disagreed about
         * their payload the first time either changed.
         */
        const result = await apiClient.get(ROUND_SCOREBOARD_PATH(festId, eventId));
        setBoard(result ?? null);
        setWinnersTable(null);
      } else {
        const result = await apiClient.get(
          `/fests/${festId}/results${eventId ? `?eventId=${eventId}` : ''}`,
        );
        setWinnersTable(result ?? null);
        setBoard(null);
      }
      setStatus('ready');
    } catch (error) {
      setLoadError(error?.message || COPY.loadFailed);
      setStatus('error');
    }
  }, [festId, eventId, level]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveError('');
    loadResults();
  }, [loadResults]);

  /*
   * One corrected cell. The PATCH returns the WHOLE board rather than the cell,
   * so the totals and the ranking that move with it come from the server in the
   * same round trip — the client never has to guess whether its own arithmetic
   * still agrees with the server's about who won.
   */
  async function commitCell(row, cell, nextScore) {
    const cellKey = `${cell.roundId}:${row.participantUserId}`;
    setSavingCellKey(cellKey);
    setSaveError('');
    try {
      const updated = await apiClient.patch(
        `/fests/${festId}/events/${eventId}/rounds/${cell.roundId}/scores/${row.participantUserId}`,
        { score: nextScore },
      );
      setBoard(updated ?? null);
    } catch (error) {
      setSaveError(error?.message || COPY.saveFailed);
      // The board is reloaded rather than left holding the rejected number, so
      // what is on screen is always what the server actually stored.
      await loadResults();
    } finally {
      setSavingCellKey(null);
    }
  }

  const rounds = board?.rounds ?? [];
  const rankedRows = useMemo(() => rankScoreboardRows(board?.rows ?? []), [board]);

  const normalisedSearch = searchText.trim().toLowerCase();
  const visibleRows = useMemo(() => {
    if (!normalisedSearch) {
      return rankedRows;
    }
    return rankedRows.filter((row) =>
      scoreboardRowName(row).toLowerCase().includes(normalisedSearch),
    );
  }, [rankedRows, normalisedSearch]);

  const podium = useMemo(
    () => rankedRows.filter((row) => row.rank !== null && row.rank <= 3),
    [rankedRows],
  );

  /*
   * The download label states the LEVEL and the COUNT, because those are the two
   * things an admin needs to know before clicking: a button that says only
   * "Download" on a page with three possible tables is a button you have to
   * click to find out what it does.
   */
  const downloadLabel = useMemo(() => {
    if (level === 'scoreboard') {
      return COPY.downloadScoreboard(rankedRows.length);
    }
    const eventCount = winnersTable?.events?.length ?? 0;
    return eventId ? COPY.downloadWinnersEvent(eventCount) : COPY.downloadWinnersFest(eventCount);
  }, [level, rankedRows.length, winnersTable, eventId]);

  /*
   * The export is built SERVER-side from the same resolver the read uses, rather
   * than from the rows in the browser: the CSV then cannot describe a different
   * event set or a different ranking from the table it was downloaded beside,
   * and a level-3 export carries every competitor even when the search box has
   * one of them on screen.
   */
  async function handleDownload() {
    setIsDownloading(true);
    setSaveError('');
    try {
      const response = await apiClient.get(
        `/fests/${festId}/results/download?format=csv${eventId ? `&eventId=${eventId}` : ''}`,
        { responseType: 'blob' },
      );
      const blobUrl = URL.createObjectURL(
        response instanceof Blob ? response : new Blob([response]),
      );
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = '';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      setSaveError(error?.message || COPY.downloadFailed);
    } finally {
      setIsDownloading(false);
    }
  }

  const heading =
    level === 'scoreboard'
      ? COPY.scoreboardHeading(board?.event?.eventName ?? selectedEvent?.eventName ?? '')
      : COPY.winnersHeading(winnersTable?.scopeName ?? '');
  const subtitle =
    level === 'scoreboard'
      ? COPY.scoreboardSubtitle
      : eventId
        ? COPY.winnersSubtitleEvent
        : COPY.winnersSubtitleFest;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <AdminErrorBanner message={loadError || saveError} />

      {/* The cascade, as ONE event dropdown beside the fest. */}
      <div className="sticky top-0 z-20 flex flex-wrap items-end gap-3 bg-admin-surface-off-white py-2">
        <div className="w-[240px]">
          <AdminExecutiveSelect
            label={COPY.festLabel}
            value={festId}
            placeholder={COPY.festPlaceholder}
            options={fests.map((fest) => ({ value: fest.id, label: fest.festName }))}
            onChange={(changeEvent) => {
              setFestId(changeEvent.target.value);
              // A new fest's events are different events; keeping the old
              // selection would show a board for something not in this fest.
              setEventId('');
            }}
          />
        </div>
        {festId ? (
          <div className="w-[300px]">
            <AdminExecutiveSelect
              label={COPY.eventLabel}
              value={eventId}
              options={[{ value: '', label: COPY.wholeFestOption }, ...eventOptions]}
              onChange={(changeEvent) => setEventId(changeEvent.target.value)}
            />
          </div>
        ) : null}
      </div>

      {!festId ? (
        <AdminExecutiveCard>
          <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">
            {fests.length === 0 ? COPY.noFests : COPY.selectFestPrompt}
          </p>
        </AdminExecutiveCard>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-admin-display text-[18px] font-semibold text-admin-neutral-ink">
                {heading}
              </h2>
              <p className="mt-1 font-admin-body text-[14px] leading-5 text-admin-slate-600">
                {subtitle}
              </p>
            </div>
            {status === 'ready' ? (
              <AdminExecutiveButton
                variant="secondary"
                onClick={handleDownload}
                loading={isDownloading}
                iconLeft={<Download size={15} />}
              >
                {isDownloading ? COPY.downloading : downloadLabel}
              </AdminExecutiveButton>
            ) : null}
          </div>

          {status === 'loading' ? (
            <div className="flex h-[30vh] items-center justify-center">
              <span
                aria-label="Loading"
                className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
              />
            </div>
          ) : status !== 'ready' ? null : level === 'winners' ? (
            <WinnersTable table={winnersTable ?? { events: [] }} />
          ) : rounds.length === 0 ? (
            <AdminExecutiveCard>
              <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">
                {COPY.noRounds}
              </p>
            </AdminExecutiveCard>
          ) : rankedRows.length === 0 ? (
            <AdminExecutiveCard>
              <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">
                {COPY.noCompetitors}
              </p>
            </AdminExecutiveCard>
          ) : (
            <>
              {/* The podium, stated once above the grid. The grid below can be
                  scrolled and searched; the answer to "who won" should not
                  require either. */}
              {podium.length > 0 ? (
                <AdminExecutiveCard>
                  <h3 className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">
                    {COPY.podiumHeading}
                  </h3>
                  <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {podium.map((row) => {
                      const style = PODIUM_STYLES[row.rank];
                      return (
                        <li
                          key={row.participantUserId}
                          className={`flex items-center gap-3 rounded-md px-3 py-2.5 ${style.ring}`}
                        >
                          <Medal size={20} style={{ color: style.icon }} className="shrink-0" />
                          <span className="min-w-0">
                            <span className="block truncate font-admin-body text-[14px] font-semibold text-admin-neutral-ink">
                              {scoreboardRowName(row)}
                            </span>
                            <span className="block font-admin-mono text-[12px] text-admin-slate-600">
                              {style.label} · {row.totalScore}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </AdminExecutiveCard>
              ) : null}

              <div className="max-w-sm">
                <AdminExecutiveInput
                  label={COPY.searchLabel}
                  placeholder={COPY.searchPlaceholder}
                  iconLeft={<Search size={15} />}
                  value={searchText}
                  onChange={(changeEvent) => setSearchText(changeEvent.target.value)}
                />
              </div>

              {board?.event?.resultsFinalisedAt ? (
                <p className="font-admin-body text-[13px] text-admin-slate-600">
                  {COPY.finalisedNote}
                </p>
              ) : null}

              <AdminExecutiveCard bodyClassName="p-0">
                {/* The grid scrolls sideways on its own rather than the page: a
                    fest with eight rounds must not push the console's chrome off
                    screen. */}
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b border-admin-slate-200">
                        <th
                          scope="col"
                          className={`sticky left-0 z-10 bg-admin-surface-white ${HEADER_CELL_CLASS}`}
                        >
                          {COPY.competitorHeader}
                        </th>
                        {rounds.map((round) => (
                          <th
                            key={round.id}
                            scope="col"
                            className="min-w-[92px] border-l border-admin-slate-200 px-2 py-2.5 text-center font-admin-mono text-[11px] font-semibold uppercase tracking-wide text-admin-slate-600"
                          >
                            {COPY.roundLabel(round)}
                          </th>
                        ))}
                        <th
                          scope="col"
                          className="min-w-[86px] border-l-2 border-admin-neutral-ink px-3 py-2.5 text-right font-admin-mono text-[11px] font-semibold uppercase tracking-wide text-admin-neutral-ink"
                        >
                          {COPY.totalHeader}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row) => {
                        const style = row.rank !== null ? PODIUM_STYLES[row.rank] : undefined;
                        // Recomputed locally so the total is right the instant a
                        // cell is corrected, before the server's board comes back.
                        const total = computeRowTotal(row.cells);
                        return (
                          <tr
                            key={row.participantUserId}
                            className={`border-b border-admin-slate-200 ${style ? style.ring : ''}`}
                          >
                            <th
                              scope="row"
                              className="sticky left-0 z-10 bg-admin-surface-white px-4 py-2 text-left font-normal"
                            >
                              <span className="flex items-center gap-2">
                                {row.rank !== null ? (
                                  <span
                                    className={[
                                      'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 font-admin-mono text-[11px] font-semibold',
                                      style
                                        ? style.chip
                                        : 'bg-admin-slate-200 text-admin-neutral-ink',
                                    ].join(' ')}
                                  >
                                    {row.rank}
                                  </span>
                                ) : (
                                  <span
                                    title={COPY.unranked}
                                    className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-admin-slate-200/50 px-1 font-admin-mono text-[11px] text-admin-slate-600"
                                  >
                                    –
                                  </span>
                                )}
                                <span className="min-w-0">
                                  <span className="block truncate font-admin-body text-[14px] text-admin-neutral-ink">
                                    {scoreboardRowName(row)}
                                  </span>
                                  <span className="block truncate font-admin-mono text-[11px] text-admin-slate-600">
                                    {[
                                      row.isTeam
                                        ? `${row.members.length} member${row.members.length === 1 ? '' : 's'}`
                                        : (row.usn ?? row.participantId ?? ''),
                                      row.collegeName,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </span>
                                </span>
                              </span>
                            </th>

                            {rounds.map((round) => {
                              const cell = row.cells.find(
                                (entry) => entry.roundId === round.id,
                              ) ?? {
                                roundId: round.id,
                                score: null,
                                wasInRound: false,
                                isAdminEdited: false,
                              };
                              return (
                                <ScoreCell
                                  key={round.id}
                                  cell={cell}
                                  round={round}
                                  rowName={scoreboardRowName(row)}
                                  isSaving={
                                    savingCellKey === `${round.id}:${row.participantUserId}`
                                  }
                                  onCommit={(nextScore) => commitCell(row, cell, nextScore)}
                                />
                              );
                            })}

                            <td className="border-l-2 border-admin-neutral-ink px-3 py-2 text-right font-admin-mono text-[14px] font-semibold tabular-nums text-admin-neutral-ink">
                              {row.hasAnyScore ? total : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </AdminExecutiveCard>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default AdminResultsBoardScreen;

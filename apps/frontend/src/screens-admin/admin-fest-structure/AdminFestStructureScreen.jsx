// AdminFestStructureScreen.jsx
// The fest's whole event hierarchy as a top-to-bottom org chart, built
// client-side from parentEventId over GET /fests/:festId/events/all.
//
// TWO ROUTES REACH THIS SCREEN:
//   /admin/fests/:festId/structure  — arrived at from one fest; festId is in the path.
//   /admin/events/structure         — the sidebar entry, which names no fest.
//
// So the fest is resolved from the path param when there is one, and otherwise
// from a ?festId= search param driven by an in-page selector. The selector
// writes to the URL rather than to local state on purpose: keeping the choice
// IN the URL means the address bar and the chart cannot drift apart, and a
// reload or a shared link lands on the same fest.
//
// TWO MODES, ONE AT A TIME. The org chart is the default and stays read-only:
// it answers "what IS the shape", and a map that cannot be reshaped by a stray
// drag while someone reads it is the safer default. The editor — the dnd-kit
// grouped table in AdminEventStructureTable — is an explicit second mode for
// "change the shape". Leaving the editor re-reads the fest so the chart shows
// what the server now holds rather than what the last drag left in memory.
//
// THE WRITE. A drop lands locally first so the row sits where it was dropped,
// then ONE move call names the two neighbours it landed between. The server
// mints the rank; the client never computes one. Failure rolls the tree back
// to exactly its pre-drag shape. The backend's sibling-conflict response — a
// neighbour that moved or vanished, i.e. somebody else rearranged this fest —
// rolls back, refetches, and tells the admin so, with no automatic retry.
//
// THE PAGE IS A CANVAS. The chart fills the whole panel and every other control
// floats over it: the fest picker and publish action top-left, zoom bottom-right,
// the detail and orphan panels as overlays. The fest-name header row, the share
// card and the publish section were removed rather than shrunk — each one cost
// vertical space that the diagram is a better use of, and the share card belongs
// with the fest's own page, not with its structure.
//
// Orphans — events whose parentEventId names an event not in this fest's list —
// are listed in a floating panel rather than drawn into the tree: they point at
// a parent that does not exist, so there is no level at which they could
// honestly be placed. Surfacing them beats dropping them; a silently vanished
// event is how structural bugs hide.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveSelect from '../../components-admin/admin-executive-select/AdminExecutiveSelect.jsx';
import AdminStatusPill from '../../components-admin/admin-status-pill/AdminStatusPill.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import AdminModal from '../../components-admin/admin-modal/AdminModal.jsx';
import AdminEventOrgChart, {
  AdminEventOrgChartEmpty,
  AdminEventOrgChartError,
  AdminEventOrgChartNoFests,
  AdminEventOrgChartNoSelection,
  AdminEventOrgChartSkeleton,
} from '../../components-admin/admin-event-org-chart/AdminEventOrgChart.jsx';
import AdminEventStructureTable, {
  AdminEventStructureTableSkeleton,
} from '../../components-admin/admin-event-structure-table/AdminEventStructureTable.jsx';
import AdminToast from '../../components-admin/admin-toast/AdminToast.jsx';
import AdminSegmentedToggle from '../../components-admin/admin-segmented-toggle/AdminSegmentedToggle.jsx';
import { useOnlineStatus } from '../../hooks/use-online-status/use-online-status.js';
import AdminContingentConfig from '../../components-admin/admin-contingent-config/AdminContingentConfig.jsx';
import AdminEventEditModal from '../../components-admin/admin-event-edit-modal/AdminEventEditModal.jsx';
import { useAuthentication } from '../../contexts/authentication-context/AuthenticationContext.jsx';
import { ADMIN_FEST_STRUCTURE_COPY as COPY } from '../../brand-admin/brand-copy.js';
import { compareBySiblingRank } from '../../helpers/sibling-rank-sort.js';

/*
 * Flat rows → the nested { ...event, children } shape the chart and the editor
 * both walk.
 *
 * Each level is sorted with the shared sibling-rank comparator (rank as a
 * plain string, id as the tiebreaker), the same rule the results board and
 * the server apply. An event with no rank (not yet backfilled) sorts first;
 * without the second key two such rows could draw in a different order on each
 * load and look like the fest had silently rearranged itself.
 */

function buildTree(events) {
  const knownIds = new Set(events.map((event) => event.id));
  const nodesById = new Map(events.map((event) => [event.id, { ...event, children: [] }]));

  const roots = [];
  const orphans = [];

  events.forEach((event) => {
    const node = nodesById.get(event.id);
    if (!event.parentEventId) {
      roots.push(node);
      return;
    }
    if (!knownIds.has(event.parentEventId)) {
      orphans.push(node);
      return;
    }
    nodesById.get(event.parentEventId).children.push(node);
  });

  const sortLevel = (nodes) => {
    nodes.sort(compareBySiblingRank);
    nodes.forEach((node) => sortLevel(node.children));
    return nodes;
  };

  return { roots: sortLevel(roots), orphans: sortLevel(orphans) };
}


/*
 * The key to the status borders the chart draws on every box.
 *
 * It sits with the fest picker, on the one page that speaks this language — not
 * in the sidebar, where it was below the fold of a scrolling rail and so was
 * never going to be read by the people who needed it.
 *
 * Inline styles, not utilities: these three rules must match the chart's box
 * borders exactly, and a class carrying the colour is one theme-token change or
 * one cascade collision away from rendering as plain grey — which is exactly
 * what happened the first time, leaving a legend that explained nothing.
 */
const LEGEND_ENTRIES = [
  { label: 'Published', borderTop: '2px solid #22c55e' },
  { label: 'Draft', borderTop: '2px dashed #f59e0b' },
  { label: 'Cancelled', borderTop: '2px solid #ef4444' },
];

function StatusLegend() {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      {LEGEND_ENTRIES.map((entry) => (
        <span key={entry.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            aria-hidden="true"
            style={{ display: 'inline-block', width: 16, height: 0, borderTop: entry.borderTop }}
          />
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{entry.label}</span>
        </span>
      ))}
    </div>
  );
}

/* Stable id so the empty state's "Select fest" can reach the picker in the
   topbar — the two are in different subtrees, so a ref cannot span them. */
const FEST_SELECT_ID = 'admin-fest-structure-fest-select';

const MODE_CHART = 'chart';
const MODE_EDITOR = 'editor';

/* The backend's code for "a neighbour you named has moved or is gone". */
const SIBLING_CONFLICT_CODE = 'EVENT_SIBLING_CONFLICT';

/*
 * Reconciles the server's view of the moved event onto the optimistic tree:
 * the rank it minted and the parent it recorded. Position in the array is
 * left exactly where the drop put it — the rank is consistent with that
 * order by construction, so nothing visibly moves.
 */
function patchNode(nodes, movedEvent) {
  return nodes.map((node) =>
    node.id === movedEvent.id
      ? { ...node, siblingRank: movedEvent.siblingRank, parentEventId: movedEvent.parentEventId }
      : { ...node, children: patchNode(node.children ?? [], movedEvent) },
  );
}

function findNodeById(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = findNodeById(node.children ?? [], id);
    if (found) {
      return found;
    }
  }
  return null;
}

function AdminFestStructureScreen() {
  const { festId: festIdFromPath } = useParams();
  const [searchParameters, setSearchParameters] = useSearchParams();
  const navigate = useNavigate();
  /*
   * The path wins when present. Only the sidebar route (no path param) falls
   * back to the query string, so the fest-scoped route behaves exactly as before
   * and never grows a selector.
   */
  const festId = festIdFromPath ?? searchParameters.get('festId') ?? '';
  const needsFestPicker = !festIdFromPath;
  const [availableFests, setAvailableFests] = useState([]);
  const { isAdministrator } = useAuthentication();

  const [status, setStatus] = useState('loading');
  /* Cleared by the toast on a timer; re-set on every move, which restarts
     that timer rather than inheriting the previous one. */
  const [toastMessage, setToastMessage] = useState('');
  const [fest, setFest] = useState(null);
  const [treeItems, setTreeItems] = useState([]);
  const [orphanItems, setOrphanItems] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  /*
   * The scope whose bundle is being configured, or null. Either a Main Event
   * node, or the chart's synthetic fest-root node (isFestRoot) when the fest is
   * two layers deep and has no Main Event to hang a bundle off.
   */
  const [contingentTarget, setContingentTarget] = useState(null);
  /* The event being edited in the inline modal, or null. The modal opens OVER
     the canvas — editing an event must never cost the map you were reading. */
  const [editTarget, setEditTarget] = useState(null);
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  /* Chart by default. The editor is only ever entered explicitly. */
  const [mode, setMode] = useState(MODE_CHART);
  /* The event whose move is in flight. Its row shows "Saving…" and cannot be
     picked up again; every other row stays interactive. */
  const [savingEventId, setSavingEventId] = useState(null);
  /* The result of the last move, spoken through the editor's live region. */
  const [announcement, setAnnouncement] = useState('');
  const isOnline = useOnlineStatus();

  useEffect(() => {
    if (!needsFestPicker) {
      return;
    }
    let isActive = true;
    apiClient
      .get('/fests/mine')
      .then((fests) => {
        if (!isActive) {
          return;
        }
        const list = Array.isArray(fests) ? fests : [];
        setAvailableFests(list);
        /*
         * Auto-select ONLY when there is exactly one fest. With several, picking
         * one for the admin would put a fest's name and numbers on screen that
         * they did not choose — the same trap the dashboard had.
         */
        if (list.length === 1 && !searchParameters.get('festId')) {
          setSearchParameters({ festId: list[0].id }, { replace: true });
        }
      })
      .catch(() => setAvailableFests([]));
    return () => {
      isActive = false;
    };
  }, [needsFestPicker, searchParameters, setSearchParameters]);

  /*
   * Hands focus to the picker in the topbar. showPicker() drops the dropdown
   * open where the browser supports it; focus alone is the fallback, and is
   * enough to make the next keystroke reach the right control.
   */
  const focusFestSelect = useCallback(() => {
    const element = document.getElementById(FEST_SELECT_ID);
    if (!element) {
      return;
    }
    element.focus();
    try {
      element.showPicker?.();
    } catch {
      /* showPicker throws unless it is a direct user gesture on some browsers. */
    }
  }, []);

  /*
   * keepError: a conflict refetch must NOT wipe the banner that explains why
   * the tree just changed under the admin — the message is the point.
   */
  const loadStructure = useCallback(async ({ keepError = false } = {}) => {
    // Nothing to load until a fest is chosen; the picker below says so.
    if (!festId) {
      setStatus('ready');
      setFest(null);
      setTreeItems([]);
      setOrphanItems([]);
      return;
    }
    setStatus('loading');
    if (!keepError) {
      setErrorMessage('');
    }
    try {
      const [festDetail, eventList] = await Promise.all([
        apiClient.get(`/fests/${festId}`),
        apiClient.get(`/fests/${festId}/events/all`),
      ]);
      const events = Array.isArray(eventList) ? eventList : [];
      const { roots, orphans } = buildTree(events);
      setFest(festDetail);
      setTreeItems(roots);
      setOrphanItems(orphans);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStructure();
  }, [loadStructure]);

  /*
   * Mode switch. Leaving the editor re-reads the fest: the chart must show
   * what the server holds, not the last optimistic tree. Entering it does
   * not, because the editor starts from the same loaded rows the chart drew.
   */
  const handleModeChange = useCallback(
    (nextMode) => {
      if (nextMode === mode) {
        return;
      }
      setMode(nextMode);
      setAnnouncement('');
      if (nextMode === MODE_CHART) {
        loadStructure();
      }
    },
    [mode, loadStructure],
  );

  /*
   * ONE drop, ONE write. The editor has already placed the row locally and
   * handed over the tree before and after; this sends the move naming the two
   * neighbours the row landed between, and the server picks the rank.
   *
   * The batch /reorder endpoint is deliberately not used here: a drop in this
   * editor repositions exactly one row, and the batch path exists for a drop
   * that genuinely moves several.
   */
  const handleDrop = useCallback(
    async ({ eventId, parentEventId, previousSiblingId, nextSiblingId, previousRoots, nextRoots }) => {
      const movedName = findNodeById(previousRoots, eventId)?.eventName ?? '';
      setTreeItems(nextRoots);
      setSavingEventId(eventId);
      setErrorMessage('');
      setAnnouncement('');
      try {
        const moved = await apiClient.patch(`/fests/${festId}/events/${eventId}/move`, {
          newParentEventId: parentEventId,
          newFestId: null,
          previousSiblingId,
          nextSiblingId,
        });
        // Success: keep the optimistic shape, fold in the rank the server minted.
        setTreeItems((current) => patchNode(current, moved));
        const parentName = parentEventId ? findNodeById(nextRoots, parentEventId)?.eventName : null;
        const previousName = previousSiblingId
          ? findNodeById(nextRoots, previousSiblingId)?.eventName
          : null;
        setAnnouncement(COPY.announceSaved(movedName, parentName ?? null, previousName ?? null));
      } catch (moveError) {
        // Any failure: the tree goes back to exactly its pre-drag shape.
        setTreeItems(previousRoots);
        setAnnouncement(COPY.announceFailed(movedName));
        if (moveError?.code === SIBLING_CONFLICT_CODE) {
          /*
           * Somebody else rearranged this fest between our last load and this
           * drop. The only honest answer is the current shape: refetch, keep
           * the explanation on screen, and let the admin try again from what
           * they can now see. No retry, no guessed position.
           */
          setErrorMessage(COPY.structureChanged);
          setSavingEventId(null);
          await loadStructure({ keepError: true });
          return;
        }
        setErrorMessage(moveError?.message || COPY.moveFailed);
      } finally {
        setSavingEventId(null);
      }
    },
    [festId, loadStructure],
  );

  /*
   * Stable, because AdminToast's dismiss timer depends on it. An inline arrow
   * would be a new identity every render, restarting the effect and leaving a
   * toast that never goes away.
   */
  const handleToastDismiss = useCallback(() => setToastMessage(''), []);

  /* A drop the table refused before any request (own-descendant). */
  const handleRejectDrop = useCallback((message) => {
    setErrorMessage(message);
    setAnnouncement(message);
  }, []);

  /*
   * Publishing the fest publishes its draft events with it (see
   * fest-service.publishFest), which is why the confirmation says so: an admin
   * who expects only the fest to go live would otherwise find every event
   * suddenly visible to participants.
   */
  const handlePublishFest = useCallback(async () => {
    setIsPublishing(true);
    setErrorMessage('');
    try {
      await apiClient.post(`/fests/${festId}/publish`);
      setIsPublishOpen(false);
      // Re-read rather than patching state: every event badge changed too.
      await loadStructure();
    } catch (publishError) {
      setErrorMessage(publishError?.message || COPY.publishFailed);
      setIsPublishOpen(false);
    } finally {
      setIsPublishing(false);
    }
  }, [festId, loadStructure]);

  const handleDelete = useCallback(async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) {
      return;
    }
    try {
      await apiClient.delete(`/fests/${festId}/events/${target.id}/soft`);
      await loadStructure();
    } catch (error) {
      setErrorMessage(error?.message ?? COPY.loadError);
    }
  }, [deleteTarget, festId, loadStructure]);

  /*
   * The overflow menu for one box. Built per node at render rather than baked
   * onto the tree data: the chart takes the plain event nodes, so nothing has to
   * be decorated onto them the way the old drag tree required.
   */
  const buildActions = useCallback(
    (node) => {
      /*
       * A contingent is a priced bundle across several registerable events, and
       * there are exactly two places one can hang:
       *   · a Main Event that actually has verticals (fest → main event → …), and
       *   · the FEST itself, when it is two layers deep (fest → events) and so
       *     has no Main Event to hang it off. Two events is the floor, because
       *     one event is not a bundle.
       * Offering it anywhere else opens a form that cannot be saved.
       */
      const isEligibleForContingent = node.isFestRoot
        ? (node.children ?? []).length >= 2
        : (node.children ?? []).length > 0;

      const contingentAction = {
        key: 'contingent',
        label: COPY.configureContingent,
        onSelect: () => setContingentTarget(node),
      };

      /* The fest root is not an event: it cannot be edited, viewed in Event
         Access or deleted, so the bundle is the only action it carries. */
      if (node.isFestRoot) {
        return isAdministrator && isEligibleForContingent ? [contingentAction] : [];
      }

      return [
        {
          key: 'view',
          label: COPY.viewInEventAccess,
          onSelect: () => navigate(`/admin/events/access?festId=${festId}&eventId=${node.id}`),
        },
        ...(isAdministrator
          ? [
              {
                key: 'edit',
                label: COPY.editEvent,
                onSelect: () => setEditTarget(node),
              },
              ...(isEligibleForContingent ? [contingentAction] : []),
              {
                key: 'delete',
                label: COPY.deleteEvent,
                tone: 'danger',
                onSelect: () => setDeleteTarget(node),
              },
            ]
          : []),
      ];
    },
    [isAdministrator, festId, navigate],
  );


  /*
   * The fest picker, the publish action and the status legend all mount into the
   * TOPBAR rather than over the canvas. The bar already carries the page
   * identity, so page-scoped controls belong with it — and the chart area is
   * left as pure canvas, with nothing but the zoom pill floating on it.
   */
  /*
   * The controls that briefly lived in the page header bar. With that bar gone
   * they sit as a plain inline row above the canvas — no background, no border,
   * no second title. A control row is not a header: it carries only things you
   * act on, never a restatement of where you are.
   */
  const controlRow = (
    <div className="flex shrink-0 flex-col gap-2 px-1 pb-3">
      <div className="flex flex-wrap items-center gap-3">
      {needsFestPicker && availableFests.length > 0 ? (
        <div className="w-[240px]">
          <AdminExecutiveSelect
            id={FEST_SELECT_ID}
            value={festId}
            onChange={(changeEvent) => {
              const nextFestId = changeEvent.target.value;
              if (nextFestId) {
                setSearchParameters({ festId: nextFestId });
              } else {
                setSearchParameters({});
              }
            }}
            placeholder={COPY.festSelectorPlaceholder}
            options={availableFests.map((availableFest) => ({
              value: availableFest.id,
              label: availableFest.festName,
            }))}
          />
        </div>
      ) : null}

      {fest && fest.status === 'draft' && isAdministrator ? (
        <AdminExecutiveButton onClick={() => setIsPublishOpen(true)} disabled={isPublishing}>
          {COPY.publishFest}
        </AdminExecutiveButton>
      ) : null}

      {/* The mode toggle is an administrator's control: a coordinator can view
          the chart but has nothing to rearrange, so for them there is no
          second mode to offer. Gating is unchanged — isAdministrator already
          covers both the platform admin and the college administrator. */}
      {isAdministrator && festId ? (
        <AdminSegmentedToggle
          name={COPY.modeLabel}
          value={mode}
          onChange={handleModeChange}
          options={[
            { value: MODE_CHART, label: COPY.modeChart },
            { value: MODE_EDITOR, label: COPY.modeEditor },
          ]}
        />
      ) : null}
      </div>

      <StatusLegend />
    </div>
  );

  /*
   * Full-bleed. The admin shell pads its main area by 24px, which is right for a
   * document and wrong for a canvas — so the padding is cancelled here rather
   * than removed from the shell, where every other screen still wants it. The
   * height compensates by exactly the padding it cancels, so the panel neither
   * scrolls nor clips. The control row puts its own padding back.
   */
  const framed = (children) => (
    <div className="-m-6 flex h-[calc(100%+3rem)] flex-col overflow-hidden">
      <div className="px-6 pt-5">{controlRow}</div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );

  if (status === 'loading') {
    return framed(
      mode === MODE_EDITOR ? <AdminEventStructureTableSkeleton /> : <AdminEventOrgChartSkeleton />,
    );
  }

  if (status === 'error') {
    return framed(<AdminEventOrgChartError onRetry={loadStructure} />);
  }

  const isEmpty = treeItems.length === 0 && orphanItems.length === 0;

  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] flex-col overflow-hidden">
      <div className="px-6 pt-5">{controlRow}</div>
      <div className="min-h-0 flex-1">
      {needsFestPicker && !festId ? (
        availableFests.length === 0 ? (
          <AdminEventOrgChartNoFests onCreateFest={() => navigate('/admin/fests/create')} />
        ) : (
          <AdminEventOrgChartNoSelection
            onSelectFest={focusFestSelect}
            onCreateFest={() => navigate('/admin/fests/create')}
          />
        )
      ) : isEmpty ? (
        <AdminEventOrgChartEmpty
          festName={fest?.festName}
          onCreateEvent={() =>
            navigate(`/admin/events/create${festId ? `?festId=${festId}` : ''}`)
          }
        />
      ) : (
        <div className="relative h-full w-full">
          {mode === MODE_EDITOR && isAdministrator ? (
            /*
             * The indented dnd-kit tree used to be here. Same props, same
             * onDrop contract, same optimistic-then-reconcile write path in
             * this screen — only the presentation changed, from an indented
             * tree to a grouped table. Nothing about the move endpoint or the
             * neighbour-id payload moved with it.
             */
            <AdminEventStructureTable
              roots={treeItems}
              buildActions={buildActions}
              onDrop={handleDrop}
              onRejectDrop={handleRejectDrop}
              savingEventId={savingEventId}
              canEdit={isOnline}
              isOnline={isOnline}
              announcement={announcement}
              onToast={setToastMessage}
            />
          ) : (
            <AdminEventOrgChart fest={fest} roots={treeItems} buildActions={buildActions} />
          )}


          {/*
            The toast confirms a move that has already been applied and is
            already visible. Errors stay in the banner below, which does not
            self-dismiss — a failure the reader might miss is worse than a
            confirmation they do.
          */}
          <AdminToast message={toastMessage} onDismiss={handleToastDismiss} />

          {/* Errors float over the canvas rather than displacing it. */}
          {errorMessage ? (
            <div className="absolute bottom-4 left-4 z-20 max-w-md">
              <AdminErrorBanner message={errorMessage} />
            </div>
          ) : null}

          {!isAdministrator && !errorMessage ? (
            <p className="absolute bottom-4 left-4 z-20 font-admin-body text-[12px] text-admin-slate-600">
              {COPY.readOnlyNote}
            </p>
          ) : null}

          {/* Orphans are events whose parent is not in this fest. They have no
              honest position in the hierarchy, so they are listed in a floating
              panel rather than drawn into the tree. */}
          {orphanItems.length > 0 ? (
            <div className="absolute bottom-16 right-4 z-20 w-64 rounded-lg border border-admin-slate-200 bg-admin-surface-white p-3 shadow-[0_1px_3px_rgba(0,0,0,0.12)]">
              <p className="font-admin-body text-[12px] font-semibold text-admin-neutral-ink">
                {COPY.unattachedHeading}
              </p>
              <p className="mt-1 font-admin-body text-[11px] text-admin-slate-600">
                {COPY.unattachedNote}
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {orphanItems.map((orphan) => (
                  <li
                    key={orphan.id}
                    className="flex items-center gap-2 font-admin-body text-[12px] text-admin-neutral-ink"
                  >
                    <span className="truncate">{orphan.eventName}</span>
                    {orphan.status ? <AdminStatusPill status={orphan.status} /> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
      </div>

      <AdminModal
        isOpen={isPublishOpen}
        title={COPY.publishConfirmTitle}
        confirmLabel={COPY.publishFest}
        cancelLabel={COPY.cancel}
        isBusy={isPublishing}
        onConfirm={handlePublishFest}
        onCancel={() => setIsPublishOpen(false)}
      >
        <p className="font-admin-body text-[14px] text-admin-slate-600">
          {COPY.publishConfirmBody}
        </p>
      </AdminModal>

      {contingentTarget ? (
        <AdminContingentConfig
          festId={festId}
          festName={fest?.festName}
          /* null mainEvent IS the fest-level scope — see AdminContingentConfig. */
          mainEvent={contingentTarget.isFestRoot ? null : contingentTarget}
          verticals={
            contingentTarget.isFestRoot
              ? /* Top-level events only, and only the ones a participant can
                   actually register for: a container root is a grouping, not a
                   seat, so bundling it would sell nothing. */
                (contingentTarget.children ?? []).filter(
                  (child) => (child.children ?? []).length === 0,
                )
              : (contingentTarget.children ?? [])
          }
          onClose={() => setContingentTarget(null)}
          onSaved={loadStructure}
        />
      ) : null}

      {editTarget ? (
        <AdminEventEditModal
          festId={festId}
          event={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={loadStructure}
          onOpenFullEditor={() =>
            navigate(`/admin/events/access?festId=${festId}&eventId=${editTarget.id}`)
          }
        />
      ) : null}

      <AdminModal
        isOpen={Boolean(deleteTarget)}
        title={COPY.deleteConfirmTitle}
        confirmLabel={COPY.deleteConfirmAction}
        cancelLabel={COPY.cancel}
        tone="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      >
        <p className="font-admin-body text-[14px] text-admin-slate-600">
          {deleteTarget ? COPY.deleteConfirmBody(deleteTarget.eventName) : ''}
        </p>
      </AdminModal>
    </div>
  );
}

export default AdminFestStructureScreen;

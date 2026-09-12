// AdminEventStructureTable.jsx
// The fest structure as a TABLE that can be rearranged: drag a row by its grip
// to reorder it inside its Main Event, or across a group divider to reparent it.
//
// THIS REPLACED AN INDENTED DND-KIT TREE. The tree was the right shape for the
// data and the wrong shape for the job: at forty-plus events you could not see
// the fest without scrolling and collapsing, and the one question this screen is
// opened with — "where does everything sit" — needed a whole-list answer. A
// table gives every row the same columns at the same x positions, so the eye
// scans down a column instead of tracing indentation.
//
// WHAT IT OWNS AND WHAT IT DOES NOT — deliberately identical to the tree's
// split, because the screen's write path is unchanged. It owns drag mechanics,
// keyboard grabbing and the live region. It does NOT own the write: a drop is
// reported upward as "this event now sits between these two neighbours under
// this parent", with the tree before and after, and the screen decides what to
// send and how to roll back. Pointer and keyboard both end in one onDrop call,
// and the backend contract is untouched.
//
// TWO SENSORS, TWO MODELS, ONE COMMIT. Pointer drag is dnd-kit over a flat row
// list. The keyboard is NOT dnd-kit's sensor: the arrow semantics here are
// custom — up/down move within a group, left/right move ACROSS groups — and
// expressing "change parent" as a pixel delta was exactly the indirection that
// made the tree's keyboard support hard to reason about. Both paths compute a
// destination group and index, then call the same commitMove.

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, WifiOff } from 'lucide-react';
import AdminStatusPill from '../admin-status-pill/AdminStatusPill.jsx';
import AdminActionsMenu from '../admin-actions-menu/AdminActionsMenu.jsx';
import {
  TOP_LEVEL_GROUP_ID,
  buildGroups,
  flattenRows,
  isOwnDescendant,
  moveNodeInRoots,
  resolveNeighbours,
} from './event-structure-rows.js';

const COPY = {
  columnEvent: 'Event',
  columnStatus: 'Status',
  columnType: 'Type',
  columnCapacity: 'Capacity',
  columnRegistered: 'Registered',
  topLevel: 'Top level',
  grabHint: 'Press Space to pick up, arrow keys to move, Escape to cancel.',
  empty: 'This fest has no events yet.',
  offline: 'Offline — rearranging is paused until the connection is back.',
  grabbed: (name) => `Picked up ${name}. Use arrow keys to move it, Space to drop.`,
  cancelled: (name) => `Cancelled. ${name} is back where it started.`,
  circular: 'An event cannot be moved inside itself.',
};

/*
 * ALTERNATING GROUP TINTS, not alternating ROW tints.
 *
 * Zebra-striping rows would fight the thing the tints are for: telling you
 * where one Main Event's block ends and the next begins. Two adjacent groups
 * therefore differ, and every row inside a group matches its neighbours.
 */
const GROUP_TINTS = ['bg-admin-surface-white', 'bg-admin-surface-off-white'];

/* One place, so the header and every cell cannot drift apart. Widths are on the
   header cells; the body inherits them through the table layout. */
const COLUMN_WIDTHS = {
  grip: 'w-10',
  event: '',
  status: 'w-[120px]',
  type: 'w-[88px]',
  capacity: 'w-[90px]',
  registered: 'w-[100px]',
  actions: 'w-12',
};

function typeLabel(node) {
  return node.eventType === 'team' ? 'Team' : 'Solo';
}

/* ── One row ─────────────────────────────────────────────────────────────── */

function EventRow({ row, tint, isGrabbed, isSaving, canEdit, actions, onGripKeyDown }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !canEdit,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  /*
   * THE GRABBED STATE IS THE ACCENT, and it is the only place on this table
   * that uses it. The brief named --fill-accent; that token does not exist in
   * this codebase — the admin console has its own palette (brand-admin) and the
   * participant system's --accent has no business here. admin-primary-blue is
   * the console's accent, so the tint and the left border are drawn from it.
   */
  const rowClass = [
    'border-b border-admin-slate-100 last:border-b-0',
    isGrabbed
      ? 'border-l-2 border-l-admin-primary-blue bg-admin-primary-blue/10'
      : `border-l-2 border-l-transparent ${tint}`,
    isDragging ? 'opacity-40' : '',
    isSaving ? 'opacity-60' : '',
  ].join(' ');

  return (
    <tr ref={setNodeRef} style={style} className={rowClass}>
      <td className={`py-2 pl-2 ${COLUMN_WIDTHS.grip}`}>
        <button
          type="button"
          className={[
            'flex h-8 w-8 items-center justify-center rounded',
            canEdit
              ? 'cursor-grab text-admin-slate-600 hover:bg-admin-slate-200/60 active:cursor-grabbing'
              : 'cursor-not-allowed text-admin-slate-200',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-admin-primary-blue',
          ].join(' ')}
          disabled={!canEdit}
          aria-label={`Reorder ${row.node.eventName}. ${COPY.grabHint}`}
          aria-pressed={isGrabbed}
          onKeyDown={(keyboardEvent) => onGripKeyDown(keyboardEvent, row)}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      </td>

      <td className="py-2 pr-3">
        <span className="block truncate font-admin-body text-[14px] text-admin-neutral-ink">
          {row.node.eventName}
        </span>
        {/*
          MOBILE COMPACT. Below sm the three trailing columns are hidden and the
          Main Event name moves under the event name instead — a five-column
          table on a 390px screen is a horizontal scroll nobody performs. The
          grip and the name are what the job needs; the rest is context.
        */}
        <span className="block truncate font-admin-body text-[12px] text-admin-slate-600 sm:hidden">
          {row.groupName}
        </span>
      </td>

      <td className={`hidden py-2 pr-3 sm:table-cell ${COLUMN_WIDTHS.status}`}>
        <AdminStatusPill status={row.node.status} />
      </td>
      <td
        className={`hidden py-2 pr-3 font-admin-body text-[13px] text-admin-slate-600 sm:table-cell ${COLUMN_WIDTHS.type}`}
      >
        {typeLabel(row.node)}
      </td>
      <td
        className={`hidden py-2 pr-3 text-right font-admin-mono text-[13px] text-admin-neutral-ink sm:table-cell ${COLUMN_WIDTHS.capacity}`}
      >
        {/* An uncapped event shows a dash, not 0 — "no limit" and "no seats"
            are opposite facts and both would render as zero. */}
        {row.node.capacity ?? '—'}
      </td>
      <td
        className={`hidden py-2 pr-3 text-right font-admin-mono text-[13px] text-admin-neutral-ink sm:table-cell ${COLUMN_WIDTHS.registered}`}
      >
        {row.node.registeredCount ?? 0}
      </td>
      <td className={`py-2 pr-2 text-right ${COLUMN_WIDTHS.actions}`}>
        {actions.length > 0 ? (
          <AdminActionsMenu items={actions} label={`Actions for ${row.node.eventName}`} />
        ) : null}
      </td>
    </tr>
  );
}

/* ── The table ───────────────────────────────────────────────────────────── */

function AdminEventStructureTable({
  roots,
  buildActions,
  onDrop,
  onRejectDrop,
  savingEventId,
  canEdit = true,
  isOnline = true,
  announcement = '',
  onToast,
}) {
  const groups = useMemo(() => buildGroups(roots, { topLevelLabel: COPY.topLevel }), [roots]);
  const rows = useMemo(() => flattenRows(groups), [groups]);
  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);

  const [activeId, setActiveId] = useState(null);
  /* The keyboard grab. Separate from activeId because a keyboard grab persists
     across re-renders while the reader presses arrows, whereas a pointer drag
     is owned by dnd-kit for its duration. */
  const [grabbedId, setGrabbedId] = useState(null);
  const [liveMessage, setLiveMessage] = useState('');
  /* Where the grabbed row started, so Escape can put it back without a refetch. */
  const grabOriginRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      /* A few pixels of slop so a click on the grip (or on the row actions
         beside it) is not read as the start of a drag. */
      activationConstraint: { distance: 4 },
    }),
  );

  /*
   * THE ONE COMMIT. Both the pointer drop and every keyboard step arrive here
   * with a destination group and an index inside it; everything below is the
   * same work regardless of which input produced it.
   */
  const commitMove = useCallback(
    (movingEventId, destinationGroup, targetIndex) => {
      const movingRow = rows.find((row) => row.id === movingEventId);
      if (!movingRow || !destinationGroup) {
        return false;
      }

      if (isOwnDescendant(movingRow.node, destinationGroup.parentEventId)) {
        onRejectDrop?.(COPY.circular);
        return false;
      }

      const { previousSiblingId, nextSiblingId } = resolveNeighbours(
        destinationGroup.rows,
        movingEventId,
        targetIndex,
      );

      /* A no-op drop — dropped exactly where it already was — is not sent. The
         server would accept it and mint a new rank for nothing, and the toast
         would claim a move that did not happen. */
      const isSameGroup = movingRow.groupId === destinationGroup.groupId;
      const isSamePlace =
        isSameGroup &&
        (previousSiblingId ?? null) ===
          (destinationGroup.rows[movingRow.indexInGroup - 1]?.id ?? null);
      if (isSamePlace) {
        return false;
      }

      const nextRoots = moveNodeInRoots(
        roots,
        movingEventId,
        destinationGroup.parentEventId,
        targetIndex,
      );

      onDrop?.({
        eventId: movingEventId,
        parentEventId: destinationGroup.parentEventId,
        previousSiblingId,
        nextSiblingId,
        previousRoots: roots,
        nextRoots,
      });

      onToast?.(`Moved ${movingRow.node.eventName} to ${destinationGroup.groupName}`);
      return true;
    },
    [rows, roots, onDrop, onRejectDrop, onToast],
  );

  /* ── Pointer ───────────────────────────────────────────────────────────── */

  const handleDragEnd = useCallback(
    ({ active, over }) => {
      setActiveId(null);
      if (!over || active.id === over.id) {
        return;
      }
      const overRow = rows.find((row) => row.id === over.id);
      if (!overRow) {
        return;
      }
      const destinationGroup = groups[overRow.groupIndex];
      const movingRow = rows.find((row) => row.id === active.id);

      /*
       * Landing index. Within the same group a downward drag has to account for
       * the row being lifted out first, otherwise it lands one short of where
       * it was dropped — the classic off-by-one that makes a list feel like it
       * is resisting you.
       */
      let targetIndex = overRow.indexInGroup;
      if (movingRow.groupId === overRow.groupId && movingRow.indexInGroup < overRow.indexInGroup) {
        targetIndex = overRow.indexInGroup + 1;
      }

      commitMove(active.id, destinationGroup, targetIndex);
    },
    [rows, groups, commitMove],
  );

  /* ── Keyboard ──────────────────────────────────────────────────────────── */

  const handleGripKeyDown = useCallback(
    (keyboardEvent, row) => {
      if (!canEdit) {
        return;
      }
      const { key } = keyboardEvent;

      if (key === ' ' || key === 'Spacebar') {
        keyboardEvent.preventDefault();
        if (grabbedId === row.id) {
          setGrabbedId(null);
          grabOriginRef.current = null;
          setLiveMessage('');
          return;
        }
        setGrabbedId(row.id);
        grabOriginRef.current = { groupId: row.groupId, indexInGroup: row.indexInGroup };
        setLiveMessage(COPY.grabbed(row.node.eventName));
        return;
      }

      if (grabbedId !== row.id) {
        return;
      }

      if (key === 'Escape') {
        keyboardEvent.preventDefault();
        /*
         * Nothing to undo. Every arrow step already committed its own move, so
         * Escape releases the grab rather than rewinding — the alternative is
         * holding a pending stack of moves and replaying them backwards, which
         * would diverge from the server the moment one of them failed.
         */
        setGrabbedId(null);
        grabOriginRef.current = null;
        setLiveMessage(COPY.cancelled(row.node.eventName));
        return;
      }

      const currentGroup = groups[row.groupIndex];

      if (key === 'ArrowUp' || key === 'ArrowDown') {
        keyboardEvent.preventDefault();
        const delta = key === 'ArrowUp' ? -1 : 1;
        const targetIndex = row.indexInGroup + delta;
        if (targetIndex < 0 || targetIndex >= currentGroup.rows.length) {
          return;
        }
        /* Moving down past one neighbour means landing AFTER it, which is
           index + 1 once the row itself is lifted out. */
        commitMove(row.id, currentGroup, key === 'ArrowDown' ? targetIndex + 1 : targetIndex);
        return;
      }

      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        keyboardEvent.preventDefault();
        const delta = key === 'ArrowLeft' ? -1 : 1;
        const destinationGroup = groups[row.groupIndex + delta];
        if (!destinationGroup) {
          return;
        }
        /* Into the new group at the same depth in the list, clamped — landing
           at the end is the predictable answer when the target group is
           shorter than the position the row came from. */
        commitMove(
          row.id,
          destinationGroup,
          Math.min(row.indexInGroup, destinationGroup.rows.length),
        );
      }
    },
    [canEdit, grabbedId, groups, commitMove],
  );

  const activeRow = activeId ? rows.find((row) => row.id === activeId) : null;

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-admin-body text-[14px] text-admin-slate-600">{COPY.empty}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto px-6 pb-6">
      {!isOnline ? (
        <p className="mb-3 flex items-center gap-2 font-admin-body text-[13px] text-admin-slate-600">
          <WifiOff size={15} aria-hidden="true" />
          {COPY.offline}
        </p>
      ) : null}

      {/* The screen's own announcement plus this component's grab messages. One
          region, because two live regions race each other. */}
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage || announcement}
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => setActiveId(active.id)}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-hidden rounded-lg border border-admin-slate-200">
          <table className="w-full table-fixed border-collapse">
            <thead className="bg-admin-surface-white">
              <tr className="border-b border-admin-slate-200">
                <th className={COLUMN_WIDTHS.grip}>
                  <span className="sr-only">Reorder</span>
                </th>
                <th className="py-2 pr-3 text-left font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                  {COPY.columnEvent}
                </th>
                <th
                  className={`hidden py-2 pr-3 text-left font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600 sm:table-cell ${COLUMN_WIDTHS.status}`}
                >
                  {COPY.columnStatus}
                </th>
                <th
                  className={`hidden py-2 pr-3 text-left font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600 sm:table-cell ${COLUMN_WIDTHS.type}`}
                >
                  {COPY.columnType}
                </th>
                <th
                  className={`hidden py-2 pr-3 text-right font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600 sm:table-cell ${COLUMN_WIDTHS.capacity}`}
                >
                  {COPY.columnCapacity}
                </th>
                <th
                  className={`hidden py-2 pr-3 text-right font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600 sm:table-cell ${COLUMN_WIDTHS.registered}`}
                >
                  {COPY.columnRegistered}
                </th>
                <th className={COLUMN_WIDTHS.actions} />
              </tr>
            </thead>

            <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
              {groups.map((group, groupIndex) => (
                <tbody key={group.groupId}>
                  {/* The divider a row is dragged across to reparent. It is a
                      header, not a droppable — the drop target is the first row
                      of the group below it, which is where the reader is aiming
                      anyway. */}
                  <tr className={GROUP_TINTS[groupIndex % GROUP_TINTS.length]}>
                    <td colSpan={7} className="border-y border-admin-slate-200 px-3 py-1.5">
                      <span className="font-admin-body text-[12px] font-semibold uppercase tracking-admin-label text-admin-slate-600">
                        {group.groupId === TOP_LEVEL_GROUP_ID ? COPY.topLevel : group.groupName}
                      </span>
                      <span className="ml-2 font-admin-mono text-[11px] text-admin-slate-600">
                        {group.rows.length}
                      </span>
                    </td>
                  </tr>

                  {group.rows.map((node) => {
                    const row = rows.find((candidate) => candidate.id === node.id);
                    return (
                      <EventRow
                        key={node.id}
                        row={row}
                        tint={GROUP_TINTS[groupIndex % GROUP_TINTS.length]}
                        isGrabbed={grabbedId === node.id}
                        isSaving={savingEventId === node.id}
                        canEdit={canEdit}
                        actions={buildActions ? buildActions(node) : []}
                        onGripKeyDown={handleGripKeyDown}
                      />
                    );
                  })}
                </tbody>
              ))}
            </SortableContext>
          </table>
        </div>

        {/* The floating copy under the cursor. Rendered as a plain block rather
            than a cloned <tr>, which cannot be positioned outside its table. */}
        <DragOverlay>
          {activeRow ? (
            <div className="flex items-center gap-2 rounded-md border-l-2 border-l-admin-primary-blue bg-admin-primary-blue/10 px-3 py-2 shadow-lg">
              <GripVertical size={16} className="text-admin-slate-600" aria-hidden="true" />
              <span className="font-admin-body text-[14px] text-admin-neutral-ink">
                {activeRow.node.eventName}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

/*
 * The loading shape. Group headers and rows rather than the tree's indented
 * bars, because the skeleton's whole job is to reserve the layout that is about
 * to arrive — a skeleton shaped like the previous design makes the real content
 * look like it jumped when it lands.
 */
function AdminEventStructureTableSkeleton() {
  const groups = [3, 4, 2];
  return (
    <div className="flex h-full w-full flex-col gap-3 px-6 py-2" role="status" aria-label="Loading">
      {groups.map((rowCount, groupIndex) => (
        <div key={groupIndex} className="flex flex-col gap-1.5">
          <div className="h-6 w-40 animate-pulse rounded bg-admin-slate-200/70" />
          {Array.from({ length: rowCount }, (_, rowIndex) => (
            <div key={rowIndex} className="h-10 animate-pulse rounded bg-admin-slate-200/50" />
          ))}
        </div>
      ))}
    </div>
  );
}

export { AdminEventStructureTableSkeleton };
export default AdminEventStructureTable;

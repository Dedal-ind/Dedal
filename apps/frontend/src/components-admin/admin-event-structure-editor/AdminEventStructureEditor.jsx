// AdminEventStructureEditor.jsx
// The fest structure as an INDENTED TREE that can be rearranged: drag a row by
// its handle to reorder it among its siblings or nest it under another event.
// The read-only org chart on the same screen answers "what is the shape"; this
// answers "change the shape", and the two never render together.
//
// WHAT THIS COMPONENT OWNS, AND WHAT IT DOES NOT. It owns the drag mechanics,
// the collapse state, the keyboard sensor and the live-region announcements.
// It does NOT own the write: a drop is reported upward as "this event now sits
// between these two neighbours under this parent" together with the tree as it
// looked before and after, and the screen decides what to send and how to roll
// back. That keeps one write path with two ways in — pointer and keyboard both
// end in the same onDrop call.
//
// NEIGHBOURS, NOT INDICES. The backend's move contract names the sibling
// immediately before and after the dropped event and mints the rank itself.
// The client never computes or sends a rank; it only reads the two ids off the
// level the library rebuilt after the drop.
//
// KEYBOARD. dnd-kit-sortable-tree ships with only a pointer sensor (its
// keyboard sensor is commented out upstream). DndContext props are spread last
// in that component, so the sensors are overridden here with pointer + keyboard,
// and the coordinate getter below turns arrow keys into the same x/y deltas a
// mouse would produce: up/down step the insertion point to the neighbouring
// row, right/left shift by one indentation so the tree projects a deeper or
// shallower parent. Space picks up and drops, escape cancels — those come from
// dnd-kit's KeyboardSensor as standard.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableTree } from 'dnd-kit-sortable-tree';
import { WifiOff } from 'lucide-react';
import AdminEventTreeItem from '../admin-event-tree-item/AdminEventTreeItem.jsx';
import { ADMIN_FEST_STRUCTURE_COPY as COPY } from '../../brand-admin/brand-copy.js';

const INDENTATION_WIDTH = 28;

/*
 * LIFTED FROM dnd-kit-sortable-tree@0.1.73 — src/ui/simple/SimpleTreeItemWrapper.css.
 *
 * The package ships that stylesheet in its src/ only, not in its built dist,
 * so nothing imports it and the ghost/clone states would render unstyled.
 * These are the rules the editor depends on, copied here the same way the
 * org chart inlines its popup keyframes.
 *
 * ON UPGRADE, RE-CHECK THIS BLOCK against the package's stylesheet. The class
 * names below are the wrapper's own; if a newer version renames one, the drag
 * ghost and the drop indicator simply stop being styled — no build error, no
 * console warning, just a drag that looks like nothing is happening.
 */
const TREE_STYLES = `
.dnd-sortable-tree_simple_wrapper { list-style: none; box-sizing: border-box; }
.dnd-sortable-tree_simple_tree-item { position: relative; box-sizing: border-box; }
.dnd-sortable-tree_simple_ghost { opacity: 0.4; }
.dnd-sortable-tree_simple_clone { display: inline-block; pointer-events: none; }
.dnd-sortable-tree_simple_clone > .dnd-sortable-tree_simple_tree-item {
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
  background: #fff;
}
.dnd-sortable-tree_simple_disable-selection { user-select: none; -webkit-user-select: none; }
.dnd-sortable-tree_simple_disable-interaction { pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .dnd-sortable-tree_simple_wrapper { transition: none !important; }
}
`;

/* Every id in a subtree, the node itself included. Used to refuse a drop that
   would put an event under its own descendant before any request is made. */
function collectSubtreeIds(node, into = new Set()) {
  into.add(node.id);
  (node.children ?? []).forEach((child) => collectSubtreeIds(child, into));
  return into;
}

function findNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = findNode(node.children ?? [], id);
    if (found) {
      return found;
    }
  }
  return null;
}

function collectContainerIds(nodes, into = new Set()) {
  nodes.forEach((node) => {
    if ((node.children ?? []).length > 0) {
      into.add(node.id);
      collectContainerIds(node.children, into);
    }
  });
  return into;
}

/*
 * Walks the tree the library handed back after a drop and reads off the
 * dropped event's new level: its parent and the sibling on each side. A null
 * neighbour is a real answer — "first" or "last" in that level — and is sent
 * as such.
 */
function locateInTree(nodes, id, parent = null) {
  const index = nodes.findIndex((node) => node.id === id);
  if (index !== -1) {
    return {
      parent,
      previousSibling: nodes[index - 1] ?? null,
      nextSibling: nodes[index + 1] ?? null,
    };
  }
  for (const node of nodes) {
    const found = locateInTree(node.children ?? [], id, node);
    if (found) {
      return found;
    }
  }
  return null;
}

/* Strips the editor's own decorations (collapsed, actions, isSaving …) so the
   tree handed back to the screen is plain event nodes again. */
function undecorate(nodes) {
  return nodes.map((node) => {
    const { collapsed, actions, canDrag, isSaving, canHaveChildren, ...event } = node;
    void collapsed;
    void actions;
    void canDrag;
    void isSaving;
    void canHaveChildren;
    return { ...event, children: undecorate(node.children ?? []) };
  });
}

/*
 * Arrow keys → drag coordinates. Receives dnd-kit's sensor context: the
 * dragged item's current rect and every droppable row's rect.
 *
 * Up/down pick the row whose top edge is nearest above/below the current one
 * and land on it — closest-centre collision then resolves the drop target the
 * same way a pointer hovering that row would. Right/left move by exactly one
 * indentation so the tree's own projection changes depth by one.
 */
function buildKeyboardCoordinateGetter(indentationWidth) {
  return function keyboardCoordinateGetter(event, { context }) {
    const { active, collisionRect, droppableRects, droppableContainers } = context;
    if (!active || !collisionRect) {
      return undefined;
    }

    switch (event.code) {
      case 'ArrowRight':
        event.preventDefault();
        return { x: collisionRect.left + indentationWidth, y: collisionRect.top };
      case 'ArrowLeft':
        event.preventDefault();
        return { x: collisionRect.left - indentationWidth, y: collisionRect.top };
      case 'ArrowUp':
      case 'ArrowDown': {
        event.preventDefault();
        const isDown = event.code === 'ArrowDown';
        const rows = droppableContainers
          .getEnabled()
          .map((container) => ({ id: container.id, rect: droppableRects.get(container.id) }))
          .filter((row) => row.rect && row.id !== active.id)
          .sort((left, right) => left.rect.top - right.rect.top);

        const candidates = rows.filter((row) =>
          isDown ? row.rect.top > collisionRect.top + 1 : row.rect.top < collisionRect.top - 1,
        );
        const target = isDown ? candidates[0] : candidates[candidates.length - 1];
        if (!target) {
          return undefined;
        }
        return { x: collisionRect.left, y: target.rect.top };
      }
      default:
        return undefined;
    }
  };
}

/*
 * Toolbar over the tree: expand/collapse all, the keyboard hint, and the
 * offline notice. Sits inside the editor rather than the screen's control row
 * so the chart never grows controls that mean nothing to it.
 */
function EditorToolbar({ onExpandAll, onCollapseAll, isOnline }) {
  const buttonClass =
    'rounded-md border border-admin-slate-200 bg-admin-surface-white px-3 py-1.5 font-admin-body text-[12px] font-semibold text-admin-neutral-ink transition-colors hover:bg-admin-surface-off-white';
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 pb-3">
      <button type="button" onClick={onExpandAll} className={buttonClass}>
        {COPY.expandAll}
      </button>
      <button type="button" onClick={onCollapseAll} className={buttonClass}>
        {COPY.collapseAll}
      </button>
      <span className="font-admin-body text-[12px] text-admin-slate-600">{COPY.editorHint}</span>
      {!isOnline ? (
        <span className="ml-auto flex items-center gap-1.5 rounded-md border border-admin-status-error-red/30 bg-admin-status-error-red/5 px-2 py-1 font-admin-body text-[12px] text-admin-status-error-red">
          <WifiOff size={12} aria-hidden="true" />
          {COPY.offlineEditor}
        </span>
      ) : null}
    </div>
  );
}

/*
 * Skeleton for the editor's loading state: a column of row-shaped blocks with
 * a stagger of indents, the same idea as the chart's tree-shaped skeleton —
 * a placeholder shaped like what is coming.
 */
function AdminEventStructureEditorSkeleton() {
  const block = 'animate-pulse rounded-md bg-admin-slate-200/70 h-11';
  const indents = [0, 1, 1, 0, 1, 2, 2, 0];
  return (
    <div className="flex h-full w-full flex-col gap-2 px-6 py-2" role="status" aria-label="Loading">
      {indents.map((indent, index) => (
        <div key={index} className={block} style={{ marginLeft: indent * INDENTATION_WIDTH }} />
      ))}
    </div>
  );
}

/*
 * props
 *   roots        — the plain { ...event, children } tree the screen built.
 *   buildActions — (node) => overflow-menu items, the same function the chart uses.
 *   onDrop       — ({ eventId, parentEventId, previousSiblingId, nextSiblingId,
 *                    previousRoots, nextRoots }) => void. Called once per drop,
 *                    after the client-side descendant check has passed.
 *   onRejectDrop — (message) => void. A drop refused before any request.
 *   savingEventId — the event whose move is in flight, or null.
 *   canEdit      — false locks every handle (offline, or not an administrator).
 *   isOnline     — drives the offline notice.
 *   announcement — text for the result live region; the screen sets it after
 *                  the write settles so success and failure are both spoken.
 */
function AdminEventStructureEditor({
  roots,
  buildActions,
  onDrop,
  onRejectDrop,
  savingEventId,
  canEdit,
  isOnline,
  announcement,
}) {
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());

  /* Names by id, for the announcements. A ref rather than a dep: the
     announcement callbacks are memoised once and read the latest names. */
  const namesRef = useRef(new Map());
  useEffect(() => {
    const names = new Map();
    const walk = (nodes) =>
      nodes.forEach((node) => {
        names.set(node.id, node.eventName);
        walk(node.children ?? []);
      });
    walk(roots);
    namesRef.current = names;
  }, [roots]);

  const items = useMemo(() => {
    const decorate = (nodes) =>
      nodes.map((node) => ({
        ...node,
        children: decorate(node.children ?? []),
        collapsed: collapsedIds.has(node.id),
        actions: buildActions ? buildActions(node) : null,
        canDrag: canEdit,
        isSaving: node.id === savingEventId,
      }));
    return decorate(roots);
  }, [roots, collapsedIds, buildActions, canEdit, savingEventId]);

  /* The tree as last committed, for the drop handler and collapse-all: they
     run from dnd-kit callbacks that would otherwise close over a stale tree. */
  const rootsRef = useRef(roots);
  useEffect(() => {
    rootsRef.current = roots;
  }, [roots]);

  const handleItemsChanged = useCallback(
    (nextItems, reason) => {
      if (reason.type === 'collapsed' || reason.type === 'expanded') {
        setCollapsedIds((previous) => {
          const next = new Set(previous);
          if (reason.type === 'collapsed') {
            next.add(reason.item.id);
          } else {
            next.delete(reason.item.id);
          }
          return next;
        });
        return;
      }
      if (reason.type !== 'dropped') {
        return;
      }

      const previousRoots = rootsRef.current;
      const draggedId = reason.draggedItem.id;
      const draggedBefore = findNode(previousRoots, draggedId);
      const newParentId = reason.droppedToParent ? reason.droppedToParent.id : null;

      /* The library removes the dragged subtree from the drop targets while a
         drag is in progress, so this cannot normally trigger — it is the belt
         to that brace, and it costs nothing. */
      if (draggedBefore && newParentId && collectSubtreeIds(draggedBefore).has(newParentId)) {
        onRejectDrop?.(COPY.circularMoveFailed);
        return;
      }

      const nextRoots = undecorate(nextItems);
      const location = locateInTree(nextRoots, draggedId);
      if (!location) {
        return;
      }

      onDrop({
        eventId: draggedId,
        parentEventId: location.parent ? location.parent.id : null,
        previousSiblingId: location.previousSibling ? location.previousSibling.id : null,
        nextSiblingId: location.nextSibling ? location.nextSibling.id : null,
        previousRoots,
        nextRoots,
      });
    },
    [onDrop, onRejectDrop],
  );

  const expandAll = useCallback(() => setCollapsedIds(new Set()), []);
  const collapseAll = useCallback(
    () => setCollapsedIds(collectContainerIds(rootsRef.current)),
    [],
  );

  /* Pointer + keyboard. The 3px activation distance is the library's default
     and keeps a plain click on the handle from starting a drag. */
  const [coordinateGetter] = useState(() => buildKeyboardCoordinateGetter(INDENTATION_WIDTH));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter }),
  );

  const accessibility = useMemo(() => {
    const nameOf = (id) => namesRef.current.get(id) ?? String(id);
    return {
      screenReaderInstructions: { draggable: COPY.keyboardInstructions },
      announcements: {
        onDragStart: ({ active }) => COPY.announcePickedUp(nameOf(active.id)),
        onDragMove: ({ active, over }) =>
          over && over.id !== active.id ? COPY.announceOver(nameOf(active.id), nameOf(over.id)) : undefined,
        onDragOver: ({ active, over }) =>
          over && over.id !== active.id ? COPY.announceOver(nameOf(active.id), nameOf(over.id)) : undefined,
        onDragEnd: ({ active }) => COPY.announceDropped(nameOf(active.id)),
        onDragCancel: ({ active }) => COPY.announceCancelled(nameOf(active.id)),
      },
    };
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-admin-surface-off-white">
      <style>{TREE_STYLES}</style>
      <EditorToolbar onExpandAll={expandAll} onCollapseAll={collapseAll} isOnline={isOnline} />

      {/* The result live region. dnd-kit's own region speaks the pick-up,
          hover and drop; this one speaks what happened AFTER — saved, failed,
          or refused — because the drop itself is not the outcome. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          <SortableTree
            items={items}
            onItemsChanged={handleItemsChanged}
            TreeItemComponent={AdminEventTreeItem}
            indentationWidth={INDENTATION_WIDTH}
            disableSorting={!canEdit}
            dndContextProps={{ sensors, accessibility }}
          />
        </ul>
      </div>
    </div>
  );
}

export { AdminEventStructureEditorSkeleton };
export default AdminEventStructureEditor;

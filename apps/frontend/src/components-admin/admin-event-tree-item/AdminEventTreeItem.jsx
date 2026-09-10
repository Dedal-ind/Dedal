// AdminEventTreeItem.jsx
// One row of the fest structure editor, rendered by dnd-kit-sortable-tree for
// every node it draws.
//
// The component is wrapped in forwardRef and hands the ref straight to
// SimpleTreeItemWrapper because dnd-kit measures this element to position the
// drag ghost and the drop indicator — a row that swallows the ref still renders,
// but drops land in the wrong place, which is a far more confusing bug than a
// row that fails to appear.
//
// THE HANDLE IS OURS, NOT THE WRAPPER'S. The wrapper's default puts the drag
// listeners on the whole row AND on an unlabelled div, which makes the row
// itself a tab stop with no name and lets a click that meant "open the menu"
// begin a drag. manualDrag turns that off; the handle here is a real button
// with a label, the drag listeners, and the keyboard listeners dnd-kit's
// KeyboardSensor needs — one element, one way in for both pointer and keys.
//
// The collapse chevron is also ours for the same reason: the wrapper hides its
// own under manualDrag, and a chevron the screen reader can name beats an
// anonymous one.

import { forwardRef } from 'react';
import { SimpleTreeItemWrapper } from 'dnd-kit-sortable-tree';
import { ChevronRight, GripVertical, Loader2 } from 'lucide-react';
import AdminExecutiveChip from '../admin-executive-chip/AdminExecutiveChip.jsx';
import AdminStatusPill from '../admin-status-pill/AdminStatusPill.jsx';
import AdminActionsMenu from '../admin-actions-menu/AdminActionsMenu.jsx';
import { ADMIN_FEST_STRUCTURE_COPY as COPY } from '../../brand-admin/brand-copy.js';
import { formatCategoryLabel } from '../../helpers/category-format.js';

const HANDLE_CLASS =
  'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-admin-slate-600 transition-colors hover:bg-admin-surface-off-white hover:text-admin-neutral-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-admin-primary-blue';

const AdminEventTreeItem = forwardRef(function AdminEventTreeItem(props, ref) {
  const event = props.item;
  const childCount = event.children?.length ?? 0;
  const isContainer = childCount > 0;
  const actions = event.actions ?? null;
  const isSaving = event.isSaving === true;
  /* A row that is saving, or one the editor has locked (offline, or a
     non-administrator), shows the handle but does not wire the listeners:
     the affordance stays where the eye expects it, it just does nothing. */
  const canDrag = event.canDrag !== false && !isSaving && !props.disableSorting;

  return (
    <SimpleTreeItemWrapper
      {...props}
      ref={ref}
      manualDrag
      showDragHandle={false}
      hideCollapseButton
      disableCollapseOnItemClick
      /* 44px floor comes from the spec; the row grows past it when the badges
         wrap on a narrow console rather than clipping them. */
      contentClassName={[
        'min-h-[44px] flex items-center gap-2 rounded-md border border-admin-slate-200 bg-admin-surface-white px-2 py-2 transition-colors',
        props.isOver ? 'border-admin-primary-blue' : '',
        isSaving ? 'opacity-70' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* The grab affordance. handleProps carries dnd-kit's pointer AND
          keyboard listeners plus its aria attributes (role, tabIndex,
          aria-describedby pointing at the instructions), so this one button
          is both the drag handle and the keyboard entry point. */}
      {isSaving ? (
        <span className={HANDLE_CLASS} aria-label={COPY.saving} role="status">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        </span>
      ) : (
        <button
          type="button"
          {...(canDrag ? props.handleProps : { disabled: true })}
          aria-label={COPY.dragHandleLabel(event.eventName)}
          className={`${HANDLE_CLASS} ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-40'}`}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      )}

      {isContainer && props.onCollapse ? (
        <button
          type="button"
          onClick={(clickEvent) => {
            clickEvent.stopPropagation();
            props.onCollapse();
          }}
          aria-expanded={!props.collapsed}
          aria-label={
            props.collapsed ? COPY.expandLabel(event.eventName) : COPY.collapseLabel(event.eventName)
          }
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-admin-slate-600 transition-colors hover:bg-admin-surface-off-white"
        >
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={`transition-transform ${props.collapsed ? '' : 'rotate-90'}`}
          />
        </button>
      ) : (
        <span className="w-6 shrink-0" aria-hidden="true" />
      )}

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="truncate font-admin-body text-[14px] font-semibold text-admin-neutral-ink">
          {event.eventName}
        </span>

        {event.eventType ? (
          <AdminExecutiveChip tone="neutral">{event.eventType}</AdminExecutiveChip>
        ) : null}

        {event.category ? (
          <AdminExecutiveChip tone="info">{formatCategoryLabel(event.category)}</AdminExecutiveChip>
        ) : (
          <AdminExecutiveChip tone="neutral">{COPY.groupingMarker}</AdminExecutiveChip>
        )}

        {event.status ? <AdminStatusPill status={event.status} /> : null}

        {isContainer ? (
          <span className="font-admin-mono text-[12px] text-admin-slate-600">
            {COPY.subEventCount(childCount)}
          </span>
        ) : null}

        {isSaving ? (
          <span className="font-admin-body text-[12px] text-admin-slate-600">{COPY.saving}</span>
        ) : null}

        {/* The server decides eligibility (a top-level event that has
            children) so the badge and the vertical-code generator cannot
            drift apart. */}
        {event.isContingentEligible ? (
          <span className="rounded-full bg-admin-primary-blue/10 px-2 py-0.5 font-admin-body text-[10px] font-semibold uppercase tracking-wide text-admin-primary-blue">
            {COPY.contingentEligible}
          </span>
        ) : null}
      </div>

      {actions && !props.clone ? (
        <AdminActionsMenu items={actions} label={COPY.rowActionsLabel(event.eventName)} />
      ) : null}
    </SimpleTreeItemWrapper>
  );
});

export default AdminEventTreeItem;

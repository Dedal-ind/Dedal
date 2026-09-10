// AdminEventOrgChart.jsx
// The fest's event hierarchy as a CANVAS, not a document: the chart fills the
// whole panel, scrolls in both directions, and zooms — the interaction model of
// a diagram tool rather than a page you scroll past.
//
// ONE INTERACTION, NOT TWO. Clicking a box opens its detail popup, and that
// popup IS the action menu. The per-box overflow menu is gone: it offered the
// same actions the popup already carried, so every box paid for a control that
// duplicated the box's own click.
//
// STATUS IS THE BORDER. Published, draft and cancelled are a solid green, a
// dashed amber and a solid red outline respectively — no badge text inside the
// box. At this density a status pill was the widest thing in a 120px box and
// pushed the name it was describing into a truncation. The key lives in the
// sidebar rail (AdminSidebarNavigation) — once for the whole console, rather
// than once per node or once per page.
//
// HOW THE CONNECTORS ARE DRAWN. Not one horizontal rail spanning the row — that
// needs the first and last child's widths, which are not known until after
// layout, and any percentage guess overhangs the moment two siblings differ in
// width. Instead every child draws its OWN half-rails: a left half (suppressed
// on the first child) and a right half (suppressed on the last). Butted together
// they form a rail running exactly from the centre of the first child to the
// centre of the last, at any widths, with no measurement. A lone child draws
// neither half and is joined to its parent by the stem alone.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Network, Pencil, Settings, Trash2, WifiOff, X } from 'lucide-react';
import AdminExecutiveChip from '../admin-executive-chip/AdminExecutiveChip.jsx';
import { formatCategoryLabel } from '../../helpers/category-format.js';
import { ADMIN_FEST_STRUCTURE_COPY as COPY } from '../../brand-admin/brand-copy.js';

const RAIL = 'bg-admin-slate-300';
const RAIL_THICKNESS = 'h-[1.5px]';
const STEM_THICKNESS = 'w-[1.5px]';
/* Half of the 36px between levels; the child's own stem is the other half. */
const HALF_LEVEL = 'h-[18px]';
const SIBLING_GAP = 'gap-4';

/*
 * The canvas ground: a 1px dot every 24px at 4% black. Enough to say "this
 * surface scrolls", quiet enough that the boxes never compete with it.
 */
const DOT_GRID_STYLE = {
  backgroundImage: 'radial-gradient(circle, rgba(0,0,0,0.04) 1px, transparent 1px)',
  backgroundSize: '24px 24px',
};

/*
 * Status → outline. Colour AND line style both carry it, so the three states
 * stay distinguishable without relying on hue alone.
 */
const STATUS_BORDER = {
  published: 'border-[1.5px] border-solid border-[#22C55E]',
  draft: 'border-[1.5px] border-dashed border-[#F59E0B]',
  cancelled: 'border-[1.5px] border-solid border-[#EF4444]',
};
const STATUS_BORDER_FALLBACK = 'border-[1.5px] border-solid border-admin-slate-200';
/* Selection is a GLOW, never a border swap. An earlier version replaced the
   status outline with a blue one, which meant the single box you were inspecting
   was the one box whose published/draft state you could no longer see. The soft
   ring sits outside the border and leaves the status colour intact. */
const SELECTED_GLOW = 'z-10 shadow-[0_0_0_3px_rgba(37,99,235,0.15)]';

/* Popup size, used only to decide which side of the box to open on. Estimates
   are fine here: being a few pixels out flips the popup one box early, never
   off the screen. */
/* The fest root's synthetic node id. Prefixed so it can never collide with an
   event id, which is a Mongo ObjectId. */
const FEST_ROOT_ID = '__fest_root__';

const POPUP_WIDTH = 280;
const POPUP_HEIGHT = 260;
const POPUP_OFFSET = 12;

const POPUP_KEYFRAMES = `
@keyframes adminOrgPopupIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .admin-org-popup { animation: none !important; }
}
`;

const ACTION_ICONS = {
  view: ArrowRight,
  edit: Pencil,
  contingent: Settings,
  delete: Trash2,
};

/*
 * One event box. The WHOLE card is the button — the name, the badges, the
 * padding. A click target that was only the name text meant most of a box did
 * nothing when clicked, which reads as broken rather than as precise.
 */
function EventBox({ node, depth, isSelected, onSelect }) {
  const childCount = node.children?.length ?? 0;
  const sizing = depth === 0 ? 'min-w-[160px] max-w-[220px]' : 'min-w-[120px] max-w-[180px]';
  const statusBorder = STATUS_BORDER[node.status] ?? STATUS_BORDER_FALLBACK;

  return (
    <button
      type="button"
      onClick={(clickEvent) => onSelect(node, clickEvent.currentTarget.getBoundingClientRect())}
      aria-pressed={isSelected}
      title={node.eventName}
      className={`flex cursor-pointer flex-col gap-1 rounded-lg bg-admin-surface-white px-3 py-2 text-left transition-shadow hover:shadow-[0_1px_3px_rgba(0,0,0,0.1)] ${sizing} ${
        isSelected ? SELECTED_GLOW : ''
      } ${statusBorder}`}
    >
      <span className="flex w-full items-baseline gap-1">
        <span className="truncate font-admin-body text-[13px] font-semibold text-admin-neutral-ink">
          {node.eventName}
        </span>
        {childCount > 0 ? (
          <span className="shrink-0 font-admin-mono text-[10px] text-admin-slate-600">
            · {childCount}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function ChartNode({ node, depth, isFirst, isLast, isOnly, selectedId, onSelect }) {
  const children = node.children ?? [];

  return (
    <div className="relative flex flex-col items-center pt-[18px]">
      {!isOnly && !isFirst ? (
        <span
          className={`absolute left-0 top-0 w-1/2 rounded-[1px] ${RAIL_THICKNESS} ${RAIL}`}
          aria-hidden="true"
        />
      ) : null}
      {!isOnly && !isLast ? (
        <span
          className={`absolute right-0 top-0 w-1/2 rounded-[1px] ${RAIL_THICKNESS} ${RAIL}`}
          aria-hidden="true"
        />
      ) : null}
      <span
        className={`absolute left-1/2 top-0 -translate-x-1/2 ${HALF_LEVEL} ${STEM_THICKNESS} ${RAIL}`}
        aria-hidden="true"
      />

      <EventBox node={node} depth={depth} isSelected={selectedId === node.id} onSelect={onSelect} />

      {children.length > 0 ? (
        <>
          <span className={`${HALF_LEVEL} ${STEM_THICKNESS} ${RAIL}`} aria-hidden="true" />
          <div className={`flex items-start justify-center ${SIBLING_GAP}`}>
            {children.map((child, index) => (
              <ChartNode
                key={child.id}
                node={child}
                depth={depth + 1}
                isFirst={index === 0}
                isLast={index === children.length - 1}
                isOnly={children.length === 1}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/*
 * The detail popup, anchored to the box that opened it.
 *
 * Positioned FIXED against the clicked box's viewport rect, and flipped to the
 * left or above when the default placement would put it off-screen — a popup
 * that opens past the edge of the panel is a popup whose actions cannot be
 * reached.
 */
function EventPopup({ node, anchorRect, actions, onClose }) {
  const popupRef = useRef(null);

  /* Close on any mousedown outside the popup. mousedown rather than click so
     the popup is gone before a drag on the canvas begins. */
  useEffect(() => {
    function handlePointerDown(pointerEvent) {
      if (popupRef.current && !popupRef.current.contains(pointerEvent.target)) {
        onClose();
      }
    }
    function handleKeyDown(keyEvent) {
      if (keyEvent.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (!node || !anchorRect) {
    return null;
  }

  const opensLeft = anchorRect.right + POPUP_OFFSET + POPUP_WIDTH > window.innerWidth;
  const opensAbove = anchorRect.bottom + POPUP_OFFSET + POPUP_HEIGHT > window.innerHeight;

  const left = opensLeft
    ? Math.max(8, anchorRect.left - POPUP_OFFSET - POPUP_WIDTH)
    : anchorRect.right + POPUP_OFFSET;
  const top = opensAbove
    ? Math.max(8, anchorRect.top - POPUP_OFFSET - POPUP_HEIGHT)
    : anchorRect.bottom + POPUP_OFFSET;

  const childCount = node.children?.length ?? 0;

  return (
    <>
      <style>{POPUP_KEYFRAMES}</style>
      <div
        ref={popupRef}
        role="dialog"
        aria-label={node.eventName}
        style={{
          position: 'fixed',
          left,
          top,
          minWidth: 220,
          maxWidth: 300,
          width: POPUP_WIDTH,
          animation: 'adminOrgPopupIn 150ms ease-out both',
        }}
        className="admin-org-popup z-50 rounded-xl border border-admin-slate-200 bg-admin-surface-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.12)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={COPY.cancel}
          className="absolute right-3 top-3 text-admin-slate-600 transition-colors hover:text-admin-neutral-ink"
        >
          <X size={12} />
        </button>

        <p className="pr-5 font-admin-body text-[15px] font-semibold leading-tight text-admin-neutral-ink">
          {node.eventName}
        </p>

        {node.isFestRoot ? (
          /* The fest root is not an event: it has no category, no type and no
             registration count of its own. Showing an event's chips here would
             invent facts about it, so it carries only what it really has —
             how many top-level events hang under it. */
          <p className="mt-2 font-admin-body text-[12px] text-admin-slate-600">
            {COPY.topLevelEventCount(childCount)}
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {node.category ? (
                <AdminExecutiveChip tone="info">
                  {formatCategoryLabel(node.category)}
                </AdminExecutiveChip>
              ) : null}
              <AdminExecutiveChip tone="neutral">
                {node.eventType ?? COPY.groupingMarker}
              </AdminExecutiveChip>
            </div>

            <p className="mt-2 font-admin-body text-[12px] text-admin-slate-600">
              {COPY.registeredOf(node.registeredCount ?? 0, node.capacity)}
              {childCount > 0 ? ` · ${COPY.subEventCount(childCount)}` : ''}
            </p>
          </>
        )}

        {actions.length > 0 ? (
          <>
            <div className="my-3 h-px bg-admin-slate-200/70" />
            <div className="flex flex-col">
              {actions.map((action) => {
                const Icon = ACTION_ICONS[action.key] ?? ArrowRight;
                return (
                  <button
                    key={action.key}
                    type="button"
                    onClick={() => {
                      action.onSelect();
                      onClose();
                    }}
                    className={`flex items-center gap-2 rounded-md px-2 py-2 text-left font-admin-body text-[13px] transition-colors hover:bg-admin-surface-off-white ${
                      action.tone === 'danger'
                        ? 'text-admin-status-error-red'
                        : 'text-admin-neutral-ink'
                    }`}
                  >
                    <Icon size={14} className="shrink-0" aria-hidden="true" />
                    {action.label}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}


/*
 * What the canvas shows when it cannot show a tree.
 *
 * NO DOT GRID HERE. The grid means "there is a surface to move around on"; under
 * an empty state it means "your diagram is missing", which is exactly the wrong
 * reading when the truth is simply that nothing has been chosen yet. These
 * states sit on a clean ground and carry a card with somewhere to go next — a
 * message alone tells you that you are stuck without telling you how to leave.
 */
function ChartStateFrame({ children }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-admin-surface-off-white px-6">
      <div className="flex w-full max-w-[400px] flex-col items-center gap-3 rounded-xl border border-admin-slate-200 bg-admin-surface-white p-8 text-center">
        {children}
      </div>
    </div>
  );
}

function ChartStateActions({ children }) {
  return <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{children}</div>;
}

const PRIMARY_ACTION_CLASS =
  'rounded-md bg-admin-primary-blue px-3 py-2 font-admin-body text-[13px] font-semibold text-white transition-colors hover:bg-admin-primary-blue-dark';
const SECONDARY_ACTION_CLASS =
  'rounded-md border border-admin-slate-200 px-3 py-2 font-admin-body text-[13px] font-semibold text-admin-neutral-ink transition-colors hover:bg-admin-surface-off-white';

function StateIcon({ icon: Icon }) {
  return <Icon size={64} strokeWidth={1.25} className="text-admin-primary-blue/20" aria-hidden="true" />;
}

function StateHeading({ children }) {
  return (
    <p className="font-admin-display text-[18px] font-semibold text-admin-neutral-ink">{children}</p>
  );
}

function StateBody({ children }) {
  return <p className="font-admin-body text-[14px] text-admin-slate-600">{children}</p>;
}

function AdminEventOrgChartError({ onRetry }) {
  return (
    <ChartStateFrame>
      <StateIcon icon={WifiOff} />
      <StateHeading>Could not load event structure</StateHeading>
      <StateBody>Check your connection and try again.</StateBody>
      {onRetry ? (
        <ChartStateActions>
          <button type="button" onClick={onRetry} className={SECONDARY_ACTION_CLASS}>
            {COPY.retry}
          </button>
        </ChartStateActions>
      ) : null}
    </ChartStateFrame>
  );
}

/* No fest chosen, with fests available to choose from. */
function AdminEventOrgChartNoSelection({ onSelectFest, onCreateFest }) {
  return (
    <ChartStateFrame>
      <StateIcon icon={Network} />
      <StateHeading>Select a fest to view its structure</StateHeading>
      <StateBody>
        Choose a fest from the dropdown above to see the complete event hierarchy.
      </StateBody>
      <ChartStateActions>
        <button type="button" onClick={onSelectFest} className={PRIMARY_ACTION_CLASS}>
          Select fest
        </button>
        <button type="button" onClick={onCreateFest} className={SECONDARY_ACTION_CLASS}>
          Create new fest
        </button>
      </ChartStateActions>
    </ChartStateFrame>
  );
}

/* The account has no fests at all — nothing to select, only something to make. */
function AdminEventOrgChartNoFests({ onCreateFest }) {
  return (
    <ChartStateFrame>
      <StateIcon icon={Network} />
      <StateHeading>No fests created yet</StateHeading>
      <StateBody>Create your first fest to start building events.</StateBody>
      <ChartStateActions>
        <button type="button" onClick={onCreateFest} className={PRIMARY_ACTION_CLASS}>
          Create fest
        </button>
      </ChartStateActions>
    </ChartStateFrame>
  );
}

/* A fest is chosen but carries no events. */
function AdminEventOrgChartEmpty({ festName, onCreateEvent }) {
  return (
    <ChartStateFrame>
      <StateIcon icon={Network} />
      <StateHeading>{festName ? `No events in ${festName} yet` : 'No events yet'}</StateHeading>
      <StateBody>Create events under this fest to build the structure.</StateBody>
      {onCreateEvent ? (
        <ChartStateActions>
          <button type="button" onClick={onCreateEvent} className={SECONDARY_ACTION_CLASS}>
            {COPY.emptyAction}
          </button>
        </ChartStateActions>
      ) : null}
    </ChartStateFrame>
  );
}

/*
 * The skeleton is the TREE's shape, not a row of grey bars: a placeholder shaped
 * like the thing being loaded tells you what is coming. It keeps the dot grid,
 * because a chart really is about to appear on it.
 */
function AdminEventOrgChartSkeleton() {
  const block = 'animate-pulse rounded-lg bg-admin-slate-200/70';
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-admin-surface-white"
      style={DOT_GRID_STYLE}
    >
      <div className="flex flex-col items-center" aria-label="Loading" role="status">
        <div className={`h-11 w-[180px] ${block}`} />
        <span className={`${HALF_LEVEL} ${STEM_THICKNESS} bg-admin-slate-200`} aria-hidden="true" />
        <div className={`flex items-start ${SIBLING_GAP}`}>
          {[0, 1, 2].map((column) => (
            <div key={column} className="flex flex-col items-center">
              <div className={`h-10 w-[130px] ${block}`} />
              <span
                className={`${HALF_LEVEL} ${STEM_THICKNESS} bg-admin-slate-200`}
                aria-hidden="true"
              />
              <div className={`flex ${SIBLING_GAP}`}>
                {[0, 1].map((leaf) => (
                  <div key={leaf} className={`h-10 w-[120px] ${block}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const ZOOM_MINIMUM = 0.3;
const ZOOM_MAXIMUM = 2;
const ZOOM_STEP = 0.1;
/*
 * Per unit of wheel delta, and deliberately tiny. A trackpad pinch emits a dense
 * stream of small deltaY values, so anything larger crosses the whole zoom range
 * in one gesture. At this rate a pinch moves the scale by thousandths and the
 * zoom feels like a dial rather than a switch.
 */
const ZOOM_WHEEL_SPEED = 0.0012;
/* Auto-fit never zooms IN: a four-event fest blown up looks broken, and 100% is
   the size the boxes were designed at. */
const AUTO_FIT_CEILING = 1;
/* Auto-fit leaves a 10% margin so the outermost boxes never touch the edges. */
const FIT_MARGIN = 0.9;

function AdminEventOrgChart({ fest, roots, buildActions }) {
  const viewportRef = useRef(null);
  const contentRef = useRef(null);
  const [zoom, setZoom] = useState(AUTO_FIT_CEILING);
  const hasAutoFittedRef = useRef(false);
  /* Set the moment the user zooms by any means; stops a resize from overriding
     a level they chose deliberately. */
  const hasUserZoomedRef = useRef(false);
  /* Mirrors `zoom`. The zoom handlers run from a native listener and from
     rAF callbacks, both of which would otherwise close over a stale value. */
  const zoomRef = useRef(AUTO_FIT_CEILING);
  const [selected, setSelected] = useState(null);

  /*
   * The scale at which the whole tree fits the viewport.
   *
   * offsetWidth/Height are read off the CONTENT element, which is unaffected by
   * the transform applied to it — so this measures the tree's natural size
   * whatever the current zoom, and re-fitting never compounds.
   *
   * The 0.9 factor is breathing room: a tree scaled to exactly the viewport
   * touches all four edges, which reads as clipped even when nothing is.
   */
  const computeFitScale = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content || !content.offsetWidth || !content.offsetHeight) {
      return null;
    }
    const rawScale = Math.min(
      viewport.clientWidth / content.offsetWidth,
      viewport.clientHeight / content.offsetHeight,
      AUTO_FIT_CEILING,
    );
    return Math.max(ZOOM_MINIMUM, rawScale * FIT_MARGIN);
  }, []);

  /*
   * Centring is done from the CONTENT's natural size times the scale, not from
   * the viewport's scrollWidth: scrollWidth is only correct once the browser has
   * laid out the new transform, so reading it in the same tick that set the zoom
   * centres against the OLD scale — which is how the tree ended up parked off to
   * one side on load.
   */
  const centreOn = useCallback((scale) => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) {
      return;
    }
    const scaledWidth = content.offsetWidth * scale;
    const scaledHeight = content.offsetHeight * scale;
    viewport.scrollLeft = Math.max(0, (scaledWidth - viewport.clientWidth) / 2);
    viewport.scrollTop = Math.max(0, (scaledHeight - viewport.clientHeight) / 2);
  }, []);

  const fitToView = useCallback(() => {
    const scale = computeFitScale();
    if (scale === null) {
      return;
    }
    zoomRef.current = scale;
    setZoom(scale);
    /* Two frames: one for React to commit the transform, one for the browser to
       lay it out. Centring before that scrolls against a stale scroll extent. */
    requestAnimationFrame(() => requestAnimationFrame(() => centreOn(scale)));
  }, [computeFitScale, centreOn]);

  /* A new tree is a new fit — and it re-arms auto-fit, because the zoom the user
     chose for the previous fest means nothing for this one. */
  useEffect(() => {
    hasUserZoomedRef.current = false;
    hasAutoFittedRef.current = false;
  }, [roots]);

  /*
   * Fit runs from the ResizeObserver, not an effect body: fitting measures
   * laid-out DOM, so it cannot happen before paint, and the observer fires once
   * as soon as it starts observing — exactly the "measure now" moment — then
   * again on every panel resize.
   *
   * A resize re-fits only while the user has not taken manual control. Once they
   * have chosen a zoom, dragging the window must not overwrite it.
   */
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      if (hasUserZoomedRef.current) {
        return;
      }
      const scale = computeFitScale();
      if (scale === null) {
        return;
      }
      hasAutoFittedRef.current = true;
      zoomRef.current = scale;
      setZoom(scale);
      requestAnimationFrame(() => requestAnimationFrame(() => centreOn(scale)));
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [roots, computeFitScale, centreOn]);


  /*
   * Zoom about the CENTRE of the viewport.
   *
   * transform-origin stays at 0 0 so the maths is a straight multiply: a content
   * point sits at `contentPoint * scale` in scroll coordinates, whatever the
   * scale. Everything else is done by moving the scroll position — which is how
   * Figma and Google Maps behave, and why the origin is NOT set to centre: a
   * centred origin makes the content's scroll extent and its visual position
   * disagree, and the scroll correction stops being solvable in one line.
   *
   * The scroll write waits two frames. Zooming in grows the scrollable area, and
   * a scrollLeft set before the browser has laid out the larger content is
   * clamped to the OLD maximum — which is the same stale-extent bug that used to
   * park the tree off to one side on load.
   */
  const applyZoom = useCallback((computeNext) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const current = zoomRef.current;
    const next = Math.min(ZOOM_MAXIMUM, Math.max(ZOOM_MINIMUM, computeNext(current)));
    if (next === current) {
      return;
    }

    // The content point currently under the centre of the visible area.
    const contentX = (viewport.scrollLeft + viewport.clientWidth / 2) / current;
    const contentY = (viewport.scrollTop + viewport.clientHeight / 2) / current;

    hasUserZoomedRef.current = true;
    zoomRef.current = next;
    setZoom(next);

    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const element = viewportRef.current;
        if (!element) {
          return;
        }
        element.scrollLeft = Math.max(0, contentX * next - element.clientWidth / 2);
        element.scrollTop = Math.max(0, contentY * next - element.clientHeight / 2);
      }),
    );
  }, []);

  /*
   * Trackpad pinch arrives as a wheel event with ctrlKey set, and the browser's
   * default for that is to zoom the whole page. Bound natively with
   * { passive: false } because React's synthetic wheel handler is passive and
   * cannot preventDefault. Plain scrolling is left alone entirely — only the
   * ctrl-modified gesture is intercepted, so the canvas still scrolls normally.
   */
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }
    function handleWheel(wheelEvent) {
      if (!wheelEvent.ctrlKey) {
        return;
      }
      wheelEvent.preventDefault();
      /*
       * Proportional to the gesture, not a fixed step per event: a small pinch
       * moves a little, a large one moves more, and neither jumps.
       *
       * deltaY is normalised first because its UNIT varies by browser —
       * deltaMode 0 is pixels, 1 is lines, 2 is pages. Without this, a browser
       * reporting lines would zoom roughly sixteen times faster than one
       * reporting pixels, from identical hardware and an identical gesture.
       *
       * The result is left unrounded: at this speed a single event moves the
       * scale by thousandths, and snapping to steps would quantise the whole
       * gesture away.
       */
      let delta = wheelEvent.deltaY;
      if (wheelEvent.deltaMode === 1) {
        delta *= 16;
      } else if (wheelEvent.deltaMode === 2) {
        delta *= 100;
      }
      applyZoom((previous) => previous - delta * ZOOM_WHEEL_SPEED);
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [applyZoom]);

  const handleSelect = useCallback((node, rect) => {
    setSelected({ node, rect });
  }, []);

  /*
   * The fest root as a node the popup can render and buildActions can inspect.
   * `isFestRoot` is what the screen keys its "configure contingent" rule off —
   * the alternative, sniffing for a missing eventType, would also match a
   * grouping event and put a fest-level action on the wrong box.
   */
  const festNode = {
    id: FEST_ROOT_ID,
    isFestRoot: true,
    eventName: fest?.festName ?? COPY.pageTitle,
    children: roots,
  };

  const closePopup = useCallback(() => setSelected(null), []);

  const zoomButtonClass =
    'flex h-7 w-7 items-center justify-center rounded-full font-admin-mono text-[13px] leading-none text-admin-slate-600 transition-colors hover:bg-admin-surface-off-white disabled:opacity-40';

  return (
    <div className="relative h-full w-full overflow-hidden bg-admin-surface-white">
      <div ref={viewportRef} className="h-full w-full overflow-auto" style={DOT_GRID_STYLE}>
        <div
          ref={contentRef}
          className="inline-block p-[60px]"
          style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}
        >
          <div className="flex flex-col items-center">
            {/* LEVEL 0 — the fest itself, keeping its filled navy treatment.
                CLICKABLE, like every other box: a two-layer fest (fest → events)
                has no main event to hang a contingent off, so the fest root is
                the only place that bundle can be configured from. */}
            <button
              type="button"
              onClick={(clickEvent) =>
                handleSelect(festNode, clickEvent.currentTarget.getBoundingClientRect())
              }
              aria-pressed={selected?.node.id === FEST_ROOT_ID}
              title={festNode.eventName}
              className={`flex min-w-[180px] max-w-[260px] cursor-pointer flex-col items-center rounded-xl bg-admin-primary-blue px-4 py-2.5 transition-shadow hover:shadow-[0_1px_3px_rgba(0,0,0,0.2)] ${
                selected?.node.id === FEST_ROOT_ID ? SELECTED_GLOW : ''
              }`}
            >
              <span className="w-full truncate text-center font-admin-display text-[15px] font-semibold text-white">
                {festNode.eventName}
              </span>
            </button>

            {roots.length > 0 ? (
              <>
                <span className={`${HALF_LEVEL} ${STEM_THICKNESS} ${RAIL}`} aria-hidden="true" />
                <div className={`flex items-start justify-center ${SIBLING_GAP}`}>
                  {roots.map((root, index) => (
                    <ChartNode
                      key={root.id}
                      node={root}
                      depth={1}
                      isFirst={index === 0}
                      isLast={index === roots.length - 1}
                      isOnly={roots.length === 1}
                      selectedId={selected?.node.id ?? null}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Bottom-right overlay: zoom. The percentage re-fits on click, because
          "show me everything again" is what is wanted after zooming a branch. */}
      <div className="absolute bottom-4 right-4 z-20 flex items-center gap-0.5 rounded-full border border-admin-slate-200 bg-admin-surface-white/95 px-1 py-1 shadow-[0_1px_3px_rgba(0,0,0,0.12)] backdrop-blur">
        <button
          type="button"
          aria-label="Zoom out"
          disabled={zoom <= ZOOM_MINIMUM}
          onClick={() => applyZoom((previous) => previous - ZOOM_STEP)}
          className={zoomButtonClass}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => {
            hasUserZoomedRef.current = false;
            fitToView();
          }}
          title="Fit to screen"
          className="rounded-full px-2 py-1 font-admin-mono text-[12px] text-admin-slate-600 transition-colors hover:bg-admin-surface-off-white"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoom >= ZOOM_MAXIMUM}
          onClick={() => applyZoom((previous) => previous + ZOOM_STEP)}
          className={zoomButtonClass}
        >
          +
        </button>
      </div>

      {selected ? (
        <EventPopup
          node={selected.node}
          anchorRect={selected.rect}
          actions={buildActions(selected.node)}
          onClose={closePopup}
        />
      ) : null}
    </div>
  );
}

export {
  AdminEventOrgChartEmpty,
  AdminEventOrgChartError,
  AdminEventOrgChartNoFests,
  AdminEventOrgChartNoSelection,
  AdminEventOrgChartSkeleton,
};
export default AdminEventOrgChart;

// AdminModal.jsx
// A centered dialog on a dimmed backdrop — the one place the console uses
// shadow-admin-modal, because a modal genuinely floats above the page. It is
// controlled: the parent decides when it is open and owns the action handlers.
//
// THREE ZONES, NOT ONE SCROLLING BLOCK. The panel is a flex column capped at
// 90vh: the title and the action row are fixed, and only the BODY scrolls. That
// distinction is the whole point of the cap — a panel that simply scrolled as a
// whole would still carry its buttons off the bottom of a long form, which is
// exactly the failure this replaces. The promotion form runs to ~970px with an
// image preview in it, so on any laptop the confirm and cancel buttons sat
// outside the viewport with no way to reach them: `items-center` clipped the
// panel at BOTH ends, and a fixed-position element cannot be scrolled into view.
//
// `tone` colours the confirm button: 'primary' (blue) for a normal action,
// 'danger' (red) for a destructive one (cancel/unpublish/archive).
//
// `secondaryAction` ({ label, onClick, disabled }) puts a THIRD button between
// cancel and confirm, for dialogs that offer two ways to commit — "save as
// draft" beside "save and publish". It is rendered as a secondary (outlined)
// button so the hierarchy is unambiguous: one filled primary, one outline, one
// ghost. Dialogs that do not pass it are unchanged.

import { useEffect, useRef } from 'react';
import AdminExecutiveButton from '../admin-executive-button/AdminExecutiveButton.jsx';

/*
 * Body-scroll lock, REFERENCE COUNTED across every open modal.
 *
 * A plain save-and-restore per modal breaks the moment two are stacked — a form
 * dialog with a "discard unsaved changes?" prompt over it. Both close in the
 * same commit, React runs the cleanups in tree order, and the SECOND cleanup
 * restores the value it captured ('hidden', because the first modal had already
 * set it) — leaving the console permanently unscrollable with no dialog on
 * screen. Counting openers and restoring only when the last one leaves is the
 * only version of this that survives stacking.
 */
let openModalCount = 0;
let previousBodyOverflow = '';

function lockBodyScroll() {
  if (openModalCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  openModalCount += 1;
}

function releaseBodyScroll() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
  }
}

function AdminModal({
  isOpen,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'primary',
  isBusy = false,
  confirmDisabled = false,
  secondaryAction = null,
  onConfirm,
  onCancel,
}) {
  /* This dialog's position in the stack, assigned when it opens. */
  const depthReference = useRef(0);

  /*
   * The scroll lock and the Escape key are ONE effect because they share the
   * stack position: the lock assigns the depth, and Escape needs it to decide
   * whether this dialog is the one on top.
   *
   * ESCAPE MUST ONLY REACH THE TOPMOST DIALOG. Every open modal listens on
   * `window`, so a form dialog with a "discard unsaved changes?" prompt over it
   * would receive the same keypress twice: the prompt would close, the form's
   * own handler would run its unsaved-changes check, and the prompt would
   * immediately reopen. Escape looked like it did nothing at all.
   */
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    lockBodyScroll();
    depthReference.current = openModalCount;

    function handleKeyDown(keyboardEvent) {
      if (keyboardEvent.key === 'Escape' && depthReference.current === openModalCount) {
        onCancel?.();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      releaseBodyScroll();
    };
  }, [isOpen, onCancel]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      {/* Backdrop — stays inset-0 so a click anywhere outside the panel closes.
          The owner decides what "close" means; a form dialog routes this through
          its own unsaved-changes check. */}
      <button
        type="button"
        aria-label={cancelLabel}
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-admin-neutral-ink/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-admin-slate-200 bg-admin-surface-white shadow-admin-modal"
      >
        <h2 className="shrink-0 px-6 pt-6 font-admin-display text-[18px] font-semibold leading-6 text-admin-neutral-ink">
          {title}
        </h2>

        {/* The only scrolling region. min-h-0 is required: a flex child will not
            shrink below its content height without it, and the body would push
            the action row back off the panel. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 font-admin-body text-[14px] leading-5 text-admin-slate-600">
          {children}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-admin-slate-200 px-6 py-4">
          <AdminExecutiveButton variant="ghost" onClick={onCancel} disabled={isBusy}>
            {cancelLabel}
          </AdminExecutiveButton>
          {secondaryAction ? (
            <AdminExecutiveButton
              variant="secondary"
              onClick={secondaryAction.onClick}
              disabled={isBusy || secondaryAction.disabled}
            >
              {secondaryAction.label}
            </AdminExecutiveButton>
          ) : null}
          <AdminExecutiveButton
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={isBusy}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </AdminExecutiveButton>
        </div>
      </div>
    </div>
  );
}

export default AdminModal;

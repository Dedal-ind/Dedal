// A small in-app confirmation dialog in the app's own visual language —
// backdrop, rounded card, title, message, and a cancel/confirm pair. Replaces
// window.confirm(), which renders as the browser's native chrome box and looks
// like a foreign element inside the app (and cannot be styled at all).
//
// Controlled: parent owns `open` and supplies onCancel/onConfirm.
// `danger` colours the confirm action for destructive flows (delete account).
//
// PALETTE. On the dedal design system (confirm-dialog.css). It was the last
// Heritage surface reachable from the redesigned volunteer flow — an olive
// gradient confirm button and `bg-background`/`text-on-surface` throughout —
// so backing out of a redesigned screen opened a box from the old app.
//
// MOTION. It used to `return null` on close with no transition of any kind, so
// it both appeared and vanished as a hard cut — the harshest possible way to
// present a question about deleting an account. useExitTransition holds it in
// the tree for the exit; layer-motion.css supplies the shape.
import { useExitTransition } from '../../hooks/use-exit-transition/use-exit-transition.js';
import '../../design/layer-motion.css';
import './confirm-dialog.css';

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Yes',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}) {
  const { isMounted, isVisible, ref } = useExitTransition(open);

  if (!isMounted) {
    return null;
  }
  return (
    <>
      <div
        className={`dcf-scrim dlm-fade${isVisible ? ' dlm-fade--in' : ''}`}
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        /* The Tailwind -translate-y-1/2 is dropped: dlm-pop-centred owns the
           transform now, and two rules setting it would mean the last one wins
           and the dialog jumps half its height on open. */
        className={`dcf-card dlm-pop-centred${isVisible ? ' dlm-pop-centred--in' : ''}`}
        inert={open ? undefined : true}
      >
        <h3 className="dcf-title">{title}</h3>
        {message ? <p className="dcf-message">{message}</p> : null}
        <div className="dcf-actions">
          <button
            type="button"
            onClick={onCancel}
            className="dcf-btn dcf-btn--cancel"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={[
              'dcf-btn',
              danger ? 'dcf-btn--danger' : 'dcf-btn--confirm',
            ].join(' ')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

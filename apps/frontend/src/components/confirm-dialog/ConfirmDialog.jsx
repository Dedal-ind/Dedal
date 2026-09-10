// A small in-app confirmation dialog in the app's own visual language —
// backdrop, rounded card, title, message, and a cancel/confirm pair. Replaces
// window.confirm(), which renders as the browser's native chrome box and looks
// like a foreign element inside the app (and cannot be styled at all).
//
// Controlled: parent owns `open` and supplies onCancel/onConfirm.
// `danger` colours the confirm action for destructive flows (delete account).
//
// MOTION. It used to `return null` on close with no transition of any kind, so
// it both appeared and vanished as a hard cut — the harshest possible way to
// present a question about deleting an account. useExitTransition holds it in
// the tree for the exit; layer-motion.css supplies the shape.
import { useExitTransition } from '../../hooks/use-exit-transition/use-exit-transition.js';
import '../../design/layer-motion.css';

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
        className={`fixed inset-0 z-40 bg-black/40 dlm-fade${isVisible ? ' dlm-fade--in' : ''}`}
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
        className={`fixed inset-x-6 top-1/2 z-50 rounded-2xl bg-background p-5 shadow-xl sm:mx-auto sm:max-w-sm dlm-pop-centred${
          isVisible ? ' dlm-pop-centred--in' : ''
        }`}
        inert={open ? undefined : true}
      >
        <h3 className="mb-1 text-center font-display text-[18px] font-bold leading-6 text-on-surface">
          {title}
        </h3>
        {message ? (
          <p className="mb-4 text-center font-body text-[13px] leading-5 text-on-surface-variant">
            {message}
          </p>
        ) : (
          <div className="mb-4" />
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-heritage border border-outline-variant bg-surface-container-lowest p-3 font-body text-[14px] font-bold text-on-surface active:bg-surface-container"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={[
              'flex-1 rounded-heritage p-3 font-body text-[14px] font-bold text-brand-beige',
              danger
                ? 'bg-error'
                : 'bg-gradient-to-r from-[#2d4a1a] to-[#556b2f]',
            ].join(' ')}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}

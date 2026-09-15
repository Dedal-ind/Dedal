// AdminDeleteConfirm.jsx
// The one confirmation every hard delete in the console goes through — events,
// fests and campaigns. It names the thing ("Delete Robo Wars?"), says it cannot
// be undone, and adds a line on what else goes with it when there is anything.
//
// `target` is { name } or null (closed). `note` is the optional consequence
// line. `blockedReason`, when set, replaces the confirm with an explanation:
// used for a parent event, which the server refuses until its sub-events are
// gone, so offering a confirm that is guaranteed to fail would be a lie.
import AdminModal from '../admin-modal/AdminModal.jsx';
import { ADMIN_DELETE_COPY as COPY } from '../../brand-admin/brand-copy.js';

function AdminDeleteConfirm({ target, note = '', blockedReason = '', isBusy = false, onConfirm, onCancel }) {
  return (
    <AdminModal
      isOpen={Boolean(target)}
      title={target ? COPY.title(target.name) : ''}
      confirmLabel={COPY.confirm}
      cancelLabel={COPY.cancel}
      tone="danger"
      isBusy={isBusy}
      confirmDisabled={Boolean(blockedReason)}
      onConfirm={onConfirm}
      onCancel={() => (isBusy ? null : onCancel())}
    >
      <p className="font-admin-body text-[14px] text-admin-slate-600">{COPY.body}</p>
      {note ? <p className="mt-2 font-admin-body text-[14px] text-admin-neutral-ink">{note}</p> : null}
      {blockedReason ? (
        <p className="mt-2 font-admin-body text-[14px] text-admin-status-error-red">{blockedReason}</p>
      ) : null}
    </AdminModal>
  );
}

export default AdminDeleteConfirm;

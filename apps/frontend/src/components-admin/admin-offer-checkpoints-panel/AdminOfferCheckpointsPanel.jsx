// AdminOfferCheckpointsPanel.jsx
// Physical scanning locations per offer, on the edit-fest screen. Each
// checkpoint is a place a volunteer scans claims of ONE offer; adding more
// ("Food Counter B") spreads the queue. Deactivation is the only removal —
// scans are append-only and each carries checkpointId, so there is no delete.

import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveButton from '../admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveInput from '../admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveChip from '../admin-executive-chip/AdminExecutiveChip.jsx';
import AdminModal from '../admin-modal/AdminModal.jsx';
import AdminErrorBanner from '../admin-error-banner/AdminErrorBanner.jsx';
import { ADMIN_FEST_OFFERS_COPY as COPY } from '../../brand-admin/brand-copy.js';

function AdminOfferCheckpointsPanel({ festId, offers }) {
  const [checkpoints, setCheckpoints] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [newNameByOfferId, setNewNameByOfferId] = useState({});
  const [busyCheckpointId, setBusyCheckpointId] = useState(null);
  const [deactivationTarget, setDeactivationTarget] = useState(null);

  const loadCheckpoints = useCallback(async () => {
    setLoadError('');
    try {
      const payload = await apiClient.get(`/fests/${festId}/checkpoints`);
      setCheckpoints(
        (payload?.checkpoints ?? []).filter((checkpoint) => checkpoint.checkpointType === 'offer'),
      );
    } catch {
      setLoadError(COPY.checkpointsLoadFailed);
    }
  }, [festId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCheckpoints();
  }, [loadCheckpoints]);

  async function handleAddCheckpoint(offerId) {
    const checkpointName = (newNameByOfferId[offerId] ?? '').trim();
    if (!checkpointName) {
      return;
    }
    setActionError('');
    try {
      await apiClient.post(`/fests/${festId}/checkpoints`, { offerId, checkpointName });
      setNewNameByOfferId((previous) => ({ ...previous, [offerId]: '' }));
      await loadCheckpoints();
    } catch (addError) {
      setActionError(addError.message || COPY.checkpointActionFailed);
    }
  }

  async function setCheckpointActive(checkpoint, isActive) {
    setBusyCheckpointId(checkpoint.checkpointId);
    setActionError('');
    try {
      await apiClient.patch(`/fests/${festId}/checkpoints/${checkpoint.checkpointId}`, { isActive });
      await loadCheckpoints();
    } catch (patchError) {
      setActionError(patchError.message || COPY.checkpointActionFailed);
    } finally {
      setBusyCheckpointId(null);
      setDeactivationTarget(null);
    }
  }

  const activeOffers = offers.filter((offer) => offer.isActive !== false);
  if (activeOffers.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink">
          {COPY.checkpointsHeading}
        </span>
        <p className="mt-0.5 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
          {COPY.checkpointsIntro}
        </p>
      </div>

      <AdminErrorBanner message={loadError || actionError} />

      {activeOffers.map((offer) => {
        const offerId = String(offer._id ?? offer.id);
        const offerCheckpoints = checkpoints.filter((checkpoint) => checkpoint.offerId === offerId);
        return (
          <div key={offerId} className="rounded-md border border-admin-slate-200 p-3">
            <p className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">
              {offer.offerName}
            </p>
            {offerCheckpoints.length === 0 ? (
              <p className="mt-2 font-admin-body text-[13px] text-admin-slate-600">
                {COPY.checkpointsEmptyNote}
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {offerCheckpoints.map((checkpoint) => (
                  <li key={checkpoint.checkpointId} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate font-admin-body text-[14px] text-admin-neutral-ink">
                      {checkpoint.name}
                    </span>
                    <AdminExecutiveChip tone={checkpoint.isActive ? 'success' : 'neutral'}>
                      {checkpoint.isActive ? COPY.checkpointActive : COPY.checkpointInactive}
                    </AdminExecutiveChip>
                    <AdminExecutiveButton
                      variant="ghost"
                      size="small"
                      loading={busyCheckpointId === checkpoint.checkpointId}
                      onClick={() =>
                        checkpoint.isActive
                          ? setDeactivationTarget(checkpoint)
                          : setCheckpointActive(checkpoint, true)
                      }
                    >
                      {checkpoint.isActive ? COPY.checkpointDeactivate : COPY.checkpointReactivate}
                    </AdminExecutiveButton>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <AdminExecutiveInput
                  placeholder={COPY.checkpointAddPlaceholder}
                  value={newNameByOfferId[offerId] ?? ''}
                  onChange={(event) =>
                    setNewNameByOfferId((previous) => ({ ...previous, [offerId]: event.target.value }))
                  }
                />
              </div>
              <AdminExecutiveButton
                variant="secondary"
                size="small"
                disabled={!(newNameByOfferId[offerId] ?? '').trim()}
                onClick={() => handleAddCheckpoint(offerId)}
              >
                {COPY.checkpointAdd}
              </AdminExecutiveButton>
            </div>
          </div>
        );
      })}

      <AdminModal
        isOpen={Boolean(deactivationTarget)}
        title={COPY.checkpointDeactivateModalTitle}
        confirmLabel={COPY.checkpointConfirm}
        cancelLabel={COPY.checkpointCancel}
        tone="danger"
        isBusy={Boolean(busyCheckpointId)}
        onConfirm={() => setCheckpointActive(deactivationTarget, false)}
        onCancel={() => (busyCheckpointId ? null : setDeactivationTarget(null))}
      >
        {deactivationTarget ? COPY.checkpointDeactivateModalBody(deactivationTarget.name) : null}
      </AdminModal>
    </div>
  );
}

export default AdminOfferCheckpointsPanel;

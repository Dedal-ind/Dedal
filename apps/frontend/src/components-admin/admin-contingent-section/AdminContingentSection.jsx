// AdminContingentSection.jsx
// The "Contingents" card on /admin/events/access, shown for an event target
// that has at least two published solo sub-events. Lists the event's bundles
// with claim-aware lifecycle actions (publish, cancel via AdminModal) and links
// into AdminContingentEditScreen for create/edit.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminVerticalCodesTable from '../admin-vertical-codes-table/AdminVerticalCodesTable.jsx';
import AdminExecutiveCard from '../admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../admin-executive-button/AdminExecutiveButton.jsx';
import AdminStatusPill from '../admin-status-pill/AdminStatusPill.jsx';
import AdminModal from '../admin-modal/AdminModal.jsx';
import AdminErrorBanner from '../admin-error-banner/AdminErrorBanner.jsx';
import { ADMIN_CONTINGENT_COPY as COPY } from '../../brand-admin/brand-copy.js';

function formatRupees(paise) {
  return `₹${((paise ?? 0) / 100).toLocaleString('en-IN')}`;
}

function AdminContingentSection({ festId, parentEvent, eligibleSubEventCount }) {
  const navigate = useNavigate();
  const [contingents, setContingents] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [modal, setModal] = useState(null); // { path, title, body }
  const [isBusy, setIsBusy] = useState(false);

  const loadContingents = useCallback(async () => {
    setLoadError('');
    try {
      const result = await apiClient.get(`/fests/${festId}/contingents`);
      const all = Array.isArray(result?.contingents) ? result.contingents : [];
      setContingents(all.filter((row) => String(row.parentEventId) === String(parentEvent?.id)));
    } catch {
      setLoadError(COPY.loadFailed);
    }
    /*
     * OPTIONAL CHAINING IN A DEPENDENCY ARRAY IS NOT DEFENSIVE PADDING — it is
     * the only place a guard can go.
     *
     * A dependency array is evaluated DURING RENDER, before any early return and
     * before any effect. `parentEvent.id` on a null prop therefore threw
     * synchronously and unwound the whole page to the error boundary, which is
     * exactly how /admin/events/access went down: the screen rendered this
     * component with parentEvent={null} and there was no reachable point at
     * which a check could have run.
     */
  }, [festId, parentEvent?.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadContingents();
  }, [loadContingents]);

  /*
   * AFTER the hooks, never before: hooks must run on every render in the same
   * order, so the component cannot bail out above them. Returning null here is
   * what makes a missing parentEvent render nothing instead of crashing — the
   * contingent card is inherently ABOUT one parent event, so with no parent
   * there is nothing meaningful to draw.
   */
  if (!parentEvent?.id) {
    return null;
  }

  async function runModalAction() {
    if (!modal) {
      return;
    }
    setIsBusy(true);
    setActionError('');
    try {
      await apiClient.post(modal.path);
      await loadContingents();
      setModal(null);
    } catch (actionException) {
      setActionError(actionException.message || COPY.actionFailed);
      setModal(null);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <AdminExecutiveCard>
      <div className="flex items-center justify-between">
        <h2 className="font-admin-display text-[18px] font-semibold leading-6 text-admin-neutral-ink">
          {COPY.sectionHeading}
        </h2>
        {eligibleSubEventCount >= 2 ? (
          <AdminExecutiveButton
            variant="ghost"
            size="small"
            iconLeft={<Plus size={15} />}
            onClick={() =>
              navigate(`/admin/fests/${festId}/contingents/create`, {
                state: { parentEventId: parentEvent?.id, parentEventName: parentEvent?.eventName },
              })
            }
          >
            {COPY.addContingent}
          </AdminExecutiveButton>
        ) : null}
      </div>
      <p className="mt-1 font-admin-body text-[13px] leading-4.5 text-admin-slate-600">
        {eligibleSubEventCount >= 2 ? COPY.sectionHelp : COPY.needTwoSubEvents}
      </p>

      <AdminErrorBanner message={actionError || loadError} />

      {contingents.length === 0 ? (
        <p className="mt-3 font-admin-body text-[13px] text-admin-slate-600">{COPY.listEmpty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-admin-slate-200">
          {contingents.map((contingent) => (
            <li key={contingent.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate font-admin-body text-[14px] font-medium text-admin-neutral-ink">
                    {contingent.contingentName}
                  </span>
                  <AdminStatusPill status={contingent.status} />
                </span>
                <span className="block font-admin-mono text-[13px] text-admin-slate-600">
                  {contingent.includedEventIds.length} events · {formatRupees(contingent.pricePaise)} ·{' '}
                  {contingent.soldBundleCount ?? 0} {COPY.claimsSuffix}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <AdminExecutiveButton
                  variant="ghost"
                  size="small"
                  onClick={() =>
                    navigate(`/admin/fests/${festId}/contingents/${contingent.id}/edit`, {
                      state: { parentEventId: parentEvent?.id, parentEventName: parentEvent?.eventName },
                    })
                  }
                >
                  {COPY.editContingent}
                </AdminExecutiveButton>
                {contingent.status === 'draft' ? (
                  <AdminExecutiveButton
                    variant="primary"
                    size="small"
                    onClick={() =>
                      setModal({
                        path: `/fests/${festId}/contingents/${contingent.id}/publish`,
                        title: COPY.publishModalTitle,
                        body: COPY.publishModalBody(contingent.contingentName),
                        tone: 'primary',
                      })
                    }
                  >
                    {COPY.publishContingent}
                  </AdminExecutiveButton>
                ) : null}
                {contingent.status !== 'cancelled' ? (
                  <AdminExecutiveButton
                    variant="danger"
                    size="small"
                    onClick={() =>
                      setModal({
                        path: `/fests/${festId}/contingents/${contingent.id}/cancel`,
                        title: COPY.cancelModalTitle,
                        body: COPY.cancelModalBody(contingent.contingentName),
                        tone: 'danger',
                      })
                    }
                  >
                    {COPY.cancelContingent}
                  </AdminExecutiveButton>
                ) : null}
              </span>
              </div>
              {/* Per-vertical join codes for this bundle. Self-hiding until a
                  purchase has been paid for and the codes minted. */}
              <AdminVerticalCodesTable festId={festId} contingentId={contingent.id} />
            </li>
          ))}
        </ul>
      )}

      <AdminModal
        isOpen={Boolean(modal)}
        title={modal?.title}
        confirmLabel={COPY.confirm}
        cancelLabel={COPY.keepEditing}
        tone={modal?.tone}
        isBusy={isBusy}
        onConfirm={runModalAction}
        onCancel={() => (isBusy ? null : setModal(null))}
      >
        {modal?.body}
      </AdminModal>
    </AdminExecutiveCard>
  );
}

export default AdminContingentSection;

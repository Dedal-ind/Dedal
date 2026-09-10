// AdminContingentConfig.jsx
// The contingent editor reached from a Main Event in the Event Structure tree.
//
// A DIALOG rather than a panel spliced under the tree row. The row is rendered
// by dnd-kit's SortableTree, which owns its children and gives no hook for
// injecting arbitrary content beneath one node; forcing it in would fight the
// drag layer for the same space. The dialog names the event in its title, so
// which Main Event is being configured is never in doubt.
//
// PRICE IS ENTERED IN RUPEES AND STORED IN PAISE. The conversion happens here
// and nowhere else on this screen — every amount that crosses the API is an
// integer number of paise, matching the rest of the money in the system.

import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../api-client/api-client.js';
import AdminModal from '../admin-modal/AdminModal.jsx';
import AdminExecutiveInput from '../admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveTextarea from '../admin-executive-textarea/AdminExecutiveTextarea.jsx';
import AdminErrorBanner from '../admin-error-banner/AdminErrorBanner.jsx';
import { ADMIN_CONTINGENT_CONFIG_COPY as COPY } from '../../brand-admin/brand-copy.js';

const PAISE_PER_RUPEE = 100;

function rupeesFromPaise(pricePaise) {
  if (typeof pricePaise !== 'number') {
    return '';
  }
  // Whole rupees where possible; a stored 49950 shows as 499.5, not 499.
  return String(pricePaise / PAISE_PER_RUPEE);
}

/*
 * TWO SCOPES, ONE FORM.
 *
 * `mainEvent` names the container the bundle hangs under in a three-layer fest
 * (fest → main event → verticals). A two-layer fest (fest → events) has no such
 * container, so the caller passes `festScope` instead: the bundle hangs off the
 * fest and `verticals` are its top-level events. The only differences are the
 * copy, and a parentEventId that goes over the wire as null.
 */
function AdminContingentConfig({ festId, festName, mainEvent, verticals, onClose, onSaved }) {
  const isFestLevel = !mainEvent;
  const scopeName = isFestLevel ? (festName ?? '') : mainEvent.eventName;
  const [contingentId, setContingentId] = useState(null);
  const [contingentName, setContingentName] = useState('');
  const [description, setDescription] = useState('');
  const [priceRupees, setPriceRupees] = useState('');
  const [includedEventIds, setIncludedEventIds] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  /*
   * An existing bundle is loaded and pre-filled rather than silently replaced —
   * an admin opening this on a configured event expects to edit what is there,
   * not to start again and create a second one.
   */
  const loadExisting = useCallback(async () => {
    try {
      const existing = await apiClient.get(`/fests/${festId}/contingents`);
      const rows = Array.isArray(existing) ? existing : [];
      const match = rows.find((row) =>
        isFestLevel
          ? !row.parentEventId
          : String(row.parentEventId) === String(mainEvent.id),
      );
      if (!match) {
        setContingentName(scopeName ?? '');
        return;
      }
      setContingentId(match.id);
      setContingentName(match.contingentName ?? '');
      setDescription(match.description ?? '');
      setPriceRupees(rupeesFromPaise(match.pricePaise));
      setIncludedEventIds((match.includedEventIds ?? []).map(String));
    } catch {
      // A failed read is not a failed edit: fall back to a blank form rather
      // than blocking the admin out of a bundle they can still create.
      setContingentName(scopeName ?? '');
    }
  }, [festId, isFestLevel, mainEvent, scopeName]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadExisting();
  }, [loadExisting]);

  function toggleVertical(verticalId) {
    setIncludedEventIds((previous) =>
      previous.includes(verticalId)
        ? previous.filter((id) => id !== verticalId)
        : [...previous, verticalId],
    );
  }

  async function handleSave() {
    const parsedRupees = Number(priceRupees);
    if (!contingentName.trim()) {
      setErrorMessage(COPY.nameRequired);
      return;
    }
    if (!Number.isFinite(parsedRupees) || parsedRupees < 0) {
      setErrorMessage(COPY.priceInvalid);
      return;
    }
    if (includedEventIds.length < 2) {
      // The server enforces the same floor; saying so here saves a round trip.
      setErrorMessage(isFestLevel ? COPY.needTwoEvents : COPY.needTwoVerticals);
      return;
    }

    setErrorMessage('');
    setIsSaving(true);
    try {
      const payload = {
        // null is the fest-level scope, not a missing value — the server reads it
        // as "this bundle belongs to the fest, not to a container event".
        parentEventId: isFestLevel ? null : mainEvent.id,
        contingentName: contingentName.trim(),
        description: description.trim() || null,
        // Rounded, not truncated: 499.995 rupees is 491000 paise, and a
        // floating-point tail must never become a fraction of a paisa.
        pricePaise: Math.round(parsedRupees * PAISE_PER_RUPEE),
        includedEventIds,
      };
      if (contingentId) {
        await apiClient.patch(`/fests/${festId}/contingents/${contingentId}`, payload);
      } else {
        await apiClient.post(`/fests/${festId}/contingents`, payload);
      }
      await onSaved();
      onClose();
    } catch (saveError) {
      setErrorMessage(saveError?.message || COPY.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AdminModal
      isOpen
      title={isFestLevel ? COPY.festTitle(scopeName) : COPY.title(scopeName)}
      confirmLabel={COPY.save}
      cancelLabel={COPY.cancel}
      isBusy={isSaving}
      onConfirm={handleSave}
      onCancel={onClose}
    >
      <div className="flex flex-col gap-4">
        {errorMessage ? <AdminErrorBanner message={errorMessage} /> : null}

        <AdminExecutiveInput
          label={COPY.nameLabel}
          value={contingentName}
          onChange={(changeEvent) => setContingentName(changeEvent.target.value)}
        />

        {/* Separate from the Main Event's own description: this sells the
            bundle, not the event. */}
        <AdminExecutiveTextarea
          label={COPY.descriptionLabel}
          helperText={COPY.descriptionHelp}
          rows={3}
          value={description}
          onChange={(changeEvent) => setDescription(changeEvent.target.value)}
        />

        <AdminExecutiveInput
          label={COPY.priceLabel}
          helperText={COPY.priceHelp}
          type="number"
          inputMode="decimal"
          min="0"
          value={priceRupees}
          onChange={(changeEvent) => setPriceRupees(changeEvent.target.value)}
        />

        <div>
          <span className="font-admin-body text-[13px] font-medium text-admin-neutral-ink">
            {isFestLevel ? COPY.festEventsLabel : COPY.verticalsLabel}
          </span>
          <p className="mb-2 font-admin-body text-[12px] text-admin-slate-600">
            {isFestLevel ? COPY.festEventsHelp : COPY.verticalsHelp}
          </p>
          {verticals.length === 0 ? (
            <p className="font-admin-body text-[13px] text-admin-slate-600">
              {isFestLevel ? COPY.noFestEvents : COPY.noVerticals}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {verticals.map((vertical) => {
                /* A team event cannot be bundled — the buyer would be handing
                   over a seat the recipient still has to form a team for. Shown
                   but disabled, so the admin sees WHY it is not an option rather
                   than wondering where the event went. */
                const isTeamEvent = vertical.eventType === 'team';
                return (
                  <li key={vertical.id}>
                    <label
                      className={`flex items-center gap-2.5 ${isTeamEvent ? 'opacity-60' : ''}`}
                    >
                      <input
                        type="checkbox"
                        disabled={isTeamEvent}
                        checked={includedEventIds.includes(String(vertical.id))}
                        onChange={() => toggleVertical(String(vertical.id))}
                        className="h-4 w-4 accent-admin-primary-blue"
                      />
                      <span className="font-admin-body text-[13px] text-admin-neutral-ink">
                        {vertical.eventName}
                      </span>
                      {isTeamEvent ? (
                        <span className="font-admin-body text-[11px] text-admin-slate-600">
                          {COPY.teamEventNote}
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </AdminModal>
  );
}

export default AdminContingentConfig;

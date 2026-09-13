// AdminContingentScopeManager.jsx
// Every contingent in ONE scope — a Main Event, or the fest itself — with a form
// to create or edit one and a Publish action per draft.
//
// WHY THIS REPLACED AdminContingentConfig. That form assumed a scope holds
// exactly one bundle, while the participant app has always sold several per
// scope. It could not even find the one: it read the list endpoint's
// { contingents } envelope as a bare array, so it opened blank every time and
// POSTed a duplicate on every save, until a published copy made the next save a
// CONTINGENT_EVENT_CONFLICT. It also had no way to publish, so nothing it made
// could ever be bought.
//
// THE SERVER RESOLVES THE SCOPE; THIS RENDERS IT. One read —
// GET /fests/:festId/contingents/scope — returns the bundles, every candidate
// event with the same eligibility verdict create and publish will reach, and a
// blockedReason. So this component does not re-derive a single rule. It greys
// out exactly what the server says is ineligible and shows the server's reason,
// which is what stops it offering a choice the save then refuses.
//
// THE PRICE CONFIRMATION IS RULE C.3, SURFACED. A bundle priced above the sum of
// its events' individual fees must be sent with allowNegativeDiscount — a
// deliberate guard, not a bug. The old form never sent it, so a bundle of free
// events (sum ₹0) could not be saved at any price. The guard stays; the form now
// asks the question the guard is asking.
//
// PRICE IS ENTERED IN RUPEES AND STORED IN PAISE, converted here and nowhere
// else, matching every other amount that crosses the API.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminModal from '../admin-modal/AdminModal.jsx';
import AdminExecutiveInput from '../admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveTextarea from '../admin-executive-textarea/AdminExecutiveTextarea.jsx';
import AdminExecutiveButton from '../admin-executive-button/AdminExecutiveButton.jsx';
import AdminErrorBanner from '../admin-error-banner/AdminErrorBanner.jsx';
import AdminStatusPill from '../admin-status-pill/AdminStatusPill.jsx';

const PAISE_PER_RUPEE = 100;

const COPY = {
  listTitle: (scopeName) => `Contingents — ${scopeName}`,
  newTitle: 'New contingent',
  editTitle: (contingentName) => `Edit ${contingentName}`,
  newContingent: 'New contingent',
  close: 'Close',
  back: 'Back',
  save: 'Save contingent',
  loading: 'Loading contingents…',
  loadFailed: 'The contingents for this scope could not be loaded.',
  retry: 'Retry',
  empty: 'No contingents here yet. Create one to sell these events together.',
  festScope: 'Whole fest',
  blockedParentHasFee:
    'This event charges its own registration fee, so a contingent under it would charge buyers twice. Make the event free to bundle its sub-events.',
  blockedNotEnoughEvents: (minimum) =>
    `A contingent needs at least ${minimum} eligible events here — published, solo events.`,
  nameLabel: 'Name',
  descriptionLabel: 'Description',
  descriptionHelp: 'What the bundle offers buyers.',
  priceLabel: 'Price (₹)',
  priceHelp: 'The whole-bundle price.',
  eventsLabel: 'Included events',
  eventsHelp: (minimum) => `Choose at least ${minimum}.`,
  noCandidates: 'There are no events in this scope to bundle yet.',
  free: 'Free',
  lockedNote:
    'Published or already bought, so the price and events are fixed. You can still change the name and description.',
  takenBy: (contingentName) => `Already sold in “${contingentName}”`,
  eventCount: (count) => `${count} event${count === 1 ? '' : 's'}`,
  claimCount: (count) => `${count} claimed`,
  edit: 'Edit',
  publish: 'Publish',
  overpricedLabel: (individualTotal) =>
    `Charge more than these events cost individually (${individualTotal})`,
  overpricedFreeLabel: 'These events are free individually — confirm this bundle carries a price',
  overpricedRequired: 'Confirm the price is intentional before saving.',
  nameRequired: 'Give the contingent a name.',
  priceInvalid: 'Enter a price of zero or more.',
  needMoreEvents: (minimum) => `Choose at least ${minimum} events.`,
  saveFailed: 'The contingent could not be saved.',
  publishFailed: 'The contingent could not be published.',
};

function formatRupees(paise) {
  return `₹${((paise ?? 0) / PAISE_PER_RUPEE).toLocaleString('en-IN')}`;
}

function haveSameIds(firstIds, secondIds) {
  if (firstIds.length !== secondIds.length) {
    return false;
  }
  const sortedFirst = firstIds.map(String).sort();
  const sortedSecond = secondIds.map(String).sort();
  return sortedFirst.every((identifier, index) => identifier === sortedSecond[index]);
}

function AdminContingentScopeManager({ festId, parentEventId = null, onClose, onSaved }) {
  const [scopeData, setScopeData] = useState(null);
  const [loadState, setLoadState] = useState('loading');
  const [view, setView] = useState('list');
  const [editingContingent, setEditingContingent] = useState(null);
  const [contingentName, setContingentName] = useState('');
  const [description, setDescription] = useState('');
  const [priceRupees, setPriceRupees] = useState('');
  const [includedEventIds, setIncludedEventIds] = useState([]);
  const [hasConfirmedOverprice, setHasConfirmedOverprice] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [publishingContingentId, setPublishingContingentId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  /* Per-event reasons the server returned on a refused save, keyed by event id,
     so each one lands beside the event it is about instead of in one banner. */
  const [eventErrorsById, setEventErrorsById] = useState({});

  const loadScope = useCallback(async () => {
    const query = parentEventId ? `?parentEventId=${parentEventId}` : '';
    try {
      const data = await apiClient.get(`/fests/${festId}/contingents/scope${query}`);
      setScopeData(data);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [festId, parentEventId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadScope();
  }, [loadScope]);

  const scope = scopeData?.scope ?? null;
  const candidateEvents = useMemo(() => scopeData?.candidateEvents ?? [], [scopeData]);
  const contingents = scopeData?.contingents ?? [];
  const minimumEventCount = scope?.minimumEventCount ?? 2;
  const isStructureLocked = Boolean(editingContingent?.isStructureLocked);

  const individualTotalPaise = useMemo(
    () =>
      candidateEvents
        .filter((event) => includedEventIds.includes(event.id))
        .reduce((runningTotal, event) => runningTotal + (event.feeAmountPaise ?? 0), 0),
    [candidateEvents, includedEventIds],
  );

  const isPriceValid =
    priceRupees !== '' && Number.isFinite(Number(priceRupees)) && Number(priceRupees) >= 0;
  /* Rounded, not truncated: a floating-point tail must never become a fraction
     of a paisa. */
  const pricePaise = isPriceValid ? Math.round(Number(priceRupees) * PAISE_PER_RUPEE) : 0;
  const isOverpriced = !isStructureLocked && isPriceValid && pricePaise > individualTotalPaise;

  function applyServerError(serverError, fallbackMessage) {
    const perEventReasons = serverError?.details?.includedEventIds;
    setEventErrorsById(
      perEventReasons && typeof perEventReasons === 'object' ? perEventReasons : {},
    );
    setErrorMessage(serverError?.message || fallbackMessage);
  }

  function openForm(contingent) {
    setEditingContingent(contingent);
    setContingentName(contingent ? contingent.contingentName : (scope?.scopeName ?? ''));
    setDescription(contingent?.description ?? '');
    setPriceRupees(contingent ? String(contingent.pricePaise / PAISE_PER_RUPEE) : '');
    setIncludedEventIds(contingent ? contingent.includedEventIds.map(String) : []);
    setHasConfirmedOverprice(false);
    setErrorMessage('');
    setEventErrorsById({});
    setView('form');
  }

  function backToList() {
    setView('list');
    setEditingContingent(null);
    setErrorMessage('');
    setEventErrorsById({});
  }

  function toggleEvent(eventId) {
    setIncludedEventIds((previous) =>
      previous.includes(eventId)
        ? previous.filter((identifier) => identifier !== eventId)
        : [...previous, eventId],
    );
    setEventErrorsById((previous) => {
      if (!previous[eventId]) {
        return previous;
      }
      const next = { ...previous };
      delete next[eventId];
      return next;
    });
  }

  /*
   * Why an event cannot be ticked, or null. The static rules come from the
   * server's verdict verbatim; the only thing decided here is the one case the
   * server cannot know about in a read — that an event sold in a published
   * bundle is still selectable while editing THAT bundle.
   */
  function describeBlock(event) {
    if (!event.isEligible) {
      return event.ineligibleReasons.join('; ');
    }
    if (
      event.inPublishedContingent &&
      event.inPublishedContingent.id !== editingContingent?.id
    ) {
      return COPY.takenBy(event.inPublishedContingent.contingentName);
    }
    return null;
  }

  async function handleSave() {
    if (!contingentName.trim()) {
      setErrorMessage(COPY.nameRequired);
      return;
    }
    if (!isStructureLocked) {
      if (!isPriceValid) {
        setErrorMessage(COPY.priceInvalid);
        return;
      }
      if (includedEventIds.length < minimumEventCount) {
        setErrorMessage(COPY.needMoreEvents(minimumEventCount));
        return;
      }
    }

    /*
     * An edit that leaves price and events alone sends neither. The server
     * re-runs the C.3 price check whenever either is present, so sending them
     * unchanged would make a name fix on an intentionally overpriced draft ask
     * for the confirmation all over again.
     */
    const hasStructuralChange =
      !editingContingent ||
      pricePaise !== editingContingent.pricePaise ||
      !haveSameIds(includedEventIds, editingContingent.includedEventIds);

    if (!isStructureLocked && hasStructuralChange && isOverpriced && !hasConfirmedOverprice) {
      setErrorMessage(COPY.overpricedRequired);
      return;
    }

    setErrorMessage('');
    setEventErrorsById({});
    setIsSaving(true);
    try {
      if (editingContingent) {
        const payload = {
          contingentName: contingentName.trim(),
          description: description.trim() || null,
        };
        if (!isStructureLocked && hasStructuralChange) {
          payload.pricePaise = pricePaise;
          payload.includedEventIds = includedEventIds;
          payload.allowNegativeDiscount = isOverpriced && hasConfirmedOverprice;
        }
        await apiClient.patch(`/fests/${festId}/contingents/${editingContingent.id}`, payload);
      } else {
        await apiClient.post(`/fests/${festId}/contingents`, {
          /* null is the fest scope, not a missing value. */
          parentEventId: scope?.parentEventId ?? null,
          contingentName: contingentName.trim(),
          description: description.trim() || null,
          pricePaise,
          includedEventIds,
          allowNegativeDiscount: isOverpriced && hasConfirmedOverprice,
        });
      }
      await loadScope();
      await onSaved?.();
      /* Back to the list, not closed: the natural next step after saving a
         draft is to publish it, and that lives on the list. */
      backToList();
    } catch (saveError) {
      applyServerError(saveError, COPY.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePublish(contingent) {
    setErrorMessage('');
    setEventErrorsById({});
    setPublishingContingentId(contingent.id);
    try {
      await apiClient.post(`/fests/${festId}/contingents/${contingent.id}/publish`);
      await loadScope();
      await onSaved?.();
    } catch (publishError) {
      applyServerError(publishError, COPY.publishFailed);
    } finally {
      setPublishingContingentId(null);
    }
  }

  function handleRetry() {
    setLoadState('loading');
    loadScope();
  }

  const scopeName = scope?.scopeName || COPY.festScope;
  let blockedMessage = null;
  if (scope?.blockedReason === 'parentHasFee') {
    blockedMessage = COPY.blockedParentHasFee;
  } else if (scope?.blockedReason === 'notEnoughEligibleEvents') {
    blockedMessage = COPY.blockedNotEnoughEvents(minimumEventCount);
  }

  if (view === 'form') {
    return (
      <AdminModal
        isOpen
        title={editingContingent ? COPY.editTitle(editingContingent.contingentName) : COPY.newTitle}
        confirmLabel={COPY.save}
        cancelLabel={COPY.back}
        isBusy={isSaving}
        onConfirm={handleSave}
        onCancel={backToList}
      >
        <div className="flex flex-col gap-4">
          {errorMessage ? <AdminErrorBanner message={errorMessage} /> : null}

          {isStructureLocked ? (
            <p className="rounded-md bg-admin-surface-off-white px-3 py-2 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
              {COPY.lockedNote}
            </p>
          ) : null}

          <AdminExecutiveInput
            label={COPY.nameLabel}
            value={contingentName}
            onChange={(changeEvent) => setContingentName(changeEvent.target.value)}
          />

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
            disabled={isStructureLocked}
            onChange={(changeEvent) => setPriceRupees(changeEvent.target.value)}
          />

          <div>
            <span className="font-admin-body text-[13px] font-medium text-admin-neutral-ink">
              {COPY.eventsLabel}
            </span>
            <p className="mb-2 font-admin-body text-[12px] text-admin-slate-600">
              {COPY.eventsHelp(minimumEventCount)}
            </p>
            {candidateEvents.length === 0 ? (
              <p className="font-admin-body text-[13px] text-admin-slate-600">{COPY.noCandidates}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {candidateEvents.map((event) => {
                  const isSelected = includedEventIds.includes(event.id);
                  const blockReason = describeBlock(event);
                  /* An already-ticked event that has since become ineligible stays
                     un-tickable, so the admin can remove it rather than being
                     stuck with a selection the save will refuse. */
                  const isDisabled = isStructureLocked || (!isSelected && Boolean(blockReason));
                  const serverReason = eventErrorsById[event.id];
                  return (
                    <li key={event.id}>
                      <label
                        className={`flex items-start gap-2.5 ${
                          isDisabled ? 'opacity-60' : 'cursor-pointer'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={isDisabled}
                          checked={isSelected}
                          onChange={() => toggleEvent(event.id)}
                          className="mt-0.5 h-4 w-4 accent-admin-primary-blue"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="font-admin-body text-[13px] text-admin-neutral-ink">
                              {event.eventName}
                            </span>
                            <span className="shrink-0 font-admin-mono text-[12px] text-admin-slate-600">
                              {event.feeAmountPaise > 0 ? formatRupees(event.feeAmountPaise) : COPY.free}
                            </span>
                          </span>
                          {blockReason ? (
                            <span className="block font-admin-body text-[12px] text-admin-slate-600">
                              {blockReason}
                            </span>
                          ) : null}
                          {serverReason ? (
                            <span className="block font-admin-body text-[12px] text-admin-status-error-red">
                              {serverReason}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {isOverpriced ? (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-admin-slate-200 px-3 py-2">
              <input
                type="checkbox"
                checked={hasConfirmedOverprice}
                onChange={(changeEvent) => setHasConfirmedOverprice(changeEvent.target.checked)}
                className="mt-0.5 h-4 w-4 accent-admin-primary-blue"
              />
              <span className="font-admin-body text-[13px] leading-[18px] text-admin-neutral-ink">
                {individualTotalPaise > 0
                  ? COPY.overpricedLabel(formatRupees(individualTotalPaise))
                  : COPY.overpricedFreeLabel}
              </span>
            </label>
          ) : null}
        </div>
      </AdminModal>
    );
  }

  return (
    <AdminModal
      isOpen
      title={COPY.listTitle(scopeName)}
      confirmLabel={COPY.newContingent}
      cancelLabel={COPY.close}
      confirmDisabled={loadState !== 'ready' || Boolean(blockedMessage)}
      onConfirm={() => openForm(null)}
      onCancel={onClose}
    >
      <div className="flex flex-col gap-4">
        {errorMessage ? <AdminErrorBanner message={errorMessage} /> : null}

        {loadState === 'loading' ? (
          <p className="font-admin-body text-[13px] text-admin-slate-600">{COPY.loading}</p>
        ) : loadState === 'error' ? (
          <div className="flex flex-col items-start gap-2">
            <AdminErrorBanner message={COPY.loadFailed} />
            <AdminExecutiveButton variant="secondary" size="small" onClick={handleRetry}>
              {COPY.retry}
            </AdminExecutiveButton>
          </div>
        ) : (
          <>
            {blockedMessage ? (
              <p className="rounded-md border border-admin-slate-200 bg-admin-surface-off-white px-3 py-2 font-admin-body text-[13px] leading-[18px] text-admin-neutral-ink">
                {blockedMessage}
              </p>
            ) : null}

            {contingents.length === 0 ? (
              <p className="font-admin-body text-[13px] text-admin-slate-600">{COPY.empty}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-admin-slate-100 rounded-md border border-admin-slate-200">
                {contingents.map((contingent) => (
                  <li key={contingent.id} className="flex items-center gap-3 px-3 py-2.5">
                    <Layers
                      size={16}
                      strokeWidth={1.75}
                      className="shrink-0 text-admin-slate-600"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-admin-body text-[14px] font-medium text-admin-neutral-ink">
                          {contingent.contingentName}
                        </span>
                        <AdminStatusPill status={contingent.status} />
                      </span>
                      <span className="block font-admin-mono text-[12px] text-admin-slate-600">
                        {formatRupees(contingent.pricePaise)} ·{' '}
                        {COPY.eventCount(contingent.includedEventIds.length)}
                        {contingent.claimCount > 0
                          ? ` · ${COPY.claimCount(contingent.claimCount)}`
                          : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <AdminExecutiveButton
                        variant="secondary"
                        size="small"
                        onClick={() => openForm(contingent)}
                      >
                        {COPY.edit}
                      </AdminExecutiveButton>
                      {contingent.status === 'draft' ? (
                        <AdminExecutiveButton
                          variant="primary"
                          size="small"
                          loading={publishingContingentId === contingent.id}
                          disabled={Boolean(publishingContingentId)}
                          onClick={() => handlePublish(contingent)}
                        >
                          {COPY.publish}
                        </AdminExecutiveButton>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </AdminModal>
  );
}

export default AdminContingentScopeManager;

// AdminContingentEditScreen.jsx
// Routes: /admin/fests/:festId/contingents/create and
//         /admin/fests/:festId/contingents/:contingentId/edit
// Create/edit one contingent: multi-select of eligible sub-events (published
// SOLO children of the parent event, excluding events already inside another
// published contingent of the same parent), bundle price in ₹ (paise on the
// wire), live savings display, and publish. Structural fields lock once the
// contingent has purchases — the backend enforces it; this screen says so.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveInput from '../../components-admin/admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveTextarea from '../../components-admin/admin-executive-textarea/AdminExecutiveTextarea.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import { ADMIN_CONTINGENT_COPY as COPY } from '../../brand-admin/brand-copy.js';

function formatRupees(paise) {
  return `₹${((paise ?? 0) / 100).toLocaleString('en-IN')}`;
}

function AdminContingentEditScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { festId, contingentId } = useParams();
  const isEditing = Boolean(contingentId);

  const parentEventId = location.state?.parentEventId ?? null;
  const parentEventName = location.state?.parentEventName ?? '';

  const [status, setStatus] = useState('loading');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [existingContingent, setExistingContingent] = useState(null);
  const [claimCount, setClaimCount] = useState(0);

  // Eligible sub-events and which are ticked.
  const [eligibleEvents, setEligibleEvents] = useState([]);
  const [selectedEventIds, setSelectedEventIds] = useState([]);
  const [contingentName, setContingentName] = useState('');
  const [description, setDescription] = useState('');
  const [priceRupees, setPriceRupees] = useState('');
  const [maximumBundleClaims, setMaximumBundleClaims] = useState('');
  const [allowNegativeDiscount, setAllowNegativeDiscount] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [eventList, contingentListResult, detail] = await Promise.all([
        apiClient.get(`/fests/${festId}/events/all`),
        apiClient.get(`/fests/${festId}/contingents`),
        isEditing ? apiClient.get(`/fests/${festId}/contingents/${contingentId}`) : Promise.resolve(null),
      ]);
      const allEvents = Array.isArray(eventList) ? eventList : [];
      const allContingents = Array.isArray(contingentListResult?.contingents)
        ? contingentListResult.contingents
        : [];
      const resolvedParentId = detail?.contingent?.parentEventId ?? parentEventId;

      // Sub-events locked by ANOTHER published contingent of the same parent
      // are filtered out up front, so the form cannot offer a choice C.1 rejects.
      const lockedEventIds = new Set(
        allContingents
          .filter(
            (row) =>
              row.status === 'published' &&
              String(row.parentEventId) === String(resolvedParentId) &&
              String(row.id) !== String(contingentId ?? ''),
          )
          .flatMap((row) => row.includedEventIds.map(String)),
      );
      setEligibleEvents(
        allEvents.filter(
          (event) =>
            String(event.parentEventId) === String(resolvedParentId) &&
            event.status === 'published' &&
            event.eventType === 'solo' &&
            !lockedEventIds.has(String(event.id)),
        ),
      );

      if (detail) {
        const row = detail.contingent;
        setExistingContingent(row);
        setContingentName(row.contingentName);
        setDescription(row.description ?? '');
        setSelectedEventIds(row.includedEventIds.map(String));
        setPriceRupees(String(row.pricePaise / 100));
        setMaximumBundleClaims(row.maximumBundleClaims === null ? '' : String(row.maximumBundleClaims));
        setClaimCount(
          Object.values(detail.claimCountsByStatus ?? {}).reduce(
            (runningTotal, count) => runningTotal + count,
            0,
          ),
        );
      }
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [festId, contingentId, isEditing, parentEventId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const isStructureFrozen = Boolean(
    existingContingent && (existingContingent.status !== 'draft' || claimCount > 0),
  );

  const eventById = useMemo(
    () => new Map(eligibleEvents.map((event) => [String(event.id), event])),
    [eligibleEvents],
  );
  const individualTotalPaise = selectedEventIds.reduce(
    (runningTotal, eventId) => runningTotal + (eventById.get(eventId)?.feeAmountPaise ?? 0),
    0,
  );
  const pricePaise = Math.max(0, Math.round(parseFloat(priceRupees || '0') * 100) || 0);
  const savingsPaise = individualTotalPaise - pricePaise;
  const isNegativeDiscount = savingsPaise < 0;

  function toggleEvent(eventId) {
    setSelectedEventIds((previous) =>
      previous.includes(eventId)
        ? previous.filter((candidate) => candidate !== eventId)
        : [...previous, eventId],
    );
  }

  const canSave =
    contingentName.trim().length > 0 &&
    (isStructureFrozen || (selectedEventIds.length >= 2 && selectedEventIds.length <= 12)) &&
    (!isNegativeDiscount || allowNegativeDiscount) &&
    !isSaving;

  async function handleSave() {
    if (!canSave) {
      return;
    }
    setSaveError('');
    setIsSaving(true);
    try {
      if (isEditing) {
        const payload = {
          contingentName: contingentName.trim(),
          description: description.trim() || null,
          allowNegativeDiscount,
        };
        if (!isStructureFrozen) {
          payload.includedEventIds = selectedEventIds;
          payload.pricePaise = pricePaise;
          payload.maximumBundleClaims =
            maximumBundleClaims === '' ? null : Number(maximumBundleClaims);
        }
        await apiClient.patch(`/fests/${festId}/contingents/${contingentId}`, payload);
      } else {
        await apiClient.post(`/fests/${festId}/contingents`, {
          parentEventId,
          contingentName: contingentName.trim(),
          description: description.trim() || null,
          includedEventIds: selectedEventIds,
          pricePaise,
          maximumBundleClaims: maximumBundleClaims === '' ? null : Number(maximumBundleClaims),
          allowNegativeDiscount,
        });
      }
      navigate(-1);
    } catch (saveException) {
      setSaveError(saveException.message || COPY.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <span
          aria-label="Loading"
          className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
        />
      </div>
    );
  }
  if (status === 'error' || (!isEditing && !parentEventId)) {
    return (
      <AdminExecutiveCard>
        <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.loadFailed}</p>
      </AdminExecutiveCard>
    );
  }

  return (
    <div className="mx-auto flex max-w-[760px] flex-col gap-6">
      <h1 className="font-admin-display text-[24px] font-semibold leading-8 text-admin-neutral-ink">
        {isEditing ? COPY.editorTitleEdit : COPY.editorTitleCreate}
      </h1>

      <AdminErrorBanner message={saveError} />

      {isStructureFrozen ? (
        <p className="rounded-md border border-admin-slate-200 bg-admin-surface-off-white px-3 py-2 font-admin-body text-[13px] text-admin-neutral-ink">
          {COPY.frozenNotice}
        </p>
      ) : null}

      <AdminExecutiveCard>
        <div className="flex flex-col gap-4">
          {parentEventName ? (
            <p className="font-admin-mono text-[13px] text-admin-slate-600">
              {COPY.parentLabel}: {parentEventName}
            </p>
          ) : null}
          <AdminExecutiveInput
            label={COPY.nameLabel}
            placeholder={COPY.namePlaceholder}
            value={contingentName}
            onChange={(changeEvent) => setContingentName(changeEvent.target.value)}
          />
          <AdminExecutiveTextarea
            label={COPY.descriptionLabel}
            value={description}
            onChange={(changeEvent) => setDescription(changeEvent.target.value)}
          />
        </div>
      </AdminExecutiveCard>

      <AdminExecutiveCard>
        <h2 className="font-admin-display text-[18px] font-semibold leading-6 text-admin-neutral-ink">
          {COPY.subEventsLabel}
        </h2>
        <p className="mt-1 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
          {COPY.subEventsHelp}
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {eligibleEvents.map((event) => (
            <label
              key={event.id}
              className={[
                'flex cursor-pointer items-center justify-between rounded-md border p-3',
                selectedEventIds.includes(String(event.id))
                  ? 'border-admin-primary-blue bg-admin-primary-blue/5'
                  : 'border-admin-slate-200',
                isStructureFrozen ? 'cursor-not-allowed opacity-60' : '',
              ].join(' ')}
            >
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selectedEventIds.includes(String(event.id))}
                  disabled={isStructureFrozen}
                  onChange={() => toggleEvent(String(event.id))}
                  className="h-4 w-4 accent-admin-primary-blue"
                />
                <span className="font-admin-body text-[14px] text-admin-neutral-ink">
                  {event.eventName}
                </span>
              </span>
              <span className="font-admin-mono text-[13px] text-admin-slate-600">
                {formatRupees(event.feeAmountPaise)}
              </span>
            </label>
          ))}
        </div>
      </AdminExecutiveCard>

      <AdminExecutiveCard>
        <div className="flex flex-col gap-4">
          <AdminExecutiveInput
            label={COPY.priceLabel}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={priceRupees}
            disabled={isStructureFrozen}
            onChange={(changeEvent) => setPriceRupees(changeEvent.target.value)}
          />
          <AdminExecutiveInput
            label={COPY.maximumBundleClaimsLabel}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={maximumBundleClaims}
            disabled={isStructureFrozen}
            onChange={(changeEvent) => setMaximumBundleClaims(changeEvent.target.value)}
          />
          <p className="font-admin-body text-[14px] text-admin-neutral-ink">
            {COPY.individualTotalPrefix}{' '}
            <span className="font-semibold">{formatRupees(individualTotalPaise)}</span>
            {savingsPaise > 0 ? (
              <>
                {' — '}
                {COPY.savingsPrefix}{' '}
                <span className="font-semibold text-admin-status-success-green">
                  {formatRupees(savingsPaise)}
                </span>
              </>
            ) : null}
          </p>
          {isNegativeDiscount ? (
            <label className="flex items-start gap-2 rounded-md border border-admin-status-error-red/40 bg-admin-status-error-red/5 p-3">
              <input
                type="checkbox"
                checked={allowNegativeDiscount}
                onChange={(changeEvent) => setAllowNegativeDiscount(changeEvent.target.checked)}
                className="mt-0.5 h-4 w-4 accent-admin-primary-blue"
              />
              <span className="font-admin-body text-[13px] text-admin-neutral-ink">
                {COPY.negativeDiscountWarning} {COPY.allowNegativeDiscountLabel}
              </span>
            </label>
          ) : null}
        </div>
      </AdminExecutiveCard>

      <div className="flex justify-end gap-2">
        <AdminExecutiveButton variant="ghost" onClick={() => navigate(-1)}>
          {COPY.keepEditing}
        </AdminExecutiveButton>
        <AdminExecutiveButton variant="primary" onClick={handleSave} disabled={!canSave}>
          {isEditing ? COPY.saveChanges : COPY.saveDraft}
        </AdminExecutiveButton>
      </div>
    </div>
  );
}

export default AdminContingentEditScreen;

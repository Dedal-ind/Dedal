// AdminEventEditModal.jsx
// Editing an event WITHOUT leaving the Event Structure canvas.
//
// The structure page is a map, and editing used to be a redirect off it: click
// "Edit event", land on Event Access, edit, then navigate back and re-pick the
// fest to see the change. The map is the context — which box you are editing,
// what sits above and beside it — and a redirect throws that context away for
// the sake of renaming a thing. So the editor comes to the canvas instead.
//
// ESSENTIAL FIELDS ONLY. Name, description, category, type, venue, capacity,
// schedule, fee, team sizes. Custom questions, staff, scoring and artwork are
// deliberately absent: they are the reasons the full editor exists, and the
// footer links straight to it. A modal that tried to be the full editor would
// be the full editor, on top of a map, in 600px.
//
// It is its OWN dialog rather than an AdminModal, because the footer this design
// asks for is not AdminModal's: one filled action plus two TEXT links (cancel,
// and a way out to the full editor), and a close X in the corner.

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveButton from '../admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveInput from '../admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveTextarea from '../admin-executive-textarea/AdminExecutiveTextarea.jsx';
import AdminCategorySelect from '../admin-category-select/AdminCategorySelect.jsx';
import AdminErrorBanner from '../admin-error-banner/AdminErrorBanner.jsx';
import { ADMIN_EVENT_EDIT_MODAL_COPY as COPY } from '../../brand-admin/brand-copy.js';

const PAISE_PER_RUPEE = 100;

/*
 * A datetime-local input has no timezone of its own, so the stored UTC instant is
 * shifted into the admin's own clock before it is shown — and shifted back by
 * `new Date(...)` on save, which reads the field in local time. Same pair as the
 * Event Access editor uses; getting only one half right is how a save quietly
 * moves an event by the UTC offset.
 */
function toLocalInputValue(isoString) {
  if (!isoString) {
    return '';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const offsetMilliseconds = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMilliseconds).toISOString().slice(0, 16);
}

/*
 * The tree node is the SEED, not the source of truth: it carries name, type,
 * category and status, so the form is never blank while the detail request is in
 * flight. The fetch then fills in description, venue, dates and fee.
 */
function buildFormFromEvent(event) {
  return {
    eventName: event?.eventName ?? '',
    description: event?.description ?? '',
    category: event?.category ?? '',
    eventType: event?.eventType ?? 'solo',
    venue: event?.venue ?? '',
    capacity:
      event?.capacity === null || event?.capacity === undefined ? '' : String(event.capacity),
    startsAt: toLocalInputValue(event?.startsAt),
    endsAt: toLocalInputValue(event?.endsAt),
    feeRupees:
      typeof event?.feeAmountPaise === 'number'
        ? String(event.feeAmountPaise / PAISE_PER_RUPEE)
        : '',
    minimumTeamSize: String(event?.minimumTeamSize ?? 1),
    maximumTeamSize: String(event?.maximumTeamSize ?? 1),
  };
}

function AdminEventEditModal({ festId, event, onClose, onSaved, onOpenFullEditor }) {
  const [form, setForm] = useState(() => buildFormFromEvent(event));
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  /*
   * Type is frozen once anyone has registered: flipping a solo event to a team
   * event would leave every existing registration without a team, and the reverse
   * would strand teams the event no longer has room for.
   */
  const [hasRegistrations, setHasRegistrations] = useState((event?.registeredCount ?? 0) > 0);

  const eventId = event?.id;

  useEffect(() => {
    let isActive = true;
    /* isLoading starts true and is only ever cleared: the modal is mounted per
       event, so there is no second fetch to re-arm it for. */
    apiClient
      .get(`/fests/${festId}/events/${eventId}`)
      .then((detail) => {
        if (!isActive || !detail) {
          return;
        }
        setForm(buildFormFromEvent(detail));
        setHasRegistrations((detail.registeredCount ?? 0) > 0);
      })
      .catch(() => {
        // A failed detail read is not a failed edit: the seeded form still holds
        // the fields the tree knows, and the admin can fix a name without them.
        if (isActive) {
          setErrorMessage(COPY.loadFailed);
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });
    return () => {
      isActive = false;
    };
  }, [festId, eventId]);

  useEffect(() => {
    function handleKeyDown(keyboardEvent) {
      if (keyboardEvent.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const setField = useCallback((fieldName, fieldValue) => {
    setForm((previous) => ({ ...previous, [fieldName]: fieldValue }));
  }, []);

  const isTeamEvent = form.eventType === 'team';

  async function handleSave() {
    if (!form.eventName.trim()) {
      setErrorMessage(COPY.nameRequired);
      return;
    }
    const parsedFee = Number(form.feeRupees || 0);
    if (!Number.isFinite(parsedFee) || parsedFee < 0) {
      setErrorMessage(COPY.feeInvalid);
      return;
    }

    /*
     * feeType travels WITH the amount. The model rejects a free event carrying a
     * non-zero fee and a paid one carrying zero, so sending the amount alone
     * would fail validation the moment an admin priced a previously free event.
     */
    const feeAmountPaise = Math.round(parsedFee * PAISE_PER_RUPEE);
    const payload = {
      eventName: form.eventName.trim(),
      description: form.description.trim(),
      category: form.category.trim() || null,
      venue: form.venue.trim(),
      capacity: form.capacity.trim() === '' ? null : Number(form.capacity),
      feeAmountPaise,
      feeType: feeAmountPaise > 0 ? 'perPerson' : 'free',
    };
    if (form.startsAt) {
      payload.startsAt = new Date(form.startsAt).toISOString();
    }
    if (form.endsAt) {
      payload.endsAt = new Date(form.endsAt).toISOString();
    }
    if (!hasRegistrations) {
      payload.eventType = form.eventType;
      // A solo event is a team of exactly one — the model enforces it, so the
      // sizes are sent to match the type rather than left to drift.
      payload.minimumTeamSize = isTeamEvent ? Number(form.minimumTeamSize || 2) : 1;
      payload.maximumTeamSize = isTeamEvent ? Number(form.maximumTeamSize || 2) : 1;
    } else if (isTeamEvent) {
      payload.minimumTeamSize = Number(form.minimumTeamSize || 2);
      payload.maximumTeamSize = Number(form.maximumTeamSize || 2);
    }

    setErrorMessage('');
    setIsSaving(true);
    try {
      await apiClient.patch(`/fests/${festId}/events/${eventId}`, payload);
      await onSaved();
      onClose();
    } catch (saveError) {
      // The modal STAYS OPEN on failure: closing would discard edits the admin
      // would have to retype, and the error would have nowhere to be shown.
      setErrorMessage(saveError?.message || COPY.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  const linkClass =
    'font-admin-body text-[13px] font-medium text-admin-primary-blue underline-offset-2 transition-colors hover:underline disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label={COPY.cancel}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={COPY.title(event?.eventName ?? '')}
        className="relative flex max-h-[80vh] w-full max-w-[600px] flex-col overflow-y-auto rounded-xl bg-admin-surface-white p-6 shadow-lg"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={COPY.cancel}
          className="absolute right-4 top-4 text-admin-slate-600 transition-colors hover:text-admin-neutral-ink"
        >
          <X size={16} />
        </button>

        <h2 className="pr-8 font-admin-display text-[18px] font-semibold leading-6 text-admin-neutral-ink">
          {COPY.title(event?.eventName ?? '')}
        </h2>

        <div className="mt-4 flex flex-col gap-4">
          {errorMessage ? <AdminErrorBanner message={errorMessage} /> : null}
          {isLoading ? (
            <p className="font-admin-body text-[13px] text-admin-slate-600">{COPY.loading}</p>
          ) : null}

          <AdminExecutiveInput
            label={COPY.nameLabel}
            required
            value={form.eventName}
            onChange={(changeEvent) => setField('eventName', changeEvent.target.value)}
          />

          <AdminExecutiveTextarea
            label={COPY.descriptionLabel}
            rows={3}
            value={form.description}
            onChange={(changeEvent) => setField('description', changeEvent.target.value)}
          />

          <div className="flex flex-col gap-1.5">
            <span className="font-admin-body text-[13px] font-medium text-admin-neutral-ink">
              {COPY.categoryLabel}
            </span>
            <AdminCategorySelect
              value={form.category}
              onChange={(nextCategory) => setField('category', nextCategory)}
              placeholder={COPY.categoryPlaceholder}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="font-admin-body text-[13px] font-medium text-admin-neutral-ink">
              {COPY.typeLabel}
            </span>
            <div className="flex items-center gap-4">
              {['solo', 'team'].map((typeOption) => (
                <label key={typeOption} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="admin-event-edit-type"
                    value={typeOption}
                    checked={form.eventType === typeOption}
                    disabled={hasRegistrations}
                    onChange={() => setField('eventType', typeOption)}
                    className="h-4 w-4 accent-admin-primary-blue"
                  />
                  <span className="font-admin-body text-[13px] text-admin-neutral-ink">
                    {typeOption === 'solo' ? COPY.typeSolo : COPY.typeTeam}
                  </span>
                </label>
              ))}
            </div>
            {hasRegistrations ? (
              <p className="font-admin-body text-[12px] text-admin-slate-600">{COPY.typeLocked}</p>
            ) : null}
          </div>

          {isTeamEvent ? (
            <div className="grid grid-cols-2 gap-3">
              <AdminExecutiveInput
                label={COPY.minimumTeamSizeLabel}
                type="number"
                min="2"
                value={form.minimumTeamSize}
                onChange={(changeEvent) => setField('minimumTeamSize', changeEvent.target.value)}
              />
              <AdminExecutiveInput
                label={COPY.maximumTeamSizeLabel}
                type="number"
                min="2"
                value={form.maximumTeamSize}
                onChange={(changeEvent) => setField('maximumTeamSize', changeEvent.target.value)}
              />
            </div>
          ) : null}

          <AdminExecutiveInput
            label={COPY.venueLabel}
            value={form.venue}
            onChange={(changeEvent) => setField('venue', changeEvent.target.value)}
          />

          <div className="grid grid-cols-2 gap-3">
            <AdminExecutiveInput
              label={COPY.capacityLabel}
              helperText={COPY.capacityHelp}
              type="number"
              min="1"
              value={form.capacity}
              onChange={(changeEvent) => setField('capacity', changeEvent.target.value)}
            />
            <AdminExecutiveInput
              label={COPY.feeLabel}
              helperText={COPY.feeHelp}
              type="number"
              inputMode="decimal"
              min="0"
              value={form.feeRupees}
              onChange={(changeEvent) => setField('feeRupees', changeEvent.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <AdminExecutiveInput
              label={COPY.startsAtLabel}
              type="datetime-local"
              value={form.startsAt}
              onChange={(changeEvent) => setField('startsAt', changeEvent.target.value)}
            />
            <AdminExecutiveInput
              label={COPY.endsAtLabel}
              type="datetime-local"
              value={form.endsAt}
              onChange={(changeEvent) => setField('endsAt', changeEvent.target.value)}
            />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-admin-slate-200 pt-4">
          <button type="button" onClick={onOpenFullEditor} className={linkClass}>
            {COPY.openFullEditor}
          </button>
          <div className="flex items-center gap-4">
            <button type="button" onClick={onClose} disabled={isSaving} className={linkClass}>
              {COPY.cancel}
            </button>
            <AdminExecutiveButton onClick={handleSave} loading={isSaving}>
              {COPY.save}
            </AdminExecutiveButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminEventEditModal;

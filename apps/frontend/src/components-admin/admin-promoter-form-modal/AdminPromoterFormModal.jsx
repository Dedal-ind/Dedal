// AdminPromoterFormModal.jsx
// Create or edit a promoter, in the modal form the console uses everywhere.
// Shared by the promoters list and the promoter detail so there is one form.
//
// THE DUPLICATE-NAME REFUSAL IS NOT A GENERIC ERROR. The backend answers a
// colliding name with the promoter that already owns it. The form says so
// plainly and links to that promoter, so the admin goes and uses the one that
// exists instead of retrying with a slightly different spelling and creating
// a near-duplicate.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminModal from '../admin-modal/AdminModal.jsx';
import AdminExecutiveInput from '../admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveSelect from '../admin-executive-select/AdminExecutiveSelect.jsx';
import AdminErrorBanner from '../admin-error-banner/AdminErrorBanner.jsx';
import { ADMIN_PROMOTERS_COPY as COPY } from '../../brand-admin/brand-copy.js';
import {
  PROMOTER_KINDS,
  REFUSAL_CODES,
  promotersApi,
  promoterPath,
} from '../../helpers/admin-promotions-api.js';

const EMPTY_FORM = {
  displayName: '',
  kind: 'sponsor',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
};

function formFrom(promoter) {
  if (!promoter) {
    return EMPTY_FORM;
  }
  return {
    displayName: promoter.displayName ?? '',
    kind: promoter.kind ?? 'sponsor',
    contactName: promoter.contactName ?? '',
    contactEmail: promoter.contactEmail ?? '',
    contactPhone: promoter.contactPhone ?? '',
  };
}

/*
 * isOpen, promoter (null to create), onClose, onSaved(savedPromoter).
 */
function AdminPromoterFormModal({ isOpen, promoter, onClose, onSaved }) {
  const [form, setForm] = useState(() => formFrom(promoter));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [nameTakenBy, setNameTakenBy] = useState(null);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(formFrom(promoter));
      setError('');
      setNameTakenBy(null);
    }
  }, [isOpen, promoter]);

  const set = (field) => (changeEvent) => {
    setNameTakenBy(null);
    setForm((previous) => ({ ...previous, [field]: changeEvent.target.value }));
  };

  async function handleSave() {
    if (!form.displayName.trim()) {
      setError(COPY.nameRequired);
      return;
    }
    setError('');
    setNameTakenBy(null);
    setIsSaving(true);
    const payload = {
      displayName: form.displayName.trim(),
      kind: form.kind,
      contactName: form.contactName.trim() || null,
      contactEmail: form.contactEmail.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
    };
    try {
      const saved = promoter
        ? await promotersApi.update(promoter.id, payload)
        : await promotersApi.create(payload);
      onSaved(saved);
    } catch (saveError) {
      if (saveError?.code === REFUSAL_CODES.NAME_TAKEN) {
        setNameTakenBy({
          id: saveError.details?.existingPromoterId,
          name: saveError.details?.existingDisplayName ?? form.displayName,
          status: saveError.details?.existingStatus,
        });
      } else {
        setError(saveError?.message || COPY.saveFailed);
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AdminModal
      isOpen={isOpen}
      title={promoter ? COPY.editModalTitle : COPY.createModalTitle}
      confirmLabel={promoter ? COPY.saveAction : COPY.createAction}
      cancelLabel={COPY.cancel}
      isBusy={isSaving}
      onConfirm={handleSave}
      onCancel={() => (isSaving ? null : onClose())}
    >
      <div className="flex flex-col gap-4">
        <AdminErrorBanner message={error} />
        {nameTakenBy ? (
          <div
            role="alert"
            className="rounded-md border border-admin-status-warning-amber/40 bg-admin-status-warning-amber/5 px-4 py-3 font-admin-body text-[14px] leading-5 text-admin-neutral-ink"
          >
            {COPY.nameTakenBody(nameTakenBy.name)}{' '}
            {nameTakenBy.id ? (
              <Link to={promoterPath(nameTakenBy.id)} className="font-semibold text-admin-primary-blue underline">
                {COPY.nameTakenLink}
              </Link>
            ) : null}
            {nameTakenBy.status === 'inactive' ? ` ${COPY.nameTakenArchivedNote}` : ''}
          </div>
        ) : null}
        <AdminExecutiveInput
          label={COPY.nameLabel}
          required
          maxLength={120}
          value={form.displayName}
          onChange={set('displayName')}
        />
        <AdminExecutiveSelect
          label={COPY.kindLabel}
          required
          value={form.kind}
          onChange={set('kind')}
          options={PROMOTER_KINDS}
        />
        <AdminExecutiveInput label={COPY.contactNameLabel} maxLength={120} value={form.contactName} onChange={set('contactName')} />
        <AdminExecutiveInput
          label={COPY.contactEmailLabel}
          type="email"
          maxLength={254}
          value={form.contactEmail}
          onChange={set('contactEmail')}
        />
        <AdminExecutiveInput label={COPY.contactPhoneLabel} maxLength={32} value={form.contactPhone} onChange={set('contactPhone')} />
      </div>
    </AdminModal>
  );
}

export default AdminPromoterFormModal;

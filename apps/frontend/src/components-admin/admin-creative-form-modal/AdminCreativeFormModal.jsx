// AdminCreativeFormModal.jsx
// Create or edit a creative: the artwork through the existing upload field,
// then the creative's own fields. One form for both, in the console's modal.
//
// EDITING WHAT A PUBLISHED CAMPAIGN IS SERVING changes what participants see
// the moment it saves — the backend allows it and records the previous media,
// there is no review step. So the form asks first: it names every published
// campaign currently running this creative and requires an explicit confirm.
// The warning exists so the swap is never an accident.

import { useEffect, useState } from 'react';
import AdminModal from '../admin-modal/AdminModal.jsx';
import AdminExecutiveInput from '../admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveSelect from '../admin-executive-select/AdminExecutiveSelect.jsx';
import AdminExecutiveTextarea from '../admin-executive-textarea/AdminExecutiveTextarea.jsx';
import AdminPosterUpload from '../admin-poster-upload/AdminPosterUpload.jsx';
import AdminErrorBanner from '../admin-error-banner/AdminErrorBanner.jsx';
import { ADMIN_CREATIVES_COPY as COPY } from '../../brand-admin/brand-copy.js';
import { CREATIVE_MEDIA_TYPES, creativesApi } from '../../helpers/admin-promotions-api.js';

const EMPTY_FORM = {
  title: '',
  mediaType: 'image',
  imageUrl: '',
  videoUrl: '',
  linkUrl: '',
  description: '',
};

function formFrom(creative) {
  if (!creative) {
    return EMPTY_FORM;
  }
  return {
    title: creative.title ?? '',
    mediaType: creative.mediaType ?? 'image',
    imageUrl: creative.imageUrl ?? '',
    videoUrl: creative.videoUrl ?? '',
    linkUrl: creative.linkUrl ?? '',
    description: creative.description ?? '',
  };
}

/*
 * isOpen, promoterId, creative (null to create; when editing, pass the
 * detail read so `campaigns` is present), onClose, onSaved(savedCreative).
 */
function AdminCreativeFormModal({ isOpen, promoterId, creative, onClose, onSaved }) {
  const [form, setForm] = useState(() => formFrom(creative));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [isLiveWarningOpen, setIsLiveWarningOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(formFrom(creative));
      setError('');
      setIsLiveWarningOpen(false);
    }
  }, [isOpen, creative]);

  const servingCampaigns = (creative?.campaigns ?? []).filter(
    (row) => row.campaignStatus === 'published' && row.isActive,
  );

  const set = (field) => (changeEvent) =>
    setForm((previous) => ({ ...previous, [field]: changeEvent.target.value }));

  function validate() {
    if (!form.title.trim()) {
      return COPY.titleRequired;
    }
    if (form.mediaType === 'image' && !form.imageUrl) {
      return COPY.imageRequired;
    }
    if (form.mediaType === 'video' && !form.videoUrl.trim()) {
      return COPY.videoRequired;
    }
    return '';
  }

  function requestSave() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    if (creative && servingCampaigns.length > 0) {
      setIsLiveWarningOpen(true);
      return;
    }
    save();
  }

  async function save() {
    setIsLiveWarningOpen(false);
    setIsSaving(true);
    const payload = {
      title: form.title.trim(),
      mediaType: form.mediaType,
      imageUrl: form.imageUrl || null,
      videoUrl: form.mediaType === 'video' ? form.videoUrl.trim() || null : null,
      linkUrl: form.linkUrl.trim() || null,
      description: form.description.trim() || null,
    };
    try {
      const saved = creative
        ? await creativesApi.update(creative.id, payload)
        : await creativesApi.create({ promoterId, ...payload });
      onSaved(saved);
    } catch (saveError) {
      const details = saveError?.details;
      const fieldProblems = details && typeof details === 'object'
        ? Object.entries(details).map(([field, problem]) => `${field} ${problem}`).join(' · ')
        : '';
      setError(fieldProblems || saveError?.message || COPY.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <AdminModal
        isOpen={isOpen && !isLiveWarningOpen}
        title={creative ? COPY.editModalTitle : COPY.createModalTitle}
        confirmLabel={creative ? COPY.saveAction : COPY.createAction}
        cancelLabel={COPY.cancel}
        isBusy={isSaving}
        onConfirm={requestSave}
        onCancel={() => (isSaving ? null : onClose())}
      >
        <div className="flex flex-col gap-4">
          <AdminErrorBanner message={error} />

          <AdminExecutiveSelect
            label={COPY.mediaTypeLabel}
            required
            value={form.mediaType}
            onChange={set('mediaType')}
            options={CREATIVE_MEDIA_TYPES}
          />

          <div>
            <span className="font-admin-body text-[13px] font-medium text-admin-neutral-ink">
              {form.mediaType === 'video' ? COPY.posterLabel : COPY.imageLabel}
            </span>
            <p className="mb-2 font-admin-body text-[12px] text-admin-slate-600">
              {form.mediaType === 'video' ? COPY.posterHelp : COPY.imageHelp}
            </p>
            <AdminPosterUpload
              value={form.imageUrl}
              onChange={(nextUrl) => setForm((previous) => ({ ...previous, imageUrl: nextUrl }))}
            />
            {form.imageUrl ? (
              <div className="mt-3 aspect-video max-h-[220px] w-full overflow-hidden rounded border border-admin-slate-200">
                <img src={form.imageUrl} alt="" className="h-full w-full object-cover" />
              </div>
            ) : null}
          </div>

          {form.mediaType === 'video' ? (
            <AdminExecutiveInput
              label={COPY.videoUrlLabel}
              required
              helperText={COPY.videoUrlHelp}
              value={form.videoUrl}
              onChange={set('videoUrl')}
            />
          ) : null}

          <AdminExecutiveInput label={COPY.titleLabel} required maxLength={120} value={form.title} onChange={set('title')} />
          <AdminExecutiveInput label={COPY.linkUrlLabel} helperText={COPY.linkUrlHelp} value={form.linkUrl} onChange={set('linkUrl')} />
          <AdminExecutiveTextarea
            label={COPY.descriptionLabel}
            maxLength={300}
            rows={3}
            value={form.description}
            onChange={set('description')}
          />
        </div>
      </AdminModal>

      {/* The live-edit confirmation. Painted instead of the form so the two
          never stack; cancelling returns to the form with everything typed. */}
      <AdminModal
        isOpen={isOpen && isLiveWarningOpen}
        title={COPY.liveEditTitle}
        confirmLabel={COPY.liveEditConfirm}
        cancelLabel={COPY.liveEditBack}
        tone="danger"
        isBusy={isSaving}
        onConfirm={save}
        onCancel={() => setIsLiveWarningOpen(false)}
      >
        <p className="font-admin-body text-[14px] leading-5 text-admin-slate-600">
          {COPY.liveEditBody(servingCampaigns.length)}
        </p>
        <ul className="mt-3 list-disc pl-5 font-admin-body text-[14px] text-admin-neutral-ink">
          {servingCampaigns.map((row) => (
            <li key={row.campaignId}>{row.campaignName}</li>
          ))}
        </ul>
        <p className="mt-3 font-admin-body text-[12px] text-admin-slate-600">{COPY.liveEditNote}</p>
      </AdminModal>
    </>
  );
}

export default AdminCreativeFormModal;

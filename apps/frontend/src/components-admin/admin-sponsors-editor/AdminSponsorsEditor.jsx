// AdminSponsorsEditor.jsx
// The sponsor logo slots on create-fest and edit-fest. Each slot reuses
// AdminPosterUpload for the image (same client-side type/size gate and the same
// POST /uploads path as the banner), plus an optional name and link. Capped at
// 20. Removal goes through AdminModal on the edit screen — the logo is already
// live on the participant-facing page by then.

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import AdminPosterUpload from '../admin-poster-upload/AdminPosterUpload.jsx';
import AdminExecutiveInput from '../admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveButton from '../admin-executive-button/AdminExecutiveButton.jsx';
import AdminModal from '../admin-modal/AdminModal.jsx';
import { ADMIN_SPONSORS_COPY as COPY } from '../../brand-admin/brand-copy.js';

const SPONSORS_MAX = 20;

function AdminSponsorsEditor({ sponsors, onChange, confirmRemoval = false }) {
  const [removalIndex, setRemovalIndex] = useState(null);

  function updateSponsor(sponsorIndex, changes) {
    onChange(
      sponsors.map((sponsor, index) =>
        index === sponsorIndex ? { ...sponsor, ...changes } : sponsor,
      ),
    );
  }

  function removeSponsor(sponsorIndex) {
    onChange(sponsors.filter((unused, index) => index !== sponsorIndex));
    setRemovalIndex(null);
  }

  function handleRemoveClick(sponsorIndex) {
    if (confirmRemoval) {
      setRemovalIndex(sponsorIndex);
    } else {
      removeSponsor(sponsorIndex);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink">
          {COPY.heading}
        </span>
        <p className="mt-0.5 font-admin-body text-[13px] leading-[18px] text-admin-slate-600">
          {COPY.intro}
        </p>
      </div>

      {sponsors.map((sponsor, index) => (
        <div key={index} className="rounded-md border border-admin-slate-200 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <AdminPosterUpload
                label={COPY.heading}
                value={sponsor.imageUrl ?? ''}
                onChange={(imageUrl) => updateSponsor(index, { imageUrl })}
              />
            </div>
            <button
              type="button"
              onClick={() => handleRemoveClick(index)}
              aria-label={COPY.removeSponsor}
              className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-admin-slate-600 transition-colors hover:bg-admin-status-error-red/10 hover:text-admin-status-error-red"
            >
              <Trash2 size={16} />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <AdminExecutiveInput
              label={COPY.sponsorNameLabel}
              maxLength={80}
              placeholder={COPY.sponsorNamePlaceholder}
              value={sponsor.sponsorName ?? ''}
              onChange={(event) => updateSponsor(index, { sponsorName: event.target.value })}
            />
            <AdminExecutiveInput
              label={COPY.linkUrlLabel}
              placeholder={COPY.linkUrlPlaceholder}
              value={sponsor.linkUrl ?? ''}
              onChange={(event) => updateSponsor(index, { linkUrl: event.target.value })}
            />
          </div>
          {/* imageUrl is the one required field — a slot without one is dropped
              on submit, so say so rather than failing silently at the backend. */}
          {!sponsor.imageUrl ? (
            <p className="mt-2 font-admin-body text-[13px] text-admin-status-warning-amber">
              {COPY.missingImage}
            </p>
          ) : null}
        </div>
      ))}

      {sponsors.length >= SPONSORS_MAX ? (
        <p className="font-admin-body text-[13px] text-admin-status-warning-amber">
          {COPY.limitReached}
        </p>
      ) : (
        <div>
          <AdminExecutiveButton
            variant="ghost"
            onClick={() => onChange([...sponsors, { imageUrl: '', sponsorName: '', linkUrl: '' }])}
          >
            {COPY.addSponsor}
          </AdminExecutiveButton>
        </div>
      )}

      <AdminModal
        isOpen={removalIndex !== null}
        title={COPY.removeModalTitle}
        confirmLabel={COPY.removeConfirm}
        cancelLabel={COPY.removeCancel}
        tone="danger"
        onConfirm={() => removeSponsor(removalIndex)}
        onCancel={() => setRemovalIndex(null)}
      >
        {COPY.removeModalBody}
      </AdminModal>
    </div>
  );
}

export default AdminSponsorsEditor;

// AdminPosterUpload.jsx
// The shared admin image-upload field (event poster, fest banner). Picks a
// jpg/png, validates type and size on the client, uploads it to POST /uploads
// (multipart field `file`), and reports back the absolute URL the backend
// returns — the caller binds it to posterImageUrl / bannerImageUrl.
//
// The type gate and size cap here are the fast, local first line so a file the
// server would refuse never leaves the browser. The cap MATCHES the server's own
// (5 MB, MAX_UPLOAD_BYTES in upload-controller) rather than undercutting it: at
// 2 MB this component refused perfectly valid 3–4 MB banners and certificate
// artwork that the API would have accepted, and the admin had no way to tell a
// real limit from a client-side one. A preview renders once the URL is in hand,
// with a remove affordance that clears the field.

import { useRef, useState } from 'react';
import { ImagePlus, X, Loader2 } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import { ADMIN_UPLOAD_COPY } from '../../brand-admin/brand-copy.js';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];
const MAX_BYTES = 5 * 1024 * 1024; // Same 5 MB the backend enforces — see above.

function AdminPosterUpload({ label, value, onChange }) {
  const inputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleFileSelected(changeEvent) {
    const file = changeEvent.target.files?.[0];
    // Reset the input so re-selecting the same file after a remove still fires.
    changeEvent.target.value = '';
    if (!file) {
      return;
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setErrorMessage(ADMIN_UPLOAD_COPY.typeError);
      return;
    }
    if (file.size > MAX_BYTES) {
      setErrorMessage(ADMIN_UPLOAD_COPY.sizeError);
      return;
    }

    setErrorMessage('');
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      // Override the client's default application/json so axios sets the multipart
      // boundary itself.
      const result = await apiClient.post('/uploads', formData, {
        headers: { 'Content-Type': undefined },
      });
      onChange?.(result.url);
    } catch (uploadError) {
      setErrorMessage(uploadError.message || ADMIN_UPLOAD_COPY.uploadError);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <span className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink">
          {label}
        </span>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        onChange={handleFileSelected}
        className="hidden"
      />

      {value ? (
        <div className="relative w-full max-w-[280px] overflow-hidden rounded-md border border-admin-slate-200 bg-admin-surface-off-white">
          {/* object-contain so the preview matches the participant's view: an
              admin who approves a cover-cropped preview would be approving a
              picture nobody actually sees. */}
          <img
            src={value}
            alt={ADMIN_UPLOAD_COPY.previewAlt}
            className="h-40 w-full bg-admin-surface-off-white object-contain"
          />
          <button
            type="button"
            aria-label={ADMIN_UPLOAD_COPY.remove}
            onClick={() => onChange?.(null)}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-admin-surface-white/90 text-admin-neutral-ink shadow-admin-modal transition-colors hover:bg-admin-surface-white"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className="flex h-40 w-full max-w-[280px] flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-admin-slate-200 bg-admin-surface-off-white text-admin-slate-600 transition-colors hover:border-admin-primary-blue hover:text-admin-primary-blue disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isUploading ? (
            <Loader2 size={22} className="animate-spin" />
          ) : (
            <>
              <ImagePlus size={22} strokeWidth={1.75} />
              <span className="font-admin-body text-[13px]">{ADMIN_UPLOAD_COPY.cta}</span>
              <span className="font-admin-body text-[12px] text-admin-slate-600/80">
                {ADMIN_UPLOAD_COPY.hint}
              </span>
            </>
          )}
        </button>
      )}

      {errorMessage ? (
        <p className="font-admin-body text-[13px] leading-[18px] text-admin-status-error-red">{errorMessage}</p>
      ) : null}
    </div>
  );
}

export default AdminPosterUpload;

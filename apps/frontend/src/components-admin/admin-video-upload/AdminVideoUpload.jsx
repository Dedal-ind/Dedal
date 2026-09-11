// AdminVideoUpload.jsx
// The admin video-upload field for promotion creatives. Picks an MP4, WebM or
// MOV, checks it locally, uploads it to POST /uploads (multipart field `file`)
// and hands back the absolute URL the backend returns.
//
// A SEPARATE COMPONENT FROM AdminPosterUpload, deliberately. That one is shared
// by the fest banner, the event poster and certificate artwork; widening it to
// take video would put a video field one prop away from three surfaces that
// must never accept one. This shares the endpoint, not the component.
//
// WHAT VIDEO NEEDS THAT AN IMAGE DOES NOT:
//   · A 50 MB cap, not 5 MB — matching MAX_VIDEO_UPLOAD_BYTES on the server
//     rather than undercutting it, so a file the API would accept is never
//     refused here with no way to tell a real limit from a client-side one.
//   · The size shown BEFORE upload. A 40 MB file on a venue's wifi is a
//     minutes-long wait, and an admin deciding whether to start it needs the
//     number, not a spinner that begins and says nothing.
//   · A real progress bar, for the same reason. axios reports upload progress;
//     an indeterminate spinner for four minutes is indistinguishable from a
//     hang.
//   · A PLAYING preview, not a thumbnail. The point of reviewing a promo clip
//     is watching it — muted, looping, inline, so approving it does not mean
//     opening it somewhere else.
//
// The extension must match the declared type, because the server enforces that
// too (assertExtensionMatchesDeclaredType): MP4 and MOV are the same container
// and magic bytes cannot tell them apart, so the filename is what decides.

import { useEffect, useRef, useState } from 'react';
import { Film, Loader2, X } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';

const ACCEPTED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const EXTENSION_BY_TYPE = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
};
/* 50 MB, the same ceiling MAX_VIDEO_UPLOAD_BYTES enforces server-side. */
const MAX_BYTES = 50 * 1024 * 1024;

const COPY = {
  cta: 'Drop a video here, or click to browse',
  hint: 'MP4, WebM or MOV · up to 50 MB',
  remove: 'Remove video',
  typeError: 'Choose an MP4, WebM or MOV file.',
  sizeError: 'That video is larger than 50 MB. Compress it and try again.',
  extensionError: (expected) => `That file must be named ${expected} to match its format.`,
  uploadError: 'The upload failed. Try again.',
  uploading: 'Uploading',
};

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function AdminVideoUpload({ label, value, onChange }) {
  const inputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [pendingSizeLabel, setPendingSizeLabel] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  /* A drag that ends outside the component still has to clear the highlight. */
  useEffect(() => {
    function clearDragging() {
      setIsDragging(false);
    }
    window.addEventListener('dragend', clearDragging);
    window.addEventListener('drop', clearDragging);
    return () => {
      window.removeEventListener('dragend', clearDragging);
      window.removeEventListener('drop', clearDragging);
    };
  }, []);

  async function uploadFile(file) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setErrorMessage(COPY.typeError);
      return;
    }
    /*
     * The size warning happens BEFORE a byte leaves the browser. Starting a
     * 60 MB upload only to have the server refuse it wastes the admin's time
     * and their data, and on a venue connection that is not a small cost.
     */
    if (file.size > MAX_BYTES) {
      setErrorMessage(COPY.sizeError);
      return;
    }
    const expected = EXTENSION_BY_TYPE[file.type];
    if (!file.name.toLowerCase().endsWith(expected)) {
      setErrorMessage(COPY.extensionError(expected));
      return;
    }

    setErrorMessage('');
    setPendingSizeLabel(formatBytes(file.size));
    setProgressPercent(0);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const result = await apiClient.post('/uploads', formData, {
        // Cleared so axios sets the multipart boundary itself.
        headers: { 'Content-Type': undefined },
        onUploadProgress: (progressEvent) => {
          if (!progressEvent.total) {
            return;
          }
          setProgressPercent(Math.round((progressEvent.loaded / progressEvent.total) * 100));
        },
      });
      onChange?.(result.url);
    } catch (uploadError) {
      setErrorMessage(uploadError.message || COPY.uploadError);
    } finally {
      setIsUploading(false);
      setPendingSizeLabel('');
    }
  }

  function handleFileSelected(changeEvent) {
    const file = changeEvent.target.files?.[0];
    // Reset so re-selecting the same file after a remove still fires.
    changeEvent.target.value = '';
    if (file) {
      uploadFile(file);
    }
  }

  function handleDrop(dropEvent) {
    dropEvent.preventDefault();
    setIsDragging(false);
    const file = dropEvent.dataTransfer?.files?.[0];
    if (file) {
      uploadFile(file);
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
        accept="video/mp4,video/webm,video/quicktime"
        onChange={handleFileSelected}
        className="hidden"
      />

      {value ? (
        <div className="relative w-full max-w-[280px] overflow-hidden rounded-md border border-admin-slate-200 bg-admin-neutral-ink">
          {/*
            Muted, looping, inline and with controls: this is a review surface,
            not the participant's feed. An admin approving a clip should be able
            to scrub it.
          */}
          <video
            src={value}
            className="h-40 w-full bg-admin-neutral-ink object-contain"
            muted
            loop
            playsInline
            autoPlay
            controls
          />
          <button
            type="button"
            aria-label={COPY.remove}
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
          onDragOver={(dragEvent) => {
            dragEvent.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          disabled={isUploading}
          className={[
            'flex h-40 w-full max-w-[280px] flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed bg-admin-surface-off-white text-admin-slate-600 transition-colors disabled:cursor-not-allowed',
            isDragging
              ? 'border-admin-primary-blue text-admin-primary-blue'
              : 'border-admin-slate-200 hover:border-admin-primary-blue hover:text-admin-primary-blue',
          ].join(' ')}
        >
          {isUploading ? (
            <>
              <Loader2 size={22} className="animate-spin" />
              <span className="font-admin-body text-[13px]">
                {COPY.uploading} {pendingSizeLabel} · {progressPercent}%
              </span>
              {/* scaleX on a transform only — the bar never triggers layout. */}
              <span className="h-1 w-3/4 overflow-hidden rounded-full bg-admin-slate-200">
                <span
                  className="block h-full origin-left rounded-full bg-admin-primary-blue transition-transform duration-200"
                  style={{ transform: `scaleX(${progressPercent / 100})` }}
                />
              </span>
            </>
          ) : (
            <>
              <Film size={22} strokeWidth={1.75} />
              <span className="font-admin-body text-[13px]">{COPY.cta}</span>
              <span className="font-admin-body text-[12px] text-admin-slate-600/80">
                {COPY.hint}
              </span>
            </>
          )}
        </button>
      )}

      {errorMessage ? (
        <p className="font-admin-body text-[13px] leading-[18px] text-admin-status-error-red">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

export default AdminVideoUpload;

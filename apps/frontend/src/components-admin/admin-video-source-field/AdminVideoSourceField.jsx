// AdminVideoSourceField.jsx
// The video input for a promotion or a creative: EITHER upload a file OR paste a
// YouTube / Vimeo link, with a preview for each.
//
// ONE FIELD FOR BOTH ADMIN FORMS. The creative form offered upload only, so a
// YouTube link had nowhere to go; the older promotions form offered a free-text
// URL box, so a YouTube link went in and reached participants as <video src>,
// which cannot play it. Both forms now render this, and both paths end in the
// same videoUrl field the backend already stores.
//
// THE MODE FOLLOWS THE SAVED VALUE UNTIL THE ADMIN TOUCHES THE FIELD, then it is
// theirs. Both forms load their record in an effect after the modal opens, so on
// the first render the value is still the previous one; a mode seeded once from
// that would open a YouTube creative on Upload. So until any interaction the mode
// is derived from the value, and the first toggle, keystroke or upload pins it.
// Pinning matters because a half-typed link ("https://ww") parses as a valid
// direct URL — deriving the mode from the text while typing would flip the field
// back to Upload mid-keystroke.
//
// Whether a URL is a direct file or a YouTube / Vimeo link is decided by describeVideoSource in
// @dedal/shared — the same function the backend validator and the participant
// renderers use — so this field cannot accept a link the save will refuse.

import { useState } from 'react';
import { Play } from 'lucide-react';
import { VIDEO_SOURCE_KINDS, describeVideoSource, isLinkedVideoSource } from '@dedal/shared';
import { useVideoThumbnail } from '../../hooks/use-video-thumbnail/use-video-thumbnail.js';
import { isMissingYouTubeThumbnail } from '../../helpers/video-thumbnail.js';
import AdminSegmentedToggle from '../admin-segmented-toggle/AdminSegmentedToggle.jsx';
import AdminVideoUpload from '../admin-video-upload/AdminVideoUpload.jsx';
import AdminExecutiveInput from '../admin-executive-input/AdminExecutiveInput.jsx';

const MODES = {
  UPLOAD: 'upload',
  LINK: 'link',
};

const COPY = {
  modeName: 'Video source',
  upload: 'Upload file',
  link: 'YouTube or Vimeo link',
  linkPlaceholder: 'https://www.youtube.com/watch?v=…',
  linkHelp:
    'Paste the address of the video itself. Participants see its thumbnail; a tap opens the promotion’s link, or the video if there is none.',
  linkInvalid: 'That isn’t a YouTube or Vimeo video link. Paste the address of the video itself.',
  previewOn: (providerName) => `Preview on ${providerName}`,
  vimeoPosterNote:
    'Vimeo doesn’t provide a thumbnail, so the poster frame is what participants see.',
};

function modeFor(value) {
  return isLinkedVideoSource(describeVideoSource(value)) ? MODES.LINK : MODES.UPLOAD;
}

function AdminVideoSourceField({ label, value, onChange }) {
  /* null = not yet chosen by the admin, so the mode tracks the value. */
  const [pinnedMode, setPinnedMode] = useState(null);
  const mode = pinnedMode ?? modeFor(value);
  const source = describeVideoSource(value);
  const isLinkedVideo = isLinkedVideoSource(source);
  /* The same image the participant card shows for this video — maxres, then
     hq — so what the admin approves is what participants see. */
  const thumbnail = useVideoThumbnail(isLinkedVideo ? source : null, null);

  function handleModeChange(nextMode) {
    if (nextMode === mode) {
      setPinnedMode(nextMode);
      return;
    }
    setPinnedMode(nextMode);
    /* A file URL is not a link and a link is not a file — switching clears the
       value rather than carrying one into the other path. */
    onChange?.('');
  }

  const linkProblem = mode === MODES.LINK && value && !isLinkedVideo ? COPY.linkInvalid : '';

  return (
    <div className="flex flex-col gap-2">
      {label ? (
        <span className="font-admin-body text-[13px] font-medium leading-[18px] text-admin-neutral-ink">
          {label}
        </span>
      ) : null}

      <AdminSegmentedToggle
        name={COPY.modeName}
        value={mode}
        onChange={handleModeChange}
        options={[
          { value: MODES.UPLOAD, label: COPY.upload },
          { value: MODES.LINK, label: COPY.link },
        ]}
      />

      {mode === MODES.UPLOAD ? (
        <AdminVideoUpload
          /* Only a direct file previews here; a YouTube / Vimeo link would render
             as a broken <video>. */
          value={source?.kind === VIDEO_SOURCE_KINDS.DIRECT ? value : ''}
          onChange={(nextUrl) => {
            setPinnedMode(MODES.UPLOAD);
            onChange?.(nextUrl ?? '');
          }}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <AdminExecutiveInput
            type="url"
            inputMode="url"
            placeholder={COPY.linkPlaceholder}
            helperText={linkProblem ? undefined : COPY.linkHelp}
            errorMessage={linkProblem || undefined}
            value={value}
            onChange={(changeEvent) => {
              setPinnedMode(MODES.LINK);
              onChange?.(changeEvent.target.value);
            }}
          />

          {isLinkedVideo ? (
            <div className="flex max-w-[280px] flex-col gap-1.5">
              <div className="relative aspect-video overflow-hidden rounded-md border border-admin-slate-200 bg-admin-neutral-ink">
                {thumbnail.hasFailed ? null : (
                  <img
                    src={thumbnail.src ?? undefined}
                    alt=""
                    className="h-full w-full object-cover"
                    onLoad={(loadEvent) => {
                      if (isMissingYouTubeThumbnail(thumbnail.src, loadEvent.currentTarget.naturalWidth)) {
                        thumbnail.advance();
                      }
                    }}
                    onError={thumbnail.advance}
                  />
                )}
                {/* Our play mark, the same one participants see — not YouTube's. */}
                <span className="absolute inset-0 m-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/80 pl-0.5 text-admin-neutral-ink">
                  <Play size={20} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                </span>
              </div>
              {/* The URL as saved, so the admin can check it is the right video. */}
              <p className="break-all font-admin-mono text-[12px] leading-[16px] text-admin-slate-600">
                {value}
              </p>
              <a
                href={source.watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="self-start font-admin-body text-[13px] font-medium text-admin-primary-blue hover:underline"
              >
                {COPY.previewOn(source.kind === VIDEO_SOURCE_KINDS.YOUTUBE ? 'YouTube' : 'Vimeo')}
              </a>
              {source.kind === VIDEO_SOURCE_KINDS.VIMEO ? (
                <p className="font-admin-body text-[12px] leading-[16px] text-admin-slate-600">
                  {COPY.vimeoPosterNote}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default AdminVideoSourceField;

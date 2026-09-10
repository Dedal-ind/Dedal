// AdminPromotionsScreen.jsx
// Route: /admin/system/promotions — platform admin only.
// The home-screen banners every participant sees. Promotions are platform-wide,
// never fest-scoped, which is why this lives under SYSTEM and not under a fest.
//
// TWO TYPES, two tabs. Commercial promotions (sponsor banners, merch, paid ads)
// and college events (fests a college asked us to promote) render as two
// separate carousels in the participant app, each with its own order and its own
// cap of twenty published. So the console keeps them apart too: a tab is not a
// filter over one list, it IS the list — creating from a tab creates that type,
// and reordering inside a tab never touches the other.
//
// Ordering is UP/DOWN arrow buttons, deliberately not drag-and-drop: a list of
// twenty is short enough that arrows are faster, and they are keyboard- and
// screen-reader-usable without the WCAG 2.5.7 single-pointer alternative that
// dragging would oblige.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Megaphone, ArrowUp, ArrowDown, AlertTriangle, RotateCw } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveInput from '../../components-admin/admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveTextarea from '../../components-admin/admin-executive-textarea/AdminExecutiveTextarea.jsx';
import AdminStatusPill from '../../components-admin/admin-status-pill/AdminStatusPill.jsx';
import AdminPosterUpload from '../../components-admin/admin-poster-upload/AdminPosterUpload.jsx';
import AdminModal from '../../components-admin/admin-modal/AdminModal.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import AdminSegmentedToggle from '../../components-admin/admin-segmented-toggle/AdminSegmentedToggle.jsx';
import { ADMIN_PROMOTIONS_COPY as COPY } from '../../brand-admin/brand-copy.js';

const PROMOTION_TYPES = { COMMERCIAL: 'commercial', COLLEGE_EVENT: 'collegeEvent' };

const EMPTY_FORM = {
  title: '',
  mediaType: 'image',
  imageUrl: '',
  videoUrl: '',
  linkUrl: '',
  description: '',
  collegeName: '',
};

/*
 * Strings this screen added. brand-copy's ADMIN_PROMOTIONS_COPY is shared with
 * other surfaces and is left alone.
 */
const LOCAL_COPY = {
  loading: 'Loading promotions…',
  retry: 'Try again',
  loadFailedFallback: 'The promotions could not be loaded.',
  discardTitle: 'Discard unsaved changes?',
  discardBody:
    'This promotion has not been saved. Closing now discards the title, artwork and everything else you have entered.',
  discardConfirm: 'Discard',
  discardCancel: 'Keep editing',
};

// Accepts http(s) only; anything else is a typo or an attempt at a javascript: URL.
function isAcceptableLinkUrl(candidateUrl) {
  return /^https?:\/\/\S+$/i.test(candidateUrl.trim());
}

function AdminPromotionsScreen() {
  const [promotions, setPromotions] = useState([]);
  const [status, setStatus] = useState('loading');
  /*
   * The REASON the load failed, kept rather than thrown away. A bare catch that
   * only flipped status to 'error' meant a 403 from the platform-admin gate and
   * a 500 from the database looked identical on screen — "could not load" and
   * nothing else — so there was no way to tell a permissions problem from an
   * outage without opening the network tab.
   */
  const [loadErrorMessage, setLoadErrorMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');

  // The visible tab, and therefore the type every action on this screen means.
  const [activeType, setActiveType] = useState(PROMOTION_TYPES.COMMERCIAL);
  const isCollegeEventTab = activeType === PROMOTION_TYPES.COLLEGE_EVENT;

  // The create/edit form. editingId null = creating.
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  /*
   * The type the OPEN form is for. Held separately from activeType so that
   * editing a row is always about that row's own type, and so switching tabs
   * behind an open modal cannot change what is being saved.
   */
  const [formType, setFormType] = useState(PROMOTION_TYPES.COMMERCIAL);
  const isCollegeEventForm = formType === PROMOTION_TYPES.COLLEGE_EVENT;

  // { kind: 'archive' | 'delete', promotion }
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);

  /*
   * Guards the close. The dialog is a FORM — a backdrop click or an Escape used
   * to throw away a filled-in title and an uploaded banner with no warning and
   * no undo, which is the one interaction on this screen that can lose real
   * work. Only raised when something has actually been typed or uploaded: a
   * prompt on an untouched form is the kind of friction that trains people to
   * dismiss prompts without reading them.
   */
  const [isDiscardPromptOpen, setIsDiscardPromptOpen] = useState(false);

  const loadPromotions = useCallback(async () => {
    setStatus('loading');
    setLoadErrorMessage('');
    try {
      const result = await apiClient.get('/promotions');
      setPromotions(Array.isArray(result?.promotions) ? result.promotions : []);
      setStatus('ready');
    } catch (loadError) {
      // apiClient normalises the backend envelope to { code, message, details },
      // so `message` is the server's own sentence when there is one.
      setLoadErrorMessage(loadError?.message || LOCAL_COPY.loadFailedFallback);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPromotions();
  }, [loadPromotions]);

  // Everything below this line works on the visible tab's type only.
  const visiblePromotions = useMemo(
    () => promotions.filter((promotion) => promotion.promotionType === activeType),
    [promotions, activeType],
  );

  /*
   * Reordering swaps a published promotion with its neighbour and submits the
   * whole published order FOR THIS TYPE, so the server's displayOrder is a clean
   * 0..n-1 sequence per type rather than a set of drifting numbers. Mixing types
   * in one submission is refused by the server with PROMOTION_TYPE_MISMATCH.
   */
  const publishedPromotions = visiblePromotions.filter(
    (promotion) => promotion.status === 'published',
  );

  function switchTab(nextType) {
    setActiveType(nextType);
    setActionError('');
    setNotice('');
  }

  function openCreateForm() {
    setEditingId(null);
    // The tab decides the type — there is no type picker in the modal, because
    // the admin already answered that question by choosing a tab.
    setFormType(activeType);
    setForm(EMPTY_FORM);
    setFormError('');
    setIsFormOpen(true);
  }

  /*
   * "Touched" means the form differs from the state it opened in — so an edit
   * dialog is clean until something is actually changed, not dirty from the
   * moment it loads the row it is editing.
   */
  const isFormDirty = useMemo(() => {
    const baseline = editingId
      ? (promotions.find((promotion) => promotion.id === editingId) ?? null)
      : null;
    if (!baseline) {
      return Object.values(form).some((fieldValue) => fieldValue.trim() !== '');
    }
    return (
      form.title !== (baseline.title ?? '') ||
      form.mediaType !== (baseline.mediaType ?? 'image') ||
      form.imageUrl !== (baseline.imageUrl ?? '') ||
      form.videoUrl !== (baseline.videoUrl ?? '') ||
      form.linkUrl !== (baseline.linkUrl ?? '') ||
      form.description !== (baseline.description ?? '') ||
      form.collegeName !== (baseline.collegeName ?? '')
    );
  }, [form, editingId, promotions]);

  /* Every route out of the form dialog goes through here: the Cancel button,
   * Escape, and a backdrop click all land on the same guard. */
  function requestCloseForm() {
    if (isSaving) {
      return;
    }
    if (isFormDirty) {
      setIsDiscardPromptOpen(true);
      return;
    }
    setIsFormOpen(false);
  }

  function discardAndCloseForm() {
    setIsDiscardPromptOpen(false);
    setIsFormOpen(false);
    setForm(EMPTY_FORM);
    setFormError('');
  }

  function openEditForm(promotion) {
    setEditingId(promotion.id);
    setFormType(promotion.promotionType);
    setForm({
      title: promotion.title ?? '',
      mediaType: promotion.mediaType ?? 'image',
      imageUrl: promotion.imageUrl ?? '',
      videoUrl: promotion.videoUrl ?? '',
      linkUrl: promotion.linkUrl ?? '',
      description: promotion.description ?? '',
      collegeName: promotion.collegeName ?? '',
    });
    setFormError('');
    setIsFormOpen(true);
  }

  /* Save creates or updates; shouldPublish chains the publish transition. */
  async function handleSave(shouldPublish) {
    if (!form.title.trim()) {
      setFormError(COPY.titleRequired);
      return;
    }
    /*
     * A video promotion is validated on its video, not its poster: the poster is
     * a nicety, the video is the promotion. An image promotion still needs its
     * image, exactly as before.
     */
    if (form.mediaType === 'video') {
      if (!form.videoUrl.trim()) {
        setFormError(COPY.videoRequired);
        return;
      }
    } else if (!form.imageUrl) {
      setFormError(COPY.imageRequired);
      return;
    }
    // Required for a college event, meaningless for a commercial banner.
    if (isCollegeEventForm && !form.collegeName.trim()) {
      setFormError(COPY.collegeNameRequired);
      return;
    }
    if (form.linkUrl.trim() && !isAcceptableLinkUrl(form.linkUrl)) {
      setFormError(COPY.linkInvalid);
      return;
    }

    setIsSaving(true);
    setActionError('');
    setFormError('');
    try {
      const payload = {
        title: form.title.trim(),
        promotionType: formType,
        mediaType: form.mediaType,
        // The poster still travels with a video promotion — it is what the
        // carousel shows before playback starts.
        imageUrl: form.imageUrl || null,
        videoUrl: form.mediaType === 'video' ? form.videoUrl.trim() : null,
        linkUrl: form.linkUrl.trim() || null,
        description: form.description.trim() || null,
        // Sent only for the type it means something for; the server drops it
        // from a commercial promotion regardless.
        collegeName: isCollegeEventForm ? form.collegeName.trim() : null,
      };
      const saved = editingId
        ? await apiClient.patch(`/promotions/${editingId}`, payload)
        : await apiClient.post('/promotions', payload);
      if (shouldPublish) {
        await apiClient.post(`/promotions/${saved.id}/publish`);
      }
      setIsFormOpen(false);
      setForm(EMPTY_FORM);
      setNotice(shouldPublish ? COPY.publishedNotice : COPY.savedNotice);
      await loadPromotions();
    } catch (saveError) {
      setFormError(saveError.message || COPY.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function runAction(path, successNotice) {
    setActionError('');
    setNotice('');
    try {
      await apiClient.post(path);
      setNotice(successNotice);
      await loadPromotions();
    } catch (error) {
      setActionError(error.message || COPY.actionFailed);
    }
  }

  async function confirmDestructiveAction() {
    if (!confirmTarget) {
      return;
    }
    setIsConfirming(true);
    setActionError('');
    try {
      if (confirmTarget.kind === 'archive') {
        await apiClient.post(`/promotions/${confirmTarget.promotion.id}/archive`);
        setNotice(COPY.archivedNotice);
      } else {
        await apiClient.delete(`/promotions/${confirmTarget.promotion.id}`);
        setNotice(COPY.deletedNotice);
      }
      setConfirmTarget(null);
      await loadPromotions();
    } catch (error) {
      setActionError(error.message || COPY.actionFailed);
      setConfirmTarget(null);
    } finally {
      setIsConfirming(false);
    }
  }

  async function movePromotion(promotionId, direction) {
    const currentIndex = publishedPromotions.findIndex((promotion) => promotion.id === promotionId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= publishedPromotions.length) {
      return;
    }
    const reordered = [...publishedPromotions];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
    setActionError('');
    try {
      await apiClient.post('/promotions/reorder', {
        promotionType: activeType,
        orderedPromotionIds: reordered.map((promotion) => promotion.id),
      });
      await loadPromotions();
    } catch (error) {
      setActionError(error.message || COPY.actionFailed);
    }
  }

  /*
   * The load has its own state on screen. Without this branch the page fell
   * straight through to the list and rendered the EMPTY state while the request
   * was still in flight — so every visit began by announcing "no promotions
   * yet", then flipped to the real list. A page that says the wrong thing first
   * reads as broken even when it is working.
   */
  if (status === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-[50vh] flex-col items-center justify-center gap-3"
      >
        <span
          aria-hidden="true"
          className="h-6 w-6 animate-spin rounded-full border-2 border-admin-slate-200 border-t-admin-primary-blue"
        />
        <span className="font-admin-body text-[14px] text-admin-slate-600">
          {LOCAL_COPY.loading}
        </span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <AdminExecutiveCard>
        <div className="flex flex-col items-start gap-3 py-6">
          <p className="flex items-start gap-2 font-admin-body text-[14px] text-admin-neutral-ink">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-admin-status-error-red" />
            {/* The server's own sentence, not a generic stand-in — a 403 from
                the platform-admin gate and a 500 read differently here now. */}
            {loadErrorMessage || COPY.loadFailed}
          </p>
          <AdminExecutiveButton
            variant="secondary"
            iconLeft={<RotateCw size={15} />}
            onClick={loadPromotions}
          >
            {LOCAL_COPY.retry}
          </AdminExecutiveButton>
        </div>
      </AdminExecutiveCard>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1000px] flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="mt-1 font-admin-body text-[14px] leading-5 text-admin-slate-600">
            {COPY.intro}
          </p>
        </div>
        <AdminExecutiveButton
          variant="primary"
          iconLeft={<Megaphone size={15} />}
          onClick={openCreateForm}
        >
          {COPY.createButton}
        </AdminExecutiveButton>
      </div>

      {/* The two types. A radiogroup under the hood, so arrow keys move between
          them and a screen reader announces which list is showing. */}
      <AdminSegmentedToggle
        label={COPY.tabsLabel}
        name="promotionType"
        value={activeType}
        onChange={switchTab}
        options={[
          { value: PROMOTION_TYPES.COMMERCIAL, label: COPY.tabCommercial },
          { value: PROMOTION_TYPES.COLLEGE_EVENT, label: COPY.tabCollegeEvents },
        ]}
      />

      <AdminErrorBanner message={actionError} />
      {notice ? (
        <div
          role="status"
          className="rounded-md border border-admin-status-success-green/30 bg-admin-status-success-green/5 px-4 py-3 font-admin-body text-[14px] leading-5 text-admin-status-success-green"
        >
          {notice}
        </div>
      ) : null}

      <AdminExecutiveCard>
        {visiblePromotions.length === 0 ? (
          <p className="py-6 font-admin-body text-[14px] text-admin-slate-600">
            {isCollegeEventTab ? COPY.emptyCollegeEvents : COPY.emptyCommercial}
          </p>
        ) : (
          <ul className="divide-y divide-admin-slate-200">
            {visiblePromotions.map((promotion) => {
              const publishedIndex = publishedPromotions.findIndex(
                (candidate) => candidate.id === promotion.id,
              );
              const isPublished = promotion.status === 'published';
              return (
                <li key={promotion.id} className="flex items-center gap-4 py-3">
                  <div className="h-12 w-20 shrink-0 overflow-hidden rounded border border-admin-slate-200 bg-admin-surface-off-white">
                    {promotion.imageUrl ? (
                      <img
                        src={promotion.imageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(errorEvent) => {
                          errorEvent.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate font-admin-body text-[14px] font-medium text-admin-neutral-ink">
                      {promotion.title}
                    </p>
                    <p className="truncate font-admin-mono text-[12px] text-admin-slate-600">
                      {isPublished ? COPY.orderLabel(publishedIndex + 1) : ''}
                      {promotion.linkUrl ? ` · ${promotion.linkUrl}` : ` · ${COPY.noLink}`}
                    </p>
                  </div>

                  {/* Whose event this is — the college-events tab only, where it
                      is the column that tells two rows apart. */}
                  {isCollegeEventTab ? (
                    <span className="hidden w-40 shrink-0 truncate font-admin-body text-[13px] text-admin-slate-600 sm:block">
                      {promotion.collegeName || COPY.noCollege}
                    </span>
                  ) : null}

                  <span className="hidden shrink-0 font-admin-mono text-[12px] text-admin-slate-600 md:block">
                    {new Date(promotion.createdAt).toLocaleDateString()}
                  </span>

                  <AdminStatusPill status={promotion.status} />

                  {/* Reorder: published only, and disabled at the ends. */}
                  {isPublished ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={COPY.moveUp}
                        disabled={publishedIndex === 0}
                        onClick={() => movePromotion(promotion.id, -1)}
                        className="flex h-8 w-8 items-center justify-center rounded border border-admin-slate-200 text-admin-neutral-ink disabled:opacity-30"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={COPY.moveDown}
                        disabled={publishedIndex === publishedPromotions.length - 1}
                        onClick={() => movePromotion(promotion.id, 1)}
                        className="flex h-8 w-8 items-center justify-center rounded border border-admin-slate-200 text-admin-neutral-ink disabled:opacity-30"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </span>
                  ) : null}

                  <span className="flex shrink-0 items-center gap-2">
                    {promotion.status !== 'archived' ? (
                      <AdminExecutiveButton variant="ghost" size="small" onClick={() => openEditForm(promotion)}>
                        {COPY.editAction}
                      </AdminExecutiveButton>
                    ) : null}
                    {promotion.status !== 'published' ? (
                      <AdminExecutiveButton
                        variant="secondary"
                        size="small"
                        onClick={() => runAction(`/promotions/${promotion.id}/publish`, COPY.publishedNotice)}
                      >
                        {COPY.publishAction}
                      </AdminExecutiveButton>
                    ) : null}
                    {isPublished ? (
                      <AdminExecutiveButton
                        variant="ghost"
                        size="small"
                        onClick={() => setConfirmTarget({ kind: 'archive', promotion })}
                      >
                        {COPY.archiveAction}
                      </AdminExecutiveButton>
                    ) : null}
                    {/* Delete is ABSENT — not disabled — unless this is a draft. */}
                    {promotion.status === 'draft' ? (
                      <AdminExecutiveButton
                        variant="ghost"
                        size="small"
                        className="text-admin-status-error-red hover:bg-admin-status-error-red/5"
                        onClick={() => setConfirmTarget({ kind: 'delete', promotion })}
                      >
                        {COPY.deleteAction}
                      </AdminExecutiveButton>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </AdminExecutiveCard>

      {/* Create / edit */}
      {/*
        * Both ways to commit now live in the FOOTER, in one hierarchy: publish is
        * the filled primary (it is what the admin came to do), save-as-draft is
        * the outlined secondary, cancel is the ghost. Previously "Save and
        * publish" was a full-width primary inside the body while "Save draft" was
        * a primary in the footer — two blue buttons of different widths in
        * different places, with no way to tell which one was the main action.
        */}
      <AdminModal
        isOpen={isFormOpen}
        title={editingId ? COPY.editModalTitle : COPY.createModalTitle}
        confirmLabel={COPY.saveAndPublish}
        cancelLabel={COPY.cancel}
        isBusy={isSaving}
        secondaryAction={{ label: COPY.saveDraft, onClick: () => handleSave(false) }}
        onConfirm={() => handleSave(true)}
        onCancel={requestCloseForm}
      >
        <div className="flex flex-col gap-4">
          <AdminExecutiveInput
            label={COPY.titleLabel}
            required
            maxLength={120}
            value={form.title}
            onChange={(changeEvent) => setForm((previous) => ({ ...previous, title: changeEvent.target.value }))}
          />

          {/* College events only. HIDDEN, not disabled, on the commercial form:
              a commercial banner has no promoting college at all, and a greyed
              field would suggest one could be filled in. */}
          {isCollegeEventForm ? (
            <AdminExecutiveInput
              label={COPY.collegeNameLabel}
              required
              maxLength={100}
              helperText={COPY.collegeNameHelp}
              value={form.collegeName}
              onChange={(changeEvent) =>
                setForm((previous) => ({ ...previous, collegeName: changeEvent.target.value }))
              }
            />
          ) : null}

          {/* Which medium this slide plays. One or the other — the fields below
              swap rather than stacking, so an admin cannot half-fill both and
              leave the carousel to guess. */}
          <div>
            <span className="font-admin-body text-[13px] font-medium text-admin-neutral-ink">
              {COPY.mediaTypeLabel}
            </span>
            <div className="mt-2 flex items-center gap-2">
              {[
                { value: 'image', label: COPY.mediaTypeImage },
                { value: 'video', label: COPY.mediaTypeVideo },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setForm((previous) => ({ ...previous, mediaType: option.value }))}
                  aria-pressed={form.mediaType === option.value}
                  className={[
                    'rounded-md border px-3 py-1.5 font-admin-body text-[13px] font-medium transition-colors',
                    form.mediaType === option.value
                      ? 'border-admin-primary-blue bg-admin-primary-blue text-admin-surface-white'
                      : 'border-admin-slate-200 text-admin-slate-600 hover:text-admin-neutral-ink',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {form.mediaType === 'video' ? (
            <div>
              <AdminExecutiveInput
                label={COPY.videoUrlLabel}
                placeholder="https://youtube.com/watch?v=… or https://…/clip.mp4"
                helperText={COPY.videoUrlHelp}
                value={form.videoUrl}
                onChange={(changeEvent) =>
                  setForm((previous) => ({ ...previous, videoUrl: changeEvent.target.value }))
                }
              />
              {/* The poster is optional but strongly wanted: without it the slide
                  is a black rectangle until the video buffers. */}
              <span className="mt-4 block font-admin-body text-[13px] font-medium text-admin-neutral-ink">
                {COPY.videoPosterLabel}
              </span>
              <p className="mb-2 font-admin-body text-[12px] text-admin-slate-600">
                {COPY.videoPosterHelp}
              </p>
              <AdminPosterUpload
                value={form.imageUrl}
                onChange={(nextUrl) => setForm((previous) => ({ ...previous, imageUrl: nextUrl }))}
              />
            </div>
          ) : (
          <div>
            {/* The label is rendered ONCE, by this block, so it can sit above the
                help text in reading order. AdminPosterUpload is therefore given
                no `label` — passing one printed "Banner image" twice, stacked. */}
            <span className="font-admin-body text-[13px] font-medium text-admin-neutral-ink">
              {COPY.imageLabel}
            </span>
            <p className="mb-2 font-admin-body text-[12px] text-admin-slate-600">{COPY.imageHelp}</p>
            <AdminPosterUpload
              value={form.imageUrl}
              onChange={(nextUrl) => setForm((previous) => ({ ...previous, imageUrl: nextUrl }))}
            />
            {/* Shown at the carousel's own ratio, so what the admin approves is
                what a participant sees. */}
            {form.imageUrl ? (
              <div className="mt-3 aspect-video max-h-[220px] w-full overflow-hidden rounded border border-admin-slate-200">
                <img src={form.imageUrl} alt="" className="h-full w-full object-cover" />
              </div>
            ) : null}
          </div>
          )}

          <AdminExecutiveInput
            label={COPY.linkLabel}
            placeholder="https://example.com"
            helperText={COPY.linkHelp}
            value={form.linkUrl}
            onChange={(changeEvent) => setForm((previous) => ({ ...previous, linkUrl: changeEvent.target.value }))}
          />

          <AdminExecutiveTextarea
            label={COPY.descriptionLabel}
            maxLength={300}
            rows={2}
            helperText={COPY.descriptionHelp}
            value={form.description}
            onChange={(changeEvent) =>
              setForm((previous) => ({ ...previous, description: changeEvent.target.value }))
            }
          />

          {formError ? (
            <p className="flex items-start gap-1.5 font-admin-body text-[13px] text-admin-status-error-red">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {formError}
            </p>
          ) : null}
        </div>
      </AdminModal>

      {/* Raised only when the form has been touched — see isFormDirty. Rendered
          after the form dialog so it paints above it. */}
      <AdminModal
        isOpen={isDiscardPromptOpen}
        title={LOCAL_COPY.discardTitle}
        confirmLabel={LOCAL_COPY.discardConfirm}
        cancelLabel={LOCAL_COPY.discardCancel}
        tone="danger"
        onConfirm={discardAndCloseForm}
        onCancel={() => setIsDiscardPromptOpen(false)}
      >
        {LOCAL_COPY.discardBody}
      </AdminModal>

      <AdminModal
        isOpen={Boolean(confirmTarget)}
        title={confirmTarget?.kind === 'archive' ? COPY.archiveModalTitle : COPY.deleteModalTitle}
        confirmLabel={confirmTarget?.kind === 'archive' ? COPY.archiveAction : COPY.deleteAction}
        cancelLabel={COPY.cancel}
        tone="danger"
        isBusy={isConfirming}
        onConfirm={confirmDestructiveAction}
        onCancel={() => (isConfirming ? null : setConfirmTarget(null))}
      >
        {confirmTarget?.kind === 'archive' ? COPY.archiveModalBody : COPY.deleteModalBody}
      </AdminModal>
    </div>
  );
}

export default AdminPromotionsScreen;

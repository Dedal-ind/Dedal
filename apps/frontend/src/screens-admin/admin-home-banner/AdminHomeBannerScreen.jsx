// AdminHomeBannerScreen.jsx
// Route: /admin/system/home-banner — platform admin only.
//
// WHAT THE BIG BANNER ON DISCOVER SHOWS. Two modes:
//   Automatic — the app's own rule: a live fest, else the next fest, else a
//               promotion.
//   Curated   — exactly the slides listed here, up to five, any mix of fests and
//               promotions, rotating in this order.
//
// Only a published fest that has not ended, or a published promotion, can be
// added — the server refuses anything else. A slide that later ends or is
// unpublished stays in this list marked "Not showing" and drops out of the
// public banner on its own; if every slide drops out, participants get
// Automatic.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, GalleryHorizontal, Plus, RotateCw, Trash2 } from 'lucide-react';
import apiClient from '../../api-client/api-client.js';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveSelect from '../../components-admin/admin-executive-select/AdminExecutiveSelect.jsx';
import AdminSegmentedToggle from '../../components-admin/admin-segmented-toggle/AdminSegmentedToggle.jsx';
import AdminExecutiveChip from '../../components-admin/admin-executive-chip/AdminExecutiveChip.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';

const MODES = { AUTOMATIC: 'automatic', CURATED: 'curated' };
const KIND_LABEL = { fest: 'Fest', promotion: 'Promotion' };

const COPY = {
  title: 'Home banner',
  lede: 'Choose what the big banner at the top of Discover shows.',
  modeLabel: 'Banner mode',
  automatic: 'Automatic',
  curated: 'Curated',
  automaticHelp:
    'The app decides: a fest that is live now, otherwise the next fest to start, otherwise a promotion.',
  curatedHelp: (maximum) =>
    `Up to ${maximum} slides — any mix of fests and promotions. They rotate in this order.`,
  slidesTitle: 'Slides',
  noSlides: 'No slides yet. Add a fest or a promotion below.',
  addFest: 'Add a fest',
  addPromotion: 'Add a promotion',
  chooseFest: 'Choose a published fest',
  choosePromotion: 'Choose a published promotion',
  add: 'Add',
  full: (maximum) => `The banner is full (${maximum} slides). Remove one to add another.`,
  notShowing: 'Not showing',
  notShowingHelp: 'Unpublished or ended — hidden from participants until it is live again.',
  save: 'Save banner',
  saved: 'Saved. Participants see the new banner within a minute.',
  loading: 'Loading the home banner…',
  loadFailed: 'The home banner could not be loaded.',
  retry: 'Try again',
  moveUp: (title) => `Move ${title} up`,
  moveDown: (title) => `Move ${title} down`,
  remove: (title) => `Remove ${title}`,
};

function describeSaveError(error) {
  const details = error?.details && typeof error.details === 'object' ? Object.values(error.details) : [];
  return [error?.message || 'The banner could not be saved.', ...details].join(' ');
}

function AdminHomeBannerScreen() {
  const [loadState, setLoadState] = useState('loading'); // loading | ready | error
  const [loadError, setLoadError] = useState('');
  const [maximumSlides, setMaximumSlides] = useState(5);
  const [mode, setMode] = useState(MODES.AUTOMATIC);
  const [slides, setSlides] = useState([]);
  const [fests, setFests] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [festChoice, setFestChoice] = useState('');
  const [promotionChoice, setPromotionChoice] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoadState('loading');
    setLoadError('');
    try {
      const [setting, festList, promotionList] = await Promise.all([
        apiClient.get('/home-banner'),
        apiClient.get('/public/fests'),
        apiClient.get('/promotions'),
      ]);
      const now = Date.now();
      setMode(setting?.mode ?? MODES.AUTOMATIC);
      setMaximumSlides(setting?.maximumSlides ?? 5);
      setSlides(Array.isArray(setting?.slides) ? setting.slides : []);
      setFests(
        (Array.isArray(festList) ? festList : (festList?.fests ?? [])).filter(
          (fest) => !fest.endsOn || new Date(fest.endsOn).getTime() >= now,
        ),
      );
      setPromotions(
        (promotionList?.promotions ?? []).filter((promotion) => promotion.status === 'published'),
      );
      setLoadState('ready');
    } catch (error) {
      setLoadError(error?.message || COPY.loadFailed);
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const placed = useMemo(() => new Set(slides.map((slide) => `${slide.kind}:${slide.id}`)), [slides]);
  const festOptions = fests
    .filter((fest) => !placed.has(`fest:${fest.id}`))
    .map((fest) => ({ value: fest.id, label: fest.festName }));
  const promotionOptions = promotions
    .filter((promotion) => !placed.has(`promotion:${promotion.id}`))
    .map((promotion) => ({
      value: promotion.id,
      label: `${promotion.title}${promotion.mediaType === 'video' ? ' (video)' : ''}`,
    }));
  const isFull = slides.length >= maximumSlides;

  function changeSlides(next) {
    setSlides(next);
    setNotice('');
    setSaveError('');
  }

  function addSlide(kind, id) {
    if (!id || isFull) {
      return;
    }
    const title =
      kind === 'fest'
        ? fests.find((fest) => fest.id === id)?.festName
        : promotions.find((promotion) => promotion.id === id)?.title;
    changeSlides([...slides, { kind, id, title: title ?? id, isShowable: true }]);
    if (kind === 'fest') setFestChoice('');
    else setPromotionChoice('');
  }

  function moveSlide(index, offset) {
    const target = index + offset;
    if (target < 0 || target >= slides.length) {
      return;
    }
    const next = [...slides];
    [next[index], next[target]] = [next[target], next[index]];
    changeSlides(next);
  }

  async function save() {
    setIsSaving(true);
    setSaveError('');
    setNotice('');
    try {
      const result = await apiClient.put('/home-banner', {
        mode,
        slides: slides.map((slide) => ({ kind: slide.kind, id: slide.id })),
      });
      setMode(result?.mode ?? mode);
      setSlides(Array.isArray(result?.slides) ? result.slides : slides);
      setNotice(COPY.saved);
    } catch (error) {
      setSaveError(describeSaveError(error));
    } finally {
      setIsSaving(false);
    }
  }

  if (loadState === 'loading') {
    return <p className="p-6 font-admin-body text-[14px] text-admin-slate-600">{COPY.loading}</p>;
  }

  if (loadState === 'error') {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <AdminErrorBanner message={loadError} />
        <AdminExecutiveButton variant="secondary" iconLeft={<RotateCw size={15} />} onClick={load}>
          {COPY.retry}
        </AdminExecutiveButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 font-admin-heading text-[22px] font-semibold text-admin-neutral-ink">
          <GalleryHorizontal size={20} aria-hidden="true" />
          {COPY.title}
        </h1>
        <p className="font-admin-body text-[14px] text-admin-slate-600">{COPY.lede}</p>
      </header>

      <AdminExecutiveCard>
        <div className="flex flex-col gap-2">
          <AdminSegmentedToggle
            label={COPY.modeLabel}
            name="homeBannerMode"
            value={mode}
            onChange={(next) => {
              setMode(next);
              setNotice('');
              setSaveError('');
            }}
            options={[
              { value: MODES.AUTOMATIC, label: COPY.automatic },
              { value: MODES.CURATED, label: COPY.curated },
            ]}
          />
          <p className="font-admin-body text-[13px] text-admin-slate-600">
            {mode === MODES.AUTOMATIC ? COPY.automaticHelp : COPY.curatedHelp(maximumSlides)}
          </p>
        </div>
      </AdminExecutiveCard>

      {mode === MODES.CURATED ? (
        <AdminExecutiveCard title={`${COPY.slidesTitle} (${slides.length}/${maximumSlides})`}>
          {slides.length === 0 ? (
            <p className="py-4 font-admin-body text-[14px] text-admin-slate-600">{COPY.noSlides}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-admin-slate-200">
              {slides.map((slide, index) => {
                const title = slide.title ?? slide.id;
                return (
                  <li key={`${slide.kind}:${slide.id}`} className="flex items-center gap-3 py-3">
                    <span className="w-6 text-center font-admin-body text-[13px] text-admin-slate-600">
                      {index + 1}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-admin-body text-[14px] font-medium text-admin-neutral-ink">
                        {title}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 font-admin-body text-[12px] text-admin-slate-600">
                        {KIND_LABEL[slide.kind]}
                        {slide.isShowable === false ? (
                          <span title={COPY.notShowingHelp}>
                            <AdminExecutiveChip tone="warning">{COPY.notShowing}</AdminExecutiveChip>
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <AdminExecutiveButton
                      variant="secondary"
                      size="small"
                      aria-label={COPY.moveUp(title)}
                      disabled={index === 0}
                      onClick={() => moveSlide(index, -1)}
                      iconLeft={<ArrowUp size={14} />}
                    />
                    <AdminExecutiveButton
                      variant="secondary"
                      size="small"
                      aria-label={COPY.moveDown(title)}
                      disabled={index === slides.length - 1}
                      onClick={() => moveSlide(index, 1)}
                      iconLeft={<ArrowDown size={14} />}
                    />
                    <AdminExecutiveButton
                      variant="secondary"
                      size="small"
                      aria-label={COPY.remove(title)}
                      onClick={() => changeSlides(slides.filter((_, position) => position !== index))}
                      iconLeft={<Trash2 size={14} />}
                    />
                  </li>
                );
              })}
            </ol>
          )}

          <div className="mt-4 grid gap-4 border-t border-admin-slate-200 pt-4 md:grid-cols-2">
            {[
              {
                kind: 'fest',
                label: COPY.addFest,
                placeholder: COPY.chooseFest,
                options: festOptions,
                value: festChoice,
                setValue: setFestChoice,
              },
              {
                kind: 'promotion',
                label: COPY.addPromotion,
                placeholder: COPY.choosePromotion,
                options: promotionOptions,
                value: promotionChoice,
                setValue: setPromotionChoice,
              },
            ].map((picker) => (
              <div key={picker.kind} className="flex items-end gap-2">
                <AdminExecutiveSelect
                  className="flex-1"
                  label={picker.label}
                  placeholder={picker.placeholder}
                  options={picker.options}
                  value={picker.value}
                  disabled={isFull || picker.options.length === 0}
                  onChange={(changeEvent) => picker.setValue(changeEvent.target.value)}
                />
                <AdminExecutiveButton
                  variant="secondary"
                  iconLeft={<Plus size={15} />}
                  disabled={isFull || !picker.value}
                  onClick={() => addSlide(picker.kind, picker.value)}
                >
                  {COPY.add}
                </AdminExecutiveButton>
              </div>
            ))}
          </div>
          {isFull ? (
            <p className="mt-2 font-admin-body text-[13px] text-admin-slate-600">{COPY.full(maximumSlides)}</p>
          ) : null}
        </AdminExecutiveCard>
      ) : null}

      <AdminErrorBanner message={saveError} />
      {notice ? (
        <p role="status" className="font-admin-body text-[14px] text-admin-status-success-green">
          {notice}
        </p>
      ) : null}

      <div>
        <AdminExecutiveButton
          variant="primary"
          loading={isSaving}
          disabled={mode === MODES.CURATED && slides.length === 0}
          onClick={save}
        >
          {COPY.save}
        </AdminExecutiveButton>
      </div>
    </div>
  );
}

export default AdminHomeBannerScreen;

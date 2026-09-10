// AdminCampaignDetailScreen.jsx
// Route: /admin/system/campaigns/new   — create (stepped wizard, saves as draft)
// Route: /admin/system/campaigns/:campaignId — edit (same form, live-edit rules visible)
//
// Six steps: Promoter & name → Flight → Placements → Delivery → Creatives → Targeting.
// Creates as draft on first save. Publish is a deliberate final action with a
// pre-flight summary. Live-edit rules are shown in advance: disabled fields with
// a reason, audited fields with a note, freely editable fields behave normally.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Image as ImageIcon, Info, Lock, Plus } from 'lucide-react';
import AdminStepIndicator from '../../components-admin/admin-step-indicator/AdminStepIndicator.jsx';
import AdminExecutiveCard from '../../components-admin/admin-executive-card/AdminExecutiveCard.jsx';
import AdminExecutiveButton from '../../components-admin/admin-executive-button/AdminExecutiveButton.jsx';
import AdminExecutiveInput from '../../components-admin/admin-executive-input/AdminExecutiveInput.jsx';
import AdminExecutiveSelect from '../../components-admin/admin-executive-select/AdminExecutiveSelect.jsx';
import AdminExecutiveCheckbox from '../../components-admin/admin-executive-checkbox/AdminExecutiveCheckbox.jsx';
import AdminExecutiveChip from '../../components-admin/admin-executive-chip/AdminExecutiveChip.jsx';
import AdminSegmentedToggle from '../../components-admin/admin-segmented-toggle/AdminSegmentedToggle.jsx';
import AdminErrorBanner from '../../components-admin/admin-error-banner/AdminErrorBanner.jsx';
import AdminModal from '../../components-admin/admin-modal/AdminModal.jsx';
import AdminScreenState from '../../components-admin/admin-screen-state/AdminScreenState.jsx';
import AdminTargetingEditor from '../../components-admin/admin-targeting-editor/AdminTargetingEditor.jsx';
import { normaliseTargeting, EMPTY_TARGETING } from '../../components-admin/admin-targeting-editor/targeting-helpers.js';
import { ADMIN_CAMPAIGNS_COPY as COPY } from '../../brand-admin/brand-copy.js';
import { CampaignStatusChip } from '../admin-campaigns/AdminCampaignsScreen.jsx';
import {
  PLACEMENT_OPTIONS,
  PRIORITY_TIERS,
  REFUSAL_CODES,
  LIVE_EDIT_REFUSED,
  LIVE_EDIT_LOUD,
  isNetworkError,
  campaignsApi,
  promotersApi,
  creativesApi,
  targetingApi,
  campaignPath,
  campaignListPath,
  placementLabel,
  tierLabel,
} from '../../helpers/admin-promotions-api.js';

const STEPS = [
  { id: 'promoter', label: COPY.stepPromoter },
  { id: 'flight', label: COPY.stepFlight },
  { id: 'placements', label: COPY.stepPlacements },
  { id: 'delivery', label: COPY.stepDelivery },
  { id: 'creatives', label: COPY.stepCreatives },
  { id: 'targeting', label: COPY.stepTargeting },
];

const EMPTY_FORM = {
  promoterId: '',
  name: '',
  flightStartsAt: '',
  flightEndsAt: '',
  placementKeys: [],
  priorityTier: 2,
  weight: 1,
  totalImpressionTarget: '',
  maxPerDay: '',
  maxPerFlight: '',
  targeting: EMPTY_TARGETING,
};

function toDateInputValue(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toISOString().slice(0, 10);
}

function formToPayload(form) {
  const payload = {
    promoterId: form.promoterId,
    name: form.name.trim(),
    flightStartsAt: form.flightStartsAt ? new Date(form.flightStartsAt).toISOString() : undefined,
    flightEndsAt: form.flightEndsAt ? new Date(form.flightEndsAt).toISOString() : undefined,
    placementKeys: form.placementKeys,
    priorityTier: form.priorityTier,
    weight: Number(form.weight) || 1,
    pacing: { totalImpressionTarget: form.totalImpressionTarget ? Number(form.totalImpressionTarget) : null },
    frequencyCap: {
      maxPerDay: form.maxPerDay ? Number(form.maxPerDay) : null,
      maxPerFlight: form.maxPerFlight ? Number(form.maxPerFlight) : null,
    },
    targeting: form.targeting ?? EMPTY_TARGETING,
  };
  return payload;
}

function campaignToForm(campaign) {
  return {
    promoterId: campaign.promoterId ?? campaign.promoter?.id ?? '',
    name: campaign.name ?? '',
    flightStartsAt: toDateInputValue(campaign.flightStartsAt),
    flightEndsAt: toDateInputValue(campaign.flightEndsAt),
    placementKeys: campaign.placementKeys ?? [],
    priorityTier: campaign.priorityTier ?? 2,
    weight: campaign.weight ?? 1,
    totalImpressionTarget: campaign.pacing?.totalImpressionTarget ?? '',
    maxPerDay: campaign.frequencyCap?.maxPerDay ?? '',
    maxPerFlight: campaign.frequencyCap?.maxPerFlight ?? '',
    targeting: normaliseTargeting(campaign.targeting),
  };
}

function isLive(campaignStatus) {
  return campaignStatus === 'published' || campaignStatus === 'paused';
}

function fieldDisabledReason(fieldName, campaign) {
  if (!campaign || !isLive(campaign.status)) return null;
  if (campaign.status === 'archived') return 'Archived campaigns cannot be edited.';
  if (LIVE_EDIT_REFUSED.has(fieldName)) {
    if (fieldName === 'promoterId') return COPY.liveEditPromoterRefused;
    if (fieldName === 'flightStartsAt') {
      const started = campaign.flightStartsAt && new Date(campaign.flightStartsAt) <= new Date();
      return started ? COPY.liveEditFlightStartRefused : null;
    }
    return null;
  }
  return null;
}

function fieldAuditNote(fieldName, campaign) {
  if (!campaign || !isLive(campaign.status)) return null;
  if (LIVE_EDIT_LOUD.has(fieldName)) return COPY.liveEditFieldAudited;
  return null;
}

function FieldNote({ note }) {
  if (!note) return null;
  return (
    <p className="mt-1 flex items-start gap-1.5 font-admin-body text-[12px] leading-4 text-admin-slate-600">
      <Info size={13} className="mt-0.5 shrink-0 text-admin-status-warning-amber" />
      {note}
    </p>
  );
}

function DisabledOverlay({ reason }) {
  if (!reason) return null;
  return (
    <p className="mt-1 flex items-start gap-1.5 font-admin-body text-[12px] leading-4 text-admin-slate-600">
      <Lock size={13} className="mt-0.5 shrink-0" />
      {reason}
    </p>
  );
}

function RotationBar({ creatives }) {
  const active = creatives.filter((c) => c.isActive);
  const totalWeight = active.reduce((sum, c) => sum + (c.rotationWeight ?? 1), 0);
  if (totalWeight === 0) return null;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-admin-surface-off-white">
      {active.map((c, i) => {
        const share = ((c.rotationWeight ?? 1) / totalWeight) * 100;
        const hues = [210, 160, 280, 30, 340, 50];
        return (
          <div
            key={c.creativeId}
            style={{ width: `${share}%`, backgroundColor: `hsl(${hues[i % hues.length]}, 60%, 55%)` }}
            title={`${c.title ?? 'Creative'}: ${Math.round(share)}%`}
          />
        );
      })}
    </div>
  );
}

function AdminCampaignDetailScreen() {
  const { campaignId } = useParams();
  const isCreateMode = !campaignId;
  const navigate = useNavigate();

  const [loadStatus, setLoadStatus] = useState(isCreateMode ? 'ready' : 'loading');
  const [loadError, setLoadError] = useState('');
  const [campaign, setCampaign] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState('');

  const [promoters, setPromoters] = useState([]);
  const [promoterCreatives, setPromoterCreatives] = useState([]);
  const [campaignCreatives, setCampaignCreatives] = useState([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachWeight, setAttachWeight] = useState(1);
  const [attachCreativeId, setAttachCreativeId] = useState('');
  const [attachError, setAttachError] = useState('');

  const [draftId, setDraftId] = useState(campaignId ?? null);

  const load = useCallback(async () => {
    if (isCreateMode) {
      try {
        const result = await promotersApi.list({ limit: 200 });
        setPromoters(result.promoters ?? []);
      } catch { /* filters stay empty */ }
      setLoadStatus('ready');
      return;
    }
    setLoadStatus('loading');
    setLoadError('');
    try {
      const [detail, promoterResult] = await Promise.all([
        campaignsApi.get(campaignId),
        promoters.length > 0 ? Promise.resolve(null) : promotersApi.list({ limit: 200 }),
      ]);
      const c = detail.data ?? detail;
      setCampaign(c);
      setForm(campaignToForm(c));
      setCampaignCreatives(c.creatives ?? []);
      setDraftId(c.id ?? c._id ?? campaignId);
      if (promoterResult) setPromoters(promoterResult.promoters ?? []);
      setLoadStatus('ready');
    } catch (error) {
      setLoadError(isNetworkError(error) ? '' : error?.message || COPY.loadFailed);
      setLoadStatus(isNetworkError(error) ? 'offline' : 'error');
    }
  }, [campaignId, isCreateMode, promoters.length]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (!form.promoterId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPromoterCreatives([]);
      return;
    }
    let stale = false;
    creativesApi.list({ promoterId: form.promoterId, limit: 200 })
      .then((r) => { if (!stale) setPromoterCreatives(r.creatives ?? []); })
      .catch(() => {});
    return () => { stale = true; };
  }, [form.promoterId]);

  function updateField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function validateStep(stepIndex) {
    const errs = {};
    if (stepIndex === 0) {
      if (!form.promoterId) errs.promoterId = COPY.promoterRequired;
      if (!form.name.trim()) errs.name = COPY.campaignNameRequired;
    }
    if (stepIndex === 1) {
      if (!form.flightStartsAt) errs.flightStartsAt = COPY.flightStartRequired;
      if (!form.flightEndsAt) errs.flightEndsAt = COPY.flightEndRequired;
      if (form.flightStartsAt && form.flightEndsAt && form.flightEndsAt < form.flightStartsAt) {
        errs.flightEndsAt = COPY.flightEndBeforeStart;
      }
    }
    if (stepIndex === 3) {
      const day = Number(form.maxPerDay) || 0;
      const flight = Number(form.maxPerFlight) || 0;
      if (day > 0 && flight > 0 && flight < day) {
        errs.maxPerFlight = COPY.capError;
      }
    }
    return errs;
  }

  function handleNext() {
    const stepErrors = validateStep(step);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;
    setServerError('');
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  }

  async function saveDraft() {
    const stepErrors = validateStep(step);
    setErrors(stepErrors);
    if (Object.keys(stepErrors).length > 0) return;

    if (step === 5) {
      try {
        const vResult = await targetingApi.validate(normaliseTargeting(form.targeting));
        const vData = vResult.data ?? vResult;
        if ((vData.errors ?? []).length > 0) {
          setServerError(vData.errors.map((e) => e.message).join(' '));
          return;
        }
      } catch { /* validation fetch failed — proceed, backend will enforce */ }
    }

    setSaving(true);
    setServerError('');
    try {
      const payload = formToPayload(form);
      if (draftId) {
        const result = await campaignsApi.update(draftId, payload);
        const updated = result.data ?? result;
        setCampaign(updated);
        setCampaignCreatives(updated.creatives ?? campaignCreatives);
      } else {
        const result = await campaignsApi.create(payload);
        const created = result.data ?? result;
        const newId = created.id ?? created._id;
        setDraftId(newId);
        setCampaign(created);
        navigate(campaignPath(newId), { replace: true });
      }
      setNotice(COPY.saved);
    } catch (error) {
      if (error?.code === REFUSAL_CODES.EDIT_REFUSED) {
        setServerError(Object.values(error.details ?? {}).join(' '));
      } else {
        setServerError(error?.message || COPY.saveFailed);
      }
    } finally {
      setSaving(false);
    }
  }

  const publishBlocked = useMemo(() => {
    const issues = [];
    if ((form.placementKeys ?? []).length === 0) issues.push(COPY.publishBlockedNoPlacement);
    const activeCreatives = campaignCreatives.filter((c) => c.isActive);
    if (activeCreatives.length === 0) issues.push(COPY.publishBlockedNoCreative);
    return issues;
  }, [form.placementKeys, campaignCreatives]);

  async function handlePublish() {
    if (publishBlocked.length > 0) return;
    setPublishing(true);
    setServerError('');
    try {
      let publishId = draftId;
      if (!publishId) {
        const result = await campaignsApi.create(formToPayload(form));
        publishId = (result.data ?? result).id ?? (result.data ?? result)._id;
        setDraftId(publishId);
      } else {
        await campaignsApi.update(publishId, formToPayload(form));
      }
      await campaignsApi.publish(publishId);
      navigate(campaignListPath());
    } catch (error) {
      if (error?.code === REFUSAL_CODES.NOT_PUBLISHABLE) {
        setServerError(`${COPY.notPublishableBody} ${error.details?.reason ?? ''}`);
      } else {
        setServerError(error?.message || COPY.actionFailed);
      }
    } finally {
      setPublishing(false);
    }
  }

  async function handleAttach() {
    if (!attachCreativeId) return;
    setAttachError('');
    try {
      await campaignsApi.attachCreative(draftId, {
        creativeId: attachCreativeId,
        rotationWeight: Number(attachWeight) || 1,
      });
      const detail = await campaignsApi.get(draftId);
      const c = detail.data ?? detail;
      setCampaignCreatives(c.creatives ?? []);
      setCampaign(c);
      setAttachOpen(false);
      setAttachCreativeId('');
      setAttachWeight(1);
    } catch (error) {
      setAttachError(error?.message || COPY.actionFailed);
    }
  }

  async function updateAssociation(creativeId, payload) {
    setServerError('');
    try {
      await campaignsApi.updateAssociation(draftId, creativeId, payload);
      const detail = await campaignsApi.get(draftId);
      const c = detail.data ?? detail;
      setCampaignCreatives(c.creatives ?? []);
      setCampaign(c);
    } catch (error) {
      if (error?.code === REFUSAL_CODES.LAST_ACTIVE_CREATIVE) {
        setServerError(COPY.lastActiveWarning);
      } else {
        setServerError(error?.message || COPY.actionFailed);
      }
    }
  }

  async function detachCreative(creativeId) {
    setServerError('');
    try {
      await campaignsApi.detachCreative(draftId, creativeId);
      const detail = await campaignsApi.get(draftId);
      const c = detail.data ?? detail;
      setCampaignCreatives(c.creatives ?? []);
      setCampaign(c);
    } catch (error) {
      if (error?.code === REFUSAL_CODES.LAST_ACTIVE_CREATIVE) {
        setServerError(COPY.lastActiveWarning);
      } else {
        setServerError(error?.message || COPY.actionFailed);
      }
    }
  }

  if (loadStatus === 'loading') return <AdminScreenState tone="loading" message={COPY.loading} />;
  if (loadStatus === 'offline') return <AdminScreenState tone="offline" message={COPY.offline} actionLabel={COPY.retry} onAction={load} />;
  if (loadStatus === 'error') return <AdminScreenState tone="error" message={loadError || COPY.loadFailed} actionLabel={COPY.retry} onAction={load} />;

  const isLiveCampaign = campaign && isLive(campaign.status);
  const isArchived = campaign?.status === 'archived';
  const isDraft = !campaign || campaign.status === 'draft';
  const promoterOptions = promoters.map((p) => ({ value: p.id, label: p.displayName }));
  const activeCreatives = campaignCreatives.filter((c) => c.isActive);
  const totalWeight = activeCreatives.reduce((sum, c) => sum + (c.rotationWeight ?? 1), 0);

  const availableToAttach = promoterCreatives.filter(
    (pc) => pc.status !== 'inactive' && !campaignCreatives.some((cc) => cc.creativeId === pc.id),
  );

  const isLastActive = (creative) => {
    return isLiveCampaign && activeCreatives.length === 1 && creative.isActive;
  };

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AdminExecutiveButton variant="ghost" size="small" iconLeft={<ArrowLeft size={15} />} onClick={() => navigate(campaignListPath())}>
            {COPY.backToList}
          </AdminExecutiveButton>
          <h1 className="font-admin-display text-[22px] font-semibold text-admin-neutral-ink">
            {isCreateMode ? COPY.createTitle : COPY.editTitle}
          </h1>
          {campaign ? <CampaignStatusChip status={campaign.status} flightState={campaign.flightState} /> : null}
        </div>
        <div className="flex items-center gap-2">
          {!isArchived ? (
            <AdminExecutiveButton variant="secondary" loading={saving} onClick={saveDraft}>
              {saving ? COPY.saving : COPY.saveDraft}
            </AdminExecutiveButton>
          ) : null}
        </div>
      </div>

      <AdminStepIndicator steps={STEPS} currentIndex={step} onStepSelect={setStep} />

      <AdminErrorBanner message={serverError} />
      {notice ? (
        <div role="status" className="rounded-md border border-admin-status-success-green/30 bg-admin-status-success-green/5 px-4 py-3 font-admin-body text-[14px] leading-5 text-admin-status-success-green">
          {notice}
        </div>
      ) : null}

      {/* STEP 0: Promoter & Name */}
      {step === 0 ? (
        <AdminExecutiveCard>
          <div className="flex flex-col gap-6">
            <div>
              <AdminExecutiveSelect
                label={COPY.promoterLabel}
                required
                placeholder={COPY.anyPromoter}
                options={promoterOptions}
                value={form.promoterId}
                onChange={(e) => updateField('promoterId', e.target.value)}
                errorMessage={errors.promoterId}
                disabled={Boolean(fieldDisabledReason('promoterId', campaign))}
              />
              <DisabledOverlay reason={fieldDisabledReason('promoterId', campaign)} />
            </div>
            <AdminExecutiveInput
              label={COPY.campaignNameLabel}
              required
              placeholder={COPY.campaignNamePlaceholder}
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              errorMessage={errors.name}
            />
          </div>
        </AdminExecutiveCard>
      ) : null}

      {/* STEP 1: Flight */}
      {step === 1 ? (
        <AdminExecutiveCard>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <AdminExecutiveInput
                label={COPY.flightStartLabel}
                required
                type="date"
                value={form.flightStartsAt}
                onChange={(e) => updateField('flightStartsAt', e.target.value)}
                errorMessage={errors.flightStartsAt}
                disabled={Boolean(fieldDisabledReason('flightStartsAt', campaign))}
              />
              <DisabledOverlay reason={fieldDisabledReason('flightStartsAt', campaign)} />
              <FieldNote note={fieldAuditNote('flightStartsAt', campaign)} />
            </div>
            <div>
              <AdminExecutiveInput
                label={COPY.flightEndLabel}
                required
                type="date"
                value={form.flightEndsAt}
                onChange={(e) => updateField('flightEndsAt', e.target.value)}
                errorMessage={errors.flightEndsAt}
              />
              <FieldNote note={fieldAuditNote('flightEndsAt', campaign)} />
              {isLiveCampaign ? (
                <p className="mt-1 font-admin-body text-[12px] text-admin-slate-600">
                  {COPY.liveEditFlightEndRefused}
                </p>
              ) : null}
            </div>
          </div>
        </AdminExecutiveCard>
      ) : null}

      {/* STEP 2: Placements */}
      {step === 2 ? (
        <AdminExecutiveCard>
          <div className="flex flex-col gap-4">
            <div>
              <p className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">{COPY.placementsHeading}</p>
              <p className="mt-1 font-admin-body text-[13px] text-admin-slate-600">{COPY.placementsNote}</p>
            </div>
            <FieldNote note={fieldAuditNote('placementKeys', campaign)} />
            {PLACEMENT_OPTIONS.map((placement) => (
              <AdminExecutiveCheckbox
                key={placement.value}
                label={placement.label}
                checked={form.placementKeys.includes(placement.value)}
                onChange={() => {
                  const keys = form.placementKeys.includes(placement.value)
                    ? form.placementKeys.filter((k) => k !== placement.value)
                    : [...form.placementKeys, placement.value];
                  updateField('placementKeys', keys);
                }}
              />
            ))}
            {errors.placementKeys ? (
              <p className="font-admin-body text-[13px] text-admin-status-error-red">{errors.placementKeys}</p>
            ) : null}
          </div>
        </AdminExecutiveCard>
      ) : null}

      {/* STEP 3: Delivery */}
      {step === 3 ? (
        <AdminExecutiveCard>
          <div className="flex flex-col gap-6">
            <div>
              <AdminSegmentedToggle
                label={COPY.tierLabel}
                options={PRIORITY_TIERS.map((t) => ({ value: t.value, label: t.label }))}
                value={form.priorityTier}
                onChange={(value) => updateField('priorityTier', value)}
                name="priorityTier"
              />
              <p className="mt-1 font-admin-body text-[12px] text-admin-slate-600">{COPY.tierNote}</p>
              <FieldNote note={fieldAuditNote('priorityTier', campaign)} />
            </div>

            <div>
              <AdminExecutiveInput
                label={COPY.weightLabel}
                type="number"
                min={1}
                value={String(form.weight)}
                onChange={(e) => updateField('weight', Number(e.target.value) || 1)}
              />
              <p className="mt-1 font-admin-body text-[12px] text-admin-slate-600">{COPY.weightNote}</p>
              <FieldNote note={fieldAuditNote('weight', campaign)} />
            </div>

            <div>
              <AdminExecutiveInput
                label={COPY.pacingLabel}
                type="number"
                min={0}
                placeholder={COPY.pacingPlaceholder}
                value={form.totalImpressionTarget === '' ? '' : String(form.totalImpressionTarget)}
                onChange={(e) => updateField('totalImpressionTarget', e.target.value === '' ? '' : Number(e.target.value))}
              />
              <p className="mt-1 font-admin-body text-[12px] text-admin-slate-600">{COPY.pacingNote}</p>
              <FieldNote note={fieldAuditNote('pacing', campaign)} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AdminExecutiveInput
                label={COPY.maxPerDayLabel}
                type="number"
                min={0}
                placeholder={COPY.maxPerDayPlaceholder}
                value={form.maxPerDay === '' ? '' : String(form.maxPerDay)}
                onChange={(e) => updateField('maxPerDay', e.target.value === '' ? '' : Number(e.target.value))}
              />
              <div>
                <AdminExecutiveInput
                  label={COPY.maxPerFlightLabel}
                  type="number"
                  min={0}
                  placeholder={COPY.maxPerFlightPlaceholder}
                  value={form.maxPerFlight === '' ? '' : String(form.maxPerFlight)}
                  onChange={(e) => updateField('maxPerFlight', e.target.value === '' ? '' : Number(e.target.value))}
                  errorMessage={errors.maxPerFlight}
                />
              </div>
            </div>
            <p className="font-admin-body text-[12px] text-admin-slate-600">{COPY.capNote}</p>
          </div>
        </AdminExecutiveCard>
      ) : null}

      {/* STEP 4: Creatives */}
      {step === 4 ? (
        <AdminExecutiveCard>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <p className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">{COPY.creativesHeading}</p>
              {draftId ? (
                <AdminExecutiveButton
                  variant="secondary"
                  size="small"
                  iconLeft={<Plus size={14} />}
                  onClick={() => setAttachOpen(true)}
                  disabled={availableToAttach.length === 0 || isArchived}
                >
                  {COPY.attachCreative}
                </AdminExecutiveButton>
              ) : null}
            </div>

            {!draftId ? (
              <p className="font-admin-body text-[13px] text-admin-slate-600">
                Save the draft first to attach creatives.
              </p>
            ) : null}

            {draftId && campaignCreatives.length === 0 ? (
              <p className="font-admin-body text-[13px] text-admin-slate-600">{COPY.noCreativesAttached}</p>
            ) : null}

            {availableToAttach.length === 0 && campaignCreatives.length === 0 && draftId ? (
              <p className="font-admin-body text-[13px] text-admin-status-warning-amber">{COPY.noCreativesAvailable}</p>
            ) : null}

            {campaignCreatives.length > 0 ? <RotationBar creatives={campaignCreatives} /> : null}

            <ul className="flex flex-col gap-3">
              {campaignCreatives.map((cc) => {
                const share = totalWeight > 0 && cc.isActive ? Math.round(((cc.rotationWeight ?? 1) / totalWeight) * 100) : 0;
                const isLast = isLastActive(cc);
                return (
                  <li key={cc.creativeId} className="flex items-center gap-3 rounded-md border border-admin-slate-200 p-3">
                    <div className="h-12 w-20 shrink-0 overflow-hidden rounded bg-admin-surface-off-white">
                      {cc.imageUrl ? <img src={cc.imageUrl} alt="" className="h-full w-full object-cover" /> : (
                        <div className="flex h-full items-center justify-center"><ImageIcon size={18} className="text-admin-slate-600" /></div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-admin-body text-[14px] font-medium text-admin-neutral-ink">{cc.title ?? 'Creative'}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        {!cc.isActive ? <AdminExecutiveChip tone="warning">{COPY.creativePausedChip}</AdminExecutiveChip> : null}
                        {cc.isActive ? (
                          <span className="font-admin-mono text-[12px] text-admin-slate-600">{share}% share</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="flex items-center gap-1.5 font-admin-body text-[12px] text-admin-slate-600">
                        {COPY.rotationWeightLabel}
                        <input
                          type="number"
                          min={1}
                          className="w-14 rounded border border-admin-slate-200 bg-admin-surface-white px-2 py-1 font-admin-mono text-[13px] text-admin-neutral-ink"
                          value={cc.rotationWeight ?? 1}
                          onChange={(e) => updateAssociation(cc.creativeId, { rotationWeight: Math.max(1, Number(e.target.value) || 1) })}
                          disabled={isArchived}
                        />
                      </label>
                    </div>
                    {!isArchived ? (
                      <div className="flex items-center gap-1">
                        {cc.isActive ? (
                          <button
                            type="button"
                            className="rounded px-2 py-1 font-admin-body text-[12px] text-admin-slate-600 hover:bg-admin-surface-off-white disabled:opacity-40"
                            onClick={() => updateAssociation(cc.creativeId, { isActive: false })}
                            disabled={isLast}
                            title={isLast ? COPY.lastActiveWarning : COPY.pauseAssociation}
                          >
                            {COPY.pauseAssociation}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="rounded px-2 py-1 font-admin-body text-[12px] text-admin-primary-blue hover:bg-admin-surface-off-white"
                            onClick={() => updateAssociation(cc.creativeId, { isActive: true })}
                          >
                            {COPY.resumeAssociation}
                          </button>
                        )}
                        <button
                          type="button"
                          className="rounded px-2 py-1 font-admin-body text-[12px] text-admin-status-error-red hover:bg-admin-status-error-red/5 disabled:opacity-40"
                          onClick={() => detachCreative(cc.creativeId)}
                          disabled={isLast}
                          title={isLast ? COPY.lastActiveWarning : COPY.detachAction}
                        >
                          {COPY.detachAction}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </AdminExecutiveCard>
      ) : null}

      {/* STEP 5: Targeting */}
      {step === 5 ? (
        <AdminExecutiveCard>
          <AdminTargetingEditor
            targeting={form.targeting}
            onChange={(next) => updateField('targeting', next)}
            campaign={campaign}
            isLive={isLiveCampaign}
          />
        </AdminExecutiveCard>
      ) : null}

      {/* Navigation */}
      <div className="flex items-center justify-between border-t border-admin-slate-200 pt-4">
        <div>
          {step > 0 ? (
            <AdminExecutiveButton variant="ghost" onClick={() => setStep(step - 1)}>
              {COPY.previousStep}
            </AdminExecutiveButton>
          ) : (
            <button
              type="button"
              onClick={() => navigate(campaignListPath())}
              className="font-admin-body text-[14px] text-admin-slate-600 transition-colors hover:text-admin-neutral-ink"
            >
              {COPY.cancel}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {step < STEPS.length - 1 ? (
            <AdminExecutiveButton variant="primary" onClick={handleNext}>
              {COPY.nextStep}
            </AdminExecutiveButton>
          ) : null}
          {step === STEPS.length - 1 && isDraft ? (
            <div className="flex flex-col items-end gap-3">
              {publishBlocked.length > 0 ? (
                <div className="rounded-md border border-admin-status-warning-amber/30 bg-admin-status-warning-amber/5 px-4 py-3">
                  <p className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">{COPY.publishBlockedHeading}</p>
                  <ul className="mt-1 list-disc pl-5 font-admin-body text-[13px] text-admin-slate-600">
                    {publishBlocked.map((issue) => <li key={issue}>{issue}</li>)}
                  </ul>
                </div>
              ) : (
                <AdminExecutiveCard>
                  <div className="flex flex-col gap-2">
                    <p className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">{COPY.publishHeading}</p>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-admin-body text-[13px]">
                      <dt className="text-admin-slate-600">{COPY.publishSummaryPromoter}</dt>
                      <dd className="text-admin-neutral-ink">{promoters.find((p) => p.id === form.promoterId)?.displayName ?? '—'}</dd>
                      <dt className="text-admin-slate-600">{COPY.publishSummaryFlight}</dt>
                      <dd className="text-admin-neutral-ink">{form.flightStartsAt} → {form.flightEndsAt}</dd>
                      <dt className="text-admin-slate-600">{COPY.publishSummaryPlacements}</dt>
                      <dd className="text-admin-neutral-ink">{form.placementKeys.map(placementLabel).join(', ') || '—'}</dd>
                      <dt className="text-admin-slate-600">{COPY.publishSummaryCreatives}</dt>
                      <dd className="text-admin-neutral-ink">{activeCreatives.length} active</dd>
                      <dt className="text-admin-slate-600">{COPY.publishSummaryTier}</dt>
                      <dd className="text-admin-neutral-ink">{tierLabel(form.priorityTier)}</dd>
                    </dl>
                    <AdminExecutiveButton variant="primary" loading={publishing} onClick={handlePublish}>
                      {publishing ? COPY.publishing : COPY.publishButton}
                    </AdminExecutiveButton>
                  </div>
                </AdminExecutiveCard>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Attach creative modal */}
      <AdminModal
        isOpen={attachOpen}
        title={COPY.attachModalTitle}
        confirmLabel={COPY.attachCreative}
        cancelLabel={COPY.cancel}
        confirmDisabled={!attachCreativeId}
        onConfirm={handleAttach}
        onCancel={() => { setAttachOpen(false); setAttachError(''); }}
      >
        <div className="flex flex-col gap-4">
          <AdminErrorBanner message={attachError} />
          {availableToAttach.length === 0 ? (
            <p className="font-admin-body text-[13px] text-admin-slate-600">{COPY.noCreativesAvailable}</p>
          ) : (
            <ul className="flex max-h-[300px] flex-col gap-2 overflow-y-auto">
              {availableToAttach.map((creative) => (
                <li key={creative.id}>
                  <button
                    type="button"
                    onClick={() => setAttachCreativeId(creative.id)}
                    className={[
                      'flex w-full items-center gap-3 rounded-md border p-2 text-left transition-colors',
                      attachCreativeId === creative.id
                        ? 'border-admin-primary-blue bg-admin-primary-blue/5'
                        : 'border-admin-slate-200 hover:bg-admin-surface-off-white',
                    ].join(' ')}
                  >
                    <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-admin-surface-off-white">
                      {creative.imageUrl ? <img src={creative.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
                    </div>
                    <span className="truncate font-admin-body text-[14px] text-admin-neutral-ink">{creative.title}</span>
                    {attachCreativeId === creative.id ? <Check size={16} className="ml-auto shrink-0 text-admin-primary-blue" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <AdminExecutiveInput
            label={COPY.rotationWeightLabel}
            type="number"
            min={1}
            value={String(attachWeight)}
            onChange={(e) => setAttachWeight(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
      </AdminModal>
    </div>
  );
}

export default AdminCampaignDetailScreen;

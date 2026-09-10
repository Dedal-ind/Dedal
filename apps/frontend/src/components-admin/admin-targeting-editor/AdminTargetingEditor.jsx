// AdminTargetingEditor.jsx
// The targeting predicate editor for the campaign wizard. Five dimensions, each
// with include and exclude sets. Driven entirely by the options endpoint —
// closed dimensions offer a pick list only, open dimensions accept free text.
//
// Reach is estimated live as the predicate changes (debounced). Validation
// findings are shown per-dimension.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Info, Users } from 'lucide-react';
import AdminCollapsibleSection from '../admin-collapsible-section/AdminCollapsibleSection.jsx';
import AdminTokenInput from '../admin-token-input/AdminTokenInput.jsx';
import AdminScreenState from '../admin-screen-state/AdminScreenState.jsx';
import { targetingApi } from '../../helpers/admin-promotions-api.js';
import { DIMENSION_ORDER, normaliseTargeting, isTargetingEmpty } from './targeting-helpers.js';

const DIMENSION_META = {
  collegeIds: { label: 'Colleges', includeHelp: 'Only these colleges', excludeHelp: 'Never these colleges' },
  cities: { label: 'Cities', includeHelp: 'Only these cities', excludeHelp: 'Never these cities' },
  departments: { label: 'Departments', includeHelp: 'Only these departments', excludeHelp: 'Never these departments' },
  yearsOfStudy: { label: 'Years of study', includeHelp: 'Only these years', excludeHelp: 'Never these years' },
  festIds: { label: 'Fests', includeHelp: 'Registered for these fests', excludeHelp: 'Not registered for these' },
};

function dimensionCount(targeting, dim) {
  return (targeting.include[dim]?.length ?? 0) + (targeting.exclude[dim]?.length ?? 0);
}

function buildOptionsForDimension(dim, rawValues) {
  if (!rawValues) return [];
  if (dim === 'collegeIds') {
    return rawValues.map((c) => ({ value: c.id, label: `${c.name}${c.city ? ` — ${c.city}` : ''}` }));
  }
  if (dim === 'festIds') {
    return rawValues.map((f) => ({
      value: f.id,
      label: `${f.name}${f.college?.name ? ` (${f.college.name})` : ''}`,
    }));
  }
  if (dim === 'yearsOfStudy') {
    return rawValues.map((y) => ({ value: String(y), label: `Year ${y}` }));
  }
  return rawValues.map((v) => ({ value: v, label: v }));
}

function isDimensionOpen(dim, optionsData) {
  return optionsData?.[dim]?.closed === false;
}

function buildPredicateSummary(targeting) {
  if (isTargetingEmpty(targeting)) return 'Untargeted — reaches everyone.';
  const parts = [];
  for (const dim of DIMENSION_ORDER) {
    const inc = targeting.include[dim] ?? [];
    const exc = targeting.exclude[dim] ?? [];
    const dimLabel = DIMENSION_META[dim].label.toLowerCase();
    if (inc.length > 0) parts.push(`include ${inc.length} ${dimLabel}`);
    if (exc.length > 0) parts.push(`exclude ${exc.length} ${dimLabel}`);
  }
  return parts.join(', ') + '.';
}

function AdminTargetingEditor({ targeting, onChange, isLive }) {
  const [optionsStatus, setOptionsStatus] = useState('loading');
  const [optionsData, setOptionsData] = useState(null);
  const [optionsError, setOptionsError] = useState('');

  const [estimate, setEstimate] = useState(null);
  const [estimateStatus, setEstimateStatus] = useState('idle');
  const [estimateError, setEstimateError] = useState('');

  const [validation, setValidation] = useState(null);
  const [openDimensions, setOpenDimensions] = useState({});

  const debounceRef = useRef(null);
  const normalised = useMemo(() => normaliseTargeting(targeting), [targeting]);
  const auditNote = isLive
    ? 'Changes to targeting on a live campaign are recorded in the audit log.'
    : null;

  const loadOptions = useCallback(async () => {
    setOptionsStatus('loading');
    setOptionsError('');
    try {
      const result = await targetingApi.options();
      setOptionsData(result.data ?? result);
      setOptionsStatus('ready');
    } catch (error) {
      setOptionsError(error?.message || 'Could not load targeting options.');
      setOptionsStatus('error');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadOptions();
  }, [loadOptions]);

  async function fetchEstimate(pred) {
    setEstimateStatus('loading');
    setEstimateError('');
    try {
      const result = await targetingApi.estimate(pred);
      setEstimate(result.data ?? result);
      setEstimateStatus('ready');
    } catch (error) {
      if (error?.code === 'VALIDATION_FAILED') {
        setEstimateError('Fix the targeting errors below before estimating reach.');
      } else {
        setEstimateError(error?.message || 'Could not estimate reach.');
      }
      setEstimateStatus('error');
    }
  }

  async function runValidation(pred) {
    try {
      const result = await targetingApi.validate(pred);
      const data = result.data ?? result;
      setValidation(data);
    } catch {
      setValidation(null);
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchEstimate(normalised);
      runValidation(normalised);
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targeting]);

  function findingsForDimension(dim) {
    if (!validation) return { errors: [], warnings: [] };
    const errors = (validation.errors ?? []).filter((f) => f.path?.includes(dim));
    const warnings = (validation.warnings ?? []).filter((f) => f.path?.includes(dim));
    return { errors, warnings };
  }

  function updateDimension(half, dim, values) {
    const next = {
      include: { ...normalised.include },
      exclude: { ...normalised.exclude },
    };
    if (dim === 'yearsOfStudy') {
      next[half][dim] = values.map((v) => (typeof v === 'string' ? Number(v) : v));
    } else {
      next[half][dim] = values;
    }
    onChange(next);
  }

  function toggleDimension(dim) {
    setOpenDimensions((prev) => ({ ...prev, [dim]: !prev[dim] }));
  }

  if (optionsStatus === 'loading') {
    return <AdminScreenState tone="loading" message="Loading targeting options…" />;
  }
  if (optionsStatus === 'error') {
    return (
      <AdminScreenState
        tone="error"
        message={optionsError || 'Could not load targeting options.'}
        actionLabel="Retry"
        onAction={loadOptions}
      />
    );
  }

  const untargeted = isTargetingEmpty(normalised);

  return (
    <div className="flex flex-col gap-5">
      {auditNote ? (
        <p className="flex items-start gap-1.5 font-admin-body text-[12px] leading-4 text-admin-slate-600">
          <Info size={13} className="mt-0.5 shrink-0 text-admin-status-warning-amber" />
          {auditNote}
        </p>
      ) : null}

      {/* Predicate summary */}
      <div className="rounded-md border border-admin-slate-200 bg-admin-surface-off-white px-4 py-3">
        <p className="font-admin-body text-[13px] font-medium text-admin-neutral-ink">
          {buildPredicateSummary(normalised)}
        </p>
        {untargeted ? (
          <p className="mt-1 font-admin-body text-[12px] text-admin-slate-600">
            No filters set on any dimension — this campaign will be served to everyone, including minors.
          </p>
        ) : null}
      </div>

      {/* Dimensions */}
      {DIMENSION_ORDER.map((dim) => {
        const meta = DIMENSION_META[dim];
        const count = dimensionCount(normalised, dim);
        const rawValues = optionsData?.[dim]?.values ?? [];
        const options = buildOptionsForDimension(dim, rawValues);
        const isFreeText = isDimensionOpen(dim, optionsData);
        const findings = findingsForDimension(dim);
        const incValues = (normalised.include[dim] ?? []).map(String);
        const excValues = (normalised.exclude[dim] ?? []).map(String);

        return (
          <AdminCollapsibleSection
            key={dim}
            title={meta.label}
            description={count === 0 ? 'No constraint' : undefined}
            badge={count > 0 ? count : null}
            isOpen={openDimensions[dim] ?? false}
            onToggle={() => toggleDimension(dim)}
          >
            <div className="flex flex-col gap-4">
              <AdminTokenInput
                label={meta.includeHelp}
                options={options}
                value={incValues}
                onChange={(vals) => updateDimension('include', dim, vals)}
                allowFreeText={isFreeText}
                placeholder={isFreeText ? 'Type to search or add…' : 'Type to search…'}
                helperText={incValues.length === 0 ? 'Empty — no constraint on this dimension.' : undefined}
                errorMessage={findings.errors.length > 0 ? findings.errors.map((e) => e.message).join(' ') : undefined}
                warningMessage={findings.warnings.length > 0 ? findings.warnings.map((w) => w.message).join(' ') : undefined}
              />
              <AdminTokenInput
                label={meta.excludeHelp}
                options={options}
                value={excValues}
                onChange={(vals) => updateDimension('exclude', dim, vals)}
                allowFreeText={isFreeText}
                placeholder={isFreeText ? 'Type to search or add…' : 'Type to search…'}
                helperText="Exclude always beats include."
              />
            </div>
          </AdminCollapsibleSection>
        );
      })}

      {/* Reach panel */}
      <div className="rounded-md border border-admin-slate-200 bg-admin-surface-white px-4 py-4">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-admin-primary-blue" />
          <span className="font-admin-body text-[14px] font-semibold text-admin-neutral-ink">Estimated reach</span>
          {estimateStatus === 'loading' ? (
            <span className="font-admin-body text-[12px] text-admin-slate-600">Calculating…</span>
          ) : null}
        </div>

        {estimateStatus === 'error' ? (
          <p className="mt-2 font-admin-body text-[13px] text-admin-status-warning-amber">{estimateError}</p>
        ) : null}

        {estimateStatus === 'ready' && estimate ? (
          <div className="mt-3 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ReachFigure
                value={estimate.totalParticipants}
                label="Total participants"
                explanation={estimate.explanation?.totalParticipants}
              />
              <ReachFigure
                value={estimate.attributeMatches}
                label="Attribute matches"
                explanation={estimate.explanation?.attributeMatches}
                muted
              />
              <ReachFigure
                value={estimate.eligibleReach}
                label="Eligible reach"
                explanation={estimate.explanation?.eligibleReach}
                highlight
              />
              <ReachFigure
                value={estimate.ageRestricted}
                label="Age-restricted"
                explanation={estimate.explanation?.ageRestricted}
                muted
              />
            </div>

            {!untargeted && estimate.ageRestricted > 0 ? (
              <div className="flex items-start gap-1.5 rounded-md border border-admin-status-warning-amber/30 bg-admin-status-warning-amber/5 px-3 py-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-admin-status-warning-amber" />
                <p className="font-admin-body text-[12px] leading-4 text-admin-neutral-ink">
                  {estimate.ageRestricted} participant{estimate.ageRestricted === 1 ? '' : 's'} matched the predicate
                  but {estimate.ageRestricted === 1 ? 'is' : 'are'} under eighteen or of unknown age.
                  Targeted campaigns cannot reach them — only untargeted campaigns can.
                  The eligible reach ({estimate.eligibleReach}) is the number this campaign can actually serve.
                </p>
              </div>
            ) : null}

            {estimate.eligibleReach === 0 && !untargeted ? (
              <div className="flex items-start gap-1.5 rounded-md border border-admin-status-warning-amber/30 bg-admin-status-warning-amber/5 px-3 py-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-admin-status-warning-amber" />
                <p className="font-admin-body text-[12px] leading-4 text-admin-neutral-ink">
                  No participants match this predicate right now. The campaign can still be saved — check whether the
                  targeting is intentionally narrow or whether a filter is excluding everyone.
                </p>
              </div>
            ) : null}

            <p className="font-admin-body text-[11px] text-admin-slate-600">
              {estimate.explanation?.note ?? 'A snapshot of who matches now, not a forecast of who will be reached during the flight.'}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReachFigure({ value, label, explanation, highlight, muted }) {
  return (
    <div className="flex flex-col gap-0.5" title={explanation}>
      <span
        className={[
          'font-admin-mono text-[20px] font-bold',
          highlight ? 'text-admin-primary-blue' : muted ? 'text-admin-slate-600' : 'text-admin-neutral-ink',
        ].join(' ')}
      >
        {typeof value === 'number' ? value.toLocaleString('en-IN') : '—'}
      </span>
      <span className="font-admin-body text-[11px] leading-3 text-admin-slate-600">{label}</span>
    </div>
  );
}

export default AdminTargetingEditor;
